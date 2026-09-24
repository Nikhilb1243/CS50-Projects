export type EnemyType = 'shambler' | 'stalker' | 'crawler' | 'knight' | 'boss' | 'mimic' | 'screamer' | 'moths';

export interface AttackChoice {
  id: string;
  /** Distance band in which this attack is chosen. */
  min: number;
  max: number;
  weight: number;
  cooldown?: number;
  phase?: 1 | 2;
}

export interface EnemyDef {
  type: EnemyType;
  name: string;
  model: string;
  style: string;
  health: number;
  poise: number;
  poiseRegen: number;
  radius: number;
  height: number;
  scale: number;
  walkSpeed: number;
  runSpeed: number;
  turnSpeed: number;
  sightRange: number;
  sightFov: number;
  hearing: number;
  /** Distance at which a lit lantern draws this creature. */
  lanternAttract: number;
  attacks: AttackChoice[];
  attackCooldown: [number, number];
  marrow: number;
  staggerTime: number;
  parriedTime: number;
  canBackstab: boolean;
  canRiposte: boolean;
  leash: number;
  breath: string;
  voice: string;
  step: string;
  /** Damage multiplier taken per hit type (e.g. armor). */
  armor: number;
  hitSound: string;
}

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  shambler: {
    type: 'shambler', name: 'Shambler', model: 'shambler', style: 'shambler',
    health: 210, poise: 40, poiseRegen: 12, radius: 0.42, height: 1.8, scale: 1.12,
    walkSpeed: 0.9, runSpeed: 2.1, turnSpeed: 2.6,
    sightRange: 16, sightFov: 110, hearing: 1, lanternAttract: 24,
    attacks: [
      { id: 'sh_swipe', min: 0, max: 2.3, weight: 3 },
      { id: 'sh_grab', min: 0.6, max: 2.8, weight: 1.4, cooldown: 7 },
    ],
    attackCooldown: [0.8, 2.0], marrow: 45, staggerTime: 1.1, parriedTime: 1.8,
    canBackstab: true, canRiposte: true, leash: 38,
    breath: 'breath_wet', voice: 'shambler_groan', step: 'step_drag', armor: 1, hitSound: 'hit_flesh',
  },
  stalker: {
    type: 'stalker', name: 'Stalker', model: 'stalker', style: 'stalker',
    health: 150, poise: 20, poiseRegen: 20, radius: 0.34, height: 2.35, scale: 1,
    walkSpeed: 2.0, runSpeed: 7.4, turnSpeed: 7,
    sightRange: 30, sightFov: 160, hearing: 1.4, lanternAttract: 34,
    attacks: [
      { id: 'st_rake', min: 0, max: 2.4, weight: 3 },
      { id: 'st_lunge', min: 2.6, max: 6.5, weight: 2, cooldown: 4 },
    ],
    attackCooldown: [0.5, 1.4], marrow: 70, staggerTime: 0.8, parriedTime: 1.6,
    canBackstab: true, canRiposte: true, leash: 60,
    breath: 'breath_thin', voice: 'stalker_creak', step: 'step_light', armor: 1, hitSound: 'hit_flesh',
  },
  // Corpse-mimic: lies among the dead, rises when you step close.
  mimic: {
    type: 'mimic', name: 'Corpse-Mimic', model: 'shambler', style: 'shambler',
    health: 170, poise: 30, poiseRegen: 14, radius: 0.4, height: 1.8, scale: 1.0,
    walkSpeed: 1.4, runSpeed: 4.6, turnSpeed: 5,
    sightRange: 14, sightFov: 140, hearing: 0.6, lanternAttract: 0,
    attacks: [
      { id: 'sh_swipe', min: 0, max: 2.3, weight: 3 },
      { id: 'sh_grab', min: 0.4, max: 2.8, weight: 2, cooldown: 5 },
    ],
    attackCooldown: [0.4, 1.2], marrow: 80, staggerTime: 0.9, parriedTime: 1.6,
    canBackstab: true, canRiposte: true, leash: 30,
    breath: 'breath_wet', voice: 'mimic_crack', step: 'step_drag', armor: 1, hitSound: 'hit_flesh',
  },
  // Screamer: keeps its distance and wails; everything nearby answers.
  screamer: {
    type: 'screamer', name: 'Screamer', model: 'stalker', style: 'stalker',
    health: 110, poise: 15, poiseRegen: 20, radius: 0.32, height: 2.2, scale: 0.92,
    walkSpeed: 1.6, runSpeed: 4.2, turnSpeed: 6,
    sightRange: 26, sightFov: 150, hearing: 1.4, lanternAttract: 30,
    attacks: [{ id: 'st_rake', min: 0, max: 2.2, weight: 3 }],
    attackCooldown: [0.8, 1.8], marrow: 90, staggerTime: 1.2, parriedTime: 1.8,
    canBackstab: true, canRiposte: true, leash: 50,
    breath: 'breath_thin', voice: 'screamer_wail', step: 'step_light', armor: 1, hitSound: 'hit_flesh',
  },
  // Moth swarm: drawn to the lantern, smothers its flame.
  moths: {
    type: 'moths', name: 'Ashwing Swarm', model: 'crawler', style: 'stalker',
    health: 70, poise: 999, poiseRegen: 0, radius: 0.6, height: 1.6, scale: 0.4,
    walkSpeed: 2.5, runSpeed: 4.8, turnSpeed: 8,
    sightRange: 10, sightFov: 360, hearing: 0.4, lanternAttract: 42,
    attacks: [],
    attackCooldown: [1, 2], marrow: 40, staggerTime: 0, parriedTime: 0,
    canBackstab: false, canRiposte: false, leash: 70,
    breath: 'moth_flutter', voice: 'moth_flutter', step: 'moth_flutter', armor: 1, hitSound: 'hit_flesh',
  },
  crawler: {
    type: 'crawler', name: 'Crawler', model: 'crawler', style: 'stalker',
    health: 120, poise: 18, poiseRegen: 18, radius: 0.4, height: 0.9, scale: 1.05,
    walkSpeed: 1.8, runSpeed: 5.6, turnSpeed: 6,
    sightRange: 14, sightFov: 140, hearing: 1.6, lanternAttract: 16,
    attacks: [
      { id: 'cr_bite', min: 0, max: 1.8, weight: 2 },
      { id: 'cr_pounce', min: 2.2, max: 6, weight: 2.4, cooldown: 3 },
    ],
    attackCooldown: [0.6, 1.5], marrow: 55, staggerTime: 0.9, parriedTime: 1.4,
    canBackstab: false, canRiposte: true, leash: 40,
    breath: 'breath_thin', voice: 'crawler_skitter', step: 'step_skitter', armor: 1, hitSound: 'hit_flesh',
  },
  knight: {
    type: 'knight', name: 'Drowned Knight', model: 'knight', style: 'knight',
    health: 520, poise: 110, poiseRegen: 18, radius: 0.46, height: 2.0, scale: 1.12,
    walkSpeed: 1.4, runSpeed: 3.4, turnSpeed: 3.2,
    sightRange: 20, sightFov: 120, hearing: 0.9, lanternAttract: 26,
    attacks: [
      { id: 'kn_sweep', min: 0, max: 3.2, weight: 3 },
      { id: 'kn_overhead', min: 0, max: 3.0, weight: 1.6, cooldown: 5 },
      { id: 'kn_thrust', min: 2.4, max: 5.5, weight: 1.8, cooldown: 3 },
    ],
    attackCooldown: [0.9, 2.2], marrow: 240, staggerTime: 1.3, parriedTime: 2.0,
    canBackstab: true, canRiposte: true, leash: 34,
    breath: 'breath_drowned', voice: 'knight_growl', step: 'step_armor', armor: 0.85, hitSound: 'hit_armor',
  },
  boss: {
    type: 'boss', name: 'Oskeline, the Wick-Mother', model: 'wickmother', style: 'boss',
    health: 2600, poise: 9999, poiseRegen: 0, radius: 1.2, height: 5.6, scale: 2.9,
    walkSpeed: 1.8, runSpeed: 3.6, turnSpeed: 2.2,
    sightRange: 80, sightFov: 360, hearing: 2, lanternAttract: 80,
    attacks: [
      { id: 'bo_sweep', min: 0, max: 7.5, weight: 3, phase: 1 },
      { id: 'bo_slam', min: 2, max: 8.5, weight: 2, cooldown: 4, phase: 1 },
      { id: 'bo_thrust', min: 5, max: 12, weight: 1.6, cooldown: 4, phase: 1 },
      { id: 'bo_stomp', min: 0, max: 3.6, weight: 2.2, cooldown: 5, phase: 1 },
      { id: 'bo_rend', min: 0, max: 6.5, weight: 3, phase: 2 },
      { id: 'bo_leap', min: 7, max: 22, weight: 2.5, cooldown: 7, phase: 2 },
      { id: 'bo_burst', min: 0, max: 6, weight: 1.4, cooldown: 12, phase: 2 },
      { id: 'bo_wave', min: 6, max: 20, weight: 2, cooldown: 6, phase: 2 },
      { id: 'bo_slam', min: 2, max: 8.5, weight: 1.2, cooldown: 5, phase: 2 },
    ],
    attackCooldown: [0.6, 1.6], marrow: 4000, staggerTime: 0, parriedTime: 0,
    canBackstab: false, canRiposte: false, leash: 999,
    breath: 'breath_boss', voice: 'boss_roar', step: 'step_boss', armor: 1, hitSound: 'hit_wax',
  },
};
