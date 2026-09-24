import * as THREE from 'three';
import { patchFog } from '../fx/fog';
import type { WeaponId } from '../data/weapons';

/**
 * Procedural weapon meshes, attached to the Revenant's hand bones (the blade
 * runs along the hand's -Y axis). The rig also moves the striker sockets so
 * swept hit detection matches each weapon's reach.
 */
const std = (color: number, roughness: number, metalness: number, emissive = 0x000000, ei = 1): THREE.MeshStandardMaterial =>
  patchFog(new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity: ei }));

const steel = std(0x9aa0a8, 0.32, 0.9);
const darkSteel = std(0x3a3c42, 0.5, 0.85);
const grip = std(0x2a1c14, 0.85, 0);
const brass = std(0x6b5a3a, 0.4, 0.9);
const graveIron = std(0x4a4640, 0.7, 0.75);
const runeBlue = std(0x101820, 0.4, 0.2, 0x3a8cff, 2.2);
const runeWarm = std(0x201008, 0.4, 0.2, 0xff7a30, 1.6);
const ash = std(0x4a3a2a, 0.75, 0);
const bone = std(0xd8ccb0, 0.6, 0);

function m(geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale?: [number, number, number]): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  if (scale) mesh.scale.set(...scale);
  mesh.castShadow = true;
  return mesh;
}

function longsword(): THREE.Group {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 6), grip, [0, -0.04, 0]));
  g.add(m(new THREE.SphereGeometry(0.03, 6, 5), brass, [0, 0.07, 0]));
  g.add(m(new THREE.BoxGeometry(0.22, 0.03, 0.04), darkSteel, [0, -0.14, 0]));
  g.add(m(new THREE.BoxGeometry(0.045, 0.95, 0.011), steel, [0, -0.64, 0]));
  g.add(m(new THREE.BoxGeometry(0.012, 0.86, 0.016), darkSteel, [0, -0.61, 0]));
  g.add(m(new THREE.BoxGeometry(0.006, 0.5, 0.018), runeWarm, [0, -0.45, 0]));
  g.add(m(new THREE.ConeGeometry(0.024, 0.08, 4), steel, [0, -1.15, 0], [Math.PI, 0, 0], [1, 1, 0.3]));
  return g;
}

function greatsword(): THREE.Group {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(0.022, 0.024, 0.36, 6), grip, [0, 0.02, 0]));
  g.add(m(new THREE.BoxGeometry(0.07, 0.07, 0.07), graveIron, [0, 0.22, 0], [0.6, 0.6, 0]));
  g.add(m(new THREE.BoxGeometry(0.34, 0.06, 0.07), graveIron, [0, -0.19, 0]));
  // the slab: broad, chipped, grooved
  g.add(m(new THREE.BoxGeometry(0.15, 1.45, 0.035), graveIron, [0, -0.95, 0]));
  g.add(m(new THREE.BoxGeometry(0.04, 1.3, 0.045), darkSteel, [0, -0.92, 0]));
  g.add(m(new THREE.BoxGeometry(0.1, 0.12, 0.036), graveIron, [0.02, -1.72, 0], [0, 0, 0.35]));
  for (let i = 0; i < 4; i++) g.add(m(new THREE.BoxGeometry(0.012, 0.12, 0.05), runeWarm, [0, -0.45 - i * 0.28, 0]));
  return g;
}

function dagger(): THREE.Group {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(0.016, 0.016, 0.12, 6), bone, [0, -0.01, 0]));
  g.add(m(new THREE.BoxGeometry(0.1, 0.02, 0.03), darkSteel, [0, -0.08, 0]));
  g.add(m(new THREE.ConeGeometry(0.028, 0.36, 4), steel, [0, -0.27, 0], [Math.PI, 0, 0], [1, 1, 0.28]));
  g.add(m(new THREE.BoxGeometry(0.004, 0.24, 0.012), runeBlue, [0, -0.22, 0]));
  return g;
}

export interface BowParts {
  group: THREE.Group;
  string: THREE.Line;
  arrow: THREE.Mesh;
}

function bow(): BowParts {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(0.022, 0.022, 0.14, 6), grip, [0, 0, 0], [Math.PI / 2, 0, 0]));
  // two curved limbs along local Z (vertical when the arm points forward)
  for (const s of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const z = s * (0.1 + i * 0.13);
      const y = -0.02 - i * i * 0.012;
      g.add(m(new THREE.BoxGeometry(0.028, 0.03 - i * 0.004, 0.14), ash, [0, y, z], [s * (0.1 + i * 0.12), 0, 0]));
    }
    g.add(m(new THREE.SphereGeometry(0.018, 6, 4), bone, [0, -0.14, s * 0.6]));
  }
  const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.14, 0.6), new THREE.Vector3(0, -0.14, 0), new THREE.Vector3(0, -0.14, -0.6)]);
  const string = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xb8b0a0 }));
  g.add(string);
  const arrow = m(new THREE.CylinderGeometry(0.006, 0.006, 0.78, 4), ash, [0, -0.45, 0]);
  arrow.add(m(new THREE.ConeGeometry(0.014, 0.06, 4), runeBlue, [0, -0.41, 0], [Math.PI, 0, 0]));
  g.add(arrow);
  return { group: g, string, arrow };
}

interface Loadout {
  right: THREE.Group;
  left?: THREE.Group;
  base: [number, number, number];
  tip: [number, number, number];
}

export class WeaponRig {
  private loadouts: Record<WeaponId, Loadout>;
  readonly bowParts: BowParts;
  current: WeaponId = 'longsword';
  private leftBase: THREE.Object3D;
  private leftTip: THREE.Object3D;

  constructor(
    private handR: THREE.Object3D,
    handL: THREE.Object3D,
    private sockets: Map<string, THREE.Object3D>,
    strikers: Map<string, [THREE.Object3D, THREE.Object3D]>,
  ) {
    this.bowParts = bow();
    const dl = dagger();
    // the left dagger is held reversed so the lantern can still hang from that hand
    dl.rotation.set(Math.PI, 0, 0);
    dl.position.set(0, -0.02, 0.05);
    this.loadouts = {
      longsword: { right: longsword(), base: [0, -0.2, 0], tip: [0, -1.17, 0] },
      greatsword: { right: greatsword(), base: [0, -0.22, 0], tip: [0, -1.74, 0] },
      daggers: { right: dagger(), left: dl, base: [0, -0.08, 0], tip: [0, -0.45, 0] },
      bow: { right: this.bowParts.group, base: [0, 0, 0.5], tip: [0, 0, -0.5] },
    };
    for (const l of Object.values(this.loadouts)) {
      handR.add(l.right);
      l.right.visible = false;
      if (l.left) {
        handL.add(l.left);
        l.left.visible = false;
      }
    }
    this.leftBase = new THREE.Object3D();
    this.leftTip = new THREE.Object3D();
    this.leftBase.position.set(0, -0.02, 0.1);
    this.leftTip.position.set(0, 0.34, 0.12);
    handL.add(this.leftBase, this.leftTip);
    strikers.set('weaponL', [this.leftBase, this.leftTip]);
    this.equip('longsword');
  }

  equip(id: WeaponId): void {
    for (const [k, l] of Object.entries(this.loadouts)) {
      l.right.visible = k === id;
      if (l.left) l.left.visible = k === id;
    }
    const l = this.loadouts[id];
    this.sockets.get('weaponBase')?.position.set(...l.base);
    this.sockets.get('weaponTip')?.position.set(...l.tip);
    this.current = id;
    void this.handR;
  }

  /** Bow string pull (0..1) and nocked-arrow visibility. */
  setDraw(k: number, nocked: boolean): void {
    const pos = this.bowParts.string.geometry.attributes.position as THREE.BufferAttribute;
    pos.setY(1, -0.14 + k * 0.5);
    pos.needsUpdate = true;
    this.bowParts.arrow.visible = nocked;
    this.bowParts.arrow.position.y = -0.45 + k * 0.5;
  }
}

/** A standalone copy of a weapon's mesh (for the shop preview). */
export function weaponMesh(id: WeaponId): THREE.Object3D {
  switch (id) {
    case 'greatsword':
      return greatsword();
    case 'daggers':
      return dagger();
    case 'bow':
      return bow().group;
    default:
      return longsword();
  }
}
