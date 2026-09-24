export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type ToneMap = 'aces' | 'agx';

/** Everything a quality preset controls. All of it can be applied at runtime. */
export interface QualityProfile {
  /** Cap on the device pixel ratio (multiplied by `resScale`). */
  maxDpr: number;
  resScale: number;
  shadowRes: number;
  /** 0 = one moon shadow map that follows the player; otherwise cascaded shadow maps. */
  cascades: number;
  shadowFar: number;
  shadowRadius: number;
  ao: 'off' | 'half' | 'full';
  aoQuality: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra';
  smaa: 0 | 1 | 2 | 3;
  bloomLevels: number;
  godRays: boolean;
  godRaySamples: number;
  chroma: boolean;
  lanternShadow: boolean;
  pointLights: number;
  envMap: boolean;
}

export const QUALITY_PROFILES: Record<Quality, QualityProfile> = {
  low: { maxDpr: 1, resScale: 0.75, shadowRes: 1024, cascades: 0, shadowFar: 0, shadowRadius: 1, ao: 'off', aoQuality: 'Performance', smaa: 0, bloomLevels: 4, godRays: false, godRaySamples: 0, chroma: false, lanternShadow: false, pointLights: 4, envMap: false },
  medium: { maxDpr: 1, resScale: 1, shadowRes: 2048, cascades: 0, shadowFar: 0, shadowRadius: 2, ao: 'half', aoQuality: 'Low', smaa: 1, bloomLevels: 5, godRays: false, godRaySamples: 0, chroma: true, lanternShadow: false, pointLights: 6, envMap: true },
  high: { maxDpr: 1.5, resScale: 1, shadowRes: 2048, cascades: 3, shadowFar: 70, shadowRadius: 3, ao: 'half', aoQuality: 'Medium', smaa: 2, bloomLevels: 6, godRays: true, godRaySamples: 40, chroma: true, lanternShadow: true, pointLights: 8, envMap: true },
  ultra: { maxDpr: 2, resScale: 1, shadowRes: 2048, cascades: 4, shadowFar: 110, shadowRadius: 4, ao: 'full', aoQuality: 'High', smaa: 3, bloomLevels: 7, godRays: true, godRaySamples: 60, chroma: true, lanternShadow: true, pointLights: 10, envMap: true },
};

export const MAX_POINT_LIGHTS = 10;


export interface Settings {
  mouseSensitivity: number;
  padSensitivity: number;
  invertY: boolean;
  masterVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  quality: Quality;
  toneMapping: ToneMap;
  fov: number;
}

const KEY = 'mournlight.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  mouseSensitivity: 1,
  padSensitivity: 1,
  invertY: false,
  masterVolume: 0.8,
  sfxVolume: 0.9,
  ambienceVolume: 0.75,
  quality: 'medium',
  toneMapping: 'aces',
  fov: 62,
};

type Listener = (s: Settings) => void;

class SettingsStore {
  readonly value: Settings;
  private listeners = new Set<Listener>();

  constructor() {
    this.value = { ...DEFAULT_SETTINGS };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.value, JSON.parse(raw));
      if (!(this.value.quality in QUALITY_PROFILES)) this.value.quality = DEFAULT_SETTINGS.quality;
    } catch {
      /* storage unavailable: keep defaults */
    }
  }

  set<K extends keyof Settings>(key: K, v: Settings[K]): void {
    this.value[key] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* ignore */
    }
    for (const l of this.listeners) l(this.value);
  }

  onChange(fn: Listener): void {
    this.listeners.add(fn);
  }
}

export const settings = new SettingsStore();
