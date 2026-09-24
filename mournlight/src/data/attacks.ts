/**
 * Attack definitions. All timings are in frames at 60 fps:
 *  windup   - telegraph, no damage
 *  active   - the striker sweeps from the windup pose to the strike pose and
 *             can hit (swept capsule test every simulation step)
 *  recovery - vulnerable follow-through
 */
export type HitboxSpec =
  | { kind: 'striker'; names: string[]; radius: number }
  | { kind: 'sphere'; offset: [number, number, number]; radius: number };

export type HazardKind = 'shockwave' | 'burst' | 'flamewave';

export interface AttackDef {
  id: string;
  windup: number;
  active: number;
  recovery: number;
  damage: number;
  poiseDamage: number;
  stamina?: number;
  hitbox: HitboxSpec;
  poses: { windup: string; strike: string };
  /** Forward movement (m/s) applied between frames [from, to). */
  lunge?: { from: number; to: number; speed: number };
  /** Turn rate (rad/s) toward target during windup. */
  track?: number;
  /** Extra poise while winding up / striking. */
  hyperArmor?: number;
  parryable?: boolean;
  unblockable?: boolean;
  knockback?: number;
  /** Delayed swing: fraction of pose over-extension while holding. */
  holdCreep?: number;
  grab?: boolean;
  hazard?: { kind: HazardKind; frame: number; damage: number; radius?: number; offset?: [number, number, number] };
  sound?: string;
  voice?: string;
  /** Player combos: frames of recovery during which the next input chains. */
  comboWindow?: [number, number];
  next?: string;
  /** Player: frame (from start) after which a roll cancels the recovery. */
  cancelFrame?: number;
  /** Enemy combos: attack that may follow, and chance. */
  chain?: { id: string; chance: number };
}

const W = (names: string[], radius: number): HitboxSpec => ({ kind: 'striker', names, radius });

export const ATTACKS: Record<string, AttackDef> = {
  // ---------------------------------------------------------------- Revenant
  p_light1: {
    id: 'p_light1', windup: 11, active: 7, recovery: 22, damage: 42, poiseDamage: 22, stamina: 16,
    hitbox: W(['weapon'], 0.12), poses: { windup: 'slashR_wind', strike: 'slashR_hit' },
    lunge: { from: 6, to: 18, speed: 2.6 }, track: 6, comboWindow: [0, 20], next: 'p_light2', cancelFrame: 24, sound: 'swing',
  },
  p_light2: {
    id: 'p_light2', windup: 10, active: 7, recovery: 22, damage: 44, poiseDamage: 22, stamina: 16,
    hitbox: W(['weapon'], 0.12), poses: { windup: 'slashL_wind', strike: 'slashL_hit' },
    lunge: { from: 5, to: 17, speed: 2.8 }, track: 6, comboWindow: [0, 20], next: 'p_light3', cancelFrame: 23, sound: 'swing',
  },
  p_light3: {
    id: 'p_light3', windup: 16, active: 8, recovery: 30, damage: 62, poiseDamage: 38, stamina: 22,
    hitbox: W(['weapon'], 0.13), poses: { windup: 'overhead_wind', strike: 'overhead_hit' },
    lunge: { from: 10, to: 24, speed: 3.2 }, track: 5, comboWindow: [2, 24], next: 'p_light1', cancelFrame: 32, sound: 'swing_heavy',
  },
  p_heavy: {
    id: 'p_heavy', windup: 26, active: 9, recovery: 36, damage: 92, poiseDamage: 65, stamina: 32,
    hitbox: W(['weapon'], 0.15), poses: { windup: 'heavy_wind', strike: 'heavy_hit' },
    lunge: { from: 22, to: 36, speed: 4.2 }, track: 4, hyperArmor: 40, cancelFrame: 48, sound: 'swing_heavy',
  },
  p_riposte: {
    id: 'p_riposte', windup: 22, active: 6, recovery: 40, damage: 150, poiseDamage: 100,
    hitbox: W(['weapon'], 0.2), poses: { windup: 'thrust_wind', strike: 'thrust_hit' }, sound: 'swing_heavy',
  },

  // ---------------------------------------------------------------- Shambler
  sh_swipe: {
    id: 'sh_swipe', windup: 32, active: 10, recovery: 40, damage: 38, poiseDamage: 30,
    hitbox: W(['clawR'], 0.24), poses: { windup: 'sh_swipe_wind', strike: 'sh_swipe_hit' },
    lunge: { from: 28, to: 42, speed: 2.4 }, track: 3.2, sound: 'swing_heavy', voice: 'shambler_attack',
  },
  sh_grab: {
    id: 'sh_grab', windup: 42, active: 12, recovery: 56, damage: 0, poiseDamage: 0,
    hitbox: W(['clawR', 'clawL'], 0.3), poses: { windup: 'sh_grab_wind', strike: 'sh_grab_hit' },
    lunge: { from: 38, to: 54, speed: 3.6 }, track: 2.6, grab: true, parryable: false, unblockable: true, voice: 'shambler_attack',
  },

  // ---------------------------------------------------------------- Stalker
  st_rake: {
    id: 'st_rake', windup: 14, active: 6, recovery: 16, damage: 26, poiseDamage: 18,
    hitbox: W(['clawR', 'clawL'], 0.2), poses: { windup: 'st_rake_wind', strike: 'st_rake_hit' },
    lunge: { from: 10, to: 20, speed: 4 }, track: 8, sound: 'swing', chain: { id: 'st_rake2', chance: 0.7 },
  },
  st_rake2: {
    id: 'st_rake2', windup: 8, active: 6, recovery: 28, damage: 26, poiseDamage: 18,
    hitbox: W(['clawR', 'clawL'], 0.2), poses: { windup: 'st_rake_wind', strike: 'st_rake_hit' },
    lunge: { from: 4, to: 14, speed: 4 }, track: 8, sound: 'swing',
  },
  st_lunge: {
    id: 'st_lunge', windup: 24, active: 10, recovery: 34, damage: 42, poiseDamage: 30,
    hitbox: W(['clawR', 'clawL'], 0.24), poses: { windup: 'st_lunge_wind', strike: 'st_lunge_hit' },
    lunge: { from: 22, to: 34, speed: 10 }, track: 5, sound: 'swing', voice: 'stalker_shriek',
  },

  // ---------------------------------------------------------------- Crawler
  cr_pounce: {
    id: 'cr_pounce', windup: 26, active: 14, recovery: 32, damage: 36, poiseDamage: 26,
    hitbox: W(['clawR', 'clawL', 'jaw'], 0.3), poses: { windup: 'cr_pounce_wind', strike: 'cr_pounce_hit' },
    lunge: { from: 24, to: 40, speed: 9 }, track: 4, voice: 'crawler_screech',
  },
  cr_bite: {
    id: 'cr_bite', windup: 12, active: 6, recovery: 24, damage: 22, poiseDamage: 14,
    hitbox: W(['jaw', 'clawR'], 0.26), poses: { windup: 'cr_bite_wind', strike: 'cr_bite_hit' },
    lunge: { from: 10, to: 18, speed: 3 }, track: 8, sound: 'bite',
  },

  // ---------------------------------------------------------------- Drowned Knight
  kn_sweep: {
    id: 'kn_sweep', windup: 26, active: 9, recovery: 30, damage: 58, poiseDamage: 45,
    hitbox: W(['weapon'], 0.16), poses: { windup: 'kn_sweep_wind', strike: 'kn_sweep_hit' },
    lunge: { from: 20, to: 34, speed: 3 }, track: 3.5, hyperArmor: 60, sound: 'swing_heavy', voice: 'knight_growl',
    chain: { id: 'kn_back', chance: 0.65 },
  },
  kn_back: {
    id: 'kn_back', windup: 14, active: 9, recovery: 34, damage: 58, poiseDamage: 45,
    hitbox: W(['weapon'], 0.16), poses: { windup: 'kn_sweep_hit', strike: 'kn_back_hit' },
    lunge: { from: 8, to: 22, speed: 3 }, track: 3, hyperArmor: 60, sound: 'swing_heavy',
    chain: { id: 'kn_overhead', chance: 0.45 },
  },
  kn_overhead: {
    id: 'kn_overhead', windup: 64, active: 8, recovery: 42, damage: 82, poiseDamage: 70,
    hitbox: W(['weapon'], 0.17), poses: { windup: 'kn_overhead_wind', strike: 'kn_overhead_hit' },
    lunge: { from: 58, to: 72, speed: 4 }, track: 2.5, hyperArmor: 80, holdCreep: 0.18, sound: 'swing_heavy', voice: 'knight_growl',
  },
  kn_thrust: {
    id: 'kn_thrust', windup: 30, active: 8, recovery: 34, damage: 56, poiseDamage: 40,
    hitbox: W(['weapon'], 0.15), poses: { windup: 'thrust_wind', strike: 'thrust_hit' },
    lunge: { from: 26, to: 38, speed: 6.5 }, track: 4, hyperArmor: 50, sound: 'swing',
  },

  // ---------------------------------------------------------------- The Wick-Mother
  bo_sweep: {
    id: 'bo_sweep', windup: 34, active: 12, recovery: 40, damage: 70, poiseDamage: 60,
    hitbox: W(['weapon'], 0.55), poses: { windup: 'bo_sweep_wind', strike: 'bo_sweep_hit' },
    track: 2.2, hyperArmor: 200, sound: 'swing_heavy', chain: { id: 'bo_slam', chance: 0.35 },
  },
  bo_slam: {
    id: 'bo_slam', windup: 46, active: 10, recovery: 50, damage: 92, poiseDamage: 80,
    hitbox: W(['weapon'], 0.6), poses: { windup: 'bo_slam_wind', strike: 'bo_slam_hit' },
    lunge: { from: 40, to: 52, speed: 3 }, track: 2, hyperArmor: 200, sound: 'swing_heavy',
    hazard: { kind: 'shockwave', frame: 54, damage: 40, offset: [0, 0, 5.5] },
  },
  bo_thrust: {
    id: 'bo_thrust', windup: 30, active: 10, recovery: 40, damage: 66, poiseDamage: 55,
    hitbox: W(['weapon'], 0.5), poses: { windup: 'thrust_wind', strike: 'thrust_hit' },
    lunge: { from: 26, to: 40, speed: 9 }, track: 3, hyperArmor: 200, sound: 'swing_heavy',
  },
  bo_stomp: {
    id: 'bo_stomp', windup: 26, active: 8, recovery: 30, damage: 44, poiseDamage: 60,
    hitbox: { kind: 'sphere', offset: [-0.8, 0.6, 1.2], radius: 3.2 }, poses: { windup: 'bo_stomp_wind', strike: 'bo_stomp_hit' },
    hyperArmor: 200, sound: 'shockwave', unblockable: false,
  },
  bo_rend: {
    id: 'bo_rend', windup: 22, active: 8, recovery: 14, damage: 56, poiseDamage: 50,
    hitbox: W(['clawR'], 0.6), poses: { windup: 'bo_rend_wind', strike: 'bo_rend_hit' },
    lunge: { from: 16, to: 30, speed: 5 }, track: 4, hyperArmor: 200, sound: 'swing_heavy',
    chain: { id: 'bo_rend2', chance: 0.85 },
  },
  bo_rend2: {
    id: 'bo_rend2', windup: 12, active: 8, recovery: 38, damage: 56, poiseDamage: 50,
    hitbox: W(['clawL'], 0.6), poses: { windup: 'bo_rend2_wind', strike: 'bo_rend2_hit' },
    lunge: { from: 6, to: 20, speed: 5 }, track: 4, hyperArmor: 200, sound: 'swing_heavy',
    chain: { id: 'bo_rend', chance: 0.25 },
  },
  bo_leap: {
    id: 'bo_leap', windup: 34, active: 16, recovery: 52, damage: 90, poiseDamage: 90,
    hitbox: { kind: 'sphere', offset: [0, 1, 2], radius: 3.6 }, poses: { windup: 'bo_leap_wind', strike: 'bo_leap_hit' },
    track: 6, hyperArmor: 300, unblockable: true, parryable: false, voice: 'boss_roar',
    hazard: { kind: 'shockwave', frame: 50, damage: 45, offset: [0, 0, 2] },
  },
  bo_burst: {
    id: 'bo_burst', windup: 62, active: 10, recovery: 52, damage: 0, poiseDamage: 0,
    hitbox: { kind: 'sphere', offset: [0, 3, 0], radius: 0.1 }, poses: { windup: 'bo_burst_wind', strike: 'bo_burst_hit' },
    hyperArmor: 400, unblockable: true, parryable: false, voice: 'boss_scream',
    hazard: { kind: 'burst', frame: 62, damage: 95, radius: 7.5 },
  },
  bo_wave: {
    id: 'bo_wave', windup: 34, active: 12, recovery: 46, damage: 40, poiseDamage: 40,
    hitbox: W(['clawR'], 0.6), poses: { windup: 'bo_wave_wind', strike: 'bo_wave_hit' },
    track: 3, hyperArmor: 200, sound: 'flame_burst',
    hazard: { kind: 'flamewave', frame: 40, damage: 48 },
  },
};

export function attack(id: string): AttackDef {
  const a = ATTACKS[id];
  if (!a) throw new Error(`Unknown attack ${id}`);
  return a;
}

export function attackLength(a: AttackDef): number {
  return a.windup + a.active + a.recovery;
}
