import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // at the far plane
}`;

const FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uMoonDir;
uniform float uTime;
uniform float uMoon;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.6));
  // slow cloud banks
  vec2 cp = d.xz / max(0.15, d.y + 0.2) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
  float c = n(cp) * 0.6 + n(cp * 2.3) * 0.3 + n(cp * 5.1) * 0.1;
  // moon and halo
  float md = max(dot(d, normalize(uMoonDir)), 0.0);
  float disc = smoothstep(0.9993, 0.9996, md);
  float halo = pow(md, 90.0) * 0.35 + pow(md, 12.0) * 0.08;
  col += vec3(0.55, 0.62, 0.75) * halo * uMoon;
  col = mix(col, col * 0.55 + uHorizon * 0.2, smoothstep(0.45, 0.8, c) * (1.0 - up * 0.3));
  col += vec3(1.6, 1.65, 1.7) * disc * uMoon * (1.0 - smoothstep(0.5, 0.75, c) * 0.85);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Night sky dome with a pale moon behind drifting cloud banks. */
export class Sky {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, moonDir: THREE.Vector3) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uHorizon: { value: new THREE.Color(0x10141a) },
        uZenith: { value: new THREE.Color(0x030406) },
        uMoonDir: { value: moonDir.clone().normalize() },
        uTime: { value: 0 },
        uMoon: { value: 1 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), this.mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(camPos: THREE.Vector3, fogColor: THREE.Color, t: number, moon: number): void {
    this.mesh.position.copy(camPos);
    (this.mat.uniforms.uHorizon.value as THREE.Color).copy(fogColor);
    (this.mat.uniforms.uZenith.value as THREE.Color).copy(fogColor).multiplyScalar(0.3);
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uMoon.value = moon;
  }
}
