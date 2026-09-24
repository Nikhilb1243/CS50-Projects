import * as THREE from 'three';
import { weaponMesh } from '../entities/weapons';
import type { ShopEntry } from '../data/shop';

/**
 * Small, separate renderer for the shop's rotating item preview. It is created the first time
 * the shop opens and only renders while the shop is on screen.
 */
export class ItemPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
  private pivot = new THREE.Group();
  private current = '';
  private t = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 280;
    this.canvas.height = 280;
    this.canvas.className = 'shop-preview';
    const key = new THREE.DirectionalLight(0xffd9a8, 2.6);
    key.position.set(1.5, 2, 2.5);
    const rim = new THREE.DirectionalLight(0x9fb4d8, 2.2);
    rim.position.set(-2, 1, -2);
    this.scene.add(key, rim, new THREE.AmbientLight(0x40362c, 1.4), this.pivot);
    this.camera.position.set(0, 0, 3);
  }

  private ensure(): THREE.WebGLRenderer {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      this.renderer.setSize(280, 280, false);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    }
    return this.renderer;
  }

  setItem(e: ShopEntry | null): void {
    const key = e ? `${e.kind}:${e.weapon ?? ''}` : '';
    if (key === this.current) return;
    this.current = key;
    this.pivot.clear();
    if (!e) return;
    let obj: THREE.Object3D;
    if ((e.kind === 'weapon' || e.kind === 'upgrade') && e.weapon) obj = weaponMesh(e.weapon);
    else if (e.kind === 'arrows') obj = arrowBundle();
    else obj = vial();
    if (e.kind === 'upgrade') {
      // a tempered weapon gets a warm glow along its surface
      obj.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && 'emissive' in m) {
          const c = m.clone();
          c.emissive = new THREE.Color(0x3a1604);
          (o as THREE.Mesh).material = c;
        }
      });
    }
    // centre and fit the item in view
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    obj.position.sub(c);
    const holder = new THREE.Group();
    holder.add(obj);
    holder.scale.setScalar(1.5 / Math.max(0.2, size.x, size.y, size.z));
    holder.rotation.z = e.kind === 'draught' ? 0 : 0.7;
    this.pivot.add(holder);
  }

  render(dt: number): void {
    if (!this.current) return;
    this.t += dt;
    this.pivot.rotation.y = this.t * 0.8;
    this.pivot.position.y = Math.sin(this.t * 1.3) * 0.03;
    this.ensure().render(this.scene, this.camera);
  }
}

function arrowBundle(): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.MeshStandardMaterial({ color: 0x6b5238, roughness: 0.8 });
  const head = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.4, metalness: 0.8 });
  const fletch = new THREE.MeshStandardMaterial({ color: 0x8c8a86, roughness: 1, side: THREE.DoubleSide });
  const thread = new THREE.MeshStandardMaterial({ color: 0xd9ceb0, roughness: 0.7 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const x = Math.cos(a) * 0.03 * (i ? 1 : 0);
    const z = Math.sin(a) * 0.03 * (i ? 1 : 0);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.8, 5), shaft);
    s.position.set(x, 0, z);
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.07, 5), head);
    h.position.set(x, 0.43, z);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.12), fletch);
    f.position.set(x, -0.33, z);
    f.rotation.y = a;
    g.add(s, h, f);
  }
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.01, 6, 14), thread);
  band.rotation.x = Math.PI / 2;
  g.add(band);
  return g;
}

function vial(): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: 0x9a8f7a, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.45 });
  const tallow = new THREE.MeshStandardMaterial({ color: 0xe8b060, emissive: 0x8a4a10, roughness: 0.5 });
  const cork = new THREE.MeshStandardMaterial({ color: 0x5a4228, roughness: 1 });
  const prof = [[0.0, 0], [0.13, 0.01], [0.15, 0.08], [0.15, 0.22], [0.1, 0.3], [0.05, 0.34], [0.05, 0.42]].map(([r, y]) => new THREE.Vector2(r, y));
  const v = new THREE.Mesh(new THREE.LatheGeometry(prof, 16), glass);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.12, 0.2, 16), tallow);
  inner.position.y = 0.12;
  const c = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.06, 10), cork);
  c.position.y = 0.44;
  g.add(inner, v, c);
  return g;
}
