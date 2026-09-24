import * as THREE from 'three';
import { clamp01, fbm2, lerp, smoothstep } from '../core/math';
import { TERRAIN, TERRAIN_MODS, type TerrainMod } from './layout';
import type { Physics } from '../core/physics';
import { patchFog } from '../fx/fog';
import { patchWet } from './wetness';
import type { TextureSet } from './textures';

// ---------------------------------------------------------------------------
// Height function (pure, deterministic)
// ---------------------------------------------------------------------------
function rectDist(x: number, z: number, r: [number, number, number, number]): number {
  const dx = Math.max(r[0] - x, 0, x - r[2]);
  const dz = Math.max(r[1] - z, 0, z - r[3]);
  return Math.hypot(dx, dz);
}

function segInfo(x: number, z: number, a: [number, number, number], b: [number, number, number]): { t: number; d: number } {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = clamp01(((x - a[0]) * dx + (z - a[1]) * dz) / len2);
  const px = a[0] + dx * t;
  const pz = a[1] + dz * t;
  return { t, d: Math.hypot(x - px, z - pz) };
}

function applyMod(h: number, x: number, z: number, m: TerrainMod): number {
  let w = 0;
  let target = m.h ?? 0;
  let op = m.op ?? 'set';
  switch (m.kind) {
    case 'flat': {
      const d = rectDist(x, z, m.rect!);
      w = 1 - smoothstep(0, Math.max(m.blend, 1e-3), d);
      break;
    }
    case 'circle': {
      const r = m.r as number;
      const d = Math.hypot(x - m.c![0], z - m.c![1]) - r;
      w = d <= 0 ? 1 : 1 - smoothstep(0, Math.max(m.blend, 1e-3), d);
      break;
    }
    case 'ellipse': {
      const [rx, rz] = m.r as [number, number];
      const t = Math.hypot((x - m.c![0]) / rx, (z - m.c![1]) / rz);
      const d = (t - 1) * Math.min(rx, rz);
      w = d <= 0 ? 1 : 1 - smoothstep(0, m.blend, d);
      break;
    }
    case 'ramp':
    case 'trench': {
      const { t, d } = segInfo(x, z, m.a!, m.b!);
      target = lerp(m.a![2], m.b![2], t);
      const half = (m.w ?? 4) / 2;
      const dd = d - half;
      w = dd <= 0 ? 1 : 1 - smoothstep(0, Math.max(m.blend, 1e-3), dd);
      op = m.kind === 'ramp' ? 'max' : 'min';
      break;
    }
    case 'raise':
      break;
  }
  if (w <= 0) return h;
  if (m.noise) target += fbm2(x * 0.09, z * 0.09, 3) * m.noise;
  const v = lerp(h, target, w);
  if (op === 'min') return Math.min(h, v);
  if (op === 'max') return Math.max(h, v);
  return v;
}

export function terrainHeight(x: number, z: number): number {
  let h = 0.6 + fbm2(x * 0.018 + 3.1, z * 0.018 - 1.7, 4) * 1.6 + fbm2(x * 0.07, z * 0.07, 3) * 0.35;
  for (const m of TERRAIN_MODS) h = applyMod(h, x, z, m);
  // Boundary cliffs
  const d = rectDist(x, z, TERRAIN.play);
  if (d > 0) h = Math.max(h, h + smoothstep(0, 22, d) * 42 + fbm2(x * 0.05, z * 0.05, 3) * Math.min(d, 20) * 0.6);
  return h;
}

// ---------------------------------------------------------------------------
// Terrain mesh + collider
// ---------------------------------------------------------------------------
const ROADS: [number, number][][] = [
  [[0, 56], [0, 30], [2, 0], [0, -18]],
  [[0, 30], [-30, 32], [-62, 30]],
  [[2, 10], [30, 18], [62, 24], [100, 40]],
  [[-51, -66], [-40, -70], [-26, -70]],
  [[47, -78], [26, -78]],
];

function roadWeight(x: number, z: number): number {
  let best = 1e9;
  for (const path of ROADS) {
    for (let i = 0; i < path.length - 1; i++) {
      const { d } = segInfo(x, z, [path[i][0], path[i][1], 0], [path[i + 1][0], path[i + 1][1], 0]);
      best = Math.min(best, d);
    }
  }
  const wobble = fbm2(x * 0.3, z * 0.3, 2) * 0.8;
  return 1 - smoothstep(1.2, 2.6, best + wobble);
}

export interface TerrainResult {
  mesh: THREE.Mesh;
  heights: Float32Array;
}

export function buildTerrain(physics: Physics, detail: TextureSet): TerrainResult {
  const { size, cells, center } = TERRAIN;
  const n = cells + 1;
  const step = size / cells;
  const x0 = center[0] - size / 2;
  const z0 = center[1] - size / 2;

  // Heights: row = z index, col = x index, column-major for Rapier
  const heightsRapier = new Float32Array(n * n);
  const grid = new Float32Array(n * n); // row-major [zi * n + xi] for mesh
  for (let zi = 0; zi < n; zi++) {
    for (let xi = 0; xi < n; xi++) {
      const h = terrainHeight(x0 + xi * step, z0 + zi * step);
      grid[zi * n + xi] = h;
      heightsRapier[xi * n + zi] = h;
    }
  }
  physics.addHeightfield(cells, heightsRapier, size, center[0], center[1]);

  // Mesh (optionally decimated on low quality)
  const stride = 1;
  const m = Math.floor(cells / stride) + 1;
  const positions = new Float32Array(m * m * 3);
  const colors = new Float32Array(m * m * 3);
  const idx: number[] = [];
  const cGrass = new THREE.Color(0x66684f);
  const cMud = new THREE.Color(0x544c3d);
  const cWet = new THREE.Color(0x353b33);
  const cRock = new THREE.Color(0x7c776e);
  const cAsh = new THREE.Color(0x5c5853);
  const cRoad = new THREE.Color(0x7a705f);
  const cMoss = new THREE.Color(0x505b44);
  const tmp = new THREE.Color();
  const H = (xi: number, zi: number): number => grid[Math.min(n - 1, Math.max(0, zi)) * n + Math.min(n - 1, Math.max(0, xi))];

  for (let zi = 0; zi < m; zi++) {
    for (let xi = 0; xi < m; xi++) {
      const gx = xi * stride;
      const gz = zi * stride;
      const x = x0 + gx * step;
      const z = z0 + gz * step;
      const h = H(gx, gz);
      const i = zi * m + xi;
      positions[i * 3] = x;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = z;
      // slope estimate
      const dx = (H(gx + 1, gz) - H(gx - 1, gz)) / (2 * step);
      const dz = (H(gx, gz + 1) - H(gx, gz - 1)) / (2 * step);
      const slope = Math.sqrt(dx * dx + dz * dz);
      const nz = fbm2(x * 0.05, z * 0.05, 3);
      tmp.copy(cGrass).lerp(cMud, clamp01(0.5 + nz));
      tmp.lerp(cMoss, clamp01(fbm2(x * 0.13 + 9, z * 0.13, 2) * 1.5) * 0.6);
      if (x > 62) tmp.lerp(cAsh, 0.6);
      if (h < TERRAIN.waterLevel + 0.4) tmp.lerp(cWet, clamp01((TERRAIN.waterLevel + 0.4 - h) * 1.5));
      tmp.lerp(cRoad, roadWeight(x, z) * 0.85);
      tmp.lerp(cRock, smoothstep(0.55, 1.1, slope));
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
  }
  for (let zi = 0; zi < m - 1; zi++) {
    for (let xi = 0; xi < m - 1; xi++) {
      const a = zi * m + xi;
      const b = a + 1;
      const c = a + m;
      const d = c + 1;
      // match Rapier's triangulation closely enough; alternate for less banding
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = createTriplanarMaterial(detail, 0.26);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'terrain';
  return { mesh, heights: grid };
}

/**
 * MeshStandardMaterial with triplanar detail albedo / normal / roughness so
 * cliffs do not show stretched textures. Base color comes from vertex colors.
 */
export function createTriplanarMaterial(set: TextureSet, scale: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const uniforms = {
    triMap: { value: set.map },
    triNormal: { value: set.normalMap },
    triRough: { value: set.roughnessMap },
    triScale: { value: scale },
  };
  patchFog(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTriNormal = normalize(mat3(modelMatrix) * objectNormal);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vTriPos;
varying vec3 vTriNormal;
uniform sampler2D triMap;
uniform sampler2D triNormal;
uniform sampler2D triRough;
uniform float triScale;
vec3 triW() { vec3 w = pow(abs(normalize(vTriNormal)), vec3(4.0)); return w / (w.x + w.y + w.z); }`,
        )
        .replace(
          '#include <map_fragment>',
          `vec3 tw = triW();
vec2 uvX = vTriPos.zy * triScale; vec2 uvY = vTriPos.xz * triScale; vec2 uvZ = vTriPos.xy * triScale;
vec3 triTex = texture2D(triMap, uvX).rgb * tw.x + texture2D(triMap, uvY).rgb * tw.y + texture2D(triMap, uvZ).rgb * tw.z;
vec3 triTex2 = texture2D(triMap, uvY * 0.13 + 0.37).rgb;
diffuseColor.rgb *= triTex * (0.65 + 0.7 * triTex2) * 1.25;`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness * (texture2D(triRough, uvX).g * tw.x + texture2D(triRough, uvY).g * tw.y + texture2D(triRough, uvZ).g * tw.z);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `{
  vec3 wn = normalize(vTriNormal);
  vec3 tnX = texture2D(triNormal, uvX).xyz * 2.0 - 1.0;
  vec3 tnY = texture2D(triNormal, uvY).xyz * 2.0 - 1.0;
  vec3 tnZ = texture2D(triNormal, uvZ).xyz * 2.0 - 1.0;
  tnX.xy *= 1.2; tnY.xy *= 1.2; tnZ.xy *= 1.2;
  tnX = vec3(tnX.xy + wn.zy, abs(tnX.z) * wn.x);
  tnY = vec3(tnY.xy + wn.xz, abs(tnY.z) * wn.y);
  tnZ = vec3(tnZ.xy + wn.xy, abs(tnZ.z) * wn.z);
  vec3 triN = normalize(tnX.zyx * tw.x + tnY.xzy * tw.y + tnZ.xyz * tw.z);
  normal = normalize((viewMatrix * vec4(triN, 0.0)).xyz);
}`,
        );
      patchWet(shader);
    },
    'triplanar-terrain',
  );
  return mat;
}
