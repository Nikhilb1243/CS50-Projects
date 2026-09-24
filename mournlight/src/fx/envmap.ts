import * as THREE from 'three';

/**
 * A procedural environment for image-based lighting and reflections: a
 * bruised night sky with a pale moon smear, low cloud glow on the horizon and
 * a few distant pyres, pre-filtered with PMREM. Wet stone and puddles reflect
 * it; its intensity is set per region so crypts stay black.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer, moonDir: THREE.Vector3): THREE.Texture {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uMoon: { value: moonDir.clone().normalize() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uMoon;
      float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec3 d = normalize(vDir);
        float up = d.y;
        vec3 zenith = vec3(0.012, 0.016, 0.028);
        vec3 horizon = vec3(0.05, 0.058, 0.07);
        vec3 ground = vec3(0.018, 0.016, 0.014);
        vec3 col = up > 0.0 ? mix(horizon, zenith, pow(up, 0.5)) : mix(horizon * 0.6, ground, pow(-up, 0.4));
        // cloud banks lit from beneath by the moon
        vec2 cp = d.xz / max(0.2, abs(d.y) + 0.25) * 2.0;
        float c = n(cp) * 0.6 + n(cp * 2.7) * 0.4;
        col += vec3(0.05, 0.06, 0.08) * smoothstep(0.45, 0.9, c) * smoothstep(-0.05, 0.3, up);
        float md = max(dot(d, normalize(uMoon)), 0.0);
        col += vec3(0.9, 1.0, 1.15) * (pow(md, 400.0) * 6.0 + pow(md, 24.0) * 0.25);
        // distant pyres: warm specks along the horizon
        float a = atan(d.z, d.x);
        float band = exp(-pow(up * 14.0, 2.0));
        float pyres = smoothstep(0.93, 1.0, n(vec2(a * 9.0, 3.1))) * band;
        col += vec3(1.6, 0.55, 0.16) * pyres * 0.5;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0, 0.1, 50);
  pmrem.dispose();
  mat.dispose();
  return rt.texture;
}
