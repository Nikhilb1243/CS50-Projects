import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Rng, fbm2, valueNoise2 } from '../core/math';
import type { Physics } from '../core/physics';
import type { MaterialLibrary } from './materials';
import { ChunkStreamer } from './streaming';

const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);

function limb(parts: THREE.BufferGeometry[], from: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number, r1: number, seg = 6): THREE.Vector3 {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len * 0.6);
  g.translate(0, len / 2, 0);
  _q.setFromUnitVectors(_up, dir.clone().normalize());
  _m.compose(from, _q, _s);
  g.applyMatrix4(_m);
  parts.push(g);
  return from.clone().addScaledVector(dir.clone().normalize(), len);
}

/** Procedural dead tree: bent trunk with recursive bare branches. */
export function makeTreeGeometry(seed: number, lod = false): THREE.BufferGeometry {
  const rng = new Rng(seed);
  // low detail: fewer sides and no twigs; the rng sequence is untouched so the silhouette matches
  const sides = (n: number): number => (lod ? Math.max(3, n - 3) : n);
  const parts: THREE.BufferGeometry[] = [];
  const height = rng.range(6.5, 11.5);
  const baseR = rng.range(0.28, 0.46);
  const segs = 4;
  let p = new THREE.Vector3(0, -0.4, 0);
  let dir = new THREE.Vector3(rng.range(-0.1, 0.1), 1, rng.range(-0.1, 0.1)).normalize();
  const trunkPts: { p: THREE.Vector3; r: number; dir: THREE.Vector3 }[] = [];
  // root flare
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng.next();
    limb(parts, new THREE.Vector3(0, 0.4, 0), new THREE.Vector3(Math.cos(a), -0.45, Math.sin(a)), 1.1, baseR * 0.55, 0.05, sides(5));
  }
  for (let i = 0; i < segs; i++) {
    const len = height / segs;
    const r0 = baseR * (1 - i / segs) + 0.04;
    const r1 = baseR * (1 - (i + 1) / segs) + 0.03;
    const next = limb(parts, p, dir, len, r0, r1, sides(7));
    trunkPts.push({ p: p.clone(), r: r0, dir: dir.clone() });
    p = next;
    dir = dir.add(new THREE.Vector3(rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3))).normalize();
  }
  const branch = (from: THREE.Vector3, d: THREE.Vector3, len: number, r: number, depth: number): void => {
    const end = lod && depth < 2 && len < 1.2 ? from.clone().addScaledVector(d.clone().normalize(), len) : limb(parts, from, d, len, r, r * 0.4, sides(5));
    if (depth <= 0 || len < 0.6) return;
    const n = rng.int(1, 2);
    for (let i = 0; i < n; i++) {
      const nd = d.clone().add(new THREE.Vector3(rng.range(-0.8, 0.8), rng.range(-0.1, 0.6), rng.range(-0.8, 0.8))).normalize();
      branch(end.clone().lerp(from, rng.range(0, 0.4)), nd, len * rng.range(0.45, 0.7), r * 0.5, depth - 1);
    }
  };
  const branches = rng.int(4, 7);
  for (let i = 0; i < branches; i++) {
    const t = rng.range(0.45, 0.95);
    const seg = trunkPts[Math.min(segs - 1, Math.floor(t * segs))];
    const from = seg.p.clone().addScaledVector(seg.dir, (t * segs - Math.floor(t * segs)) * (height / segs));
    const yaw = rng.range(0, Math.PI * 2);
    const up = rng.range(0.25, 1.1);
    const d = new THREE.Vector3(Math.cos(yaw), up, Math.sin(yaw)).normalize();
    branch(from, d, rng.range(1.6, 3.8) * (1.2 - t * 0.5), seg.r * 0.45, 2);
  }
  const g = mergeGeometries(parts, false)!;
  for (const x of parts) x.dispose();
  return g;
}

export function makeRockGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = valueNoise2(v.x * 2.1 + seed, v.z * 2.1 + v.y * 1.3) * 0.28 + valueNoise2(v.y * 4 + seed, v.x * 4) * 0.1;
    v.multiplyScalar(1 + n);
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.3;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  g.dispose();
  return ng;
}

function makeGravestone(kind: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 0) {
    const slab = new THREE.BoxGeometry(0.62, 0.8, 0.16);
    slab.translate(0, 0.4, 0);
    const top = new THREE.CylinderGeometry(0.31, 0.31, 0.16, 12, 1, false, 0, Math.PI);
    top.rotateX(Math.PI / 2);
    top.rotateZ(Math.PI / 2);
    top.rotateY(Math.PI / 2);
    top.translate(0, 0.8, 0);
    parts.push(slab, top);
  } else if (kind === 1) {
    const post = new THREE.BoxGeometry(0.16, 1.2, 0.14);
    post.translate(0, 0.6, 0);
    const bar = new THREE.BoxGeometry(0.62, 0.14, 0.14);
    bar.translate(0, 0.86, 0);
    parts.push(post, bar);
  } else {
    const slab = new THREE.BoxGeometry(0.5, 0.55, 0.2);
    slab.translate(0, 0.27, 0);
    parts.push(slab);
  }
  const base = new THREE.BoxGeometry(0.8, 0.12, 0.35);
  base.translate(0, 0.02, 0);
  parts.push(base);
  const nonIdx = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  return mergeGeometries(nonIdx, false)!;
}

function makeReeds(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const h = rng.range(0.8, 1.9);
    const g = new THREE.ConeGeometry(0.018, h, 3, 1, true);
    g.translate(0, h / 2, 0);
    g.rotateX(rng.range(-0.25, 0.25));
    g.rotateZ(rng.range(-0.25, 0.25));
    g.translate(rng.range(-0.35, 0.35), 0, rng.range(-0.35, 0.35));
    parts.push(g);
  }
  return mergeGeometries(parts, false)!;
}

function makeBones(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const skull = new THREE.SphereGeometry(0.11, 8, 6);
  skull.scale(0.9, 0.85, 1.1);
  skull.translate(0, 0.09, 0);
  parts.push(skull.toNonIndexed());
  const jaw = new THREE.BoxGeometry(0.1, 0.04, 0.08);
  jaw.translate(0, 0.02, 0.07);
  parts.push(jaw.toNonIndexed());
  for (let i = 0; i < 4; i++) {
    const b = new THREE.CylinderGeometry(0.02, 0.025, rng.range(0.3, 0.45), 5);
    b.rotateZ(Math.PI / 2);
    b.rotateY(rng.range(0, Math.PI));
    b.translate(rng.range(-0.3, 0.3), 0.03, rng.range(-0.3, 0.3));
    parts.push(b.toNonIndexed());
  }
  return mergeGeometries(parts, false)!;
}

/** Instanced props split into spatial chunks for culling. */
export class InstancedField {
  private chunks = new Map<string, { mesh: THREE.InstancedMesh; lo: THREE.InstancedMesh | null; center: THREE.Vector3; far: boolean }>();
  private pending = new Map<string, THREE.Matrix4[]>();
  constructor(
    private geo: THREE.BufferGeometry,
    private mat: THREE.Material,
    private chunk = 40,
    private shadows = true,
    /** Optional low-detail geometry swapped in for whole chunks beyond LOD_DIST. */
    private lodGeo: THREE.BufferGeometry | null = null,
  ) {}

  add(m: THREE.Matrix4): void {
    const x = m.elements[12];
    const z = m.elements[14];
    const k = `${Math.floor(x / this.chunk)}|${Math.floor(z / this.chunk)}`;
    let list = this.pending.get(k);
    if (!list) {
      list = [];
      this.pending.set(k, list);
    }
    list.push(m.clone());
  }

  finish(scene: THREE.Scene, streamer?: ChunkStreamer): void {
    for (const [k, list] of this.pending) {
      const mesh = new THREE.InstancedMesh(this.geo, this.mat, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = this.shadows;
      mesh.receiveShadow = true;
      const group = new THREE.Group();
      group.add(mesh);
      let lo: THREE.InstancedMesh | null = null;
      if (this.lodGeo) {
        // the low-detail mesh shares the instance buffer, so the swap costs nothing
        lo = new THREE.InstancedMesh(this.lodGeo, this.mat, list.length);
        lo.instanceMatrix = mesh.instanceMatrix;
        lo.boundingSphere = mesh.boundingSphere;
        // far chunks skip the shadow pass: the outer cascades cannot resolve twigs through the fog
        lo.castShadow = false;
        lo.receiveShadow = true;
        lo.visible = false;
        group.add(lo);
      }
      scene.add(group);
      const bs = mesh.boundingSphere!;
      streamer?.add(group, scene, bs.center.x, bs.center.z, bs.radius);
      this.chunks.set(k, { mesh, lo, center: bs.center.clone(), far: false });
    }
    this.pending.clear();
  }

  /** Swap chunks between full and low detail by distance (with a little hysteresis). */
  lod(cam: THREE.Vector3): void {
    for (const c of this.chunks.values()) {
      if (!c.lo) continue;
      const d = Math.hypot(c.center.x - cam.x, c.center.z - cam.z) - (c.mesh.boundingSphere?.radius ?? 0) * 0.5;
      const far = c.far ? d > LOD_DIST - 4 : d > LOD_DIST + 4;
      if (far === c.far) continue;
      c.far = far;
      c.mesh.visible = !far;
      c.lo.visible = far;
    }
  }

  get count(): number {
    let n = 0;
    for (const c of this.chunks.values()) n += c.mesh.count;
    return n;
  }
}

/** Distance beyond which prop chunks switch to their low-detail mesh. */
const LOD_DIST = 40;

export interface PropSet {
  trees: InstancedField[];
  rocks: InstancedField[];
  graves: InstancedField[];
  reeds: InstancedField;
  bones: InstancedField;
  streamer: ChunkStreamer;
  cull(cam: THREE.Vector3, maxDist: number): void;
}

export function createPropSet(mats: MaterialLibrary): PropSet {
  const treeSeeds = [11, 23, 37, 51];
  const rockGeos = [3, 9, 17].map(makeRockGeometry);
  const graveGeos = [0, 1, 2].map(makeGravestone);
  const reedMat = new THREE.MeshStandardMaterial({ color: 0x3b3a2c, roughness: 1, side: THREE.DoubleSide });
  const set: PropSet = {
    trees: treeSeeds.map((s) => new InstancedField(makeTreeGeometry(s), mats.bark.material, 40, true, makeTreeGeometry(s, true))),
    rocks: rockGeos.map((g) => new InstancedField(g, mats.rock.material, 48)),
    graves: graveGeos.map((g) => new InstancedField(g, mats.stone.material, 48)),
    reeds: new InstancedField(makeReeds(5), reedMat, 40, false),
    bones: new InstancedField(makeBones(8), mats.bone.material, 48, false),
    streamer: new ChunkStreamer(12),
    cull(cam: THREE.Vector3, maxDist: number) {
      set.streamer.update(cam, maxDist);
      for (const f of set.trees) f.lod(cam);
    },
  };
  return set;
}

// ---------------------------------------------------------------------------
// Hanging cages
// ---------------------------------------------------------------------------
export interface Cage {
  group: THREE.Group;
  phase: number;
  amp: number;
}

export function buildCage(mats: MaterialLibrary, anchor: THREE.Vector3, drop: number, body: THREE.BufferGeometry | null): Cage {
  const parts: THREE.BufferGeometry[] = [];
  const h = 1.9;
  const r = 0.55;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const bar = new THREE.CylinderGeometry(0.018, 0.018, h, 4);
    bar.translate(Math.cos(a) * r, -drop - h / 2, Math.sin(a) * r);
    parts.push(bar);
  }
  for (const y of [0, h * 0.5, h]) {
    const ring = new THREE.TorusGeometry(r, 0.03, 4, 16);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, -drop - y, 0);
    parts.push(ring);
  }
  const floor = new THREE.CylinderGeometry(r, r, 0.05, 12);
  floor.translate(0, -drop - h, 0);
  parts.push(floor);
  const dome = new THREE.SphereGeometry(r, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.5, 1);
  dome.translate(0, -drop, 0);
  parts.push(dome);
  const chain = new THREE.CylinderGeometry(0.025, 0.025, drop, 4);
  chain.translate(0, -drop / 2, 0);
  parts.push(chain);
  const nonIdx = parts.map((p) => {
    const q = p.index ? p.toNonIndexed() : p;
    if (!q.attributes.uv) q.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2));
    return q;
  });
  const geo = mergeGeometries(nonIdx, false)!;
  const group = new THREE.Group();
  group.position.copy(anchor);
  const mesh = new THREE.Mesh(geo, mats.iron.material);
  mesh.castShadow = true;
  group.add(mesh);
  if (body) {
    const bm = new THREE.Mesh(body, mats.vertexColor);
    bm.castShadow = true;
    group.add(bm);
  }
  return { group, phase: Math.random() * 10, amp: 0.04 + Math.random() * 0.05 };
}

// ---------------------------------------------------------------------------
// Dynamic physics props (barrels, crates) - knocked around by characters
// ---------------------------------------------------------------------------
export class DynamicProp {
  readonly prev = new THREE.Vector3();
  readonly curr = new THREE.Vector3();
  readonly prevQ = new THREE.Quaternion();
  readonly currQ = new THREE.Quaternion();
  readonly home = new THREE.Vector3();
  readonly homeQ = new THREE.Quaternion();
  constructor(
    readonly mesh: THREE.Mesh,
    readonly body: RAPIER.RigidBody,
    readonly radius: number,
  ) {
    const t = body.translation();
    const r = body.rotation();
    this.curr.set(t.x, t.y, t.z);
    this.prev.copy(this.curr);
    this.currQ.set(r.x, r.y, r.z, r.w);
    this.prevQ.copy(this.currQ);
    this.home.copy(this.curr);
    this.homeQ.copy(this.currQ);
  }

  step(): void {
    this.prev.copy(this.curr);
    this.prevQ.copy(this.currQ);
    const t = this.body.translation();
    const r = this.body.rotation();
    this.curr.set(t.x, t.y, t.z);
    this.currQ.set(r.x, r.y, r.z, r.w);
  }

  render(alpha: number): void {
    this.mesh.position.lerpVectors(this.prev, this.curr, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevQ, this.currQ, alpha);
  }

  impulse(dir: THREE.Vector3, strength: number): void {
    this.body.wakeUp();
    this.body.applyImpulse({ x: dir.x * strength, y: Math.abs(dir.y) * strength + strength * 0.3, z: dir.z * strength }, true);
    this.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * strength * 0.3, y: (Math.random() - 0.5) * strength * 0.3, z: (Math.random() - 0.5) * strength * 0.3 }, true);
  }

  reset(): void {
    this.body.setTranslation({ x: this.home.x, y: this.home.y, z: this.home.z }, false);
    this.body.setRotation({ x: this.homeQ.x, y: this.homeQ.y, z: this.homeQ.z, w: this.homeQ.w }, false);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    this.body.sleep();
    this.curr.copy(this.home);
    this.prev.copy(this.home);
    this.currQ.copy(this.homeQ);
    this.prevQ.copy(this.homeQ);
  }
}

export function makeBarrel(physics: Physics, mats: MaterialLibrary, pos: THREE.Vector3): DynamicProp {
  const g = new THREE.CylinderGeometry(0.36, 0.36, 0.95, 12, 3);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const bulge = 1 + 0.12 * Math.cos((y / 0.475) * (Math.PI / 2));
    p.setX(i, p.getX(i) * bulge);
    p.setZ(i, p.getZ(i) * bulge);
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mats.wood.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const body = physics.createDynamicCylinder(pos.clone().setY(pos.y + 0.5), 0.475, 0.38, new THREE.Quaternion(), 0.6);
  return new DynamicProp(mesh, body, 0.45);
}

export function makeCrate(physics: Physics, mats: MaterialLibrary, pos: THREE.Vector3, size = 0.8, yaw = 0): DynamicProp {
  const g = new THREE.BoxGeometry(size, size, size);
  const mesh = new THREE.Mesh(g, mats.wood.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const body = physics.createDynamicBox(pos.clone().setY(pos.y + size / 2 + 0.02), new THREE.Vector3(size / 2, size / 2, size / 2), q, 0.5);
  return new DynamicProp(mesh, body, size * 0.6);
}

/** Jittered grid placement helper used for scattering props. */
export function scatter(
  rect: [number, number, number, number],
  spacing: number,
  seed: number,
  accept: (x: number, z: number, rng: Rng) => boolean,
): [number, number][] {
  const rng = new Rng(seed);
  const out: [number, number][] = [];
  for (let z = rect[1]; z < rect[3]; z += spacing) {
    for (let x = rect[0]; x < rect[2]; x += spacing) {
      const px = x + rng.range(0.1, 0.9) * spacing;
      const pz = z + rng.range(0.1, 0.9) * spacing;
      // density variation
      if (fbm2(px * 0.03, pz * 0.03, 2) < -0.25) continue;
      if (accept(px, pz, rng)) out.push([px, pz]);
    }
  }
  return out;
}
