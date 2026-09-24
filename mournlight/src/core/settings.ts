export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  mouseSensitivity: number;
  padSensitivity: number;
  invertY: boolean;
  masterVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  quality: Quality;
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
