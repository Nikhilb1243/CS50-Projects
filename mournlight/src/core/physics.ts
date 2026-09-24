import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Time } from './time';

/** Collision membership bits. */
export const G = {
  WORLD: 1 << 0,
  PLAYER: 1 << 1,
  ENEMY: 1 << 2,
  PROP: 1 << 3,
  ALL: 0xffff,
} as const;

export function groups(member: number, filter: number): number {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

export const QUERY_WORLD = groups(G.ALL, G.WORLD);
export const QUERY_WORLD_PROPS = groups(G.ALL, G.WORLD | G.PROP);

export interface Character {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  radius: number;
  halfHeight: number;
  filter: number;
}

export interface RayHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  collider: RAPIER.Collider;
}

/** Thin wrapper around the Rapier world with helpers used throughout the game. */
export class Physics {
  readonly world: RAPIER.World;
  readonly R = RAPIER;
  private playerKcc: RAPIER.KinematicCharacterController;
  private enemyKcc: RAPIER.KinematicCharacterController;
  private tmpShape = new RAPIER.Ball(0.25);

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = Time.FIXED_DT;
    this.playerKcc = this.makeKcc(true);
    this.enemyKcc = this.makeKcc(false);
  }

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  private makeKcc(player: boolean): RAPIER.KinematicCharacterController {
    const k = this.world.createCharacterController(0.03);
    k.setUp({ x: 0, y: 1, z: 0 });
    k.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    k.setMinSlopeSlideAngle((58 * Math.PI) / 180);
    k.enableAutostep(0.45, 0.15, false);
    k.enableSnapToGround(player ? 0.45 : 0.6);
    k.setSlideEnabled(true);
    k.setApplyImpulsesToDynamicBodies(true);
    k.setCharacterMass(player ? 80 : 120);
    return k;
  }

  step(): void {
    this.world.step();
  }

  /** Scene queries only see colliders after a step; used while building. */
  refreshQueries(): void {
    this.world.step();
  }

  // ---------------------------------------------------------------------------
  // Static geometry
  // ---------------------------------------------------------------------------
  private staticBody: RAPIER.RigidBody | null = null;

  private getStaticBody(): RAPIER.RigidBody {
    if (!this.staticBody) this.staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    return this.staticBody;
  }

  addStaticBox(center: THREE.Vector3, half: THREE.Vector3, rot?: THREE.Quaternion, member: number = G.WORLD): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(Math.max(half.x, 0.01), Math.max(half.y, 0.01), Math.max(half.z, 0.01))
      .setTranslation(center.x, center.y, center.z)
      .setCollisionGroups(groups(member, G.ALL))
      .setFriction(0.8);
    if (rot) desc.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    return this.world.createCollider(desc, this.getStaticBody());
  }

  addStaticCylinder(center: THREE.Vector3, halfHeight: number, radius: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setTranslation(center.x, center.y, center.z)
      .setCollisionGroups(groups(G.WORLD, G.ALL));
    return this.world.createCollider(desc, this.getStaticBody());
  }

  addStaticBall(center: THREE.Vector3, radius: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.ball(radius)
      .setTranslation(center.x, center.y, center.z)
      .setCollisionGroups(groups(G.WORLD, G.ALL));
    return this.world.createCollider(desc, this.getStaticBody());
  }

  addStaticCapsule(center: THREE.Vector3, halfHeight: number, radius: number, rot?: THREE.Quaternion): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
      .setTranslation(center.x, center.y, center.z)
      .setCollisionGroups(groups(G.WORLD, G.ALL));
    if (rot) desc.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    return this.world.createCollider(desc, this.getStaticBody());
  }

  /**
   * Heightfield: `heights` is laid out with rows along Z and columns along X,
   * column-major (index = col * rowsVerts + row). Centered on (cx, cz).
   */
  addHeightfield(cells: number, heights: Float32Array, size: number, cx: number, cz: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.heightfield(cells, cells, heights, { x: size, y: 1, z: size })
      .setTranslation(cx, 0, cz)
      .setCollisionGroups(groups(G.WORLD, G.ALL))
      .setFriction(0.9);
    return this.world.createCollider(desc, this.getStaticBody());
  }

  removeCollider(c: RAPIER.Collider): void {
    this.world.removeCollider(c, false);
  }

  // ---------------------------------------------------------------------------
  // Characters
  // ---------------------------------------------------------------------------
  createCharacter(pos: THREE.Vector3, radius: number, halfHeight: number, member: number, filter: number): Character {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + halfHeight + radius, pos.z),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius).setCollisionGroups(groups(member, filter)).setFriction(0),
      body,
    );
    return { body, collider, radius, halfHeight, filter };
  }

  removeCharacter(c: Character): void {
    this.world.removeRigidBody(c.body);
  }

  private tmpMove = new THREE.Vector3();

  /**
   * Moves a character by `desired` (world units) resolving collisions.
   * `feet` is the character's feet position and is updated in place.
   */
  moveCharacter(c: Character, feet: THREE.Vector3, desired: THREE.Vector3, isPlayer: boolean): { grounded: boolean; moved: THREE.Vector3 } {
    const k = isPlayer ? this.playerKcc : this.enemyKcc;
    k.computeColliderMovement(c.collider, { x: desired.x, y: desired.y, z: desired.z }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(G.ALL, c.filter));
    const m = k.computedMovement();
    this.tmpMove.set(m.x, m.y, m.z);
    feet.add(this.tmpMove);
    c.body.setNextKinematicTranslation({ x: feet.x, y: feet.y + c.halfHeight + c.radius, z: feet.z });
    return { grounded: k.computedGrounded(), moved: this.tmpMove };
  }

  teleportCharacter(c: Character, feet: THREE.Vector3): void {
    c.body.setTranslation({ x: feet.x, y: feet.y + c.halfHeight + c.radius, z: feet.z }, true);
    c.body.setNextKinematicTranslation({ x: feet.x, y: feet.y + c.halfHeight + c.radius, z: feet.z });
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  setCharacterEnabled(c: Character, enabled: boolean): void {
    c.collider.setEnabled(enabled);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, filter = QUERY_WORLD): RayHit | null {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, filter);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      distance: t,
      point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
    };
  }

  /** Returns distance to first hit or null. */
  rayDistance(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, filter = QUERY_WORLD): number | null {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRay(ray, maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, filter);
    return hit ? hit.timeOfImpact : null;
  }

  private losDir = new THREE.Vector3();

  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    this.losDir.subVectors(b, a);
    const len = this.losDir.length();
    if (len < 1e-4) return true;
    this.losDir.divideScalar(len);
    return this.rayDistance(a, this.losDir, len - 0.05) === null;
  }

  /** Sphere sweep; returns travel distance before contact, or null. */
  sphereCast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, radius: number, filter = QUERY_WORLD): number | null {
    if (this.tmpShape.radius !== radius) this.tmpShape = new RAPIER.Ball(radius);
    const hit = this.world.castShape(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: dir.x, y: dir.y, z: dir.z },
      this.tmpShape,
      0,
      maxDist,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      filter,
    );
    return hit ? hit.time_of_impact : null;
  }

  groundHeight(x: number, z: number, fromY: number, maxDist = 60): number | null {
    const d = this.rayDistance(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0), maxDist);
    return d === null ? null : fromY - d;
  }

  // ---------------------------------------------------------------------------
  // Dynamic props
  // ---------------------------------------------------------------------------
  createDynamicBox(pos: THREE.Vector3, half: THREE.Vector3, rot: THREE.Quaternion, density = 1): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setLinearDamping(0.3)
        .setAngularDamping(0.6)
        .setCanSleep(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setDensity(density).setCollisionGroups(groups(G.PROP, G.ALL)).setFriction(0.7),
      body,
    );
    body.sleep();
    return body;
  }

  createDynamicCylinder(pos: THREE.Vector3, halfHeight: number, radius: number, rot: THREE.Quaternion, density = 1): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setLinearDamping(0.3)
        .setAngularDamping(0.6),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(halfHeight, radius).setDensity(density).setCollisionGroups(groups(G.PROP, G.ALL)).setFriction(0.7),
      body,
    );
    body.sleep();
    return body;
  }

  createDynamicBall(pos: THREE.Vector3, radius: number, density = 1): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(0.4).setAngularDamping(0.8),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(radius).setDensity(density).setCollisionGroups(groups(G.PROP, G.ALL)).setFriction(0.8),
      body,
    );
    body.sleep();
    return body;
  }
}
