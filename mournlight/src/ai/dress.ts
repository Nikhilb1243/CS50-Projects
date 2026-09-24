import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { ModelInstance } from '../entities/models';

/**
 * Horror dressing layered on top of the procedural creature meshes:
 * glowing eye halos (they bloom), periodic drips of ichor or water, and a
 * vertex/fragment patch that makes the skin crawl: slow swelling under the
 * surface and dark veins that pulse.
 */
export interface DressDef {
  eye: number;
  eyeSize: number;
  eyeSpread: number;
  eyeY: number;
  eyeZ: number;
  drip: number | null;
  dripRate: number;
  crawl: number;
  /** Skin roughness: low reads as wet, glistening flesh; high as dry bone or cloth. */
  skinRough: number;
  /** Tint for metal parts that have rusted through. */
  rust?: number;
}

export const DRESS: Record<string, DressDef> = {
  shambler: { eye: 0xc8e0a0, eyeSize: 0.07, eyeSpread: 0.045, eyeY: 0.12, eyeZ: 0.12, drip: 0x2a3018, dripRate: 1.5, crawl: 1, skinRough: 0.42 },
  stalker: { eye: 0xf0f0ff, eyeSize: 0.05, eyeSpread: 0.035, eyeY: 0.1, eyeZ: 0.11, drip: 0x1a0606, dripRate: 0.6, crawl: 0.5, skinRough: 0.8 },
  crawler: { eye: 0xff4030, eyeSize: 0.06, eyeSpread: 0.04, eyeY: 0.08, eyeZ: 0.12, drip: 0x300808, dripRate: 1.2, crawl: 0.8, skinRough: 0.32 },
  knight: { eye: 0x60d0c0, eyeSize: 0.09, eyeSpread: 0.05, eyeY: 0.1, eyeZ: 0.14, drip: 0x1a2a2a, dripRate: 3, crawl: 0.2, skinRough: 0.95, rust: 0xa87050 },
  mimic: { eye: 0xffd0a0, eyeSize: 0.05, eyeSpread: 0.04, eyeY: 0.12, eyeZ: 0.12, drip: 0x3a1010, dripRate: 1, crawl: 1.4, skinRough: 0.38 },
  screamer: { eye: 0xffffff, eyeSize: 0.08, eyeSpread: 0.04, eyeY: 0.1, eyeZ: 0.12, drip: 0x100404, dripRate: 1.4, crawl: 1.2, skinRough: 0.9 },
};

export const crawlUniforms = { uCrawlTime: { value: 0 } };

const CRAWL_VERT = /* glsl */ `
#include <begin_vertex>
{
  vec3 cp = position * 9.0 + vec3(uCrawlTime * 0.35, uCrawlTime * 0.5, 0.0);
  float sw = sin(cp.x + sin(cp.y * 1.3)) * sin(cp.z * 1.1 + uCrawlTime * 0.7);
  transformed += normal * sw * 0.006 * uCrawl;
  vCrawl = sw;
}`;

const CRAWL_FRAG = /* glsl */ `
#include <color_fragment>
{
  float vein = smoothstep(0.82, 0.98, abs(vCrawl));
  float pulse = 0.5 + 0.5 * sin(uCrawlTime * 2.3 + vCrawl * 3.0);
  diffuseColor.rgb *= 1.0 - vein * 0.35 * pulse * min(uCrawl, 1.0);
}`;

export function patchCrawl(mat: THREE.Material, amount: number): void {
  const prev = mat.onBeforeCompile;
  const key = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uCrawlTime = crawlUniforms.uCrawlTime;
    shader.uniforms.uCrawl = { value: amount };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uCrawlTime;\nuniform float uCrawl;\nvarying float vCrawl;')
      .replace('#include <begin_vertex>', CRAWL_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uCrawlTime;\nuniform float uCrawl;\nvarying float vCrawl;')
      .replace('#include <color_fragment>', CRAWL_FRAG);
  };
  mat.customProgramCacheKey = () => key + '|crawl';
  mat.needsUpdate = true;
}

let eyeTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (eyeTex) return eyeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  eyeTex = new THREE.CanvasTexture(c);
  return eyeTex;
}

export class CreatureDress {
  private eyes: THREE.Sprite[] = [];
  private dripT = Math.random() * 2;
  private head: THREE.Object3D;
  private tmp = new THREE.Vector3();

  constructor(private ctx: GameContext, model: ModelInstance, private def: DressDef) {
    this.head = model.rig.bone('head');
    const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(def.eye).multiplyScalar(4), blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (const s of [-1, 1]) {
      const sp = new THREE.Sprite(mat);
      sp.scale.setScalar(def.eyeSize);
      sp.position.set(s * def.eyeSpread, def.eyeY, def.eyeZ);
      this.head.add(sp);
      this.eyes.push(sp);
    }
    // material variety: wet skin catches the light, bone stays dry, armour rusts
    const [skin, metal] = model.materials as THREE.MeshStandardMaterial[];
    if (skin?.isMeshStandardMaterial) {
      skin.roughness = def.skinRough;
      if (def.skinRough < 0.5) skin.envMapIntensity = 1.8;
    }
    if (def.rust !== undefined && metal?.isMeshStandardMaterial) {
      metal.color.setHex(def.rust);
      metal.roughness = 0.78;
      metal.metalness = 0.45;
    }
    const seen = new Set<THREE.Material>();
    model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mt of Array.isArray(m.material) ? m.material : [m.material]) {
        if (seen.has(mt) || !(mt as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
        seen.add(mt);
        patchCrawl(mt, def.crawl);
      }
    });
  }

  /** Per frame: eye flicker/visibility and drips. `alive`/`awake` tune intensity. */
  update(dt: number, t: number, alive: boolean, alert: boolean, visible: boolean, near = true): void {
    const k = alive ? (alert ? 1 : 0.55) * (0.8 + 0.2 * Math.sin(t * 13 + this.def.eyeY * 50)) : 0;
    for (const e of this.eyes) {
      e.visible = k > 0.02 && visible;
      e.material.opacity = k;
    }
    // detail LOD: drips only close up
    if (!alive || !visible || !near || !this.def.drip) return;
    this.dripT -= dt;
    if (this.dripT > 0) return;
    this.dripT = this.def.dripRate * (0.5 + Math.random());
    this.head.getWorldPosition(this.tmp);
    this.tmp.y -= 0.05;
    this.ctx.gpu.emit(this.ctx.gpu.alpha, { pos: this.tmp, count: 1, jitter: 0.06, vel: new THREE.Vector3(0, -0.5, 0), spread: 0.1, speed: [0.1, 0.4], life: [0.6, 0.9], size: [0.02, 0.035], color: this.def.drip, alpha: 0.9, gravity: 9 });
  }
}
