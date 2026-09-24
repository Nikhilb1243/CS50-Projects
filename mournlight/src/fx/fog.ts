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
