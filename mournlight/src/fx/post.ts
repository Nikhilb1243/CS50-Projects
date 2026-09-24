import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  Effect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import type { Quality } from '../core/settings';

const GRADE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uWarp;
uniform float uSat;
uniform float uHurt;
uniform float uFade;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uRot;

void mainUv(inout vec2 uv) {
  if (uWarp > 0.001) {
    vec2 c = uv - 0.5;
    float r = length(c);
    float w = uWarp * uWarp * 0.011;
    uv += vec2(sin(uv.y * 23.0 + uTime * 1.7), cos(uv.x * 19.0 + uTime * 1.31)) * w * (0.35 + r * 1.5);
    uv = 0.5 + (uv - 0.5) * (1.0 - uWarp * 0.02 * (0.5 + 0.5 * sin(uTime * 0.9)));
  }
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 col = inputColor.rgb;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  // Warm hues (flame light) keep their saturation; everything else is drained and cooled.
  float warm = smoothstep(0.015, 0.2, col.r - col.b) * smoothstep(0.0, 0.1, col.r - col.g * 0.55);
  float sat = mix(uSat, 1.08, warm);
  col = mix(vec3(lum), col, sat);
  col *= mix(vec3(0.85, 0.95, 1.1), vec3(1.04, 0.98, 0.9), warm);
  col += vec3(0.003, 0.005, 0.009) * (1.0 - smoothstep(0.0, 0.2, lum));
  // Sickly rot tint (boss phase two)
  col = mix(col, col * vec3(1.15, 0.8, 0.7), uRot * 0.5);
  vec2 c = uv - 0.5;
  float v = dot(c, c);
  // Wounded: red creeping from the edges
  col = mix(col, vec3(0.3, 0.015, 0.01) * (0.4 + lum), clamp(uHurt * v * 3.2, 0.0, 0.85));
  // Dread: edges darken and pulse
  col *= 1.0 - uWarp * 0.35 * smoothstep(0.05, 0.45, v) * (0.65 + 0.35 * sin(uTime * 2.1));
  col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));
  col *= 1.0 - uFade;
  outputColor = vec4(col, inputColor.a);
}`;

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uTime', new THREE.Uniform(0)],
        ['uWarp', new THREE.Uniform(0)],
        ['uSat', new THREE.Uniform(0.45)],
        ['uHurt', new THREE.Uniform(0)],
        ['uFade', new THREE.Uniform(0)],
        ['uFlash', new THREE.Uniform(0)],
        ['uFlashColor', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['uRot', new THREE.Uniform(0)],
      ]),
    });
  }
  u(name: string): THREE.Uniform {
    return this.uniforms.get(name)!;
  }
}

export interface PostParams {
  time: number;
  dread: number;
  hurt: number;
  fade: number;
  flash: number;
  flashColor?: THREE.Color;
  rot: number;
}

/**
 * pmndrs/postprocessing chain:
 *   render -> bloom (flames only, HDR threshold) -> ACES tone map ->
 *   grade (cold/desaturated with warm preservation, dread warp) -> vignette
 *   -> chromatic aberration + film grain
 */
export class PostFX {
  readonly composer: EffectComposer;
  private grade: GradeEffect;
  private chroma: ChromaticAberrationEffect | null = null;
  private vignette: VignetteEffect;
  private noise: NoiseEffect;
  private bloom: BloomEffect;
  private baseChroma = new THREE.Vector2(0.0007, 0.0005);

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: Quality) {
    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: quality === 'high' ? 4 : 0,
    });
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new BloomEffect({
      luminanceThreshold: 0.72,
      luminanceSmoothing: 0.18,
      intensity: 1.25,
      mipmapBlur: true,
      radius: 0.7,
      levels: quality === 'low' ? 4 : 6,
    });
    if (quality === 'low') this.bloom.resolution.scale = 0.5;
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.grade = new GradeEffect();
    this.vignette = new VignetteEffect({ darkness: 0.68, offset: 0.28 });
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.noise.blendMode.opacity.value = 0.14;
    if (quality === 'low') {
      this.composer.addPass(new EffectPass(camera, this.bloom, tone, this.grade, this.vignette, this.noise));
    } else {
      this.chroma = new ChromaticAberrationEffect({ offset: this.baseChroma.clone(), radialModulation: true, modulationOffset: 0.25 });
      this.composer.addPass(new EffectPass(camera, this.bloom, tone, this.grade, this.vignette));
      this.composer.addPass(new EffectPass(camera, this.chroma, this.noise));
    }
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  update(p: PostParams): void {
    const g = this.grade;
    g.u('uTime').value = p.time;
    g.u('uWarp').value = Math.max(0, (p.dread - 0.55) / 0.45);
    g.u('uSat').value = 0.48 - p.dread * 0.2;
    g.u('uHurt').value = p.hurt;
    g.u('uFade').value = p.fade;
    g.u('uFlash').value = p.flash;
    if (p.flashColor) (g.u('uFlashColor').value as THREE.Color).copy(p.flashColor);
    g.u('uRot').value = p.rot;
    this.vignette.darkness = 0.66 + p.dread * 0.22 + p.hurt * 0.1;
    this.noise.blendMode.opacity.value = 0.12 + p.dread * 0.12;
    if (this.chroma) {
      const k = 1 + p.dread * 2.5 + p.hurt * 1.5;
      this.chroma.offset.set(this.baseChroma.x * k, this.baseChroma.y * k);
    }
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
