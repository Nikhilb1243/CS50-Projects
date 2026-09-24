import * as THREE from 'three';
import { noise1, lerp, damp } from '../core/math';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { MAX_POINT_LIGHTS, QUALITY_PROFILES, type Quality, type QualityProfile } from '../core/settings';

type OnBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;
/** Direction towards the shadow-casting moon (also the direction of window light shafts, negated). */
export const MOON_OFFSET = new THREE.Vector3(38, 70, 22);

export interface FlameSource {
  pos: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  distance: number;
  lit: boolean;
  /** 0..1 current brightness (for fading when snuffed/kindled). */
  level: number;
  seed: number;
  /** Flame tongue instances owned by this source: [offset, baseScale]. */
  tongues: { off: THREE.Vector3; scale: number; idx: number }[];
  flicker: number;
  tag?: string;
}

const MAX_TONGUES = 320;

/**
 * Owns the moon, ambient light and a fixed-size pool of point lights that
 * follow the flame sources nearest to the camera. Keeping the light count
 * constant avoids shader recompiles. All flame "tongues" render in a single
 * instanced draw call.
 */
export class LightManager {
  readonly moon: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly flames: FlameSource[] = [];
  private pool: THREE.PointLight[] = [];
  private tongueMesh: THREE.InstancedMesh;
  private tongueCount = 0;
  private dummy = new THREE.Object3D();
  private moonTarget = new THREE.Object3D();
  moonIntensity = 0.5;
  hemiIntensity = 0.3;
  private shadowSnap = 4;
  private flameTime: { value: number };
  private activeLights = 0;
  /** Cascaded shadows (High/Ultra). When active the single moon light is hidden. */
  private csm: CSM | null = null;
  private csmMats = new Map<THREE.Material, OnBeforeCompile>();
  private csmSyncT = 0;
  private lastFov = 0;
  private lastAspect = 0;

  constructor(
    scene: THREE.Scene,
    quality: Quality,
  ) {
    this.moon = new THREE.DirectionalLight(0x8ea4c8, 0.5);
    this.moon.castShadow = true;
    const res = QUALITY_PROFILES[quality].shadowRes;
    this.moon.shadow.mapSize.set(res, res);
    const cam = this.moon.shadow.camera;
    cam.left = -34;
    cam.right = 34;
    cam.top = 34;
    cam.bottom = -34;
    cam.near = 1;
    cam.far = 180;
    this.moon.shadow.bias = -0.0006;
    this.moon.shadow.normalBias = 0.04;
    this.moon.target = this.moonTarget;
    scene.add(this.moon, this.moonTarget);

    this.hemi = new THREE.HemisphereLight(0x4f5d74, 0x1c1914, 0.3);
    scene.add(this.hemi);

    // The pool is allocated at its maximum size; quality presets hide the lights they do not use.
    for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
      const l = new THREE.PointLight(0xff9a4a, 0, 10, 1.5);
      l.castShadow = false;
      scene.add(l);
      this.pool.push(l);
    }
    this.activeLights = QUALITY_PROFILES[quality].pointLights;
    this.pool.forEach((l, i) => (l.visible = i < this.activeLights));

    const tongueGeo = new THREE.ConeGeometry(0.5, 1, 8, 4, true);
    tongueGeo.translate(0, 0.5, 0);
    // bulge the lower part so each tongue reads as a teardrop
    const tp = tongueGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i);
      const k = 1 + Math.sin(Math.min(1, y * 1.6) * Math.PI) * 0.55;
      tp.setX(i, tp.getX(i) * k);
      tp.setZ(i, tp.getZ(i) * k);
    }
    tongueGeo.computeVertexNormals();
    this.flameTime = { value: 0 };
    const tongueMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.flameTime },
      vertexShader: /* glsl */ `
        varying float vH;
        varying vec3 vN;
        varying vec3 vV;
        varying float vSeed;
        void main() {
          vH = position.y;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vSeed = instanceMatrix[3][0] * 3.1 + instanceMatrix[3][2] * 1.7;
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        varying float vH;
        varying vec3 vN;
        varying vec3 vV;
        varying float vSeed;
        uniform float uTime;
        void main() {
          float h = clamp(vH, 0.0, 1.0);
          float rim = abs(dot(normalize(vN), vV));
          vec3 core = vec3(2.6, 1.9, 1.0);
          vec3 mid = vec3(2.2, 0.85, 0.18);
          vec3 tip = vec3(0.9, 0.18, 0.04);
          vec3 col = mix(core, mid, smoothstep(0.0, 0.45, h));
          col = mix(col, tip, smoothstep(0.45, 1.0, h));
          float flick = 0.85 + 0.15 * sin(uTime * 23.0 + vSeed + h * 9.0);
          float a = pow(rim, 1.6) * (1.0 - smoothstep(0.55, 1.0, h)) * smoothstep(0.0, 0.08, h) * flick;
          gl_FragColor = vec4(col * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.tongueMesh = new THREE.InstancedMesh(tongueGeo, tongueMat, MAX_TONGUES);
    this.tongueMesh.count = 0;
    this.tongueMesh.frustumCulled = false;
    this.tongueMesh.renderOrder = 5;
    scene.add(this.tongueMesh);
  }

  addFlame(
    pos: THREE.Vector3,
    opts: { color?: THREE.ColorRepresentation; intensity?: number; distance?: number; lit?: boolean; tongues?: { off: THREE.Vector3; scale: number }[]; tag?: string } = {},
  ): FlameSource {
    const tongues = (opts.tongues ?? [{ off: new THREE.Vector3(), scale: 0.25 }]).map((t) => {
      const idx = this.tongueCount < MAX_TONGUES ? this.tongueCount++ : -1;
      return { ...t, idx };
    });
    this.tongueMesh.count = this.tongueCount;
    const f: FlameSource = {
      pos: pos.clone(),
      color: new THREE.Color(opts.color ?? 0xff9448),
      intensity: opts.intensity ?? 6,
      distance: opts.distance ?? 11,
      lit: opts.lit ?? true,
      level: opts.lit === false ? 0 : 1,
      seed: Math.random() * 100,
      tongues,
      flicker: 1,
      tag: opts.tag,
    };
    this.flames.push(f);
    return f;
  }

  setRegionLighting(moon: number, ambient: number): void {
    this.moonIntensity = moon * 1.3;
    this.hemiIntensity = ambient;
  }

  /** Approximate flame illumination at a point (0 = dark). */
  lightAt(p: THREE.Vector3): number {
    let sum = 0;
    for (const f of this.flames) {
      if (f.level <= 0.01) continue;
      const d = f.pos.distanceTo(p);
      if (d > f.distance) continue;
      const k = 1 - d / f.distance;
      sum += k * k * (f.intensity / 6) * f.level;
    }
    return sum;
  }

  update(dt: number, t: number, focus: THREE.Vector3, camPos: THREE.Vector3): void {
    this.moon.intensity = damp(this.moon.intensity, this.moonIntensity, 1.5, dt);
    this.hemi.intensity = damp(this.hemi.intensity, this.hemiIntensity, 1.5, dt);
    // Moon shadow frustum follows the focus, snapped to texels to avoid swimming
    const s = this.shadowSnap;
    const fx = Math.round(focus.x / s) * s;
    const fz = Math.round(focus.z / s) * s;
    this.moonTarget.position.set(fx, focus.y, fz);
    this.moon.position.set(fx, focus.y, fz).add(MOON_OFFSET);

    // Flicker + tongues
    this.flameTime.value = t;
    const m = this.tongueMesh;
    for (const f of this.flames) {
      const target = f.lit ? 1 : 0;
      f.level = damp(f.level, target, f.lit ? 2.5 : 4, dt);
      const fast = f.tag === 'candles' ? 1.6 : 1;
      const n = noise1(t * 7.3 * fast, f.seed) * 0.5 + noise1(t * 17.1 * fast, f.seed + 3) * 0.25;
      // occasional draughts make a flame gutter and recover
      const gust = Math.max(0, noise1(t * 0.63, f.seed + 9) - 0.5) * 2;
      f.flicker = (0.82 + n * 0.35) * (1 - gust * gust * 0.4);
      for (const tg of f.tongues) {
        if (tg.idx < 0) continue;
        const sc = tg.scale * f.level * (0.85 + n * 0.4);
        this.dummy.position.copy(f.pos).add(tg.off);
        this.dummy.rotation.set(noise1(t * 3 + tg.idx, f.seed) * 0.2, t * 0.5 + tg.idx, noise1(t * 2.7 + tg.idx, f.seed + 1) * 0.2);
        this.dummy.scale.set(sc * 0.45, sc * (1.2 + noise1(t * 11 + tg.idx, f.seed) * 0.35), sc * 0.45);
        if (sc < 0.002) this.dummy.scale.setScalar(0.0001);
        this.dummy.updateMatrix();
        m.setMatrixAt(tg.idx, this.dummy.matrix);
      }
    }
    m.instanceMatrix.needsUpdate = true;

    // Assign pool lights to the nearest visible flames
    const sorted = this.flames
      .filter((f) => f.level > 0.02)
      .map((f) => ({ f, d: f.pos.distanceToSquared(camPos) }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.activeLights; i++) {
      const l = this.pool[i];
      const e = sorted[i];
      if (!e || e.d > 90 * 90) {
        l.intensity = 0;
        continue;
      }
      // the light source sways with the flame so shadows breathe
      const sd = e.f.seed;
      l.position.copy(e.f.pos);
      l.position.x += noise1(t * 5.1, sd + 11) * 0.05;
      l.position.y += 0.3 + noise1(t * 6.3, sd + 12) * 0.04;
      l.position.z += noise1(t * 4.7, sd + 13) * 0.05;
      l.color.copy(e.f.color);
      l.distance = e.f.distance;
      // fade lights near the pool cut-off distance so swapping is invisible
      const fade = 1 - Math.max(0, (Math.sqrt(e.d) - 70) / 20);
      l.intensity = e.f.intensity * 1.8 * e.f.flicker * e.f.level * fade;
    }
  }

  /** Called after the camera has moved for the frame. */
  updateShadows(dt: number, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const csm = this.csm;
    if (!csm) return;
    for (const l of csm.lights) {
      l.intensity = this.moon.intensity;
      l.color.copy(this.moon.color);
    }
    if (camera.fov !== this.lastFov || camera.aspect !== this.lastAspect) {
      this.lastFov = camera.fov;
      this.lastAspect = camera.aspect;
      csm.updateFrustums();
    }
    this.csmSyncT -= dt;
    if (this.csmSyncT <= 0) {
      this.csmSyncT = 2;
      this.syncCsmMaterials(scene);
    }
    csm.update();
  }

  /** Apply a quality preset at runtime (shadow resolution, softness, cascades, light count). */
  applyQuality(q: QualityProfile, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const sh = this.moon.shadow;
    if (sh.mapSize.x !== q.shadowRes) {
      sh.mapSize.set(q.shadowRes, q.shadowRes);
      sh.map?.dispose();
      sh.map = null;
    }
    sh.radius = q.shadowRadius;
    this.activeLights = q.pointLights;
    this.pool.forEach((l, i) => {
      l.visible = i < q.pointLights;
      if (!l.visible) l.intensity = 0;
    });
    const want = q.cascades > 0;
    if (this.csm && (!want || this.csm.cascades !== q.cascades || this.csm.maxFar !== q.shadowFar || this.csm.shadowMapSize !== q.shadowRes)) this.disableCsm();
    if (want && !this.csm) {
      const csm = new CSM({
        camera,
        parent: scene,
        cascades: q.cascades,
        maxFar: q.shadowFar,
        mode: 'practical',
        shadowMapSize: q.shadowRes,
        shadowBias: -0.0004,
        lightDirection: MOON_OFFSET.clone().negate().normalize(),
        lightIntensity: this.moon.intensity,
        lightNear: 1,
        lightFar: 260,
        lightMargin: 70,
      });
      csm.fade = true;
      for (const l of csm.lights) {
        l.shadow.normalBias = 0.04;
        l.shadow.radius = q.shadowRadius;
      }
      this.csm = csm;
      this.lastFov = 0;
      this.syncCsmMaterials(scene);
    }
    if (this.csm) for (const l of this.csm.lights) l.shadow.radius = q.shadowRadius;
    this.moon.visible = !this.csm;
  }

  private syncCsmMaterials(scene: THREE.Scene): void {
    const csm = this.csm;
    if (!csm) return;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const lit = (m as THREE.MeshStandardMaterial).isMeshStandardMaterial || (m as THREE.MeshLambertMaterial).isMeshLambertMaterial || (m as THREE.MeshPhongMaterial).isMeshPhongMaterial;
        if (!lit || this.csmMats.has(m)) continue;
        const orig = m.onBeforeCompile;
        this.csmMats.set(m, orig);
        csm.setupMaterial(m);
        const csmFn = m.onBeforeCompile;
        m.onBeforeCompile = (shader, renderer) => {
          orig.call(m, shader, renderer);
          csmFn.call(m, shader, renderer);
        };
        m.needsUpdate = true;
      }
    });
  }

  private disableCsm(): void {
    if (!this.csm) return;
    for (const [m, orig] of this.csmMats) {
      m.onBeforeCompile = orig;
      if (m.defines) {
        delete m.defines.USE_CSM;
        delete m.defines.CSM_CASCADES;
        delete m.defines.CSM_FADE;
      }
      m.needsUpdate = true;
    }
    this.csmMats.clear();
    this.csm.remove();
    this.csm.dispose();
    this.csm = null;
  }

  /** Light power of the nearest flame, used for audio crackle volume etc. */
  nearestFlame(p: THREE.Vector3): { f: FlameSource | null; d: number } {
    let best: FlameSource | null = null;
    let bd = Infinity;
    for (const f of this.flames) {
      if (f.level < 0.1) continue;
      const d = f.pos.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return { f: best, d: bd };
  }
}

/** Helper to build tongue layouts for common flame kinds. */
export function tonguesFor(kind: 'brazier' | 'candles' | 'sconce' | 'arena' | 'shrine' | 'torch', seed = 1): { off: THREE.Vector3; scale: number }[] {
  const out: { off: THREE.Vector3; scale: number }[] = [];
  const r = (i: number): number => noise1(i * 1.37, seed);
  switch (kind) {
    case 'brazier':
    case 'arena':
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        out.push({ off: new THREE.Vector3(Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18), scale: kind === 'arena' ? 0.9 : 0.65 });
      }
      out.push({ off: new THREE.Vector3(0, 0.05, 0), scale: kind === 'arena' ? 1.2 : 0.85 });
      break;
    case 'candles':
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4;
        const rr = 0.12 + (i % 3) * 0.1;
        out.push({ off: new THREE.Vector3(Math.cos(a) * rr, 0.12 + lerp(0, 0.2, (r(i) + 1) / 2), Math.sin(a) * rr), scale: 0.07 });
      }
      break;
    case 'sconce':
    case 'torch':
      out.push({ off: new THREE.Vector3(0, 0, 0), scale: 0.18 });
      out.push({ off: new THREE.Vector3(0.03, 0.02, 0), scale: 0.12 });
      break;
    case 'shrine':
      out.push({ off: new THREE.Vector3(0, 0, 0), scale: 0.36 });
      out.push({ off: new THREE.Vector3(0.05, 0.02, 0.03), scale: 0.24 });
      out.push({ off: new THREE.Vector3(-0.05, 0.01, -0.02), scale: 0.2 });
      break;
  }
  return out;
}
