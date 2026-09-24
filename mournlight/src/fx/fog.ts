import * as THREE from 'three';

/**
 * Layered, animated height fog. We override Three's fog shader chunks
 * globally so every material gets:
 *   - exponential distance fog,
 *   - extra density near the ground that falls off with height,
 *   - slowly drifting noise banks.
 * Materials created by the game call `patchFog` so the shared uniforms
 * (time, height parameters) are bound.
 */
export const fogUniforms = {
  fogTime: { value: 0 },
  fogHeightBase: { value: 0 },
  fogHeightFalloff: { value: 0.16 },
  fogGroundBoost: { value: 0.9 },
  fogNoise: { value: 0.55 },
};

let installed = false;

export function installFogChunks(): void {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec4 fogWp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    fogWp = instanceMatrix * fogWp;
  #endif
  vFogWorldPos = ( modelMatrix * fogWp ).xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  uniform float fogTime;
  uniform float fogHeightBase;
  uniform float fogHeightFalloff;
  uniform float fogGroundBoost;
  uniform float fogNoise;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  float fogHash( vec3 p ) {
    p = fract( p * 0.3183099 + 0.1 );
    p *= 17.0;
    return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
  }
  float fogNoise3( vec3 x ) {
    vec3 i = floor( x );
    vec3 f = fract( x );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( mix( fogHash( i + vec3( 0, 0, 0 ) ), fogHash( i + vec3( 1, 0, 0 ) ), f.x ),
                     mix( fogHash( i + vec3( 0, 1, 0 ) ), fogHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                mix( mix( fogHash( i + vec3( 0, 0, 1 ) ), fogHash( i + vec3( 1, 0, 1 ) ), f.x ),
                     mix( fogHash( i + vec3( 0, 1, 1 ) ), fogHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
  }
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogH = max( vFogWorldPos.y - fogHeightBase, 0.0 );
    float heightTerm = 1.0 + fogGroundBoost * exp( - fogH * fogHeightFalloff );
    vec3 fq = vFogWorldPos * 0.045 + vec3( fogTime * 0.021, 0.0, fogTime * 0.013 );
    float n = fogNoise3( fq ) * 0.65 + fogNoise3( fq * 2.3 + 7.1 ) * 0.35;
    float dens = fogDensity * heightTerm * ( 1.0 - fogNoise * 0.5 + fogNoise * n );
    float fogFactor = 1.0 - exp( - dens * dens * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, clamp( fogFactor, 0.0, 1.0 ) );
#endif`;
}

type OnBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

function bindFogUniforms(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.fogTime = fogUniforms.fogTime;
  shader.uniforms.fogHeightBase = fogUniforms.fogHeightBase;
  shader.uniforms.fogHeightFalloff = fogUniforms.fogHeightFalloff;
  shader.uniforms.fogGroundBoost = fogUniforms.fogGroundBoost;
  shader.uniforms.fogNoise = fogUniforms.fogNoise;
}

/** Bind the animated fog uniforms, optionally chaining another shader patch. */
export function patchFog<T extends THREE.Material>(m: T, extra?: OnBeforeCompile, cacheKey?: string): T {
  m.onBeforeCompile = (shader, renderer) => {
    bindFogUniforms(shader);
    if (extra) extra(shader, renderer);
  };
  if (cacheKey) m.customProgramCacheKey = () => cacheKey;
  return m;
}

/**
 * Character rim light: a view-dependent (fresnel) glow added to the emissive term so player and
 * enemy silhouettes always separate from a dark background. Colour and strength come from the
 * region's lighting data and are eased by the game.
 */
export const rimUniforms = {
  uRimColor: { value: new THREE.Color(0x9fb4d8) },
  uRimStrength: { value: 0.2 },
};

export const rimPatch: OnBeforeCompile = (shader) => {
  shader.uniforms.uRimColor = rimUniforms.uRimColor;
  shader.uniforms.uRimStrength = rimUniforms.uRimStrength;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;')
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
  {
    float rimNdv = saturate(dot(normal, normalize(vViewPosition)));
    totalEmissiveRadiance += uRimColor * (pow(1.0 - rimNdv, 3.0) * uRimStrength);
  }`,
    );
};

/**
 * Death dissolve: fragments are eaten away by world-space value noise as `u.value` goes 0 → 1,
 * with a hot ember rim on the edge that is about to go. Used by creature materials (per model).
 */
export function dissolvePatch(shader: THREE.WebGLProgramParametersWithUniforms, u: { value: number }): void {
  shader.uniforms.uDissolve = u;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vDisPos;')
    .replace('#include <project_vertex>', '#include <project_vertex>\n  vDisPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform float uDissolve;
varying vec3 vDisPos;
float mlDisHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float mlDisNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mlDisHash(i), mlDisHash(i + vec3(1, 0, 0)), f.x), mix(mlDisHash(i + vec3(0, 1, 0)), mlDisHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(mlDisHash(i + vec3(0, 0, 1)), mlDisHash(i + vec3(1, 0, 1)), f.x), mix(mlDisHash(i + vec3(0, 1, 1)), mlDisHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`,
    )
    .replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
  float disEdge = 0.0;
  if (uDissolve > 0.0) {
    float dn = mlDisNoise(vDisPos * 6.0) * 0.65 + mlDisNoise(vDisPos * 21.0) * 0.35;
    if (dn < uDissolve * 1.08) discard;
    disEdge = smoothstep(uDissolve * 1.08 + 0.07, uDissolve * 1.08, dn);
  }`,
    )
    .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb += vec3(1.0, 0.42, 0.12) * disEdge * 1.6;\n#include <tonemapping_fragment>');
}
