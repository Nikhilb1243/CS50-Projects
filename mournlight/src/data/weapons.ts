import { ATTACKS, type AttackDef, type HitboxSpec } from './attacks';

/**
 * The Revenant's armaments. Each weapon has its own light chain, heavy,
 * stats, trail colour and ultimate. Attack timings follow attacks.ts
 * (frames at 60 fps).
 */
export type WeaponId = 'longsword' | 'greatsword' | 'daggers' | 'bow';
export type UltimateId = 'crescent' | 'rift' | 'hushstep' | 'deluge';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  desc: string;
  light: string;
  heavy: string;
  /** Shown in the inventory (0..5). */
  stats: { damage: number; speed: number; stagger: number; reach: number };
  bleed: number;
  trail: number;
  trailIntensity: number;
  impact: number;
  hitstop: number;
  ultimate: UltimateId;
  ultimateName: string;
  ultimateDesc: string;
}

const W = (names: string[], radius: number): HitboxSpec => ({ kind: 'striker', names, radius });

export const WEAPON_ATTACKS: Record<string, AttackDef> = {
  // ---------------------------------------------------------- Greatsword
  gs_light1: {
    id: 'gs_light1', windup: 19, active: 9, recovery: 30, damage: 78, poiseDamage: 60, stamina: 26,
    hitbox: W(['weapon'], 0.16), poses: { windup: 'slashR_wind', strike: 'slashR_hit' },
    lunge: { from: 12, to: 26, speed: 2.4 }, track: 4, hyperArmor: 30, comboWindow: [2, 22], next: 'gs_light2', cancelFrame: 42, sound: 'swing_heavy',
  },
  gs_light2: {
    id: 'gs_light2', windup: 22, active: 9, recovery: 34, damage: 92, poiseDamage: 72, stamina: 28,
    hitbox: W(['weapon'], 0.16), poses: { windup: 'overhead_wind', strike: 'overhead_hit' },
    lunge: { from: 14, to: 28, speed: 2.8 }, track: 3.5, hyperArmor: 30, comboWindow: [2, 22], next: 'gs_light1', cancelFrame: 46, sound: 'swing_heavy',
  },
  gs_heavy: {
    id: 'gs_heavy', windup: 34, active: 10, recovery: 42, damage: 150, poiseDamage: 115, stamina: 40,
    hitbox: W(['weapon'], 0.18), poses: { windup: 'heavy_wind', strike: 'heavy_hit' },
    lunge: { from: 28, to: 42, speed: 3.6 }, track: 3, hyperArmor: 70, cancelFrame: 60, sound: 'swing_heavy',
  },
  // ---------------------------------------------------------- Twin daggers
  dg_light1: {
    id: 'dg_light1', windup: 6, active: 5, recovery: 13, damage: 17, poiseDamage: 7, stamina: 8,
    hitbox: W(['weapon'], 0.1), poses: { windup: 'slashR_wind', strike: 'slashR_hit' },
    lunge: { from: 2, to: 10, speed: 3.2 }, track: 8, comboWindow: [0, 12], next: 'dg_light2', cancelFrame: 12, sound: 'swing',
  },
  dg_light2: {
    id: 'dg_light2', windup: 5, active: 5, recovery: 13, damage: 17, poiseDamage: 7, stamina: 8,
    hitbox: W(['weaponL'], 0.1), poses: { windup: 'slashL_wind', strike: 'slashL_hit' },
    lunge: { from: 2, to: 10, speed: 3.2 }, track: 8, comboWindow: [0, 12], next: 'dg_light3', cancelFrame: 12, sound: 'swing',
  },
  dg_light3: {
    id: 'dg_light3', windup: 7, active: 5, recovery: 14, damage: 20, poiseDamage: 9, stamina: 9,
    hitbox: W(['weapon'], 0.11), poses: { windup: 'thrust_wind', strike: 'thrust_hit' },
    lunge: { from: 3, to: 12, speed: 4 }, track: 8, comboWindow: [0, 12], next: 'dg_light4', cancelFrame: 13, sound: 'swing',
  },
  dg_light4: {
    id: 'dg_light4', windup: 9, active: 6, recovery: 18, damage: 26, poiseDamage: 12, stamina: 10,
    hitbox: W(['weapon', 'weaponL'], 0.11), poses: { windup: 'overhead_wind', strike: 'overhead_hit' },
    lunge: { from: 4, to: 14, speed: 4.2 }, track: 7, comboWindow: [0, 14], next: 'dg_light1', cancelFrame: 16, sound: 'swing',
  },
  dg_heavy: {
    id: 'dg_heavy', windup: 14, active: 7, recovery: 22, damage: 46, poiseDamage: 20, stamina: 20,
    hitbox: W(['weapon', 'weaponL'], 0.12), poses: { windup: 'thrust_wind', strike: 'thrust_hit' },
    lunge: { from: 8, to: 20, speed: 7 }, track: 6, cancelFrame: 26, sound: 'swing',
  },
  // ---------------------------------------------------------- Bow (bash)
  bw_bash: {
    id: 'bw_bash', windup: 9, active: 6, recovery: 20, damage: 22, poiseDamage: 18, stamina: 12,
    hitbox: W(['weapon'], 0.14), poses: { windup: 'slashL_wind', strike: 'slashL_hit' },
    lunge: { from: 3, to: 12, speed: 2.4 }, track: 6, cancelFrame: 22, sound: 'swing',
  },
};
Object.assign(ATTACKS, WEAPON_ATTACKS);

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  longsword: {
    id: 'longsword',
    name: 'Wickblade',
    desc: 'A straight blade quenched in tallow. Balanced; its three-cut chain ends in an overhead blow.',
    light: 'p_light1',
    heavy: 'p_heavy',
    stats: { damage: 3, speed: 3, stagger: 3, reach: 3 },
    bleed: 0,
    trail: 0xffa050,
    trailIntensity: 1.1,
    impact: 0xffc070,
    hitstop: 1,
    ultimate: 'crescent',
    ultimateName: 'Pale Crescent',
    ultimateDesc: 'Loose a travelling crescent of spectral blue fire.',
  },
  greatsword: {
    id: 'greatsword',
    name: 'Coffin-Lid Slab',
    desc: 'A slab of grave iron once used to seal the ossuary vaults. Slow, but every blow staggers.',
    light: 'gs_light1',
    heavy: 'gs_heavy',
    stats: { damage: 5, speed: 1, stagger: 5, reach: 4 },
    bleed: 0,
    trail: 0xff7040,
    trailIntensity: 1.3,
    impact: 0xffa060,
    hitstop: 1.6,
    ultimate: 'rift',
    ultimateName: 'Gravebreak',
    ultimateDesc: 'Slam the slab down and split the earth; flame erupts along the fissure.',
  },
  daggers: {
    id: 'daggers',
    name: 'Hush and Lull',
    desc: 'Twin needles of the silent sisters. Quick cuts that open veins: repeated hits build bleeding.',
    light: 'dg_light1',
    heavy: 'dg_heavy',
    stats: { damage: 1, speed: 5, stagger: 1, reach: 1 },
    bleed: 24,
    trail: 0x9fd0ff,
    trailIntensity: 0.9,
    impact: 0xd0e8ff,
    hitstop: 0.6,
    ultimate: 'hushstep',
    ultimateName: 'Hushstep',
    ultimateDesc: 'Blink through nearby foes, leaving cuts of cold blue light.',
  },
  bow: {
    id: 'bow',
    name: 'Gloamstring',
    desc: 'An ashwood bow strung with a mourner\'s braid. Hold to draw, release to loose; aim for the head.',
    light: 'bw_bash',
    heavy: 'bw_bash',
    stats: { damage: 3, speed: 2, stagger: 1, reach: 5 },
    bleed: 0,
    trail: 0xc8b090,
    trailIntensity: 0.6,
    impact: 0xffd090,
    hitstop: 0.8,
    ultimate: 'deluge',
    ultimateName: 'Pale Deluge',
    ultimateDesc: 'Loose an arrow into the sky; blue-flame arrows rain on the marked circle and the ground burns.',
  },
};

export const WEAPON_ORDER: WeaponId[] = ['longsword', 'greatsword', 'daggers', 'bow'];

export const BOW = {
  drawTime: 0.75,
  minDraw: 0.25,
  speed: [22, 52] as [number, number],
  damage: [26, 64] as [number, number],
  gravity: 9.8,
  headshot: 1.8,
  maxArrows: 30,
};

export const ULT_MAX = 100;
export const ULT_GAIN = { dealt: 0.14, taken: 0.35, parry: 14 };
