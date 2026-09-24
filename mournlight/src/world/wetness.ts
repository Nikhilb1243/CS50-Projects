/**
 * Wet surfaces: a shader patch for world materials. Up-facing surfaces gather
 * puddles (near-mirror roughness, flattened normals, darker albedo) that pick
 * up the environment map and every flame; walls get darker, glossier damp
 * streaks. The amount is set per region (the drowned village is soaked, the
 * cathedral is only damp) and eased by the game.
 */
import type * as THREE from 'three';

export const wetUniforms = {
  uWetness: { value: 0 },
};

const WET_FRAG = /* glsl */ `
float wetPuddle = 0.0;
#ifdef USE_FOG
if (uWetness > 0.001) {
  vec3 wetN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  float upF = smoothstep(0.78, 0.96, wetN.y);
  vec2 wp = vFogWorldPos.xz;
  float pn = fogNoise3(vec3(wp * 0.31, 0.0)) * 0.65 + fogNoise3(vec3(wp * 1.13, 3.0)) * 0.35;
  wetPuddle = smoothstep(0.6, 0.67, pn) * upF * uWetness;
  float streak = fogNoise3(vec3((wp.x + wp.y) * 1.7, vFogWorldPos.y * 0.25, 1.0));
  float wetMask = uWetness * mix(0.45 + 0.55 * streak, 1.0, upF);
  diffuseColor.rgb *= mix(1.0, 0.6, wetMask) * mix(1.0, 0.72, wetPuddle);
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.42, wetMask);
  roughnessFactor = mix(roughnessFactor, 0.035, wetPuddle);
}
#endif
#include <metalnessmap_fragment>`;

export function patchWet(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uWetness = wetUniforms.uWetness;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uWetness;')
    .replace('#include <metalnessmap_fragment>', WET_FRAG)
    // puddles are flat: blend the detail normal back towards the surface normal
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, normalize(vNormal) * faceDirection, wetPuddle));');
}
