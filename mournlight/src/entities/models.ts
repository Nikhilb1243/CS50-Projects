import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { HUMAN, JOINTS, Rig, SkinBuilder, type Joint, type Proportions, type Vec3T } from './rig';
import { patchFog, rimPatch, dissolvePatch } from '../fx/fog';

/**
 * A spawned character model. Entities only talk to this interface, so the
 * procedural builders can be swapped for GLTF assets later (see
 * GLTFModelProvider).
 */
export interface ModelInstance {
  /** Positioned/rotated by the owning entity. */
  root: THREE.Group;
  /** Scaled container holding the mesh + skeleton. */
  body: THREE.Group;
  rig: Rig;
  /** Named attachment points (weapon tips, lantern hook, mouth...). */
  sockets: Map<string, THREE.Object3D>;
  /** Named damage segments: [base, tip] sockets. */
  strikers: Map<string, [THREE.Object3D, THREE.Object3D]>;
  /** Optional detachable pieces (boss mask, staff, claws). */
  extras: Map<string, THREE.Object3D>;
  materials: THREE.Material[];
  scale: number;
  setOpacity(o: number): void;
  /** 0 = whole, 1 = gone: burns the body away (falls back to opacity for materials without the patch). */
  setDissolve(v: number): void;
  flash(amount: number): void;
  setShadows(cast: boolean): void;
  dispose(): void;
}

export interface ModelProvider {
  has(id: string): boolean;
  create(id: string): ModelInstance;
}

// ---------------------------------------------------------------------------
// Geometry shorthands
// ---------------------------------------------------------------------------
const cap = (r: number, len: number, radial = 8): THREE.BufferGeometry => new THREE.CapsuleGeometry(r, len, 3, radial);
const cyl = (rt: number, rb: number, h: number, seg = 8, open = false): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
const sph = (r: number, ws = 10, hs = 8): THREE.BufferGeometry => new THREE.SphereGeometry(r, ws, hs);
const cone = (r: number, h: number, seg = 8): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, seg);
const torus = (r: number, tube: number, arc = Math.PI * 2, rs = 6, ts = 12): THREE.BufferGeometry =>
  new THREE.TorusGeometry(r, tube, rs, ts, arc);
const hoodGeo = (r: number): THREE.BufferGeometry =>
  new THREE.SphereGeometry(r, 12, 10, Math.PI / 2 + 0.75, Math.PI * 2 - 1.5, 0, Math.PI * 0.72);

function lathe(profile: [number, number][], seg = 12): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  );
}

function charMaterials(opts: { doubleSide?: boolean; roughness?: number; metalRough?: number } = {}): THREE.Material[] {
  // one dissolve uniform per model, shared by its materials (see ModelInstance.setDissolve)
  const dissolve = { value: 0 };
  const litPatch = (shader: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer): void => {
    rimPatch(shader, r);
    dissolvePatch(shader, dissolve);
  };
  const cloth = patchFog(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: opts.roughness ?? 0.88,
      metalness: 0.02,
      side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    }),
    litPatch,
    'rim-dis',
  );
  const metal = patchFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.metalRough ?? 0.45, metalness: 0.85 }), litPatch, 'rim-dis');
  const glow = patchFog(new THREE.MeshBasicMaterial({ vertexColors: true }), (shader) => dissolvePatch(shader, dissolve), 'dis');
  for (const m of [cloth, metal, glow]) m.userData.dissolve = dissolve;
  return [cloth, metal, glow];
}

function socket(parent: THREE.Object3D, name: string, pos: Vec3T, map: Map<string, THREE.Object3D>): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0);
  parent.add(o);
  map.set(name, o);
  return o;
}

function finish(
  b: SkinBuilder,
  mats: THREE.Material[],
  scale: number,
  setup: (bone: (j: Joint) => THREE.Bone, sockets: Map<string, THREE.Object3D>, strikers: Map<string, [THREE.Object3D, THREE.Object3D]>, extras: Map<string, THREE.Object3D>) => void,
): ModelInstance {
  const { mesh, bones } = b.build(mats);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(scale);
  body.add(mesh);
  root.add(body);
  const sockets = new Map<string, THREE.Object3D>();
  const strikers = new Map<string, [THREE.Object3D, THREE.Object3D]>();
  const extras = new Map<string, THREE.Object3D>();
  const bone = (j: Joint): THREE.Bone => bones[JOINTS.indexOf(j)];
  setup(bone, sockets, strikers, extras);
  const rig = new Rig(bones);
  const baseEmissive = (mats[0] as THREE.MeshStandardMaterial).emissive.clone();
  let opacity = 1;
  let extrasHidden = false;
  return {
    root,
    body,
    rig,
    sockets,
    strikers,
    extras,
    materials: mats,
    scale,
    setOpacity(o: number) {
      if (o === opacity) return;
      opacity = o;
      for (const m of mats) {
        m.transparent = o < 0.999;
        m.opacity = o;
        m.depthWrite = o > 0.5;
        m.needsUpdate = true;
      }
      extras.forEach((e) =>
        e.traverse((c) => {
          const mm = (c as THREE.Mesh).material as THREE.Material | undefined;
          if (mm && 'opacity' in mm) {
            mm.transparent = o < 0.999;
            mm.opacity = o;
          }
        }),
      );
    },
    setDissolve(v: number) {
      const u = mats[0].userData.dissolve as { value: number } | undefined;
      if (!u) {
        this.setOpacity(1 - v);
        return;
      }
      u.value = v;
      // carried pieces (weapons, lanterns, masks) drop out early rather than dissolving
      const hide = v >= 0.3;
      if (hide !== extrasHidden) {
        extrasHidden = hide;
        extras.forEach((e) => (e.visible = !hide));
      }
    },
    flash(amount: number) {
      const m = mats[0] as THREE.MeshStandardMaterial;
      m.emissive.copy(baseEmissive).lerp(new THREE.Color(0xffe6c8), amount * 0.5);
    },
    setShadows(cast: boolean) {
      mesh.castShadow = cast;
      extras.forEach((e) => e.traverse((c) => ((c as THREE.Mesh).isMesh ? ((c as THREE.Mesh).castShadow = cast) : null)));
    },
    dispose() {
      mesh.geometry.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Shared body parts
// ---------------------------------------------------------------------------
function limbs(
  b: SkinBuilder,
  p: Proportions,
  c: { upper: THREE.ColorRepresentation; fore: THREE.ColorRepresentation; hand: THREE.ColorRepresentation; thigh: THREE.ColorRepresentation; shin: THREE.ColorRepresentation; foot: THREE.ColorRepresentation },
  r: { upper: number; fore: number; hand: number; thigh: number; shin: number },
): void {
  b.addPair('upperArmR', 'upperArmL', cap(r.upper, p.upperArm - r.upper), c.upper, { pos: [0, -p.upperArm / 2, 0] });
  b.addPair('forearmR', 'forearmL', cap(r.fore, p.forearm - r.fore), c.fore, { pos: [0, -p.forearm / 2, 0] });
  b.addPair('handR', 'handL', box(r.hand * 1.3, p.hand, r.hand * 0.7), c.hand, { pos: [0, -p.hand / 2, 0] });
  b.addPair('thighR', 'thighL', cap(r.thigh, p.thigh - r.thigh), c.thigh, { pos: [0, -p.thigh / 2, 0] });
  b.addPair('shinR', 'shinL', cap(r.shin, p.shin - r.shin), c.shin, { pos: [0, -p.shin / 2, 0] });
  b.addPair('footR', 'footL', box(r.shin * 1.5, 0.07, 0.24), c.foot, { pos: [0, -0.015, 0.05] });
}

// ---------------------------------------------------------------------------
// The Revenant (player)
// ---------------------------------------------------------------------------
function buildRevenant(): ModelInstance {
  const p = HUMAN;
  const b = new SkinBuilder(p);
  const cloak = 0x3a352f;
  const cloak2 = 0x2c2824;
  const leather = 0x54433a;
  const wraps = 0x6a6154;
  const skin = 0x7d7a74;

  b.add('hips', box(0.32, 0.2, 0.2), leather, { pos: [0, 0, 0] });
  b.add('hips', torus(0.17, 0.025, Math.PI * 2, 5, 14), 0x241e1a, { pos: [0, 0.05, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.75, 1] });
  b.add('spine', cyl(0.15, 0.165, 0.3, 8), cloak2, { pos: [0, 0.1, 0], scale: [1, 1, 0.75] });
  b.add('chest', cyl(0.2, 0.155, 0.3, 8), cloak, { pos: [0, 0.1, 0], scale: [1, 1, 0.72] });
  b.add('chest', sph(0.27, 12, 8), cloak, { pos: [0, 0.2, -0.01], scale: [1.08, 0.5, 0.82] });
  b.add('chest', box(0.06, 0.34, 0.02), 0x4a3d30, { pos: [0.05, 0.1, 0.13], rot: [0, 0, 0.5] }); // strap
  b.add('neck', cyl(0.05, 0.06, 0.12, 6), skin, { pos: [0, 0.04, 0] });
  b.add('head', sph(0.105, 10, 8), 0x141211, { pos: [0, 0.09, 0.0], scale: [0.95, 1.1, 1] });
  b.add('head', hoodGeo(0.16), cloak, { pos: [0, 0.09, -0.01], scale: [1, 1.15, 1.12] });
  b.add('head', cone(0.09, 0.22, 8), cloak, { pos: [0, 0.06, -0.15], rot: [-2.5, 0, 0] });
  b.add('head', sph(0.013, 6, 5), 0xffa24a, { pos: [-0.037, 0.1, 0.092], slot: 2, emissive: 3.2, grime: 0 });
  b.add('head', sph(0.013, 6, 5), 0xffa24a, { pos: [0.037, 0.1, 0.092], slot: 2, emissive: 3.2, grime: 0 });

  limbs(
    b,
    p,
    { upper: cloak, fore: leather, hand: wraps, thigh: 0x2a2521, shin: leather, foot: 0x221b16 },
    { upper: 0.07, fore: 0.055, hand: 0.07, thigh: 0.08, shin: 0.062 },
  );
  // sleeve cuffs, bracers
  b.addPair('forearmR', 'forearmL', cyl(0.07, 0.06, 0.12, 8), wraps, { pos: [0, -0.2, 0] });
  // coat tails bound to thighs so they follow the legs
  b.addPair('thighR', 'thighL', cyl(0.07, 0.12, 0.58, 4), cloak, { pos: [-0.02, -0.2, 0.09], rot: [0.08, Math.PI / 4, 0.06], scale: [1, 1, 0.18] });
  b.addPair('thighR', 'thighL', cyl(0.08, 0.13, 0.66, 4), cloak2, { pos: [-0.02, -0.23, -0.09], rot: [-0.08, Math.PI / 4, 0.05], scale: [1, 1, 0.18] });

  // weapons are separate meshes attached by entities/weapons.ts (WeaponRig)
  return finish(b, charMaterials({ doubleSide: true }), 1, (bone, sockets, strikers) => {
    const base = socket(bone('handR'), 'weaponBase', [0, -0.2, 0], sockets);
    const tip = socket(bone('handR'), 'weaponTip', [0, -1.17, 0], sockets);
    strikers.set('weapon', [base, tip]);
    socket(bone('handL'), 'lantern', [0, -0.08, 0.02], sockets);
    socket(bone('head'), 'head', [0, 0.1, 0.05], sockets);
    socket(bone('handL'), 'flask', [0, -0.07, 0.04], sockets);
    socket(bone('chest'), 'chest', [0, 0.1, 0], sockets);
  });
}

/** The lantern object (non-skinned) that hangs from the Revenant's hand. */
export function buildLantern(): { group: THREE.Group; flame: THREE.Mesh; glass: THREE.Mesh } {
  const g = new THREE.Group();
  const iron = patchFog(new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 0.5, metalness: 0.8 }));
  const glassMat = patchFog(
    new THREE.MeshStandardMaterial({
      color: 0xffd9a0,
      emissive: 0xffa040,
      emissiveIntensity: 1.6,
      roughness: 0.2,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  const flameMat = patchFog(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.8) }));
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = false;
    g.add(m);
    return m;
  };
  add(new THREE.TorusGeometry(0.045, 0.006, 5, 12), iron, 0, -0.01, 0).rotation.x = 0;
  add(new THREE.ConeGeometry(0.075, 0.07, 6), iron, 0, -0.07, 0);
  const glass = add(new THREE.CylinderGeometry(0.055, 0.06, 0.13, 6, 1, true), glassMat, 0, -0.17, 0);
  add(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 6), iron, 0, -0.245, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(new THREE.BoxGeometry(0.008, 0.15, 0.008), iron, Math.cos(a) * 0.062, -0.17, Math.sin(a) * 0.062);
  }
  const flame = add(new THREE.ConeGeometry(0.018, 0.06, 6), flameMat, 0, -0.18, 0);
  return { group: g, flame, glass };
}

// ---------------------------------------------------------------------------
// Shambler: bloated drowned villager
// ---------------------------------------------------------------------------
function buildShambler(phantom = false): ModelInstance {
  const p: Proportions = { ...HUMAN, upperArm: 0.33, forearm: 0.31, hand: 0.12 };
  const b = new SkinBuilder(p);
  b.grime = 0.3;
  const skin = 0x6f7862;
  const skin2 = 0x565e4c;
  const rag = 0x4a443b;
  const bone = 0x9f9884;

  b.add('hips', box(0.34, 0.22, 0.24), skin2);
  b.add('hips', cone(0.3, 0.5, 7), rag, { pos: [0, -0.12, 0], rot: [Math.PI, 0.3, 0], scale: [1, 1, 0.9] });
  b.add('spine', sph(0.23, 10, 8), skin, { pos: [0, 0.07, 0.03], scale: [1.08, 1, 1.1] });
  b.add('chest', sph(0.25, 10, 8), skin, { pos: [0, 0.11, 0], scale: [1.15, 0.92, 0.92] });
  b.add('chest', sph(0.15, 8, 6), skin2, { pos: [0.06, 0.22, -0.13] });
  b.add('chest', box(0.46, 0.24, 0.36), rag, { pos: [0, 0.02, 0], rot: [0, 0.2, 0.08], scale: [1, 1, 1] });
  for (let i = 0; i < 7; i++) {
    const a = i * 1.7;
    b.add('chest', sph(0.025 + (i % 3) * 0.008, 5, 4), bone, { pos: [Math.cos(a) * 0.2, 0.2 + (i % 2) * 0.05, Math.sin(a) * 0.14 - 0.05] });
  }
  b.add('neck', cyl(0.07, 0.09, 0.14, 7), skin, { pos: [0, 0.03, 0] });
  b.add('head', sph(0.13, 10, 8), skin, { pos: [0, 0.1, 0.01], scale: [0.95, 1.1, 1.02] });
  b.add('head', box(0.13, 0.05, 0.1), skin2, { pos: [0, -0.01, 0.08], rot: [0.5, 0, 0] });
  b.add('head', sph(0.02, 5, 4), 0x9fb09c, { pos: [-0.045, 0.12, 0.115], slot: 2, emissive: 0.9, grime: 0 });
  b.add('head', sph(0.02, 5, 4), 0x9fb09c, { pos: [0.045, 0.12, 0.115], slot: 2, emissive: 0.9, grime: 0 });
  for (let i = 0; i < 6; i++) {
    b.add('head', cyl(0.008, 0.004, 0.3, 4), 0x1a1917, { pos: [-0.09 + i * 0.036, 0.0, -0.09], rot: [0.2, 0, (i - 2.5) * 0.08] });
  }
  limbs(
    b,
    p,
    { upper: skin, fore: skin2, hand: skin2, thigh: rag, shin: skin2, foot: skin2 },
    { upper: 0.075, fore: 0.065, hand: 0.09, thigh: 0.095, shin: 0.075 },
  );
  for (const h of ['handR', 'handL'] as Joint[]) {
    for (let f = 0; f < 3; f++) b.add(h, cone(0.013, 0.12, 4), bone, { pos: [(f - 1) * 0.03, -0.16, 0.01], rot: [Math.PI, 0, 0] });
  }
  const mats = phantom ? phantomMaterials() : charMaterials({ doubleSide: false });
  return finish(b, mats, 1, (bn, sockets, strikers) => {
    strikers.set('clawR', [socket(bn('handR'), 'clawRBase', [0, 0.05, 0], sockets), socket(bn('handR'), 'clawRTip', [0, -0.2, 0], sockets)]);
    strikers.set('clawL', [socket(bn('handL'), 'clawLBase', [0, 0.05, 0], sockets), socket(bn('handL'), 'clawLTip', [0, -0.2, 0], sockets)]);
    socket(bn('head'), 'head', [0, 0.1, 0.1], sockets);
    socket(bn('chest'), 'chest', [0, 0.1, 0], sockets);
    socket(bn('head'), 'mouth', [0, 0.02, 0.14], sockets);
  });
}

function phantomMaterials(): THREE.Material[] {
  const mk = (): THREE.Material =>
    patchFog(
      new THREE.MeshBasicMaterial({
        vertexColors: false,
        color: new THREE.Color(0.35, 0.42, 0.48),
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
  const m0 = mk() as THREE.MeshBasicMaterial;
  // phantom still needs an emissive property for flash(): fake it
  (m0 as unknown as { emissive: THREE.Color }).emissive = new THREE.Color(0, 0, 0);
  return [m0, mk(), mk()];
}

// ---------------------------------------------------------------------------
// Stalker: tall, thin, faceless
// ---------------------------------------------------------------------------
function buildStalker(silhouette = false): ModelInstance {
  const p: Proportions = {
    ...HUMAN,
    hipsHeight: 1.26,
    spine: 0.14,
    chest: 0.3,
    neck: 0.33,
    head: 0.12,
    shoulderX: 0.19,
    shoulderY: 0.26,
    upperArm: 0.44,
    forearm: 0.44,
    hand: 0.16,
    hipX: 0.09,
    thigh: 0.61,
    shin: 0.62,
  };
  const b = new SkinBuilder(p);
  b.grime = 0.22;
  const skin = silhouette ? 0x050506 : 0xb4b0a6;
  const dark = silhouette ? 0x030304 : 0x5f5c57;
  b.add('hips', box(0.26, 0.16, 0.14), dark);
  b.add('spine', cyl(0.08, 0.1, 0.2, 7), skin, { pos: [0, 0.06, 0], scale: [1, 1, 0.7] });
  b.add('chest', cyl(0.17, 0.1, 0.36, 8), skin, { pos: [0, 0.12, 0], scale: [1, 1, 0.62] });
  if (!silhouette) {
    for (let i = 0; i < 5; i++) {
      b.add('chest', torus(0.135 - i * 0.01, 0.01, Math.PI, 4, 10), dark, { pos: [0, 0.2 - i * 0.055, 0.0], rot: [Math.PI / 2, 0, Math.PI], scale: [1, 0.62, 1] });
    }
  }
  b.add('neck', cyl(0.035, 0.045, 0.34, 6), skin, { pos: [0, 0.16, 0] });
  b.add('head', sph(0.1, 10, 10), skin, { pos: [0, 0.12, 0.01], scale: [0.78, 1.65, 0.9] });
  if (!silhouette) b.add('head', box(0.012, 0.2, 0.02), 0x120c0b, { pos: [0, 0.1, 0.085] });
  limbs(
    b,
    p,
    { upper: skin, fore: skin, hand: dark, thigh: skin, shin: skin, foot: dark },
    { upper: 0.04, fore: 0.034, hand: 0.05, thigh: 0.055, shin: 0.04 },
  );
  b.addPair('forearmR', 'forearmL', sph(0.045, 6, 5), dark, { pos: [0, 0, 0] });
  b.addPair('shinR', 'shinL', sph(0.05, 6, 5), dark, { pos: [0, 0, 0] });
  for (const h of ['handR', 'handL'] as Joint[]) {
    for (let f = 0; f < 4; f++) b.add(h, cone(0.009, 0.22, 4), dark, { pos: [(f - 1.5) * 0.018, -0.24, 0], rot: [Math.PI, 0, (f - 1.5) * 0.08] });
  }
  const mats = charMaterials();
  if (silhouette) {
    (mats[0] as THREE.MeshStandardMaterial).roughness = 1;
  }
  return finish(b, mats, 1, (bn, sockets, strikers) => {
    strikers.set('clawR', [socket(bn('handR'), 'clawRBase', [0, 0.05, 0], sockets), socket(bn('handR'), 'clawRTip', [0, -0.34, 0], sockets)]);
    strikers.set('clawL', [socket(bn('handL'), 'clawLBase', [0, 0.05, 0], sockets), socket(bn('handL'), 'clawLTip', [0, -0.34, 0], sockets)]);
    socket(bn('head'), 'head', [0, 0.12, 0.05], sockets);
    socket(bn('chest'), 'chest', [0, 0.12, 0], sockets);
  });
}

// ---------------------------------------------------------------------------
// Crawler: long-limbed spider-walker
// ---------------------------------------------------------------------------
function buildCrawler(): ModelInstance {
  const p: Proportions = {
    ...HUMAN,
    hipsHeight: 1.0,
    spine: 0.14,
    chest: 0.26,
    neck: 0.22,
    head: 0.1,
    upperArm: 0.42,
    forearm: 0.44,
    hand: 0.14,
    thigh: 0.5,
    shin: 0.52,
  };
  const b = new SkinBuilder(p);
  b.grime = 0.35;
  const skin = 0x6e6158;
  const dark = 0x3a322c;
  const teeth = 0xc4bba2;
  b.add('hips', box(0.26, 0.16, 0.16), dark);
  b.add('spine', cyl(0.09, 0.11, 0.2, 7), skin, { pos: [0, 0.06, 0], scale: [1, 1, 0.75] });
  b.add('chest', cyl(0.16, 0.11, 0.32, 8), skin, { pos: [0, 0.1, 0], scale: [1, 1, 0.7] });
  for (let i = 0; i < 6; i++) b.add('chest', sph(0.022, 5, 4), dark, { pos: [0, 0.22 - i * 0.07, -0.1] });
  b.add('neck', cyl(0.04, 0.05, 0.24, 6), skin, { pos: [0, 0.1, 0] });
  b.add('head', sph(0.11, 10, 8), skin, { pos: [0, 0.08, 0.02], scale: [0.9, 1.05, 1.15] });
  b.add('head', box(0.14, 0.035, 0.16), dark, { pos: [0, -0.02, 0.1], rot: [0.55, 0, 0] });
  for (let i = 0; i < 6; i++) {
    b.add('head', cone(0.008, 0.04, 4), teeth, { pos: [-0.05 + i * 0.02, 0.02, 0.16], rot: [Math.PI, 0, 0] });
    b.add('head', cone(0.008, 0.035, 4), teeth, { pos: [-0.05 + i * 0.02, -0.035, 0.155] });
  }
  const eyes: Vec3T[] = [[-0.04, 0.12, 0.12], [0.04, 0.12, 0.12], [-0.065, 0.09, 0.105], [0.065, 0.09, 0.105]];
  for (const e of eyes) b.add('head', sph(0.012, 5, 4), 0xe8e3c8, { pos: e, slot: 2, emissive: 1.4, grime: 0 });
  limbs(
    b,
    p,
    { upper: skin, fore: skin, hand: dark, thigh: skin, shin: skin, foot: dark },
    { upper: 0.045, fore: 0.036, hand: 0.055, thigh: 0.055, shin: 0.04 },
  );
  for (const h of ['handR', 'handL'] as Joint[]) {
    for (let f = 0; f < 4; f++) b.add(h, cone(0.01, 0.16, 4), dark, { pos: [(f - 1.5) * 0.02, -0.19, 0], rot: [Math.PI, 0, 0] });
  }
  return finish(b, charMaterials(), 1, (bn, sockets, strikers) => {
    strikers.set('clawR', [socket(bn('handR'), 'clawRBase', [0, 0.1, 0], sockets), socket(bn('handR'), 'clawRTip', [0, -0.26, 0], sockets)]);
    strikers.set('clawL', [socket(bn('handL'), 'clawLBase', [0, 0.1, 0], sockets), socket(bn('handL'), 'clawLTip', [0, -0.26, 0], sockets)]);
    strikers.set('jaw', [socket(bn('head'), 'jawBase', [0, 0.05, 0], sockets), socket(bn('head'), 'jawTip', [0, 0.0, 0.22], sockets)]);
    socket(bn('head'), 'head', [0, 0.08, 0.1], sockets);
    socket(bn('chest'), 'chest', [0, 0.1, 0], sockets);
  });
}

// ---------------------------------------------------------------------------
// Drowned Knight
// ---------------------------------------------------------------------------
function buildKnight(): ModelInstance {
  const p = HUMAN;
  const b = new SkinBuilder(p);
  b.grime = 0.3;
  const armor = 0x66766f;
  const armor2 = 0x4c5955;
  const rust = 0x5e4a36;
  const cloth = 0x2e373a;
  const weed = 0x3c5236;

  b.add('hips', cyl(0.2, 0.25, 0.26, 8, false), armor2, { pos: [0, -0.05, 0], slot: 1, scale: [1, 1, 0.8] });
  b.add('spine', cyl(0.17, 0.18, 0.16, 8), cloth, { pos: [0, 0.05, 0], scale: [1, 1, 0.78] });
  b.add('chest', cyl(0.23, 0.18, 0.34, 8), armor, { pos: [0, 0.1, 0.0], slot: 1, scale: [1, 1, 0.78] });
  b.add('chest', box(0.08, 0.3, 0.05), rust, { pos: [0.06, 0.08, 0.17], rot: [0.1, 0, 0.1], slot: 1 });
  b.add('chest', cyl(0.12, 0.14, 0.08, 8), armor2, { pos: [0, 0.3, 0], slot: 1 });
  b.addPair('upperArmR', 'upperArmL', sph(0.14, 8, 6), armor, { pos: [-0.03, 0.0, 0], scale: [1.25, 0.85, 1.15], slot: 1 });
  b.addPair('upperArmR', 'upperArmL', sph(0.12, 8, 6), rust, { pos: [-0.04, 0.06, 0], scale: [1.1, 0.5, 1.0], slot: 1 });
  b.add('neck', cyl(0.07, 0.08, 0.1, 7), cloth, { pos: [0, 0.03, 0] });
  b.add('head', cyl(0.12, 0.13, 0.26, 10), armor, { pos: [0, 0.1, 0], slot: 1 });
  b.add('head', sph(0.12, 10, 6), armor, { pos: [0, 0.23, 0], scale: [1, 0.55, 1], slot: 1 });
  b.add('head', box(0.2, 0.022, 0.03), 0x050606, { pos: [0, 0.13, 0.115] });
  b.add('head', sph(0.012, 5, 4), 0x6fe0c8, { pos: [-0.04, 0.13, 0.12], slot: 2, emissive: 2.5, grime: 0 });
  b.add('head', sph(0.012, 5, 4), 0x6fe0c8, { pos: [0.04, 0.13, 0.12], slot: 2, emissive: 2.5, grime: 0 });
  for (let i = 0; i < 7; i++) {
    b.add('head', cyl(0.012, 0.004, 0.34 + (i % 3) * 0.08, 4), weed, { pos: [-0.1 + i * 0.033, 0.12, -0.11], rot: [0.25, 0, (i - 3) * 0.06] });
  }
  limbs(
    b,
    p,
    { upper: armor2, fore: armor, hand: armor2, thigh: cloth, shin: armor, foot: armor2 },
    { upper: 0.075, fore: 0.068, hand: 0.08, thigh: 0.09, shin: 0.075 },
  );
  b.addPair('shinR', 'shinL', sph(0.07, 6, 5), armor, { pos: [0, 0.0, 0.03], slot: 1 });
  b.addPair('thighR', 'thighL', box(0.2, 0.55, 0.025), cloth, { pos: [-0.02, -0.2, 0.12], rot: [0.08, 0, 0.06] });
  b.addPair('thighR', 'thighL', box(0.2, 0.6, 0.025), 0x1a1f22, { pos: [-0.02, -0.22, -0.12], rot: [-0.08, 0, 0.06] });
  // barnacles
  for (let i = 0; i < 9; i++) {
    const a = i * 2.3;
    b.add('chest', sph(0.02, 5, 4), 0x8f8a78, { pos: [Math.cos(a) * 0.18, 0.05 + (i % 4) * 0.07, Math.sin(a) * 0.14] });
  }
  // Greatsword
  b.add('handR', cyl(0.022, 0.022, 0.28, 6), 0x1e1712, { pos: [0, 0.0, 0] });
  b.add('handR', box(0.34, 0.04, 0.05), armor2, { pos: [0, -0.16, 0], slot: 1 });
  b.add('handR', box(0.085, 1.45, 0.02), 0x6c7676, { pos: [0, -0.9, 0], slot: 1 });
  b.add('handR', cone(0.043, 0.14, 4), 0x6c7676, { pos: [0, -1.69, 0], rot: [Math.PI, 0, 0], scale: [1, 1, 0.3], slot: 1 });
  for (let i = 0; i < 6; i++) b.add('handR', sph(0.018, 5, 4), 0x8f8a78, { pos: [(i % 2 ? 0.03 : -0.025), -0.5 - i * 0.18, 0.01] });

  return finish(b, charMaterials({ metalRough: 0.6 }), 1.12, (bn, sockets, strikers) => {
    strikers.set('weapon', [socket(bn('handR'), 'weaponBase', [0, -0.22, 0], sockets), socket(bn('handR'), 'weaponTip', [0, -1.74, 0], sockets)]);
    socket(bn('head'), 'head', [0, 0.13, 0.1], sockets);
    socket(bn('chest'), 'chest', [0, 0.1, 0], sockets);
  });
}

// ---------------------------------------------------------------------------
// Oskeline, the Wick-Mother (boss)
// ---------------------------------------------------------------------------
function buildWickMother(): ModelInstance {
  const p: Proportions = { ...HUMAN, upperArm: 0.36, forearm: 0.36, hand: 0.12, neck: 0.27 };
  const b = new SkinBuilder(p);
  b.grime = 0.25;
  const wax = 0xcfc5ad;
  const wax2 = 0xa3957a;
  const robe = 0x43332c;
  const skin = 0x8c7f6c;

  b.add('hips', lathe([[0.0, 0.1], [0.24, 0.08], [0.3, -0.2], [0.4, -0.55], [0.55, -0.85], [0.62, -0.97], [0.0, -0.97]], 14), robe);
  b.add('hips', lathe([[0.26, 0.06], [0.33, -0.2], [0.42, -0.5], [0.5, -0.7]], 14), wax, { pos: [0, 0, 0], scale: [1.02, 1, 1.02] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const len = 0.2 + (i % 4) * 0.08;
    b.add('hips', cyl(0.025, 0.012, len, 5), wax, { pos: [Math.cos(a) * 0.49, -0.7 - len / 2, Math.sin(a) * 0.49] });
  }
  b.add('spine', cyl(0.18, 0.22, 0.2, 10), wax, { pos: [0, 0.05, 0], scale: [1, 1, 0.8] });
  b.add('chest', cyl(0.24, 0.18, 0.36, 10), wax, { pos: [0, 0.1, 0], scale: [1, 1, 0.75] });
  b.add('chest', sph(0.26, 12, 8), wax2, { pos: [0, 0.24, -0.02], scale: [1.15, 0.45, 0.85] });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const len = 0.12 + (i % 3) * 0.07;
    b.add('chest', cyl(0.018, 0.008, len, 4), wax, { pos: [Math.cos(a) * 0.24, 0.24 - len / 2, Math.sin(a) * 0.18] });
  }
  b.add('neck', cyl(0.05, 0.07, 0.28, 7), skin, { pos: [0, 0.1, 0] });
  b.add('head', sph(0.11, 10, 8), skin, { pos: [0, 0.08, 0], scale: [0.9, 1.15, 1] });
  // crown of candles
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const h = 0.08 + ((i * 37) % 5) * 0.025;
    b.add('head', cyl(0.018, 0.02, h, 6), 0xe8dcc0, { pos: [Math.cos(a) * 0.09, 0.19 + h / 2, Math.sin(a) * 0.09] });
    b.add('head', cone(0.014, 0.045, 5), 0xffb257, { pos: [Math.cos(a) * 0.09, 0.19 + h + 0.025, Math.sin(a) * 0.09], slot: 2, emissive: 4, grime: 0 });
  }
  b.add('head', torus(0.1, 0.018, Math.PI * 2, 5, 12), 0x5a4a2a, { pos: [0, 0.19, 0], rot: [Math.PI / 2, 0, 0], slot: 1 });
  // long wax-dripping sleeves
  b.addPair('upperArmR', 'upperArmL', cyl(0.09, 0.07, p.upperArm, 8), wax, { pos: [0, -p.upperArm / 2, 0] });
  b.addPair('forearmR', 'forearmL', cyl(0.1, 0.05, p.forearm, 8), wax2, { pos: [0, -p.forearm / 2, 0] });
  b.addPair('forearmR', 'forearmL', cone(0.12, 0.2, 7), wax, { pos: [0, -0.1, 0], rot: [Math.PI, 0, 0] });
  b.addPair('handR', 'handL', box(0.09, 0.1, 0.05), skin, { pos: [0, -0.05, 0] });
  for (const h of ['handR', 'handL'] as Joint[]) {
    for (let f = 0; f < 4; f++) b.add(h, cyl(0.009, 0.006, 0.14, 4), skin, { pos: [(f - 1.5) * 0.02, -0.16, 0.01] });
  }
  // feet peeking out
  b.addPair('footR', 'footL', box(0.1, 0.06, 0.22), 0x3a3029, { pos: [0, -0.02, 0.06] });

  const mats = charMaterials({ doubleSide: true, roughness: 0.7 });
  return finish(b, mats, 2.9, (bn, sockets, strikers, extras) => {
    const glowMat = patchFog(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.3, 0.9) }));
    // Porcelain mask (detaches in phase 2)
    const maskMat = patchFog(new THREE.MeshStandardMaterial({ color: 0xe6e0d2, roughness: 0.35, metalness: 0.05 }));
    const mask = new THREE.Group();
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10, Math.PI / 2 - 1.1, 2.2, 0.25, 1.9), maskMat);
    face.scale.set(0.95, 1.2, 1.05);
    mask.add(face);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    for (const x of [-0.04, 0.04]) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.018, 8), holeMat);
      hole.position.set(x, 0.03, 0.122);
      mask.add(hole);
    }
    mask.position.set(0, 0.08, 0.01);
    bn('head').add(mask);
    extras.set('mask', mask);

    // Great candelabrum staff (dropped in phase 2)
    const staff = new THREE.Group();
    const bronze = patchFog(new THREE.MeshStandardMaterial({ color: 0x6d5732, roughness: 0.45, metalness: 0.9 }));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 2.5, 7), bronze);
    pole.position.y = -0.85;
    staff.add(pole);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.04), bronze);
    bar.position.y = -1.95;
    staff.add(bar);
    for (const x of [-0.24, 0, 0.24]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.06, 7), bronze);
      cup.position.set(x, -2.0, 0);
      staff.add(cup);
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6), maskMat);
      candle.position.set(x, -2.1, 0);
      staff.add(candle);
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 5), glowMat);
      fl.position.set(x, -2.2, 0);
      fl.rotation.x = Math.PI;
      staff.add(fl);
    }
    staff.traverse((c) => ((c as THREE.Mesh).isMesh ? ((c as THREE.Mesh).castShadow = true) : null));
    bn('handR').add(staff);
    extras.set('staff', staff);
    const sBase = socket(bn('handR'), 'weaponBase', [0, -1.1, 0], sockets);
    const sTip = socket(bn('handR'), 'weaponTip', [0, -2.15, 0], sockets);
    strikers.set('weapon', [sBase, sTip]);
    socket(bn('handR'), 'staffHead', [0, -2.05, 0], sockets);

    // Phase-2 claws
    const clawMat = patchFog(new THREE.MeshStandardMaterial({ color: 0x2a1a14, roughness: 0.6, emissive: 0x3a0800 }));
    for (const side of ['R', 'L'] as const) {
      const claws = new THREE.Group();
      for (let f = 0; f < 4; f++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.55, 5), clawMat);
        c.position.set((f - 1.5) * 0.028, -0.4, 0.02);
        c.rotation.x = Math.PI;
        claws.add(c);
      }
      claws.visible = false;
      claws.scale.setScalar(0.01);
      bn(`hand${side}` as Joint).add(claws);
      extras.set(`claws${side}`, claws);
      strikers.set(`claw${side}`, [
        socket(bn(`hand${side}` as Joint), `claw${side}Base`, [0, -0.05, 0], sockets),
        socket(bn(`hand${side}` as Joint), `claw${side}Tip`, [0, -0.7, 0], sockets),
      ]);
    }

    // Phase-2 exposed rot-heart and ribs
    const heartMat = patchFog(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 0.6, 0.25) }));
    const ribs = new THREE.Group();
    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), heartMat);
    heart.position.set(0, 0.12, 0.08);
    ribs.add(heart);
    const ribMat = patchFog(new THREE.MeshStandardMaterial({ color: 0xb5a88c, roughness: 0.7 }));
    for (let i = 0; i < 4; i++) {
      for (const s of [-1, 1]) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 4, 10, Math.PI * 0.6), ribMat);
        r.position.set(s * 0.02, 0.22 - i * 0.06, 0.1);
        r.rotation.set(0, s > 0 ? -0.3 : Math.PI + 0.3, 0);
        ribs.add(r);
      }
    }
    ribs.visible = false;
    bn('chest').add(ribs);
    extras.set('ribs', ribs);
    socket(bn('head'), 'head', [0, 0.1, 0.1], sockets);
    socket(bn('chest'), 'chest', [0, 0.12, 0.1], sockets);
    socket(bn('head'), 'crown', [0, 0.28, 0], sockets);
  });
}

// ---------------------------------------------------------------------------
// Corpse (environmental storytelling; usually baked into static geometry)
// ---------------------------------------------------------------------------
function buildCorpse(): ModelInstance {
  const p = HUMAN;
  const b = new SkinBuilder(p);
  b.grime = 0.35;
  const rag = 0x4e473e;
  const skin = 0x7f7566;
  b.add('hips', box(0.3, 0.2, 0.2), rag);
  b.add('spine', cyl(0.14, 0.15, 0.16, 7), rag, { pos: [0, 0.05, 0], scale: [1, 1, 0.7] });
  b.add('chest', cyl(0.18, 0.14, 0.3, 7), rag, { pos: [0, 0.1, 0], scale: [1, 1, 0.7] });
  b.add('neck', cyl(0.045, 0.05, 0.12, 6), skin, { pos: [0, 0.04, 0] });
  b.add('head', sph(0.1, 8, 7), skin, { pos: [0, 0.09, 0], scale: [0.95, 1.1, 1] });
  b.add('head', box(0.1, 0.03, 0.04), 0x1a1612, { pos: [0, 0.05, 0.085] });
  limbs(
    b,
    p,
    { upper: rag, fore: skin, hand: skin, thigh: rag, shin: rag, foot: 0x2a241f },
    { upper: 0.055, fore: 0.045, hand: 0.06, thigh: 0.07, shin: 0.055 },
  );
  return finish(b, charMaterials(), 1, (bn, sockets) => {
    socket(bn('chest'), 'chest', [0, 0.1, 0], sockets);
  });
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
export class ProceduralModelProvider implements ModelProvider {
  private builders: Record<string, () => ModelInstance> = {
    revenant: buildRevenant,
    shambler: () => buildShambler(false),
    phantom: () => buildShambler(true),
    stalker: () => buildStalker(false),
    silhouette: () => buildStalker(true),
    crawler: buildCrawler,
    knight: buildKnight,
    wickmother: buildWickMother,
    corpse: buildCorpse,
  };
  has(id: string): boolean {
    return id in this.builders;
  }
  create(id: string): ModelInstance {
    return this.builders[id]();
  }
}

/**
 * Loads GLTF characters and exposes them through the same interface.
 * `jointMap` maps our joint names to bone names in the file. Poses are
 * composed on top of each bone's rest rotation, so skeletons authored in a
 * limbs-down rest pose animate with the procedural pose library directly.
 */
export class GLTFModelProvider implements ModelProvider {
  private loader = new GLTFLoader();
  private assets = new Map<string, { scene: THREE.Object3D; jointMap: Partial<Record<Joint, string>>; scale: number; sockets: Record<string, { bone: string; pos: Vec3T }> }>();

  async load(
    id: string,
    url: string,
    jointMap: Partial<Record<Joint, string>>,
    opts: { scale?: number; sockets?: Record<string, { bone: string; pos: Vec3T }> } = {},
  ): Promise<void> {
    const gltf = await this.loader.loadAsync(url);
    this.assets.set(id, { scene: gltf.scene, jointMap, scale: opts.scale ?? 1, sockets: opts.sockets ?? {} });
  }

  has(id: string): boolean {
    return this.assets.has(id);
  }

  create(id: string): ModelInstance {
    const a = this.assets.get(id)!;
    const scene = SkeletonUtils.clone(a.scene);
    const byName = new Map<string, THREE.Object3D>();
    scene.traverse((o) => byName.set(o.name, o));
    const bones = JOINTS.map((j) => {
      const name = a.jointMap[j];
      const found = name ? byName.get(name) : undefined;
      return found ?? new THREE.Object3D();
    });
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.scale.setScalar(a.scale);
    body.add(scene);
    root.add(body);
    const sockets = new Map<string, THREE.Object3D>();
    for (const [name, s] of Object.entries(a.sockets)) {
      const parent = byName.get(s.bone);
      if (parent) socket(parent, name, s.pos, sockets);
    }
    const strikers = new Map<string, [THREE.Object3D, THREE.Object3D]>();
    if (sockets.has('weaponBase') && sockets.has('weaponTip')) strikers.set('weapon', [sockets.get('weaponBase')!, sockets.get('weaponTip')!]);
    const mats: THREE.Material[] = [];
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) mats.push(...(Array.isArray(m) ? m : [m]));
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });
    return {
      root,
      body,
      rig: new Rig(bones, true),
      sockets,
      strikers,
      extras: new Map(),
      materials: mats,
      scale: a.scale,
      setOpacity(o: number) {
        for (const m of mats) {
          m.transparent = o < 1;
          m.opacity = o;
        }
      },
      setDissolve(v: number) {
        this.setOpacity(1 - v);
      },
      flash() {
        /* no-op for imported assets */
      },
      setShadows(cast: boolean) {
        scene.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = cast) : null));
      },
      dispose() {
        /* shared resources stay cached */
      },
    };
  }
}

/** Model registry: first provider that knows an id wins (GLTF overrides procedural). */
export class ModelLibrary {
  private providers: ModelProvider[] = [];

  register(p: ModelProvider, priority = false): void {
    if (priority) this.providers.unshift(p);
    else this.providers.push(p);
  }

  create(id: string): ModelInstance {
    for (const p of this.providers) if (p.has(id)) return p.create(id);
    throw new Error(`No model provider for ${id}`);
  }
}

export const models = new ModelLibrary();
models.register(new ProceduralModelProvider());

// ---------------------------------------------------------------------------
// Pose baking: freeze a posed skinned model into static geometry
// ---------------------------------------------------------------------------
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _mats: THREE.Matrix4[] = [];
const _nm = new THREE.Matrix3();

/**
 * Returns non-indexed geometry (position, normal, color) of the skinned
 * mesh in its current pose, transformed by `world`. Used for corpses and
 * hanging bodies so hundreds of them cost a single draw call.
 */
export function bakePosed(inst: ModelInstance, world: THREE.Matrix4): THREE.BufferGeometry {
  inst.root.updateMatrixWorld(true);
  let mesh: THREE.SkinnedMesh | null = null;
  inst.body.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  const sm = mesh as unknown as THREE.SkinnedMesh;
  const skel = sm.skeleton;
  skel.update();
  _mats.length = 0;
  const bodyInv = new THREE.Matrix4().copy(inst.root.matrixWorld).invert();
  for (let i = 0; i < skel.bones.length; i++) {
    const m = new THREE.Matrix4().multiplyMatrices(skel.bones[i].matrixWorld, skel.boneInverses[i]);
    m.premultiply(bodyInv).premultiply(world);
    _mats.push(m);
  }
  const src = sm.geometry;
  const pos = src.attributes.position;
  const nor = src.attributes.normal;
  const col = src.attributes.color;
  const si = src.attributes.skinIndex;
  const n = pos.count;
  const outP = new Float32Array(n * 3);
  const outN = new Float32Array(n * 3);
  const outC = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const m = _mats[si.getX(i)];
    _v.fromBufferAttribute(pos, i).applyMatrix4(m);
    _nm.getNormalMatrix(m);
    _n.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
    outP.set([_v.x, _v.y, _v.z], i * 3);
    outN.set([_n.x, _n.y, _n.z], i * 3);
    outC.set([col.getX(i), col.getY(i), col.getZ(i)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(outP, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(outN, 3));
  g.setAttribute('color', new THREE.BufferAttribute(outC, 3));
  return g;
}
