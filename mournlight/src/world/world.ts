import * as THREE from 'three';
import type { Physics } from '../core/physics';
import type { Quality } from '../core/settings';
import { Rng, fbm2 } from '../core/math';
import { generateTextures, scrawlTexture, type TextureLibrary } from './textures';
import { createMaterials, type MaterialLibrary } from './materials';
import { buildTerrain, terrainHeight, type TerrainResult } from './terrain';
import { StaticBuilder } from './builder';
import { ChunkStreamer } from './streaming';
import { LightManager, MOON_OFFSET, tonguesFor, type FlameSource } from './lights';
import { LightShafts } from './shafts';
import { createPropSet, buildCage, makeBarrel, makeCrate, scatter, type Cage, type DynamicProp, type PropSet } from './props';
import { FogWall, Passage, Pickup, Remnant, Shrine, ShortcutDoor, type Interactable } from './interactables';
import { models, bakePosed } from '../entities/models';
import { corpsePose } from '../entities/poses';
import {
  ARENA_BRAZIERS,
  BOSS,
  CAGES,
  CLEARINGS,
  CORPSES,
  DOORS,
  FLAMES,
  FOREST_RECT,
  ITEMS,
  MESSAGES,
  REGIONS,
  SHRINES,
  SHAFTS,
  PASSAGES,
  STRUCTURES,
  TERRAIN,
  type RegionDef,
  type V3,
} from './layout';
import { patchFog } from '../fx/fog';

const KEEP_OUT: [number, number, number][] = [
  [96, -98, 8],
  [104, 44, 10],
  [87, 70, 6],
  [0, -26, 10],
  [71, -78, 6],
  [-128, -12, 8],
];

/**
 * Builds and owns the whole map: terrain, merged static architecture,
 * instanced props, flames, water, interactables and physics props.
 */
export class World {
  tex!: TextureLibrary;
  mats!: MaterialLibrary;
  terrain!: TerrainResult;
  builder!: StaticBuilder;
  /** Streams the merged static chunks in and out with the fog range. */
  readonly chunks = new ChunkStreamer(14);
  lights: LightManager;
  props!: PropSet;
  shrines: Shrine[] = [];
  doors: ShortcutDoor[] = [];
  fogWall!: FogWall;
  items: Pickup[] = [];
  remnant!: Remnant;
  cages: Cage[] = [];
  dynamics: DynamicProp[] = [];
  water!: THREE.Mesh;
  arenaFlames: FlameSource[] = [];
  heartFlame!: FlameSource;
  private heart!: THREE.Mesh;
  arenaPhase = 1;
  shafts!: LightShafts;
  passages: Passage[] = [];
  /** Rising and falling flood water of the Weeping Catacombs. */
  private floodMesh!: THREE.Mesh;
  floodLevel = -19.6;
  private t = 0;

  constructor(
    private scene: THREE.Scene,
    private physics: Physics,
    quality: Quality,
  ) {
    this.lights = new LightManager(scene, quality);
  }

  /** Interactables owned elsewhere (the Candle-Pedlar). */
  readonly extraInteractables: Interactable[] = [];

  get interactables(): Interactable[] {
    return [...this.shrines, ...this.doors, this.fogWall, ...this.items, this.remnant, ...this.passages, ...this.extraInteractables];
  }

  async build(progress: (p: number, label: string) => void): Promise<void> {
    const tick = async (p: number, label: string): Promise<void> => {
      progress(p, label);
      await new Promise((r) => setTimeout(r, 0));
    };
    await tick(0.02, 'Weaving the fog');
    this.tex = generateTextures();
    this.mats = createMaterials(this.tex);
    await tick(0.18, 'Raising the land');
    this.terrain = buildTerrain(this.physics, this.tex.ground);
    this.scene.add(this.terrain.mesh);
    this.builder = new StaticBuilder(this.physics, this.mats);

    await tick(0.35, 'Laying the stones');
    for (const s of STRUCTURES) this.builder.build(s);

    this.shafts = new LightShafts(this.scene, SHAFTS, MOON_OFFSET.clone().negate());

    await tick(0.48, 'Lighting the candles');
    this.buildFlames();
    for (const def of SHRINES) this.shrines.push(new Shrine(def, this.builder, this.lights));
    for (const def of DOORS) this.doors.push(new ShortcutDoor(def, this.scene, this.physics, this.mats));
    this.fogWall = new FogWall(BOSS.fogWall, this.scene, this.physics);
    this.physics.refreshQueries();
    for (const it of ITEMS) {
      const p = new THREE.Vector3(...it.p);
      const g = this.physics.groundHeight(p.x, p.z, p.y + 1.2, 6);
      if (g !== null) p.y = g;
      this.items.push(new Pickup(it.id, it.kind, it.amount ?? 0, p, this.scene));
    }
    this.remnant = new Remnant(this.scene, this.mats);
    for (const d of PASSAGES) this.passages.push(new Passage(d, this.scene));
    {
      const geo = new THREE.PlaneGeometry(44, 128, 1, 1);
      geo.rotateX(-Math.PI / 2);
      const nm = this.tex.water;
      const fm = patchFog(new THREE.MeshStandardMaterial({ color: 0x070c0c, roughness: 0.08, metalness: 0.3, normalMap: nm, normalScale: new THREE.Vector2(0.4, 0.4), transparent: true, opacity: 0.88 }));
      this.floodMesh = new THREE.Mesh(geo, fm);
      this.floodMesh.position.set(320, this.floodLevel, -8);
      this.floodMesh.renderOrder = 2;
      this.scene.add(this.floodMesh);
    }
    this.buildHeart();

    await tick(0.56, 'Planting the dead trees');
    this.props = createPropSet(this.mats);
    this.scatterProps();

    await tick(0.72, 'Laying out the dead');
    this.physics.refreshQueries();
    this.buildCorpses();
    this.buildCages();
    this.buildMessages();
    this.buildWater();
    this.buildDynamics();

    await tick(0.86, 'Sealing the crypt');
    this.builder.finish(this.scene);
    const ps = this.props.streamer;
    this.props.trees.forEach((f) => f.finish(this.scene, ps));
    this.props.rocks.forEach((f) => f.finish(this.scene, ps));
    this.props.graves.forEach((f) => f.finish(this.scene, ps));
    this.props.reeds.finish(this.scene, ps);
    this.props.bones.finish(this.scene, ps);
    // merged static chunks stream too, and hand back their GPU buffers when far behind
    for (const m of this.builder.meshes) {
      const bs = m.geometry.boundingSphere!;
      this.chunks.add(m, m.parent ?? this.scene, bs.center.x, bs.center.z, bs.radius, true);
    }
    await tick(0.95, 'The fog settles');
  }

  // ---------------------------------------------------------------------------
  private buildFlames(): void {
    const B = this.builder;
    for (const f of FLAMES) {
      const [x, y, z] = f.p;
      if (f.kind === 'brazier') {
        B.cylinder([x, y, z], 0.18, 0.12, 'iron', { col: false, rTop: 0.25 });
        B.cylinder([x, y + 0.1, z], 0.07, 0.95, 'iron', { col: true, seg: 6 });
        B.cylinder([x, y + 1.02, z], 0.28, 0.28, 'iron', { col: false, rTop: 0.45 });
        this.lights.addFlame(new THREE.Vector3(x, y + 1.3, z), { intensity: 7 * (f.intensity ?? 1), distance: 13, tongues: tonguesFor('brazier') });
      } else if (f.kind === 'candles') {
        const tongues: { off: THREE.Vector3; scale: number }[] = [];
        const rng = new Rng(Math.round(x * 13 + z * 7));
        for (let i = 0; i < 9; i++) {
          const a = rng.range(0, Math.PI * 2);
          const r = rng.range(0.05, 0.5);
          const h = rng.range(0.1, 0.55);
          const cx = x + Math.cos(a) * r;
          const cz = z + Math.sin(a) * r;
          B.cylinder([cx, y, cz], rng.range(0.03, 0.06), h, 'wax', { col: false, seg: 6 });
          tongues.push({ off: new THREE.Vector3(cx - x, h + 0.02, cz - z), scale: 0.07 });
        }
        this.lights.addFlame(new THREE.Vector3(x, y, z), { intensity: 4 * (f.intensity ?? 1), distance: 9, tongues });
      } else if (f.kind === 'sconce') {
        B.box([x, y - 0.1, z], [0.25, 0.08, 0.25], 'iron', { col: false });
        B.cylinder([x, y - 0.05, z], 0.05, 0.25, 'wax', { col: false, seg: 6 });
        this.lights.addFlame(new THREE.Vector3(x, y + 0.22, z), { intensity: 4, distance: 9, tongues: tonguesFor('sconce') });
      }
    }
    for (const p of ARENA_BRAZIERS) {
      const [x, y, z] = p;
      B.cylinder([x, y, z], 0.4, 0.2, 'iron', { col: false, rTop: 0.5 });
      B.cylinder([x, y + 0.2, z], 0.12, 1.4, 'iron', { col: true, seg: 6 });
      B.cylinder([x, y + 1.55, z], 0.35, 0.35, 'iron', { col: false, rTop: 0.65 });
      this.arenaFlames.push(this.lights.addFlame(new THREE.Vector3(x, y + 1.9, z), { intensity: 9, distance: 18, tongues: tonguesFor('arena'), tag: 'arena' }));
    }
  }

  private buildHeart(): void {
    // The dead god's rotting heart, embedded in the north wall of the Godwound
    const pos = new THREE.Vector3(0, 10, -197);
    const geo = new THREE.IcosahedronGeometry(3.2, 3);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = fbm2(v.x * 0.8 + 3, v.y * 0.8 + v.z * 0.6, 3);
      v.multiplyScalar(1 + n * 0.35);
      p.setXYZ(i, v.x, v.y * 1.2, v.z);
    }
    geo.computeVertexNormals();
    const fl = this.tex.flesh;
    const mat = patchFog(new THREE.MeshStandardMaterial({ color: 0x8a3a30, map: fl.map, normalMap: fl.normalMap, roughnessMap: fl.roughnessMap, roughness: 0.9, emissive: 0x200402, emissiveIntensity: 1 }));
    this.heart = new THREE.Mesh(geo, mat);
    this.heart.position.copy(pos);
    this.heart.castShadow = true;
    this.scene.add(this.heart);
    this.heartFlame = this.lights.addFlame(pos.clone().add(new THREE.Vector3(0, -2, 5)), { color: 0xff2a10, intensity: 60, distance: 70, lit: false, tongues: [], tag: 'heart' });
    // veins
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const curve = new THREE.CatmullRomCurve3([
        pos.clone(),
        pos.clone().add(new THREE.Vector3(Math.cos(a) * 5, Math.sin(a) * 3 - 2, 2)),
        pos.clone().add(new THREE.Vector3(Math.cos(a) * 10, Math.sin(a) * 4 - 5, 5)),
      ]);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.35, 6), mat);
      this.scene.add(tube);
    }
  }

  setArenaPhase(phase: number): void {
    this.arenaPhase = phase;
    for (const f of this.arenaFlames) f.lit = phase === 1;
    this.heartFlame.lit = phase === 2;
  }

  // ---------------------------------------------------------------------------
  private keepOut(x: number, z: number): boolean {
    for (const [cx, cz, r] of KEEP_OUT) if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    for (const [cx, cz, r] of CLEARINGS) if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    return false;
  }

  private slopeAt(x: number, z: number): number {
    const d = 1;
    const hx = terrainHeight(x + d, z) - terrainHeight(x - d, z);
    const hz = terrainHeight(x, z + d) - terrainHeight(x, z - d);
    return Math.hypot(hx, hz) / (2 * d);
  }

  private scatterProps(): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const place = (field: { add(m: THREE.Matrix4): void }, x: number, y: number, z: number, scale: number, rng: Rng, tilt = 0.08): void => {
      e.set(rng.range(-tilt, tilt), rng.range(0, Math.PI * 2), rng.range(-tilt, tilt));
      q.setFromEuler(e);
      s.setScalar(scale);
      pos.set(x, y, z);
      m.compose(pos, q, s);
      field.add(m);
    };
    // Gallowwood trees
    const trees = scatter(FOREST_RECT, 5.4, 11, (x, z) => {
      if (this.keepOut(x, z)) return false;
      const h = terrainHeight(x, z);
      if (h < -3.2 && Math.hypot(x - 148, z - 118) > 13) return false;
      if (x < 68) return false;
      return this.slopeAt(x, z) < 0.75;
    });
    // sparse trees on the road and in the drowned village
    const extra = [
      ...scatter([-50, -30, 50, 50], 13, 22, (x, z, r) => r.chance(0.35) && !this.keepOut(x, z) && Math.abs(x) > 6 && this.slopeAt(x, z) < 0.5),
      ...scatter([-170, -40, -62, 90], 11, 33, (x, z, r) => r.chance(0.3) && terrainHeight(x, z) < -0.8 && !this.keepOut(x, z)),
      ...scatter([-48, -196, 48, -40], 16, 44, (x, z, r) => r.chance(0.2) && (Math.abs(x) > 28 || z > -48 || z < -128) && Math.hypot(x, z + 172) > 32 && this.slopeAt(x, z) < 0.4),
    ];
    const rng = new Rng(77);
    for (const [x, z] of [...trees, ...extra]) {
      const y = terrainHeight(x, z);
      const k = rng.int(0, this.props.trees.length - 1);
      const sc = rng.range(0.75, 1.3);
      place(this.props.trees[k], x, y, z, sc, rng, 0.06);
      this.physics.addStaticCylinder(new THREE.Vector3(x, y + 2, z), 2, 0.34 * sc);
    }
    // Rocks
    const rocks = scatter([-178, -206, 178, 156], 9, 55, (x, z, r) => {
      const sl = this.slopeAt(x, z);
      if (this.keepOut(x, z)) return false;
      if (Math.abs(x) < 24 && z > 52 && z < 150) return false; // barrow
      if (x > -26 && x < 26 && z > -125 && z < -48) return false; // cathedral
      return sl > 0.6 ? r.chance(0.55) : r.chance(0.07);
    });
    for (const [x, z] of rocks) {
      const y = terrainHeight(x, z);
      const k = rng.int(0, this.props.rocks.length - 1);
      const sc = rng.range(0.5, 2.4);
      place(this.props.rocks[k], x, y - sc * 0.15, z, sc, rng, 0.4);
      if (sc > 0.9) this.physics.addStaticBall(new THREE.Vector3(x, y + sc * 0.2, z), sc * 0.75);
    }
    // Gravestones: the barrow top, the roadside field, the cathedral yard
    const graveAreas: [number, number, number, number, number][] = [
      [-18, 64, 18, 146, 3.4],
      [-36, 26, -16, 48, 3],
      [-44, -60, -28, -46, 3.2],
      [30, -64, 44, -46, 3.2],
    ];
    for (const [x0, z0, x1, z1, sp] of graveAreas) {
      for (const [x, z] of scatter([x0, z0, x1, z1], sp, x0 * 7 + z0, (px, pz, r) => r.chance(0.55) && Math.abs(px) > 3.2 && !this.keepOut(px, pz))) {
        let y = terrainHeight(x, z);
        if (z > 60 && z < 150 && Math.abs(x) < 21) y = 1.5; // on the capstone
        const k = rng.int(0, this.props.graves.length - 1);
        const yaw = rng.range(-0.3, 0.3) + (rng.chance(0.5) ? 0 : Math.PI);
        e.set(rng.range(-0.15, 0.15), yaw, rng.range(-0.15, 0.15));
        q.setFromEuler(e);
        s.setScalar(rng.range(0.9, 1.3));
        pos.set(x, y - 0.05, z);
        m.compose(pos, q, s);
        this.props.graves[k].add(m);
        this.physics.addStaticBox(new THREE.Vector3(x, y + 0.45, z), new THREE.Vector3(0.32, 0.45, 0.1), q.clone());
      }
    }
    // Reeds in the Brinemoor shallows
    for (const [x, z] of scatter([-176, -46, -56, 94], 2.8, 91, (px, pz, r) => {
      const h = terrainHeight(px, pz);
      return h < -0.7 && h > -2 && r.chance(0.45);
    })) {
      place(this.props.reeds, x, terrainHeight(x, z), z, rng.range(0.8, 1.3), rng, 0.1);
    }
    // Bones in the crypt, the Godwound and under the gallows
    const boneSpots: [number, number, number, number, number][] = [
      [-7, 127, 7, 141, -9],
      [-10, 101, 10, 117, -9],
      [-7, 82, 7, 93, -9],
      [-16, -186, 16, -158, 4],
      [-14, 12, -8, 16, 0],
    ];
    for (const [x0, z0, x1, z1, y] of boneSpots) {
      for (const [x, z] of scatter([x0, z0, x1, z1], 2.2, x0 * 3 + z0, (_x, _z, r) => r.chance(0.4))) {
        const yy = y === 0 ? terrainHeight(x, z) : y;
        place(this.props.bones, x, yy, z, rng.range(0.8, 1.2), rng, 0.3);
      }
    }
  }

  private buildCorpses(): void {
    const inst = models.create('corpse');
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    CORPSES.forEach((c, i) => {
      inst.rig.apply(corpsePose(c.pose, i + 1));
      inst.root.position.set(0, 0, 0);
      inst.root.rotation.set(0, 0, 0);
      q.setFromEuler(new THREE.Euler(0, c.yaw, 0));
      const p = new THREE.Vector3(...c.p);
      const g = this.physics.groundHeight(p.x, p.z, p.y + 1, 4);
      if (g !== null) p.y = g;
      m.compose(p, q, new THREE.Vector3(1, 1, 1));
      this.builder.addColored(bakePosed(inst, m), p);
    });
    inst.dispose();
  }

  private buildCages(): void {
    const inst = models.create('corpse');
    for (const c of CAGES) {
      let body: THREE.BufferGeometry | null = null;
      if (c.body) {
        inst.rig.apply(corpsePose('hang', c.p[0]));
        const m = new THREE.Matrix4().compose(new THREE.Vector3(0, -c.drop - 1.86, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, c.p[2], 0)), new THREE.Vector3(0.82, 0.82, 0.82));
        body = bakePosed(inst, m);
      }
      const cage = buildCage(this.mats, new THREE.Vector3(...c.p), c.drop, body);
      this.scene.add(cage.group);
      this.cages.push(cage);
    }
    inst.dispose();
  }

  private buildMessages(): void {
    for (const msg of MESSAGES) {
      const [w, h] = msg.size ?? [4, 1];
      const tex = scrawlTexture(msg.text, { carved: msg.kind === 'carved', width: 1024, height: Math.round((1024 * h) / w) });
      const mat = patchFog(
        new THREE.MeshStandardMaterial({
          map: tex,
          transparent: true,
          roughness: 0.85,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.position.set(...msg.p);
      mesh.rotation.y = msg.yaw;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  private buildWater(): void {
    const [x0, z0, x1, z1] = TERRAIN.waterRect;
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const nm = this.tex.water;
    nm.repeat.set((x1 - x0) / 9, (z1 - z0) / 9);
    const mat = patchFog(
      new THREE.MeshStandardMaterial({
        color: 0x0b1413,
        roughness: 0.14,
        metalness: 0.35,
        normalMap: nm,
        normalScale: new THREE.Vector2(0.6, 0.6),
        transparent: true,
        opacity: 0.9,
        depthWrite: true,
      }),
    );
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.set((x0 + x1) / 2, TERRAIN.waterLevel, (z0 + z1) / 2);
    this.water.receiveShadow = true;
    this.water.renderOrder = 2;
    this.scene.add(this.water);
  }

  private buildDynamics(): void {
    const barrels: V3[] = [
      [-4, -9, 113.5], [-3.2, -9, 114.3], [8.5, -9, 103],
      [-82, 0.4, 36.5], [-86.5, 0.4, 29], [-105, 0.4, 24.5], [-139, 0.4, 35], [-80, 0.4, -6.5],
      [19.5, 0.6, 9.5], [16.5, 0.6, 6],
      [-20, 14.3, -118], [21, 14.3, -54], [-6, 0.6, -28],
    ];
    const crates: V3[] = [
      [4, -9, 104], [4.3, -9, 105.2], [-8.2, -9, 84],
      [-107, 0.4, 16], [-126, 0.4, -7], [-99, 0.4, -12],
      [-19, 14.3, -60], [20, 14.3, -116], [2.5, 0.6, -30],
    ];
    const rng = new Rng(5);
    for (const b of barrels) {
      const p = new THREE.Vector3(...b);
      const g = this.physics.groundHeight(p.x, p.z, p.y + 1.5, 4);
      if (g !== null) p.y = g;
      const d = makeBarrel(this.physics, this.mats, p);
      this.scene.add(d.mesh);
      this.dynamics.push(d);
    }
    for (const c of crates) {
      const p = new THREE.Vector3(...c);
      const g = this.physics.groundHeight(p.x, p.z, p.y + 1.5, 4);
      if (g !== null) p.y = g;
      const d = makeCrate(this.physics, this.mats, p, rng.range(0.6, 0.95), rng.range(0, 3));
      this.scene.add(d.mesh);
      this.dynamics.push(d);
    }
  }

  // ---------------------------------------------------------------------------
  regionAt(p: THREE.Vector3): RegionDef {
    for (const r of REGIONS) {
      if (r.yMin !== undefined && p.y < r.yMin) continue;
      if (r.yMax !== undefined && p.y > r.yMax) continue;
      if (r.rect) {
        const [x0, z0, x1, z1] = r.rect;
        if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) return r;
      } else if (r.circle) {
        const [cx, cz, rr] = r.circle;
        if ((p.x - cx) ** 2 + (p.z - cz) ** 2 <= rr * rr) return r;
      }
    }
    return REGIONS[REGIONS.length - 1];
  }

  step(): void {
    for (const d of this.dynamics) d.step();
  }

  resetDynamics(): void {
    for (const d of this.dynamics) d.reset();
  }

  update(dt: number, t: number, camPos: THREE.Vector3, focus: THREE.Vector3, alpha: number, fogDist: number): void {
    this.t = t;
    this.lights.update(dt, t, focus, camPos);
    for (const c of this.cages) {
      c.group.rotation.z = Math.sin(t * 0.7 + c.phase) * c.amp;
      c.group.rotation.x = Math.sin(t * 0.53 + c.phase * 1.7) * c.amp * 0.6;
    }
    for (const d of this.dynamics) d.render(alpha);
    for (const d of this.doors) d.update(dt);
    this.fogWall.update(dt, t);
    for (const it of this.items) it.update(t);
    this.remnant.update(t);
    for (const p of this.passages) p.update(t);
    // the flood breathes: a slow tide through the catacombs (about a minute)
    this.floodLevel = -20 + 0.4 + Math.sin((t * Math.PI * 2) / 55) * 0.35;
    this.floodMesh.position.y = this.floodLevel;
    const nm = (this.water.material as THREE.MeshStandardMaterial).normalMap;
    if (nm) nm.offset.set(t * 0.012, t * 0.007);
    this.props.cull(camPos, fogDist);
    this.chunks.update(camPos, fogDist + 10);
    // heart pulse
    const pulse = this.arenaPhase === 2 ? 0.5 + 0.5 * Math.pow(Math.sin(t * 2.4), 8) : 0.1;
    const hm = this.heart.material as THREE.MeshStandardMaterial;
    hm.emissive.setRGB(0.5 * pulse + 0.05, 0.03 * pulse, 0.01);
    this.heart.scale.setScalar(1 + pulse * 0.03);
    if (this.heartFlame.lit) this.heartFlame.intensity = 45 + pulse * 45;
  }

  /** Is this point under the catacomb flood? */
  inFlood(p: THREE.Vector3): boolean {
    return p.x > 296 && p.x < 344 && p.z > -72 && p.z < 56 && p.y < this.floodLevel && p.y > -21;
  }

  get time(): number {
    return this.t;
  }
}
