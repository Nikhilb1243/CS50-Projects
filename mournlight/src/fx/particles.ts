import * as THREE from 'three';
import { rand } from '../core/math';

interface P {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  r: number;
  g: number;
  b: number;
  a: number;
  grav: number;
  drag: number;
  grow: number;
  fadeIn: number;
}

export interface SpawnOpts {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  spread?: number;
  speed?: [number, number];
  life?: [number, number];
  size?: [number, number];
  color?: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  alpha?: number;
  gravity?: number;
  drag?: number;
  grow?: number;
  count?: number;
  jitter?: number;
  fadeIn?: number;
}

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
varying float vDepth;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vColor = aColor;
  vDepth = -mv.z;
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec4 vColor;
varying float vDepth;
uniform float uFog;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  float fog = exp(-vDepth * uFog);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a * fog);
  if (gl_FragColor.a < 0.003) discard;
}`;

/** CPU-simulated particle pool rendered as a single THREE.Points. */
export class ParticlePool {
  private ps: P[] = [];
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  readonly points: THREE.Points;
  private next = 0;
  private tmpC = new THREE.Color();
  private tmpC2 = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private max: number,
    additive: boolean,
    fog = 0.03,
  ) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 300 }, uFog: { value: fog } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    for (let i = 0; i < max; i++) {
      this.ps.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, r: 1, g: 1, b: 1, a: 1, grav: 0, drag: 0, grow: 0, fadeIn: 0 });
    }
  }

  setViewport(height: number, fovDeg: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = height / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  spawn(o: SpawnOpts): void {
    const n = o.count ?? 1;
    this.tmpC.set(o.color ?? 0xffffff);
    this.tmpC2.set(o.color2 ?? o.color ?? 0xffffff);
    for (let k = 0; k < n; k++) {
      const p = this.ps[this.next];
      this.next = (this.next + 1) % this.max;
      p.alive = true;
      const j = o.jitter ?? 0;
      p.x = o.pos.x + rand(-j, j);
      p.y = o.pos.y + rand(-j, j);
      p.z = o.pos.z + rand(-j, j);
      const sp = o.speed ? rand(o.speed[0], o.speed[1]) : 1;
      const spread = o.spread ?? 1;
      let dx = rand(-1, 1);
      let dy = rand(-1, 1);
      let dz = rand(-1, 1);
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
      const v = o.vel;
      if (v) {
        const vl = v.length() || 1;
        p.vx = (v.x / vl) * (1 - spread) * sp + dx * spread * sp;
        p.vy = (v.y / vl) * (1 - spread) * sp + dy * spread * sp;
        p.vz = (v.z / vl) * (1 - spread) * sp + dz * spread * sp;
      } else {
        p.vx = dx * sp;
        p.vy = dy * sp;
        p.vz = dz * sp;
      }
      p.max = p.life = o.life ? rand(o.life[0], o.life[1]) : 1;
      p.size = o.size ? rand(o.size[0], o.size[1]) : 0.1;
      const t = Math.random();
      p.r = this.tmpC.r + (this.tmpC2.r - this.tmpC.r) * t;
      p.g = this.tmpC.g + (this.tmpC2.g - this.tmpC.g) * t;
      p.b = this.tmpC.b + (this.tmpC2.b - this.tmpC.b) * t;
      p.a = o.alpha ?? 1;
      p.grav = o.gravity ?? 0;
      p.drag = o.drag ?? 0;
      p.grow = o.grow ?? 0;
      p.fadeIn = o.fadeIn ?? 0;
    }
  }

  update(dt: number): void {
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      const p = this.ps[i];
      if (!p.alive) {
        this.col[i * 4 + 3] = 0;
        this.size[i] = 0;
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this.col[i * 4 + 3] = 0;
        this.size[i] = 0;
        continue;
      }
      alive++;
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy = p.vy * damp - p.grav * dt;
      p.vz *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size += p.grow * dt;
      const u = p.life / p.max;
      const fin = p.fadeIn > 0 ? Math.min(1, (1 - u) / p.fadeIn) : 1;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.col[i * 4] = p.r;
      this.col[i * 4 + 1] = p.g;
      this.col[i * 4 + 2] = p.b;
      this.col[i * 4 + 3] = p.a * Math.min(1, u * 2.5) * fin;
      this.size[i] = Math.max(0, p.size);
    }
    this.points.visible = alive > 0;
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** High-level effect presets. */
export class Particles {
  readonly glow: ParticlePool;
  readonly soft: ParticlePool;
  private moteTimer = 0;
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, quality: string) {
    const n = quality === 'low' ? 900 : 1800;
    this.glow = new ParticlePool(scene, n, true, 0.025);
    this.soft = new ParticlePool(scene, n, false, 0.035);
  }

  setViewport(h: number, fov: number): void {
    this.glow.setViewport(h, fov);
    this.soft.setViewport(h, fov);
  }

  sparks(pos: THREE.Vector3, dir: THREE.Vector3, count = 18, color: THREE.ColorRepresentation = 0xffc070): void {
    this.glow.spawn({ pos, vel: dir, spread: 0.7, speed: [3, 9], life: [0.15, 0.45], size: [0.03, 0.07], color, color2: 0xff7a30, alpha: 1.6, gravity: 9, drag: 2, count });
  }

  blood(pos: THREE.Vector3, dir: THREE.Vector3, count = 14, color: THREE.ColorRepresentation = 0x2a0806): void {
    this.soft.spawn({ pos, vel: dir, spread: 0.6, speed: [1.5, 5], life: [0.35, 0.8], size: [0.05, 0.13], color, color2: 0x140404, alpha: 0.95, gravity: 11, drag: 1, count });
  }

  ichor(pos: THREE.Vector3, dir: THREE.Vector3, count = 12): void {
    this.soft.spawn({ pos, vel: dir, spread: 0.7, speed: [1, 4], life: [0.4, 0.9], size: [0.06, 0.14], color: 0x2c3a2a, color2: 0x151a12, alpha: 0.9, gravity: 10, drag: 1, count });
  }

  wax(pos: THREE.Vector3, dir: THREE.Vector3, count = 16): void {
    this.soft.spawn({ pos, vel: dir, spread: 0.7, speed: [2, 6], life: [0.4, 1], size: [0.06, 0.16], color: 0xe6dcc2, color2: 0xa89878, alpha: 1, gravity: 10, drag: 1, count });
  }

  embers(pos: THREE.Vector3, count = 2, spread = 0.2): void {
    this.glow.spawn({ pos, vel: new THREE.Vector3(0, 1, 0), spread: 0.35, speed: [0.4, 1.4], life: [0.8, 2.2], size: [0.02, 0.05], color: 0xffb060, color2: 0xff5a20, alpha: 1.4, gravity: -0.4, drag: 0.8, jitter: spread, count });
  }

  smoke(pos: THREE.Vector3, count = 1, color: THREE.ColorRepresentation = 0x1c1a19): void {
    this.soft.spawn({ pos, vel: new THREE.Vector3(0, 1, 0), spread: 0.3, speed: [0.3, 0.8], life: [1.5, 3], size: [0.2, 0.4], grow: 0.4, color, alpha: 0.35, drag: 0.5, jitter: 0.1, count, fadeIn: 0.3 });
  }

  dust(pos: THREE.Vector3, count = 8, color: THREE.ColorRepresentation = 0x5a544c): void {
    this.soft.spawn({ pos, vel: new THREE.Vector3(0, 1, 0), spread: 0.9, speed: [0.5, 2], life: [0.5, 1.2], size: [0.15, 0.35], grow: 0.5, color, alpha: 0.35, gravity: 0.5, drag: 2.5, jitter: 0.25, count });
  }

  splash(pos: THREE.Vector3, count = 10): void {
    this.soft.spawn({ pos, vel: new THREE.Vector3(0, 1, 0), spread: 0.6, speed: [1.5, 3.5], life: [0.3, 0.6], size: [0.04, 0.09], color: 0x6f807c, alpha: 0.7, gravity: 12, drag: 0.5, count });
  }

  wisps(pos: THREE.Vector3, count = 1, color: THREE.ColorRepresentation = 0xd8e4ff): void {
    this.glow.spawn({ pos, vel: new THREE.Vector3(0, 1, 0), spread: 0.8, speed: [0.2, 0.7], life: [1, 2.2], size: [0.04, 0.09], color, alpha: 1.1, gravity: -0.2, drag: 0.4, jitter: 0.25, count, fadeIn: 0.3 });
  }

  rot(pos: THREE.Vector3, count = 2): void {
    this.glow.spawn({ pos, vel: new THREE.Vector3(0, 1, 0), spread: 0.9, speed: [0.5, 2.5], life: [0.8, 1.8], size: [0.05, 0.14], color: 0xff5028, color2: 0x7a2a10, alpha: 1.2, gravity: -0.6, drag: 0.7, jitter: 0.5, count });
  }

  flameBurst(pos: THREE.Vector3, count = 30): void {
    this.glow.spawn({ pos, vel: new THREE.Vector3(0, 1, 0), spread: 0.8, speed: [1, 5], life: [0.4, 1], size: [0.15, 0.4], grow: -0.2, color: 0xffa040, color2: 0xff4410, alpha: 1.3, gravity: -2, drag: 1.5, jitter: 0.4, count });
  }

  /** Ambient dust motes / ash drifting around the camera. */
  ambient(dt: number, cam: THREE.Vector3, kind: 'dust' | 'ash' | 'spore'): void {
    this.moteTimer -= dt;
    if (this.moteTimer > 0) return;
    this.moteTimer = 0.05;
    this.tmp.set(cam.x + rand(-9, 9), cam.y + rand(-2, 4), cam.z + rand(-9, 9));
    if (kind === 'ash') {
      this.soft.spawn({ pos: this.tmp, vel: new THREE.Vector3(0.3, -1, 0.1), spread: 0.3, speed: [0.2, 0.5], life: [4, 7], size: [0.02, 0.045], color: 0x9a948c, alpha: 0.55, drag: 0.1, fadeIn: 0.2 });
    } else if (kind === 'spore') {
      this.glow.spawn({ pos: this.tmp, vel: new THREE.Vector3(0, 1, 0), spread: 1, speed: [0.05, 0.2], life: [4, 8], size: [0.015, 0.03], color: 0x9fb8a8, alpha: 0.45, drag: 0.1, fadeIn: 0.3 });
    } else {
      this.soft.spawn({ pos: this.tmp, vel: new THREE.Vector3(0, 1, 0), spread: 1, speed: [0.02, 0.1], life: [4, 8], size: [0.012, 0.03], color: 0xb0aaa0, alpha: 0.5, drag: 0.1, fadeIn: 0.3 });
    }
  }

  update(dt: number): void {
    this.glow.update(dt);
    this.soft.update(dt);
  }
}
