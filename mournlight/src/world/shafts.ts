import * as THREE from 'three';

/**
 * Volumetric-looking light shafts: additive prisms extruded along the
 * moonlight through windows and roof breaks. Dust motes drift inside them and
 * they fade along their length, at their silhouette edges and with distance.
 */
export interface ShaftDef {
  p: [number, number, number];
  w: number;
  h: number;
  len: number;
}

const VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vN;
uniform float uTime;
uniform float uIntensity;
uniform float uLen;
uniform vec3 uColor;
float hh(vec3 p) { p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float nn(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hh(i), hh(i + vec3(1, 0, 0)), f.x), mix(hh(i + vec3(0, 1, 0)), hh(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hh(i + vec3(0, 0, 1)), hh(i + vec3(1, 0, 1)), f.x), mix(hh(i + vec3(0, 1, 1)), hh(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
void main() {
  float along = clamp(vLocal.z / uLen, 0.0, 1.0);
  vec3 v = normalize(cameraPosition - vWorld);
  float soft = pow(abs(dot(normalize(vN), v)), 2.0);
  float dust = nn(vWorld * 1.3 + vec3(0.0, -uTime * 0.08, uTime * 0.05)) * 0.6 + nn(vWorld * 4.1 - uTime * 0.11) * 0.4;
  float motes = smoothstep(0.82, 0.9, nn(vWorld * 9.0 + vec3(uTime * 0.05, -uTime * 0.12, 0.0)));
  float dist = length(cameraPosition - vWorld);
  float a = soft * (1.0 - along) * smoothstep(0.0, 0.06, along) * (0.55 + 0.45 * dust) * (1.0 - smoothstep(35.0, 70.0, dist));
  a *= smoothstep(0.3, 2.5, dist); // no hard edges when the camera stands in a shaft
  gl_FragColor = vec4(uColor * (a * uIntensity * 0.06 + motes * a * uIntensity * 0.2), 1.0);
}`;

export class LightShafts {
  private group = new THREE.Group();
  private mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, defs: ShaftDef[], lightDir: THREE.Vector3) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1 },
        uLen: { value: 1 },
        uColor: { value: new THREE.Color(0.55, 0.65, 0.85) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const dir = lightDir.clone().normalize();
    for (const d of defs) {
      // an open elliptical tube: its rounded silhouette gives a soft fresnel falloff
      const geo = new THREE.CylinderGeometry(0.5, 0.5, d.len, 14, 6, true);
      geo.rotateX(Math.PI / 2);
      geo.scale(d.w, d.h, 1);
      geo.translate(0, 0, d.len / 2);
      // widen slightly with distance so the shaft spreads like scattered light
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const k = 1 + (pos.getZ(i) / d.len) * 0.35;
        pos.setX(i, pos.getX(i) * k);
        pos.setY(i, pos.getY(i) * k);
      }
      const mat = this.mat.clone();
      mat.uniforms.uTime = this.mat.uniforms.uTime;
      mat.uniforms.uIntensity = this.mat.uniforms.uIntensity;
      mat.uniforms.uLen = { value: d.len };
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...d.p);
      mesh.lookAt(mesh.position.clone().add(dir));
      mesh.renderOrder = 4;
      this.group.add(mesh);
    }
    scene.add(this.group);
  }

  update(t: number, intensity: number): void {
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uIntensity.value = intensity;
    this.group.visible = intensity > 0.01;
  }
}
