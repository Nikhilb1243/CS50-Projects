/** Player tuning and progression formulas. */
export const PLAYER_TUNING = {
  radius: 0.34,
  halfHeight: 0.56,
  walkSpeed: 2.0,
  runSpeed: 4.3,
  sprintSpeed: 6.5,
  blockSpeed: 1.6,
  drinkSpeed: 0.9,
  accel: 30,
  airAccel: 4,
  turnSpeed: 13,
  gravity: 22,
  jumpVelocity: 7.2,
  terminalVelocity: 40,

  rollDuration: 0.64,
  rollSpeed: 7.2,
  rollIFrames: [0.04, 0.44] as [number, number],
  rollCancel: 0.46,
  rollStamina: 22,
  jumpStamina: 12,
  sprintStaminaPerSec: 15,
  staminaRegen: 46,
  staminaRegenDelay: 0.55,
  blockRegenFactor: 0.35,
  blockStaminaFactor: 0.9,
  blockChip: 0.1,
  blockAngle: 1.2, // radians half-angle in front that blocks cover

  parryWindow: 0.2,
  parrySpamLock: 0.55,
  riposteRange: 2.4,
  backstabRange: 1.7,

  drinkDuration: 1.45,
  drinkHealFrame: 0.95,
  healFraction: 0.42,
  healFlat: 55,
  startDraughts: 3,

  lanternFuelMax: 100,
  lanternDrain: 0.3,
  lanternRadius: 13,
  lanternIntensity: 9,

  fallDamageStart: 7.5,
  fallDamagePerMeter: 26,
  fallLethal: 17,

  poise: 30,
  hurtTime: 0.34,
  staggerTime: 0.9,
  knockdownTime: 1.6,
};

export interface Attributes {
  vigor: number;
  endurance: number;
  strength: number;
}

export const START_ATTRIBUTES: Attributes = { vigor: 10, endurance: 10, strength: 10 };

export function levelOf(a: Attributes): number {
  return a.vigor + a.endurance + a.strength - 29;
}

export function maxHealth(a: Attributes): number {
  // gentle soft cap past 30
  const v = a.vigor;
  return Math.round(260 + (Math.min(v, 30) - 10) * 22 + Math.max(0, v - 30) * 8);
}

export function maxStamina(a: Attributes): number {
  const e = a.endurance;
  return Math.round(95 + (Math.min(e, 30) - 10) * 5 + Math.max(0, e - 30) * 2);
}

export function damageMultiplier(a: Attributes, bonus: number): number {
  const s = a.strength;
  return (1 + (Math.min(s, 30) - 10) * 0.055 + Math.max(0, s - 30) * 0.02) * (1 + bonus);
}

/** Marrow needed to go from `level` to `level + 1`. */
export function levelCost(level: number): number {
  return Math.round(90 + 28 * Math.pow(level, 1.42));
}
