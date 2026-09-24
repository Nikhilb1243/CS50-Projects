import { OBJECTIVES } from './objectives';

/**
 * Region progression: which main objectives clear a region, what clearing it pays, the running
 * ledger shown on the "Region Cleared" screen, first-time mechanic tips and boss whispers.
 */

/** Main objectives that clear each region (the region's goal plus its boss, where it has one). */
export const REGION_CLEAR: Record<string, { goals: string[]; marrow: number }> = {
  crypt: { goals: ['m-ossuary'], marrow: 150 },
  village: { goals: ['m-brinemoor'], marrow: 400 },
  forest: { goals: ['m-gallowwood'], marrow: 600 },
  cathedral: { goals: ['m-vigil'], marrow: 800 },
  arena: { goals: ['m-wickmother'], marrow: 2000 },
  catacombs: { goals: ['m-reliquary', 'm-choir'], marrow: 2500 },
  bellspire: { goals: ['m-warden'], marrow: 3500 },
};

export interface RegionStats {
  time: number;
  deaths: number;
  kills: number;
  cleared: boolean;
}

export type LedgerSave = Record<string, RegionStats>;

export class RegionLedger {
  private stats = new Map<string, RegionStats>();

  get(id: string): RegionStats {
    let s = this.stats.get(id);
    if (!s) {
      s = { time: 0, deaths: 0, kills: 0, cleared: false };
      this.stats.set(id, s);
    }
    return s;
  }

  tick(dt: number, region: string): void {
    this.get(region).time += dt;
  }

  /** Regions whose clearing goals are all done but have not been marked cleared yet. */
  newlyCleared(done: Set<string>): string[] {
    const out: string[] = [];
    for (const [id, def] of Object.entries(REGION_CLEAR)) {
      const s = this.get(id);
      if (s.cleared || !def.goals.every((g) => done.has(g))) continue;
      s.cleared = true;
      out.push(id);
    }
    return out;
  }

  /** Optional deeds done in a region, as [found, total]. */
  secrets(region: string, done: Set<string>): [number, number] {
    const opt = OBJECTIVES.filter((o) => !o.main && o.region === region);
    return [opt.filter((o) => done.has(o.id)).length, opt.length];
  }

  serialize(): LedgerSave {
    return Object.fromEntries(this.stats);
  }

  load(s: LedgerSave | undefined): void {
    this.stats.clear();
    if (s) for (const [k, v] of Object.entries(s)) this.stats.set(k, { ...v });
  }

  /** On load: regions already cleared in the save must not replay their screen. */
  markCleared(done: Set<string>): void {
    for (const [id, def] of Object.entries(REGION_CLEAR)) if (def.goals.every((g) => done.has(g))) this.get(id).cleared = true;
  }
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

// ---------------------------------------------------------------------------
// First-time tips
// ---------------------------------------------------------------------------
export interface TipDef {
  title: string;
  kb: string;
  pad: string;
}

export const TIPS: Record<string, TipDef> = {
  foe: { title: 'Something has seen you', kb: 'Fix your gaze on it (Q), watch for the wind-up, and roll through the blow (Space).', pad: 'Fix your gaze on it (R3), watch for the wind-up, and roll through the blow (B).' },
  lantern: { title: 'The lantern thirsts', kb: 'Shutter it (F) to save oil. Darkness feeds dread and thickens the fog. Resting at a candle refills it.', pad: 'Shutter it (LT) to save oil. Darkness feeds dread and thickens the fog. Resting at a candle refills it.' },
  dread: { title: 'Dread is rising', kb: 'Flame light, rest and distance from horrors calm it. At its height the world starts to lie to you.', pad: 'Flame light, rest and distance from horrors calm it. At its height the world starts to lie to you.' },
  draught: { title: 'You are bleeding wax', kb: 'Drink a Tallow Draught (R). Draughts return whenever you rest at a candle.', pad: 'Drink a Tallow Draught (X). Draughts return whenever you rest at a candle.' },
  ult: { title: 'Your weapon is gorged', kb: 'Unleash its ultimate (V). It fills again as you deal and take blows.', pad: 'Unleash its ultimate (Back). It fills again as you deal and take blows.' },
  remnant: { title: 'Your Marrow stayed behind', kb: 'It waits where you fell. Reach it before you die again, or it is gone for good.', pad: 'It waits where you fell. Reach it before you die again, or it is gone for good.' },
  stalker: { title: 'It moves when unseen', kb: 'Keep the lantern on its face and back away. Never turn your back on it.', pad: 'Keep the lantern on its face and back away. Never turn your back on it.' },
  swap: { title: 'A second armament', kb: 'Swap weapons with X. Each has its own reach, rhythm and ultimate.', pad: 'Swap weapons with D-pad down. Each has its own reach, rhythm and ultimate.' },
};

const TIPS_KEY = 'mournlight.tips.v1';

/** Shows each tip once per browser profile, one at a time, with a gap between them. */
export class TipBook {
  private seen = new Set<string>();
  private queue: string[] = [];
  private lastAt = -1e9;

  constructor() {
    try {
      const raw = localStorage.getItem(TIPS_KEY);
      if (raw) for (const id of JSON.parse(raw) as string[]) this.seen.add(id);
    } catch {
      /* private mode: tips simply show again next visit */
    }
  }

  want(id: string): void {
    if (!this.seen.has(id) && !this.queue.includes(id)) this.queue.push(id);
  }

  /** Next tip to show now, if any (at most one every 12 s). */
  next(now: number): TipDef | null {
    if (!this.queue.length || now - this.lastAt < 12) return null;
    const id = this.queue.shift()!;
    this.seen.add(id);
    this.lastAt = now;
    try {
      localStorage.setItem(TIPS_KEY, JSON.stringify([...this.seen]));
    } catch {
      /* ignore */
    }
    return TIPS[id] ?? null;
  }
}

// ---------------------------------------------------------------------------
// Boss whispers after repeated deaths
// ---------------------------------------------------------------------------
export const BOSS_HINTS: Record<string, string> = {
  oskeline: 'She is only wax until the mask falls. Strike when she lifts the candelabrum high: the flame leaves her side bare. When her heart burns red, keep moving, because her fire lands where you stood.',
  choir: 'Break the Cantor, the head that sings highest, and the rest lose the note. When the Choir tears itself in three, find the part that still sings.',
  warden: 'Its heart glows in the cage beneath its ribs before each toll, and arrows reach where blades cannot. When the chains snap, keep the bell between you.',
};
