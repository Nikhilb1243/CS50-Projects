import * as THREE from 'three';
import {
  AdaptiveLuminancePass,
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  Effect,
  EffectComposer,
  EffectPass,
  GodRaysEffect,
  LuminancePass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { QualityProfile, ToneMap } from '../core/settings';
import { LUT_SIZE } from './lut';

const GRADE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uWarp;
uniform float uSat;
uniform float uHurt;
uniform float uFade;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uRot;
uniform sampler3D uLutA;
uniform sampler3D uLutB;
uniform float uLutMix;
uniform float uLutAmt;
uniform float uLift;

vec3 lutLookup(sampler3D lut, vec3 c) {
  const float S = float(LUT_SIZE);
  return texture(lut, clamp(c, 0.0, 1.0) * ((S - 1.0) / S) + 0.5 / S).rgb;
}

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
  col += vec3(0.003, 0.005, 0.009) * uLift * (1.0 - smoothstep(0.0, 0.2, lum));
  // Sickly rot tint (boss phase two)
  col = mix(col, col * vec3(1.15, 0.8, 0.7), uRot * 0.5);
  // Region LUT, sampled in gamma space and cross-faded between regions
  vec3 gc = pow(max(col, 0.0), vec3(1.0 / 2.2));
  vec3 graded = mix(lutLookup(uLutA, gc), lutLookup(uLutB, gc), uLutMix);
  col = mix(col, pow(graded, vec3(2.2)), uLutAmt);
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
        ['uLift', new THREE.Uniform(1)],
        ['uHurt', new THREE.Uniform(0)],
        ['uFade', new THREE.Uniform(0)],
        ['uFlash', new THREE.Uniform(0)],
        ['uFlashColor', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['uRot', new THREE.Uniform(0)],
        ['uLutA', new THREE.Uniform(null)],
        ['uLutB', new THREE.Uniform(null)],
        ['uLutMix', new THREE.Uniform(0)],
        ['uLutAmt', new THREE.Uniform(1)],
      ]),
      defines: new Map([['LUT_SIZE', String(LUT_SIZE)]]),
    });
  }
  u(name: string): THREE.Uniform {
    return this.uniforms.get(name)!;
  }
}

/** log2 luminance range stored by the luminance pass: 2^-LOG_MIN .. 2^(LOG_RANGE-LOG_MIN). */
const LOG_MIN = 17;
const LOG_RANGE = 20;

/**
 * Writes remapped log2 luminance. Averaging it down the mip chain gives the geometric mean, so a
 * lantern flame or a moonlit patch no longer drags the whole frame's exposure down.
 */
class LogLuminanceMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      name: 'LogLuminanceMaterial',
      uniforms: { inputBuffer: new THREE.Uniform(null) },
      vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }',
      fragmentShader: `uniform sampler2D inputBuffer; varying vec2 vUv;
void main() {
  float l = dot(texture2D(inputBuffer, vUv).rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(clamp((log2(max(l, 1e-6)) + ${LOG_MIN.toFixed(1)}) / ${LOG_RANGE.toFixed(1)}, 0.0, 1.0));
}`,
      depthWrite: false,
      depthTest: false,
    });
  }
  set inputBuffer(t: THREE.Texture | null) {
    this.uniforms.inputBuffer.value = t;
  }
}

const EXPOSURE_FRAG = /* glsl */ `
uniform sampler2D uLum;
// same as three's unpackRGBAToDepth; <packing> may already be included by other effects in the pass
float mlUnpackLum(vec4 v) { return dot(v, vec4(255.0 / 256.0, 255.0 / 65536.0, 255.0 / 16777216.0, 1.0 / 16777216.0)); }
uniform float uKey;
uniform float uMinExp;
uniform float uMaxExp;
uniform float uBias;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // the adapted value is the mean log2 luminance, remapped to 0..1 and packed into RGBA8
  float l = exp2(mlUnpackLum(texture2D(uLum, vec2(0.5))) * LOG_RANGE - LOG_MIN);
  // partial adaptation: dark places open up enough to read, but never look like daylight
  float e = clamp(pow(uKey / max(l, 1e-6), 0.7), uMinExp, uMaxExp) * uBias;
  outputColor = vec4(inputColor.rgb * e, inputColor.a);
}`;

/**
 * Eye adaptation. The HDR frame is reduced to its average luminance (a 64x64
 * mip chain), which is smoothed over time on the GPU; the exposure multiplier
 * is derived from it in the shader, so nothing is read back to the CPU.
 */
class ExposureEffect extends Effect {
  private lumPass: LuminancePass;
  private adaptPass: AdaptiveLuminancePass;

  constructor() {
    super('ExposureEffect', EXPOSURE_FRAG, {
      defines: new Map([['LOG_MIN', LOG_MIN.toFixed(1)], ['LOG_RANGE', LOG_RANGE.toFixed(1)]]),
      uniforms: new Map<string, THREE.Uniform>([
        ['uLum', new THREE.Uniform(null)],
        ['uKey', new THREE.Uniform(0.04)],
        ['uMinExp', new THREE.Uniform(0.6)],
        ['uMaxExp', new THREE.Uniform(4)],
        ['uBias', new THREE.Uniform(1)],
      ]),
    });
    const rt = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearMipmapLinearFilter, depthBuffer: false, type: THREE.HalfFloatType });
    rt.texture.generateMipmaps = true;
    this.lumPass = new LuminancePass({ renderTarget: rt });
    this.lumPass.fullscreenMaterial = new LogLuminanceMaterial();
    this.lumPass.resolution.setPreferredSize(64, 64);
    this.adaptPass = new AdaptiveLuminancePass(this.lumPass.texture, { minLuminance: 0.0005, adaptationRate: 1.1 });
    (this.adaptPass.fullscreenMaterial as unknown as { mipLevel1x1: number }).mipLevel1x1 = 6;
    this.uniforms.get('uLum')!.value = this.adaptPass.texture;
  }

  set bias(v: number) {
    this.uniforms.get('uBias')!.value = v;
  }

  override initialize(renderer: THREE.WebGLRenderer, alpha: boolean, frameBufferType: number): void {
    this.lumPass.initialize(renderer, alpha, THREE.HalfFloatType);
    this.lumPass.setSize(64, 64);
    void frameBufferType;
  }

  override update(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, deltaTime?: number): void {
    this.lumPass.render(renderer, inputBuffer, null);
    this.adaptPass.render(renderer, null, null, deltaTime ?? 1 / 60);
  }

  /** Debug: read back the adapted scene luminance (stalls the GPU, do not call every frame). */
  readLuminance(renderer: THREE.WebGLRenderer): number {
    const rt = (this.adaptPass as unknown as { renderTargetAdapted: THREE.WebGLRenderTarget }).renderTargetAdapted;
    const b = new Uint8Array(4);
    renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, b);
    const d = 255 / 256 / 255;
    const v = b[0] * d + (b[1] * d) / 256 + (b[2] * d) / 65536 + b[3] / 255 / 16777216;
    return Math.pow(2, v * LOG_RANGE - LOG_MIN);
  }

  override dispose(): void {
    super.dispose();
    this.lumPass.dispose();
    this.adaptPass.dispose();
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
  /** 0..1 moon visibility, drives the god rays. */
  moon: number;
  camPos: THREE.Vector3;
  moonDir: THREE.Vector3;
  /** Multiplier on the auto-exposure result (region mood). */
  exposureBias: number;
  /** Region grade (data/lighting.ts): saturation and how much blue is lifted into the blacks. */
  saturation: number;
  lift: number;
}

const SMAA_PRESETS = [SMAAPreset.LOW, SMAAPreset.MEDIUM, SMAAPreset.HIGH, SMAAPreset.ULTRA];

/**
 * pmndrs/postprocessing chain (half-float HDR until tone mapping):
 *   render -> N8AO ambient occlusion -> auto-exposure -> moon god rays ->
 *   bloom -> ACES/AgX tone map -> grade (region LUT, dread warp, hurt) ->
 *   vignette -> SMAA -> chromatic aberration + film grain
 * The whole chain is rebuilt when the quality preset changes.
 */
export class PostFX {
  readonly composer: EffectComposer;
  private grade: GradeEffect;
  private chroma: ChromaticAberrationEffect | null = null;
  private vignette: VignetteEffect;
  private noise: NoiseEffect;
  private bloom: BloomEffect;
  private tone: ToneMappingEffect;
  private exposure: ExposureEffect;
  private godRays: GodRaysEffect | null = null;
  private moonMesh: THREE.Mesh;
  private baseChroma = new THREE.Vector2(0.0007, 0.0005);
  private lutFrom: THREE.Data3DTexture | null = null;
  private lutTo: THREE.Data3DTexture | null = null;
  private lutT = 1;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, q: QualityProfile, toneMap: ToneMap) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));
    if (q.ao !== 'off') {
      const ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
      ao.configuration.aoRadius = 1.6;
      ao.configuration.distanceFalloff = 0.8;
      ao.configuration.intensity = 2.2;
      ao.configuration.color = new THREE.Color(0, 0, 0);
      ao.configuration.gammaCorrection = false;
      ao.configuration.halfRes = q.ao === 'half';
      ao.configuration.depthAwareUpsampling = true;
      ao.setQualityMode(q.aoQuality);
      this.composer.addPass(ao);
    }
    this.exposure = new ExposureEffect();
    this.moonMesh = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 8), new THREE.MeshBasicMaterial({ color: 0x6f7f9c, fog: false }));
    if (q.godRays) {
      this.godRays = new GodRaysEffect(camera, this.moonMesh, {
        blendFunction: BlendFunction.ADD,
        samples: q.godRaySamples,
        density: 0.94,
        decay: 0.93,
        weight: 0.35,
        exposure: 0.42,
        clampMax: 0.9,
        resolutionScale: 0.5,
      });
    }
    this.bloom = new BloomEffect({
      luminanceThreshold: 0.72,
      luminanceSmoothing: 0.18,
      intensity: 1.25,
      mipmapBlur: true,
      radius: 0.7,
      levels: q.bloomLevels,
    });
    if (q.bloomLevels <= 4) this.bloom.resolution.scale = 0.5;
    this.tone = new ToneMappingEffect({ mode: toneMap === 'agx' ? ToneMappingMode.AGX : ToneMappingMode.ACES_FILMIC });
    this.grade = new GradeEffect();
    this.vignette = new VignetteEffect({ darkness: 0.68, offset: 0.28 });
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.noise.blendMode.opacity.value = 0.14;
    const main: Effect[] = [this.exposure];
    if (this.godRays) main.push(this.godRays);
    main.push(this.bloom, this.tone, this.grade, this.vignette);
    this.composer.addPass(new EffectPass(camera, ...main));
    if (q.smaa > 0) this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAA_PRESETS[q.smaa] })));
    if (q.chroma) {
      this.chroma = new ChromaticAberrationEffect({ offset: this.baseChroma.clone(), radialModulation: true, modulationOffset: 0.25 });
      this.composer.addPass(new EffectPass(camera, this.chroma, this.noise));
    } else this.composer.addPass(new EffectPass(camera, this.noise));
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  setToneMapping(t: ToneMap): void {
    this.tone.mode = t === 'agx' ? ToneMappingMode.AGX : ToneMappingMode.ACES_FILMIC;
  }

  /** Cross-fade to a region's grading LUT. */
  setLut(lut: THREE.Data3DTexture, instant = false): void {
    if (lut === this.lutTo) return;
    this.lutFrom = instant || !this.lutTo ? lut : this.lutTo;
    this.lutTo = lut;
    this.lutT = instant ? 1 : 0;
    this.grade.u('uLutA').value = this.lutFrom;
    this.grade.u('uLutB').value = this.lutTo;
  }

  update(p: PostParams, dt = 1 / 60): void {
    const g = this.grade;
    g.u('uTime').value = p.time;
    g.u('uWarp').value = Math.max(0, (p.dread - 0.55) / 0.45);
    g.u('uSat').value = p.saturation - p.dread * 0.2;
    g.u('uLift').value = p.lift;
    g.u('uHurt').value = p.hurt;
    g.u('uFade').value = p.fade;
    g.u('uFlash').value = p.flash;
    if (p.flashColor) (g.u('uFlashColor').value as THREE.Color).copy(p.flashColor);
    g.u('uRot').value = p.rot;
    this.lutT = Math.min(1, this.lutT + dt / 2.5);
    g.u('uLutMix').value = this.lutT * this.lutT * (3 - 2 * this.lutT);
    this.vignette.darkness = 0.52 + p.dread * 0.3 + p.hurt * 0.1;
    this.noise.blendMode.opacity.value = 0.12 + p.dread * 0.12;
    this.exposure.bias = p.exposureBias;
    if (this.chroma) {
      const k = 1 + p.dread * 2.5 + p.hurt * 1.5;
      this.chroma.offset.set(this.baseChroma.x * k, this.baseChroma.y * k);
    }
    if (this.godRays) {
      this.moonMesh.position.copy(p.camPos).addScaledVector(p.moonDir, 150);
      this.godRays.godRaysMaterial.weight = 0.35 * p.moon;
      this.godRays.blendMode.opacity.value = p.moon;
    }
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  debugLuminance(): number {
    return this.exposure.readLuminance(this.composer.getRenderer());
  }

  dispose(): void {
    this.composer.dispose();
    this.moonMesh.geometry.dispose();
    (this.moonMesh.material as THREE.Material).dispose();
  }
}
