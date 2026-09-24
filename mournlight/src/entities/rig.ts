import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Hierarchical humanoid rig used by every character. Bones are plain
 * THREE.Bone objects with identity rest rotations; poses are Euler angles
 * (order YXZ) per joint plus a hips translation offset.
 *
 * Conventions (character faces +Z, right hand is on -X):
 *  - Torso joints: +x bends forward, +y twists to the character's left.
 *  - Limbs (rest pointing down): -x swings forward, +y yaws toward +X,
 *    +z moves the limb toward +X.  Elbows flex with -x, knees with +x.
 */
export const JOINTS = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'upperArmR',
  'forearmR',
  'handR',
  'upperArmL',
  'forearmL',
  'handL',
  'thighR',
  'shinR',
  'footR',
  'thighL',
  'shinL',
  'footL',
] as const;

export type Joint = (typeof JOINTS)[number];
export const JOINT_COUNT = JOINTS.length;
export const J = Object.fromEntries(JOINTS.map((j, i) => [j, i])) as Record<Joint, number>;
export const OFF = JOINT_COUNT * 3; // index of hips translation offset
export const POSE_SIZE = JOINT_COUNT * 3 + 3;

export type Pose = Float32Array;
export type Vec3T = readonly [number, number, number] | readonly number[];
export type PoseSpec = Partial<Record<Joint, Vec3T>> & { off?: Vec3T };

const PARENT: Record<Joint, Joint | null> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  upperArmR: 'chest',
  forearmR: 'upperArmR',
  handR: 'forearmR',
  upperArmL: 'chest',
  forearmL: 'upperArmL',
  handL: 'forearmL',
  thighR: 'hips',
  shinR: 'thighR',
  footR: 'shinR',
  thighL: 'hips',
  shinL: 'thighL',
  footL: 'shinL',
};

export const UPPER_MASK: Float32Array = (() => {
  const m = new Float32Array(JOINT_COUNT);
  for (const j of ['spine', 'chest', 'neck', 'head', 'upperArmR', 'forearmR', 'handR', 'upperArmL', 'forearmL', 'handL'] as Joint[]) m[J[j]] = 1;
  return m;
})();

export const ARMS_MASK: Float32Array = (() => {
  const m = new Float32Array(JOINT_COUNT);
  for (const j of ['upperArmR', 'forearmR', 'handR', 'upperArmL', 'forearmL', 'handL'] as Joint[]) m[J[j]] = 1;
  return m;
})();

export function makePose(): Pose {
  return new Float32Array(POSE_SIZE);
}

export function copyPose(out: Pose, src: Pose): Pose {
  out.set(src);
  return out;
}

/** Writes a partial spec on top of `out` (which should already hold a base). */
export function applySpec(out: Pose, spec: PoseSpec): Pose {
  for (const k in spec) {
    const v = (spec as Record<string, Vec3T>)[k];
    if (!v) continue;
    if (k === 'off') {
      out[OFF] = v[0] ?? 0;
      out[OFF + 1] = v[1] ?? 0;
      out[OFF + 2] = v[2] ?? 0;
      continue;
    }
    const i = J[k as Joint];
    if (i === undefined) continue;
    out[i * 3] = v[0] ?? 0;
    out[i * 3 + 1] = v[1] ?? 0;
    out[i * 3 + 2] = v[2] ?? 0;
  }
  return out;
}

export function poseFrom(base: Pose | null, spec: PoseSpec): Pose {
  const p = makePose();
  if (base) p.set(base);
  return applySpec(p, spec);
}

/** out = lerp(a, b, t) optionally masked per joint (offset uses mask of hips). */
export function blendPose(out: Pose, a: Pose, b: Pose, t: number, mask?: Float32Array): Pose {
  if (!mask) {
    for (let i = 0; i < POSE_SIZE; i++) out[i] = a[i] + (b[i] - a[i]) * t;
    return out;
  }
  for (let j = 0; j < JOINT_COUNT; j++) {
    const w = t * mask[j];
    const i = j * 3;
    out[i] = a[i] + (b[i] - a[i]) * w;
    out[i + 1] = a[i + 1] + (b[i + 1] - a[i + 1]) * w;
    out[i + 2] = a[i + 2] + (b[i + 2] - a[i + 2]) * w;
  }
  const wo = t * mask[0];
  for (let i = OFF; i < POSE_SIZE; i++) out[i] = a[i] + (b[i] - a[i]) * wo;
  return out;
}

export function addScaled(out: Pose, add: Pose, w: number): Pose {
  for (let i = 0; i < POSE_SIZE; i++) out[i] += add[i] * w;
  return out;
}

export function setJoint(p: Pose, j: Joint, x: number, y: number, z: number): void {
  const i = J[j] * 3;
  p[i] = x;
  p[i + 1] = y;
  p[i + 2] = z;
}

export function addJoint(p: Pose, j: Joint, x: number, y: number, z: number): void {
  const i = J[j] * 3;
  p[i] += x;
  p[i + 1] += y;
  p[i + 2] += z;
}

export function getJoint(p: Pose, j: Joint, axis: 0 | 1 | 2): number {
  return p[J[j] * 3 + axis];
}

// ---------------------------------------------------------------------------
// Skeleton definition
// ---------------------------------------------------------------------------
export interface Proportions {
  hipsHeight: number;
  spine: number;
  chest: number;
  neck: number;
  head: number;
  shoulderX: number;
  shoulderY: number;
  upperArm: number;
  forearm: number;
  hand: number;
  hipX: number;
  thigh: number;
  shin: number;
}

export const HUMAN: Proportions = {
  hipsHeight: 0.95,
  spine: 0.11,
  chest: 0.22,
  neck: 0.25,
  head: 0.1,
  shoulderX: 0.2,
  shoulderY: 0.2,
  upperArm: 0.3,
  forearm: 0.27,
  hand: 0.09,
  hipX: 0.1,
  thigh: 0.45,
  shin: 0.44,
};

function restOffset(j: Joint, p: Proportions): THREE.Vector3 {
  switch (j) {
    case 'hips':
      return new THREE.Vector3(0, p.hipsHeight, 0);
    case 'spine':
      return new THREE.Vector3(0, p.spine, 0);
    case 'chest':
      return new THREE.Vector3(0, p.chest, 0);
    case 'neck':
      return new THREE.Vector3(0, p.neck, 0);
    case 'head':
      return new THREE.Vector3(0, p.head, 0);
    case 'upperArmR':
      return new THREE.Vector3(-p.shoulderX, p.shoulderY, 0);
    case 'upperArmL':
      return new THREE.Vector3(p.shoulderX, p.shoulderY, 0);
    case 'forearmR':
    case 'forearmL':
      return new THREE.Vector3(0, -p.upperArm, 0);
    case 'handR':
    case 'handL':
      return new THREE.Vector3(0, -p.forearm, 0);
    case 'thighR':
      return new THREE.Vector3(-p.hipX, -0.04, 0);
    case 'thighL':
      return new THREE.Vector3(p.hipX, -0.04, 0);
    case 'shinR':
    case 'shinL':
      return new THREE.Vector3(0, -p.thigh, 0);
    case 'footR':
    case 'footL':
      return new THREE.Vector3(0, -p.shin, 0);
  }
}

export type MaterialSlot = 0 | 1 | 2; // 0 = cloth/skin, 1 = metal, 2 = emissive

interface Part {
  geo: THREE.BufferGeometry;
  slot: MaterialSlot;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Builds a single skinned mesh out of rigid primitive parts, each bound with
 * weight 1 to one bone. This keeps characters at 1-3 draw calls.
 */
export class SkinBuilder {
  readonly bones: THREE.Bone[] = [];
  readonly restWorld: THREE.Vector3[] = [];
  private parts: Part[] = [];
  readonly props: Proportions;
  grime = 0.18;

  constructor(props: Proportions) {
    this.props = props;
    for (let i = 0; i < JOINT_COUNT; i++) {
      const j = JOINTS[i];
      const b = new THREE.Bone();
      b.name = j;
      b.rotation.order = 'YXZ';
      b.position.copy(restOffset(j, props));
      this.bones.push(b);
      const parent = PARENT[j];
      if (parent) this.bones[J[parent]].add(b);
    }
    // accumulate rest world positions (identity rotations)
    for (let i = 0; i < JOINT_COUNT; i++) {
      const j = JOINTS[i];
      const parent = PARENT[j];
      const w = this.bones[i].position.clone();
      if (parent) w.add(this.restWorld[J[parent]]);
      this.restWorld.push(w);
    }
  }

  /**
   * Adds a primitive bound to `joint`. `pos`/`rot`/`scale` are expressed in
   * the joint's local (rest) space.
   */
  add(
    joint: Joint,
    geo: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    opts: { pos?: Vec3T; rot?: Vec3T; scale?: Vec3T; slot?: MaterialSlot; grime?: number; emissive?: number } = {},
  ): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    _p.set(opts.pos?.[0] ?? 0, opts.pos?.[1] ?? 0, opts.pos?.[2] ?? 0);
    _e.set(opts.rot?.[0] ?? 0, opts.rot?.[1] ?? 0, opts.rot?.[2] ?? 0, 'YXZ');
    _q.setFromEuler(_e);
    _s.set(opts.scale?.[0] ?? 1, opts.scale?.[1] ?? 1, opts.scale?.[2] ?? 1);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    const bi = J[joint];
    g.translate(this.restWorld[bi].x, this.restWorld[bi].y, this.restWorld[bi].z);

    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    _c.set(color);
    const grime = opts.grime ?? this.grime;
    const em = opts.emissive ?? 1;
    const pos = g.attributes.position;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // cheap positional grime so surfaces are not flat colored
      const v = 1 - grime * (0.5 + 0.5 * Math.sin(x * 23.1 + y * 17.7) * Math.cos(z * 19.3 - y * 7.1));
      colors[i * 3] = _c.r * v * em;
      colors[i * 3 + 1] = _c.g * v * em;
      colors[i * 3 + 2] = _c.b * v * em;
      skinIndex[i * 4] = bi;
      skinWeight[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    this.parts.push({ geo: g, slot: opts.slot ?? 0 });
  }

  /** Mirror helper: adds the same part to R and L joints with x mirrored. */
  addPair(
    jointR: Joint,
    jointL: Joint,
    geo: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    opts: { pos?: Vec3T; rot?: Vec3T; scale?: Vec3T; slot?: MaterialSlot; grime?: number; emissive?: number } = {},
  ): void {
    this.add(jointR, geo, color, opts);
    const pos = opts.pos ? [-(opts.pos[0] ?? 0), opts.pos[1] ?? 0, opts.pos[2] ?? 0] : undefined;
    const rot = opts.rot ? [opts.rot[0] ?? 0, -(opts.rot[1] ?? 0), -(opts.rot[2] ?? 0)] : undefined;
    this.add(jointL, geo, color, { ...opts, pos, rot });
  }

  build(materials: THREE.Material[]): { mesh: THREE.SkinnedMesh; bones: THREE.Bone[] } {
    const bySlot: THREE.BufferGeometry[][] = [[], [], []];
    for (const p of this.parts) bySlot[p.slot].push(p.geo);
    const merged: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    for (let s = 0; s < 3; s++) {
      if (bySlot[s].length === 0) continue;
      const m = mergeGeometries(bySlot[s], false);
      if (!m) continue;
      merged.push(m);
      mats.push(materials[s]);
    }
    const geo = mergeGeometries(merged, true)!;
    geo.computeBoundingSphere();
    for (const p of this.parts) p.geo.dispose();
    this.parts = [];
    const mesh = new THREE.SkinnedMesh(geo, mats.length === 1 ? mats[0] : mats);
    mesh.add(this.bones[0]);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(this.bones));
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return { mesh, bones: this.bones };
  }
}

// ---------------------------------------------------------------------------
// Runtime rig
// ---------------------------------------------------------------------------
export class Rig {
  readonly bones: THREE.Object3D[];
  private readonly hipsRest: THREE.Vector3;
  private readonly restQuats: THREE.Quaternion[] | null;
  readonly pose: Pose = makePose();
  private static readonly _q = new THREE.Quaternion();
  private static readonly _e = new THREE.Euler(0, 0, 0, 'YXZ');

  /**
   * @param restRelative compose poses on top of each bone's rest rotation
   * (for imported skeletons whose rest rotations are not identity).
   */
  constructor(bones: THREE.Object3D[], restRelative = false) {
    this.bones = bones;
    this.restQuats = restRelative ? bones.map((b) => b.quaternion.clone()) : null;
    if (!restRelative) for (const b of bones) b.rotation.order = 'YXZ';
    this.hipsRest = bones[0].position.clone();
  }

  bone(j: Joint): THREE.Object3D {
    return this.bones[J[j]];
  }

  apply(p: Pose): void {
    this.pose.set(p);
    const rq = this.restQuats;
    for (let j = 0; j < JOINT_COUNT; j++) {
      const i = j * 3;
      if (rq) {
        Rig._e.set(p[i], p[i + 1], p[i + 2]);
        this.bones[j].quaternion.copy(rq[j]).multiply(Rig._q.setFromEuler(Rig._e));
      } else {
        this.bones[j].rotation.set(p[i], p[i + 1], p[i + 2]);
      }
    }
    this.bones[0].position.set(this.hipsRest.x + p[OFF], this.hipsRest.y + p[OFF + 1], this.hipsRest.z + p[OFF + 2]);
  }
}
