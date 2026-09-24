import * as THREE from 'three';

/**
 * Instanced GPU particles. The CPU only writes a particle's birth state
 * (position, velocity, birth time, life, size, colour, physics) into a ring
 * buffer of instanced attributes; the vertex shader integrates gravity and
 * drag analytically, billboards (or velocity-stretches) each quad and fades
 * it over its life. One draw call per layer, no per-particle CPU work.
 *
 * Layers: `add` (additive: sparks, embers, blue flame, trails), `alpha`
 * (smoke, dust) and `haze` (faint refraction-like shimmer above fire,
 * approximated with slow, wobbling low-alpha quads).
 */
export interface GpuEmit {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  /** 0 = exactly `vel`, 1 = random direction. */
  spread?: number;
  speed?: [number, number];
  life?: [number, number];
  size?: [number, number];
  /** Size multiplier reached at the end of life (0 = constant). */
  grow?: number;
  color?: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  alpha?: number;
  gravity?: number;
  drag?: number;
  count?: number;
  jitter?: number;
  /** Seconds of velocity used to stretch the quad (sparks, rain streaks). */
  stretch?: number;
  fadeIn?: number;
}

const VERT = /* glsl */ `
attribute vec3 aP0;
attribute vec3 aV0;
attribute vec4 aT;   // birth, life, size, grow
attribute vec4 aC;   // rgb, alpha
attribute vec4 aX;   // gravity, drag, stretch, fadeIn
uniform float uTime;
uniform float uWobble;
varying vec4 vC;
varying vec2 vUv;
varying float vDepth;
varying float vK;
void main() {
  float age = uTime - aT.x;
  float k = age / aT.y;
  if (k < 0.0 || k > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float d = max(aX.y, 1e-3);
  float ed = exp(-d * age);
  vec3 p = aP0 + aV0 * ((1.0 - ed) / d) - vec3(0.0, 0.5 * aX.x * age * age, 0.0);
  vec3 v = aV0 * ed - vec3(0.0, aX.x * age, 0.0);
  p.x += sin(age * 3.1 + aP0.z * 7.0) * uWobble * age;
  p.z += cos(age * 2.7 + aP0.x * 7.0) * uWobble * age;
  float size = aT.z * (1.0 + aT.w * k);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec2 q = position.xy;
  if (aX.z > 0.0) {
    vec3 vv = (modelViewMatrix * vec4(v, 0.0)).xyz;
    float sl = length(vv.xy);
    vec2 dir = sl > 1e-4 ? vv.xy / sl : vec2(0.0, 1.0);
    vec2 side = vec2(-dir.y, dir.x);
    mv.xy += side * q.x * size + dir * q.y * (size + sl * aX.z);
  } else {
    mv.xy += q * size;
  }
  vC = aC;
  vC.a *= (1.0 - k) * smoothstep(0.0, max(aX.w, 1e-3), k);
  vUv = q + 0.5;
  vDepth = -mv.z;
  vK = k;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec4 vC;
varying vec2 vUv;
varying float vDepth;
varying float vK;
uniform float uFog;
uniform float uAdditive;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  a *= a;
  float fog = exp(-vDepth * uFog);
  float alpha = vC.a * a * fog;
  if (alpha < 0.002) discard;
  // additive particles cool from white-hot cores to their tint
  vec3 col = uAdditive > 0.5 ? vC.rgb * (1.0 + (1.0 - vK) * (1.0 - r) * 0.8) : vC.rgb;
  gl_FragColor = vec4(col, alpha);
}`;

class Layer {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private p0: THREE.InstancedBufferAttribute;
  private v0: THREE.InstancedBufferAttribute;
  private t: THREE.InstancedBufferAttribute;
  private c: THREE.InstancedBufferAttribute;
  private x: THREE.InstancedBufferAttribute;
  private cursor = 0;
  private dirtyFrom = -1;
  private dirtyTo = -1;
  private wrapped = false;
  readonly uniforms: { uTime: { value: number }; uFog: { value: number }; uWobble: { value: number }; uAdditive: { value: number } };

  constructor(scene: THREE.Scene, private cap: number, blending: THREE.Blending, wobble: number, order: number) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    const mk = (n: number): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.p0 = mk(3);
    this.v0 = mk(3);
    this.t = mk(4);
    this.c = mk(4);
    this.x = mk(4);
    // everything starts long dead
    for (let i = 0; i < cap; i++) this.t.setXYZW(i, -1e6, 1, 0, 0);
    g.setAttribute('aP0', this.p0);
    g.setAttribute('aV0', this.v0);
    g.setAttribute('aT', this.t);
    g.setAttribute('aC', this.c);
    g.setAttribute('aX', this.x);
    g.instanceCount = cap;
    this.geo = g;
    this.uniforms = { uTime: { value: 0 }, uFog: { value: 0.02 }, uWobble: { value: wobble }, uAdditive: { value: blending === THREE.AdditiveBlending ? 1 : 0 } };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    scene.add(this.mesh);
  }

  write(px: number, py: number, pz: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, r: number, g: number, b: number, a: number, grav: number, drag: number, stretch: number, fadeIn: number): void {
    const i = this.cursor;
    this.p0.setXYZ(i, px, py, pz);
    this.v0.setXYZ(i, vx, vy, vz);
    this.t.setXYZW(i, this.uniforms.uTime.value, life, size, grow);
    this.c.setXYZW(i, r, g, b, a);
    this.x.setXYZW(i, grav, drag, stretch, fadeIn);
    if (this.dirtyFrom < 0) this.dirtyFrom = i;
    this.dirtyTo = i;
    this.cursor = (i + 1) % this.cap;
    if (this.cursor === 0) this.wrapped = true;
  }

  flush(): void {
    if (this.dirtyFrom < 0) return;
    const attrs = [this.p0, this.v0, this.t, this.c, this.x];
    for (const a of attrs) {
      a.clearUpdateRanges();
      if (this.wrapped || this.dirtyTo < this.dirtyFrom) a.addUpdateRange(0, this.cap * a.itemSize);
      else a.addUpdateRange(this.dirtyFrom * a.itemSize, (this.dirtyTo - this.dirtyFrom + 1) * a.itemSize);
      a.needsUpdate = true;
    }
    this.dirtyFrom = this.dirtyTo = -1;
    this.wrapped = false;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _v = new THREE.Vector3();

export const BLUE_FIRE = 0x5aa8ff;
export const BLUE_CORE = 0xcfe8ff;

export class GpuParticles {
  readonly add: Layer;
  readonly alpha: Layer;
  readonly haze: Layer;
  private time = 0;

  constructor(scene: THREE.Scene, capacity = 6000) {
    this.add = new Layer(scene, capacity, THREE.AdditiveBlending, 0, 7);
    this.alpha = new Layer(scene, Math.floor(capacity / 3), THREE.NormalBlending, 0.15, 6);
    this.haze = new Layer(scene, 600, THREE.NormalBlending, 0.6, 6);
  }

  emit(layer: Layer, o: GpuEmit): void {
    const n = o.count ?? 1;
    _c1.set(o.color ?? 0xffffff);
    _c2.set(o.color2 ?? o.color ?? 0xffffff);
    const spread = o.spread ?? 1;
    const j = o.jitter ?? 0;
    for (let k = 0; k < n; k++) {
      let dx = rand(-1, 1);
      let dy = rand(-1, 1);
      let dz = rand(-1, 1);
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
      const sp = o.speed ? rand(o.speed[0], o.speed[1]) : 1;
      let vx = dx * sp;
      let vy = dy * sp;
      let vz = dz * sp;
      if (o.vel) {
        _v.copy(o.vel);
        const vl = _v.length() || 1;
        vx = (_v.x / vl) * (1 - spread) * sp + dx * spread * sp;
        vy = (_v.y / vl) * (1 - spread) * sp + dy * spread * sp;
        vz = (_v.z / vl) * (1 - spread) * sp + dz * spread * sp;
        if (!o.speed) {
          vx = _v.x * (1 - spread) + dx * spread * vl;
          vy = _v.y * (1 - spread) + dy * spread * vl;
          vz = _v.z * (1 - spread) + dz * spread * vl;
        }
      }
      const t = Math.random();
      layer.write(
        o.pos.x + rand(-j, j),
        o.pos.y + rand(-j, j),
        o.pos.z + rand(-j, j),
        vx,
        vy,
        vz,
        o.life ? rand(o.life[0], o.life[1]) : 1,
        o.size ? rand(o.size[0], o.size[1]) : 0.1,
        o.grow ?? 0,
        _c1.r + (_c2.r - _c1.r) * t,
        _c1.g + (_c2.g - _c1.g) * t,
        _c1.b + (_c2.b - _c1.b) * t,
        o.alpha ?? 1,
        o.gravity ?? 0,
        o.drag ?? 0,
        o.stretch ?? 0,
        o.fadeIn ?? 0,
      );
    }
  }

  // ---- presets ---------------------------------------------------------------
  blueFire(pos: THREE.Vector3, count = 6, spread = 0.25, scale = 1): void {
    this.emit(this.add, { pos, count, jitter: spread, vel: _v.set(0, 1.6 * scale, 0), spread: 0.35, speed: [0.8 * scale, 2.2 * scale], life: [0.35, 0.8], size: [0.18 * scale, 0.42 * scale], grow: -0.6, color: BLUE_FIRE, color2: 0x2a5cff, alpha: 0.9, gravity: -1.5, drag: 1.5, fadeIn: 0.08 });
    if (Math.random() < 0.35) this.emit(this.add, { pos, count: 1, jitter: spread, vel: _v.set(0, 2, 0), spread: 0.6, speed: [1, 3], life: [0.6, 1.4], size: [0.03, 0.06], color: BLUE_CORE, gravity: -0.8, drag: 0.5 });
  }

  blueBurst(pos: THREE.Vector3, count = 40, power = 1): void {
    this.emit(this.add, { pos, count, speed: [2 * power, 9 * power], life: [0.2, 0.55], size: [0.03, 0.07], color: BLUE_CORE, color2: BLUE_FIRE, gravity: 9, drag: 2, stretch: 0.05 });
    this.emit(this.add, { pos, count: Math.ceil(count / 3), jitter: 0.3, speed: [0.5, 2.5 * power], life: [0.25, 0.6], size: [0.4 * power, 0.9 * power], grow: 0.8, color: BLUE_FIRE, color2: 0x3050ff, alpha: 0.8, drag: 3, gravity: -2 });
  }

  sparks(pos: THREE.Vector3, dir: THREE.Vector3, count = 18, color: THREE.ColorRepresentation = 0xffc070): void {
    this.emit(this.add, { pos, vel: dir, spread: 0.55, count, speed: [3, 10], life: [0.15, 0.45], size: [0.02, 0.045], color, color2: 0xff7020, gravity: 12, drag: 1.2, stretch: 0.035 });
  }

  embers(pos: THREE.Vector3, count = 3, color: THREE.ColorRepresentation = 0xff8a30): void {
    this.emit(this.add, { pos, count, jitter: 0.2, vel: _v.set(0, 1, 0), spread: 0.7, speed: [0.3, 1.4], life: [0.8, 2], size: [0.02, 0.05], color, gravity: -0.6, drag: 0.6 });
  }

  smoke(pos: THREE.Vector3, count = 2, color: THREE.ColorRepresentation = 0x1a1a1c): void {
    this.emit(this.alpha, { pos, count, jitter: 0.25, vel: _v.set(0, 0.8, 0), spread: 0.4, speed: [0.3, 0.9], life: [1.4, 2.8], size: [0.4, 0.8], grow: 2.2, color, alpha: 0.45, drag: 0.8, fadeIn: 0.15 });
  }

  heatHaze(pos: THREE.Vector3, count = 1): void {
    this.emit(this.haze, { pos, count, jitter: 0.4, vel: _v.set(0, 1.2, 0), spread: 0.2, speed: [0.6, 1.2], life: [0.8, 1.5], size: [0.5, 0.9], grow: 1, color: 0x8894a8, alpha: 0.05, fadeIn: 0.3 });
  }

  /** Glowing streak segment (arrow and projectile trails). */
  streak(pos: THREE.Vector3, vel: THREE.Vector3, color: THREE.ColorRepresentation = BLUE_FIRE, size = 0.12, life = 0.25): void {
    this.emit(this.add, { pos, count: 1, vel: _v.copy(vel).multiplyScalar(0.08), spread: 0, life: [life * 0.8, life], size: [size, size * 1.2], grow: -0.7, color, alpha: 0.9, stretch: 0.6, drag: 2 });
  }

  update(dt: number, fogDensity: number): void {
    this.time += dt;
    for (const l of [this.add, this.alpha, this.haze]) {
      l.uniforms.uTime.value = this.time;
      l.uniforms.uFog.value = fogDensity * 0.6;
      l.flush();
    }
  }
}
