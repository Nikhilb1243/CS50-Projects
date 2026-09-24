import * as THREE from 'three';

/**
 * Weapon swing ribbon. Each rendered frame during a swing pushes the
 * striker's base and tip; the ribbon joins the recent samples into a strip
 * that fades with age and towards the hilt. Additive, one draw call.
 */
const N = 28;

export class SwingTrail {
  readonly mesh: THREE.Mesh;
  private base: THREE.Vector3[] = [];
  private tip: THREE.Vector3[] = [];
  private times: number[] = [];
  private head = 0;
  private count = 0;
  private pos: Float32Array;
  private fade: Float32Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  life = 0.16;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < N; i++) {
      this.base.push(new THREE.Vector3());
      this.tip.push(new THREE.Vector3());
      this.times.push(-1);
    }
    this.pos = new Float32Array(N * 2 * 3);
    this.fade = new Float32Array(N * 2);
    const g = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.pos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    const fa = new THREE.BufferAttribute(this.fade, 1);
    fa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pa);
    g.setAttribute('aFade', fa);
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 0.6, 0.3) }, uIntensity: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aFade;
        varying float vFade;
        void main() { vFade = aFade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying float vFade;
        uniform vec3 uColor;
        uniform float uIntensity;
        void main() { float a = vFade * vFade; gl_FragColor = vec4(uColor * a * uIntensity, a); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    scene.add(this.mesh);
  }

  setColor(c: THREE.ColorRepresentation, intensity = 1): void {
    (this.mat.uniforms.uColor.value as THREE.Color).set(c);
    this.mat.uniforms.uIntensity.value = intensity;
  }

  push(a: THREE.Vector3, b: THREE.Vector3, now: number): void {
    this.head = (this.head + 1) % N;
    this.base[this.head].copy(a);
    this.tip[this.head].copy(b);
    this.times[this.head] = now;
    this.count = Math.min(N, this.count + 1);
  }

  update(now: number): void {
    let n = 0;
    for (let k = 0; k < this.count; k++) {
      const i = (this.head - k + N) % N;
      const age = now - this.times[i];
      if (age > this.life || this.times[i] < 0) break;
      const f = 1 - age / this.life;
      const b = this.base[i];
      const t = this.tip[i];
      // the ribbon starts a little up the blade so the hilt stays clean
      this.pos.set([b.x + (t.x - b.x) * 0.3, b.y + (t.y - b.y) * 0.3, b.z + (t.z - b.z) * 0.3], n * 6);
      this.pos.set([t.x, t.y, t.z], n * 6 + 3);
      this.fade[n * 2] = f * 0.15;
      this.fade[n * 2 + 1] = f;
      n++;
    }
    this.count = n;
    this.geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aFade.needsUpdate = true;
  }
}
