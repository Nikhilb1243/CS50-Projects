import type { Attributes } from '../data/stats';

export interface SaveData {
  version: 1;
  attrs: Attributes;
  marrow: number;
  draughtsMax: number;
  dmgBonus: number;
  fuelMax: number;
  shrinesLit: string[];
  lastShrine: string | null;
  doorsOpen: string[];
  itemsTaken: string[];
  bossDefeated: boolean;
  remnant: { p: [number, number, number]; amount: number } | null;
  playTime: number;
  deaths: number;
  weapons?: string[];
  weapon?: string;
  arrows?: number;
  notesRead?: string[];
  regionsVisited?: string[];
  explored?: string;
  deepBosses?: string[];
  regions?: import('../world/progression').LedgerSave;
}

const KEY = 'mournlight.save.v1';

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    return d.version === 1 ? d : null;
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable */
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
