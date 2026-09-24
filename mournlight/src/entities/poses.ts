import { clamp, clamp01, easeInOut, noise1, wrapAngle, TAU } from '../core/math';
import { applySpec, poseFrom, setJoint, addJoint, type Pose, type PoseSpec, OFF } from './rig';

/** Parameters describing how a creature walks. All angles in radians. */
export interface LocoStyle {
  hunch: number;
  chestLean: number;
  headPitch: number;
  stride: number;
  runStride: number;
  knee: number;
  armSwing: number;
  armForward: number;
  armOut: number;
  elbow: number;
  bob: number;
  sway: number;
  crouch: number;
  jitter: number;
}

export const STYLES: Record<string, LocoStyle> = {
  revenant: { hunch: 0.06, chestLean: 0.02, headPitch: 0.0, stride: 0.42, runStride: 0.72, knee: 0.85, armSwing: 0.3, armForward: 0, armOut: 0.1, elbow: 0.2, bob: 0.035, sway: 0.03, crouch: 0.02, jitter: 0 },
  shambler: { hunch: 0.42, chestLean: 0.22, headPitch: -0.45, stride: 0.26, runStride: 0.46, knee: 0.55, armSwing: 0.14, armForward: -0.35, armOut: 0.16, elbow: 0.35, bob: 0.06, sway: 0.12, crouch: 0.08, jitter: 0.04 },
  stalker: { hunch: 0.12, chestLean: 0.05, headPitch: 0.25, stride: 0.34, runStride: 0.85, knee: 0.8, armSwing: 0.06, armForward: 0.18, armOut: 0.08, elbow: 0.05, bob: 0.02, sway: 0.02, crouch: 0.0, jitter: 0.12 },
  knight: { hunch: 0.08, chestLean: 0.04, headPitch: -0.05, stride: 0.32, runStride: 0.55, knee: 0.55, armSwing: 0.08, armForward: -0.15, armOut: 0.18, elbow: 0.35, bob: 0.03, sway: 0.03, crouch: 0.04, jitter: 0 },
  boss: { hunch: 0.14, chestLean: 0.06, headPitch: -0.1, stride: 0.26, runStride: 0.46, knee: 0.45, armSwing: 0.1, armForward: -0.2, armOut: 0.2, elbow: 0.3, bob: 0.03, sway: 0.05, crouch: 0.0, jitter: 0.01 },
  corpse: { hunch: 0.3, chestLean: 0.1, headPitch: 0, stride: 0.3, runStride: 0.5, knee: 0.6, armSwing: 0.2, armForward: 0, armOut: 0.1, elbow: 0.2, bob: 0.03, sway: 0.05, crouch: 0.05, jitter: 0 },
};

/**
 * Procedural locomotion. `speed` is normalized: 0 idle, 1 walk, 2 run, 3 sprint.
 * `phase` advances with distance travelled.
 */
export function locomotion(out: Pose, t: number, phase: number, speed: number, st: LocoStyle): Pose {
  out.fill(0);
  const s = clamp(speed, 0, 3);
  const walkW = clamp01(s);
  const runW = clamp01(s - 1);
  const sprintW = clamp01(s - 2);
  const stride = st.stride * walkW + (st.runStride - st.stride) * runW + 0.1 * sprintW;
  const sn = Math.sin(phase);
  const cs = Math.cos(phase);
  const breathe = Math.sin(t * 1.7) * (1 - walkW);

  // Legs
  const kneeAmp = st.knee * (0.7 * walkW + 0.6 * runW + 0.25 * sprintW);
  const thighR = -stride * sn - st.crouch * 0.6;
  const thighL = stride * sn - st.crouch * 0.6;
  const shinR = 0.06 + st.crouch + kneeAmp * Math.max(0, cs) + 0.12 * runW * Math.max(0, -cs);
  const shinL = 0.06 + st.crouch + kneeAmp * Math.max(0, -cs) + 0.12 * runW * Math.max(0, cs);
  setJoint(out, 'thighR', thighR, 0, -0.03);
  setJoint(out, 'thighL', thighL, 0, 0.03);
  setJoint(out, 'shinR', shinR, 0, 0);
  setJoint(out, 'shinL', shinL, 0, 0);
  setJoint(out, 'footR', -(thighR + shinR) * 0.85, 0, 0);
  setJoint(out, 'footL', -(thighL + shinL) * 0.85, 0, 0);

  // Pelvis & torso
  const lean = st.hunch + 0.1 * runW + 0.14 * sprintW;
  setJoint(out, 'hips', 0.04 * runW, 0.14 * stride * sn, st.sway * cs * walkW);
  setJoint(out, 'spine', lean, 0, -st.sway * 0.5 * cs * walkW);
  setJoint(out, 'chest', st.chestLean + 0.02 * breathe, -0.22 * stride * sn, 0);
  setJoint(out, 'neck', -lean * 0.3, 0, 0);
  setJoint(out, 'head', st.headPitch - lean * 0.35, 0, 0);

  // Arms
  const swing = st.armSwing * walkW + 0.25 * runW + 0.2 * sprintW;
  const elbow = st.elbow + 0.5 * runW + 0.4 * sprintW;
  setJoint(out, 'upperArmR', st.armForward + swing * sn, 0, -st.armOut);
  setJoint(out, 'upperArmL', st.armForward - swing * sn, 0, st.armOut);
  setJoint(out, 'forearmR', -elbow - 0.1 * Math.max(0, -sn) * walkW, 0, 0);
  setJoint(out, 'forearmL', -elbow - 0.1 * Math.max(0, sn) * walkW, 0, 0);

  // Vertical bob
  out[OFF + 1] = -st.crouch * 0.5 - st.bob * Math.abs(sn) * (walkW + runW * 0.6) + 0.004 * breathe;

  if (st.jitter > 0) {
    const j = st.jitter;
    addJoint(out, 'head', noise1(t * 5.3, 1) * j, noise1(t * 4.1, 2) * j * 1.5, noise1(t * 6.7, 3) * j * 2);
    addJoint(out, 'neck', noise1(t * 3.1, 4) * j * 0.5, 0, 0);
    addJoint(out, 'forearmR', noise1(t * 7.2, 5) * j, 0, 0);
    addJoint(out, 'forearmL', noise1(t * 6.4, 6) * j, 0, 0);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Key poses. Each is a partial spec applied on top of a stance base.
// ---------------------------------------------------------------------------
const STANCE: PoseSpec = {
  spine: [0.08, 0, 0],
  chest: [0.04, 0, 0],
  head: [-0.06, 0, 0],
  thighR: [-0.28, 0, -0.06],
  shinR: [0.36, 0, 0],
  footR: [-0.08, 0, 0],
  thighL: [0.18, 0, 0.06],
  shinL: [0.26, 0, 0],
  footL: [-0.44, 0, 0],
  upperArmR: [-0.3, 0, -0.12],
  forearmR: [-0.6, 0, 0],
  upperArmL: [-0.4, 0, 0.14],
  forearmL: [-0.5, 0, 0],
  off: [0, -0.06, 0],
};

export const STANCE_POSE: Pose = poseFrom(null, STANCE);

const RAW: Record<string, PoseSpec> = {
  // ---- Revenant --------------------------------------------------------------
  guard: {
    chest: [0.05, -0.12, 0],
    head: [-0.05, 0.1, 0],
    upperArmR: [-0.55, 0.15, -0.18],
    forearmR: [-0.85, 0, 0],
    handR: [-0.45, 0, 0],
    upperArmL: [-0.55, 0, 0.18],
    forearmL: [-0.5, 0, 0],
  },
  carry: {
    upperArmR: [-0.18, 0, -0.14],
    forearmR: [-0.55, 0, 0],
    handR: [-0.55, 0, 0],
    upperArmL: [-0.55, 0, 0.14],
    forearmL: [-0.45, 0, 0],
  },
  slashR_wind: {
    hips: [0, -0.3, 0],
    spine: [0.1, -0.3, 0],
    chest: [0.05, -0.55, 0],
    head: [0, 0.75, 0],
    upperArmR: [-1.25, -1.0, -0.25],
    forearmR: [-0.35, 0, 0],
    handR: [-0.3, 0, 0],
    upperArmL: [-0.35, 0, 0.35],
    forearmL: [-0.6, 0, 0],
    off: [0, -0.07, -0.03],
  },
  slashR_hit: {
    hips: [0, 0.3, 0],
    spine: [0.16, 0.3, 0],
    chest: [0.12, 0.55, 0],
    head: [0, -0.7, 0],
    upperArmR: [-1.35, 0.95, 0],
    forearmR: [-0.25, 0, 0],
    handR: [-0.2, 0, 0],
    upperArmL: [-0.25, 0, 0.55],
    forearmL: [-0.35, 0, 0],
    thighR: [-0.55, 0, -0.06],
    shinR: [0.5, 0, 0],
    footR: [0.05, 0, 0],
    off: [0, -0.12, 0.08],
  },
  slashL_wind: {
    hips: [0, 0.3, 0],
    spine: [0.12, 0.3, 0],
    chest: [0.08, 0.55, 0],
    head: [0, -0.75, 0],
    upperArmR: [-1.3, 1.05, 0.1],
    forearmR: [-0.45, 0, 0],
    handR: [-0.3, 0, 0],
    upperArmL: [-0.25, 0, 0.5],
    forearmL: [-0.35, 0, 0],
    off: [0, -0.08, 0],
  },
  slashL_hit: {
    hips: [0, -0.3, 0],
    spine: [0.14, -0.3, 0],
    chest: [0.1, -0.55, 0],
    head: [0, 0.75, 0],
    upperArmR: [-1.3, -1.0, -0.2],
    forearmR: [-0.2, 0, 0],
    handR: [-0.15, 0, 0],
    upperArmL: [-0.4, 0, 0.3],
    forearmL: [-0.6, 0, 0],
    thighR: [-0.5, 0, -0.06],
    shinR: [0.45, 0, 0],
    off: [0, -0.12, 0.08],
  },
  overhead_wind: {
    spine: [-0.08, -0.1, 0],
    chest: [-0.16, -0.12, 0],
    head: [0.12, 0.2, 0],
    upperArmR: [-2.85, 0.15, -0.1],
    forearmR: [-0.7, 0, 0],
    handR: [-0.45, 0, 0],
    upperArmL: [-0.9, 0, 0.45],
    forearmL: [-0.7, 0, 0],
    off: [0, -0.02, -0.05],
  },
  overhead_hit: {
    spine: [0.35, 0.05, 0],
    chest: [0.3, 0.05, 0],
    head: [-0.35, 0, 0],
    upperArmR: [-0.95, 0.12, -0.05],
    forearmR: [-0.25, 0, 0],
    handR: [-0.25, 0, 0],
    upperArmL: [-0.3, 0, 0.45],
    forearmL: [-0.3, 0, 0],
    thighR: [-0.75, 0, -0.06],
    shinR: [0.8, 0, 0],
    footR: [0, 0, 0],
    thighL: [0.35, 0, 0.06],
    shinL: [0.45, 0, 0],
    off: [0, -0.2, 0.14],
  },
  heavy_wind: {
    hips: [0, -0.35, 0],
    spine: [-0.1, -0.25, 0],
    chest: [-0.22, -0.3, 0],
    head: [0.15, 0.7, 0],
    upperArmR: [-3.0, -0.3, -0.2],
    forearmR: [-1.05, 0, 0],
    handR: [-0.5, 0, 0],
    upperArmL: [-1.2, 0.2, 0.55],
    forearmL: [-0.8, 0, 0],
    thighR: [-0.1, 0, -0.1],
    shinR: [0.5, 0, 0],
    thighL: [0.35, 0, 0.1],
    shinL: [0.55, 0, 0],
    off: [0, -0.14, -0.1],
  },
  heavy_hit: {
    hips: [0, 0.15, 0],
    spine: [0.5, 0.1, 0],
    chest: [0.38, 0.1, 0],
    head: [-0.5, -0.2, 0],
    upperArmR: [-0.7, 0.15, 0],
    forearmR: [-0.15, 0, 0],
    handR: [-0.3, 0, 0],
    upperArmL: [-0.2, 0, 0.6],
    forearmL: [-0.3, 0, 0],
    thighR: [-0.95, 0, -0.08],
    shinR: [0.95, 0, 0],
    footR: [0, 0, 0],
    thighL: [0.5, 0, 0.08],
    shinL: [0.5, 0, 0],
    off: [0, -0.32, 0.25],
  },
  thrust_wind: {
    spine: [0.05, -0.2, 0],
    chest: [0, -0.5, 0],
    head: [0, 0.65, 0],
    upperArmR: [0.35, 0, -0.3],
    forearmR: [-1.65, 0, 0],
    handR: [-0.05, 0, 0],
    upperArmL: [-0.8, 0.3, 0.2],
    forearmL: [-0.9, 0, 0],
    off: [0, -0.1, -0.1],
  },
  thrust_hit: {
    spine: [0.15, 0.15, 0],
    chest: [0.12, 0.35, 0],
    head: [0, -0.45, 0],
    upperArmR: [-1.5, 0.15, 0],
    forearmR: [-0.05, 0, 0],
    handR: [-0.05, 0, 0],
    upperArmL: [-0.2, 0, 0.5],
    forearmL: [-0.3, 0, 0],
    thighR: [-0.7, 0, -0.06],
    shinR: [0.65, 0, 0],
    footR: [0.05, 0, 0],
    thighL: [0.4, 0, 0.06],
    shinL: [0.35, 0, 0],
    off: [0, -0.16, 0.25],
  },
  block: {
    chest: [0.06, -0.3, 0],
    head: [-0.05, 0.3, 0],
    upperArmR: [-1.0, 0.55, -0.1],
    forearmR: [-1.25, 0, 0],
    handR: [0.15, 0, 1.25],
    upperArmL: [-0.45, 0, 0.3],
    forearmL: [-0.7, 0, 0],
  },
  parry: {
    chest: [0.0, 0.25, 0],
    head: [-0.05, -0.2, 0],
    upperArmR: [-1.25, 0.95, -0.2],
    forearmR: [-0.9, 0, 0],
    handR: [0.2, 0, 1.1],
    upperArmL: [-0.35, 0, 0.45],
    forearmL: [-0.6, 0, 0],
  },
  drink: {
    neck: [-0.15, 0, 0],
    head: [-0.45, 0, 0],
    upperArmL: [-1.25, -0.75, 0.15],
    forearmL: [-2.1, 0, 0],
    handL: [-0.3, 0, 0],
    upperArmR: [-0.15, 0, -0.15],
    forearmR: [-0.4, 0, 0],
    handR: [-0.6, 0, 0],
  },
  hit: {
    spine: [-0.25, 0.1, 0.12],
    chest: [-0.2, 0.2, 0],
    head: [-0.35, 0, 0.1],
    upperArmR: [-0.2, 0, -0.5],
    upperArmL: [-0.3, 0, 0.5],
    off: [0, -0.04, -0.08],
  },
  stagger: {
    spine: [-0.45, 0.1, 0.2],
    chest: [-0.3, 0.3, 0],
    head: [-0.45, 0, 0.15],
    upperArmR: [-0.9, 0, -0.9],
    forearmR: [-0.4, 0, 0],
    upperArmL: [-0.7, 0, 0.9],
    forearmL: [-0.4, 0, 0],
    thighR: [-0.45, 0, -0.1],
    shinR: [0.65, 0, 0],
    thighL: [0.3, 0, 0.1],
    shinL: [0.25, 0, 0],
    off: [0, -0.12, -0.2],
  },
  fall: {
    spine: [0.05, 0, 0],
    head: [0.1, 0, 0],
    thighR: [-0.6, 0, -0.05],
    shinR: [0.9, 0, 0],
    thighL: [-0.15, 0, 0.05],
    shinL: [0.55, 0, 0],
    upperArmR: [-0.7, 0, -0.55],
    forearmR: [-0.6, 0, 0],
    upperArmL: [-0.7, 0, 0.55],
    forearmL: [-0.5, 0, 0],
  },
  kneel: {
    spine: [0.28, 0, 0],
    chest: [0.15, 0, 0],
    head: [0.35, 0, 0],
    thighR: [-1.4, 0, -0.08],
    shinR: [1.45, 0, 0],
    footR: [0, 0, 0],
    thighL: [0.15, 0, 0.08],
    shinL: [1.95, 0, 0],
    footL: [-0.4, 0, 0],
    upperArmR: [-0.45, 0, -0.15],
    forearmR: [-0.7, 0, 0],
    handR: [-0.3, 0, 0],
    upperArmL: [-0.95, 0.2, 0.2],
    forearmL: [-0.9, 0, 0],
    off: [0, -0.47, 0],
  },
  grabbed: {
    spine: [-0.3, 0, 0],
    chest: [-0.25, 0, 0],
    head: [-0.45, 0, 0],
    upperArmR: [-0.9, 0, -0.9],
    forearmR: [-0.9, 0, 0],
    upperArmL: [-0.9, 0, 0.9],
    forearmL: [-0.9, 0, 0],
    thighR: [-0.2, 0, 0],
    shinR: [0.4, 0, 0],
    off: [0, 0.04, 0],
  },
  interact: {
    spine: [0.35, 0, 0],
    chest: [0.2, 0, 0],
    head: [0.1, 0, 0],
    upperArmR: [-1.3, 0.1, -0.1],
    forearmR: [-0.3, 0, 0],
    upperArmL: [-1.3, -0.1, 0.1],
    forearmL: [-0.3, 0, 0],
    thighR: [-0.4, 0, 0],
    shinR: [0.5, 0, 0],
    off: [0, -0.1, 0],
  },
  death_knees: {
    spine: [0.5, 0, 0.1],
    chest: [0.3, 0, 0],
    head: [0.6, 0, 0.2],
    upperArmR: [0.1, 0, -0.15],
    forearmR: [-0.2, 0, 0],
    upperArmL: [0.1, 0, 0.15],
    forearmL: [-0.2, 0, 0],
    thighR: [-0.15, 0, -0.1],
    shinR: [2.0, 0, 0],
    footR: [0.4, 0, 0],
    thighL: [-0.15, 0, 0.1],
    shinL: [2.0, 0, 0],
    footL: [0.4, 0, 0],
    off: [0, -0.52, 0],
  },
  death_down: {
    hips: [1.45, 0.1, 0.1],
    spine: [0.1, 0, 0],
    chest: [0.05, 0, 0],
    head: [-0.2, 0.9, 0],
    upperArmR: [-2.4, 0.3, -0.5],
    forearmR: [-0.3, 0, 0],
    upperArmL: [-0.2, 0, 0.9],
    forearmL: [-0.8, 0, 0],
    thighR: [-1.2, 0, -0.1],
    shinR: [0.4, 0, 0],
    thighL: [-1.45, 0, 0.1],
    shinL: [0.1, 0, 0],
    footR: [0.8, 0, 0],
    footL: [0.9, 0, 0],
    off: [0, -0.78, 0.35],
  },

  // ---- Shambler --------------------------------------------------------------
  sh_swipe_wind: {
    spine: [0.3, -0.25, 0],
    chest: [0.2, -0.7, 0.1],
    head: [-0.4, 0.5, 0],
    upperArmR: [-2.4, -0.5, -0.45],
    forearmR: [-0.6, 0, 0],
    upperArmL: [-0.4, 0, 0.3],
    forearmL: [-0.4, 0, 0],
    off: [0, -0.04, -0.05],
  },
  sh_swipe_hit: {
    spine: [0.5, 0.25, 0],
    chest: [0.45, 0.6, 0],
    head: [-0.6, -0.5, 0],
    upperArmR: [-1.0, 0.95, 0],
    forearmR: [-0.2, 0, 0],
    upperArmL: [-0.3, 0, 0.25],
    forearmL: [-0.3, 0, 0],
    thighR: [-0.6, 0, -0.06],
    shinR: [0.6, 0, 0],
    off: [0, -0.12, 0.18],
  },
  sh_grab_wind: {
    spine: [0.1, 0, 0],
    chest: [-0.12, 0, 0],
    head: [-0.25, 0, 0],
    upperArmR: [-2.25, 0.35, -0.3],
    forearmR: [-0.45, 0, 0],
    upperArmL: [-2.25, -0.35, 0.3],
    forearmL: [-0.45, 0, 0],
    off: [0, 0.02, -0.12],
  },
  sh_grab_hit: {
    spine: [0.5, 0, 0],
    chest: [0.3, 0, 0],
    head: [-0.55, 0, 0],
    upperArmR: [-1.45, 0.3, 0],
    forearmR: [-0.2, 0, 0],
    upperArmL: [-1.45, -0.3, 0],
    forearmL: [-0.2, 0, 0],
    thighR: [-0.75, 0, -0.05],
    shinR: [0.75, 0, 0],
    thighL: [0.4, 0, 0.05],
    shinL: [0.3, 0, 0],
    off: [0, -0.12, 0.32],
  },
  sh_grab_hold: {
    spine: [0.45, 0, 0],
    chest: [0.35, 0, 0],
    neck: [0.3, 0, 0],
    head: [0.2, 0, 0],
    upperArmR: [-1.35, 0.55, 0],
    forearmR: [-1.25, 0, 0],
    upperArmL: [-1.35, -0.55, 0],
    forearmL: [-1.25, 0, 0],
    off: [0, -0.1, 0.1],
  },

  // ---- Stalker ---------------------------------------------------------------
  st_rake_wind: {
    spine: [0.0, -0.2, 0],
    chest: [-0.12, -0.45, 0],
    head: [0.35, 0.3, 0.5],
    upperArmR: [-2.65, -0.45, -0.35],
    forearmR: [-0.3, 0, 0],
    upperArmL: [-2.5, 0.45, 0.35],
    forearmL: [-0.3, 0, 0],
    off: [0, 0.02, -0.08],
  },
  st_rake_hit: {
    spine: [0.35, 0.2, 0],
    chest: [0.5, 0.25, 0],
    head: [-0.2, -0.3, -0.4],
    upperArmR: [-0.75, 0.55, 0],
    forearmR: [-0.1, 0, 0],
    upperArmL: [-0.55, -0.35, 0],
    forearmL: [-0.1, 0, 0],
    thighR: [-0.7, 0, 0],
    shinR: [0.6, 0, 0],
    off: [0, -0.12, 0.3],
  },
  st_lunge_wind: {
    spine: [0.3, 0, 0],
    chest: [0.25, 0, 0],
    head: [-0.5, 0, 0.6],
    upperArmR: [0.6, 0, -0.4],
    forearmR: [-0.2, 0, 0],
    upperArmL: [0.6, 0, 0.4],
    forearmL: [-0.2, 0, 0],
    thighR: [-0.9, 0, 0],
    shinR: [1.3, 0, 0],
    thighL: [-0.3, 0, 0],
    shinL: [1.2, 0, 0],
    off: [0, -0.35, -0.1],
  },
  st_lunge_hit: {
    spine: [0.6, 0, 0],
    chest: [0.35, 0, 0],
    head: [-0.8, 0, 0],
    upperArmR: [-1.6, 0.25, 0],
    forearmR: [-0.05, 0, 0],
    upperArmL: [-1.6, -0.25, 0],
    forearmL: [-0.05, 0, 0],
    thighR: [-1.0, 0, 0],
    shinR: [0.5, 0, 0],
    thighL: [0.6, 0, 0],
    shinL: [0.4, 0, 0],
    off: [0, -0.2, 0.45],
  },

  // ---- Crawler (spider-walk humanoid) -----------------------------------------
  cr_base: {
    hips: [1.42, 0, 0],
    spine: [0.12, 0, 0],
    chest: [0.05, 0, 0],
    neck: [-0.7, 0, 0],
    head: [-0.85, 0, 0],
    upperArmR: [-1.35, 0, -0.55],
    forearmR: [-0.25, 0, 0.35],
    handR: [0.4, 0, 0],
    upperArmL: [-1.35, 0, 0.55],
    forearmL: [-0.25, 0, -0.35],
    handL: [0.4, 0, 0],
    thighR: [-1.55, 0, -0.55],
    shinR: [1.2, 0, 0.2],
    footR: [0.2, 0, 0],
    thighL: [-1.55, 0, 0.55],
    shinL: [1.2, 0, -0.2],
    footL: [0.2, 0, 0],
    off: [0, -0.52, 0],
  },
  cr_pounce_wind: {
    hips: [1.3, 0, 0],
    spine: [0.2, 0, 0],
    neck: [-0.9, 0, 0],
    head: [-0.7, 0, 0.3],
    upperArmR: [-0.9, 0, -0.8],
    forearmR: [-0.9, 0, 0.3],
    upperArmL: [-0.9, 0, 0.8],
    forearmL: [-0.9, 0, -0.3],
    thighR: [-1.9, 0, -0.6],
    shinR: [2.0, 0, 0],
    thighL: [-1.9, 0, 0.6],
    shinL: [2.0, 0, 0],
    off: [0, -0.66, -0.1],
  },
  cr_pounce_hit: {
    hips: [1.2, 0, 0],
    spine: [-0.1, 0, 0],
    neck: [-0.5, 0, 0],
    head: [-0.8, 0, 0],
    upperArmR: [-2.8, 0.2, -0.2],
    forearmR: [-0.1, 0, 0],
    upperArmL: [-2.8, -0.2, 0.2],
    forearmL: [-0.1, 0, 0],
    thighR: [-0.9, 0, -0.3],
    shinR: [0.3, 0, 0],
    thighL: [-0.9, 0, 0.3],
    shinL: [0.3, 0, 0],
    off: [0, -0.3, 0.5],
  },
  cr_bite_wind: {
    hips: [1.3, 0, 0],
    neck: [-1.1, 0, 0],
    head: [-0.2, 0, 0.5],
    off: [0, -0.5, -0.12],
  },
  cr_bite_hit: {
    hips: [1.5, 0, 0],
    neck: [-0.2, 0, 0],
    head: [-1.2, 0, -0.2],
    off: [0, -0.56, 0.3],
  },

  // ---- Drowned Knight --------------------------------------------------------
  kn_carry: {
    upperArmR: [-0.3, 0, -0.15],
    forearmR: [-0.3, 0, 0],
    handR: [-0.95, 0, 0],
    upperArmL: [-0.2, 0, 0.2],
    forearmL: [-0.4, 0, 0],
  },
  kn_sweep_wind: {
    hips: [0, -0.3, 0],
    spine: [0.08, -0.3, 0],
    chest: [0.05, -0.75, 0],
    head: [0, 0.9, 0],
    upperArmR: [-1.3, -1.1, -0.25],
    forearmR: [-0.3, 0, 0],
    handR: [-0.35, 0, 0],
    upperArmL: [-1.1, -0.7, 0.2],
    forearmL: [-0.9, 0, 0],
    off: [0, -0.08, -0.05],
  },
  kn_sweep_hit: {
    hips: [0, 0.35, 0],
    spine: [0.18, 0.3, 0],
    chest: [0.12, 0.7, 0],
    head: [0, -0.9, 0],
    upperArmR: [-1.35, 1.05, 0],
    forearmR: [-0.2, 0, 0],
    handR: [-0.25, 0, 0],
    upperArmL: [-0.9, 0.9, 0.2],
    forearmL: [-0.8, 0, 0],
    thighR: [-0.6, 0, -0.06],
    shinR: [0.6, 0, 0],
    off: [0, -0.14, 0.15],
  },
  kn_back_hit: {
    hips: [0, -0.35, 0],
    spine: [0.16, -0.3, 0],
    chest: [0.12, -0.7, 0],
    head: [0, 0.9, 0],
    upperArmR: [-1.35, -1.05, -0.2],
    forearmR: [-0.2, 0, 0],
    handR: [-0.25, 0, 0],
    upperArmL: [-1.0, -0.9, 0.2],
    forearmL: [-0.8, 0, 0],
    thighL: [-0.6, 0, 0.06],
    shinL: [0.6, 0, 0],
    off: [0, -0.14, 0.12],
  },
  kn_overhead_wind: {
    spine: [-0.1, 0, 0],
    chest: [-0.22, 0, 0],
    head: [0.15, 0, 0],
    upperArmR: [-3.0, 0.2, 0],
    forearmR: [-0.85, 0, 0],
    handR: [-0.5, 0, 0],
    upperArmL: [-2.8, -0.3, 0.2],
    forearmL: [-0.9, 0, 0],
    off: [0, 0, -0.1],
  },
  kn_overhead_hit: {
    spine: [0.5, 0, 0],
    chest: [0.32, 0, 0],
    head: [-0.5, 0, 0],
    upperArmR: [-0.8, 0.1, 0],
    forearmR: [-0.1, 0, 0],
    handR: [-0.3, 0, 0],
    upperArmL: [-0.9, -0.2, 0.2],
    forearmL: [-0.3, 0, 0],
    thighR: [-0.8, 0, -0.06],
    shinR: [0.85, 0, 0],
    thighL: [0.4, 0, 0.06],
    shinL: [0.4, 0, 0],
    off: [0, -0.26, 0.3],
  },

  // ---- Wick-Mother (boss) --------------------------------------------------
  bo_carry: {
    upperArmR: [-0.4, 0, -0.2],
    forearmR: [-0.9, 0, 0],
    handR: [0.9, 0, 0],
    upperArmL: [-0.3, 0, 0.3],
    forearmL: [-0.6, 0, 0],
  },
  bo_sweep_wind: {
    spine: [0.05, -0.3, 0],
    chest: [0.0, -0.9, 0],
    head: [0, 0.9, 0],
    upperArmR: [-1.2, -1.2, -0.3],
    forearmR: [-0.25, 0, 0],
    handR: [-0.4, 0, 0],
    upperArmL: [-0.8, -0.8, 0.25],
    forearmL: [-0.7, 0, 0],
    off: [0, -0.05, -0.05],
  },
  bo_sweep_hit: {
    spine: [0.15, 0.3, 0],
    chest: [0.1, 0.85, 0],
    head: [0, -0.9, 0],
    upperArmR: [-1.3, 1.15, 0],
    forearmR: [-0.1, 0, 0],
    handR: [-0.3, 0, 0],
    upperArmL: [-0.6, 0.6, 0.3],
    forearmL: [-0.5, 0, 0],
    off: [0, -0.08, 0.1],
  },
  bo_slam_wind: {
    spine: [-0.12, 0, 0],
    chest: [-0.25, 0, 0],
    head: [0.2, 0, 0],
    upperArmR: [-3.0, 0.15, 0],
    forearmR: [-0.6, 0, 0],
    handR: [-0.3, 0, 0],
    upperArmL: [-2.9, -0.2, 0.2],
    forearmL: [-0.6, 0, 0],
    off: [0, 0, -0.08],
  },
  bo_slam_hit: {
    spine: [0.5, 0, 0],
    chest: [0.35, 0, 0],
    head: [-0.4, 0, 0],
    upperArmR: [-0.65, 0.1, 0],
    forearmR: [-0.1, 0, 0],
    handR: [-0.3, 0, 0],
    upperArmL: [-0.7, -0.1, 0.2],
    forearmL: [-0.2, 0, 0],
    off: [0, -0.3, 0.2],
  },
  bo_stomp_wind: {
    spine: [-0.05, 0, 0],
    upperArmR: [-0.6, 0, -0.6],
    upperArmL: [-0.6, 0, 0.6],
    thighR: [-1.25, 0, -0.1],
    shinR: [1.1, 0, 0],
    footR: [0.1, 0, 0],
    off: [0, 0.05, 0],
  },
  bo_stomp_hit: {
    spine: [0.2, 0, 0],
    upperArmR: [-0.4, 0, -0.7],
    upperArmL: [-0.4, 0, 0.7],
    thighR: [-0.25, 0, -0.1],
    shinR: [0.2, 0, 0],
    thighL: [0.25, 0, 0.1],
    shinL: [0.4, 0, 0],
    off: [0, -0.15, 0.05],
  },
  bo_rend_wind: {
    spine: [0.05, -0.3, 0],
    chest: [-0.05, -0.7, 0],
    head: [0, 0.6, 0],
    upperArmR: [-2.4, -0.6, -0.45],
    forearmR: [-0.3, 0, 0],
    upperArmL: [-1.5, -0.5, 0.5],
    forearmL: [-0.5, 0, 0],
    off: [0, -0.05, -0.05],
  },
  bo_rend_hit: {
    spine: [0.3, 0.3, 0],
    chest: [0.3, 0.7, 0],
    head: [0, -0.6, 0],
    upperArmR: [-1.0, 0.95, 0],
    forearmR: [-0.1, 0, 0],
    upperArmL: [-0.9, 0.2, 0.4],
    forearmL: [-0.4, 0, 0],
    off: [0, -0.12, 0.2],
  },
  bo_rend2_wind: {
    spine: [0.05, 0.3, 0],
    chest: [-0.05, 0.7, 0],
    head: [0, -0.6, 0],
    upperArmL: [-2.4, 0.6, 0.45],
    forearmL: [-0.3, 0, 0],
    upperArmR: [-1.5, 0.5, -0.5],
    forearmR: [-0.5, 0, 0],
  },
  bo_rend2_hit: {
    spine: [0.3, -0.3, 0],
    chest: [0.3, -0.7, 0],
    head: [0, 0.6, 0],
    upperArmL: [-1.0, -0.95, 0],
    forearmL: [-0.1, 0, 0],
    upperArmR: [-0.9, -0.2, -0.4],
    forearmR: [-0.4, 0, 0],
    off: [0, -0.12, 0.2],
  },
  bo_leap_wind: {
    spine: [0.5, 0, 0],
    chest: [0.3, 0, 0],
    head: [-0.6, 0, 0],
    upperArmR: [0.6, 0, -0.5],
    forearmR: [-0.5, 0, 0],
    upperArmL: [0.6, 0, 0.5],
    forearmL: [-0.5, 0, 0],
    thighR: [-1.2, 0, -0.1],
    shinR: [1.6, 0, 0],
    thighL: [-1.0, 0, 0.1],
    shinL: [1.5, 0, 0],
    off: [0, -0.4, -0.1],
  },
  bo_leap_hit: {
    spine: [0.6, 0, 0],
    chest: [0.4, 0, 0],
    head: [-0.5, 0, 0],
    upperArmR: [-1.1, 0.3, -0.2],
    forearmR: [-0.1, 0, 0],
    upperArmL: [-1.1, -0.3, 0.2],
    forearmL: [-0.1, 0, 0],
    thighR: [-1.1, 0, -0.15],
    shinR: [1.3, 0, 0],
    thighL: [-0.4, 0, 0.15],
    shinL: [1.4, 0, 0],
    off: [0, -0.42, 0.15],
  },
  bo_burst_wind: {
    spine: [-0.25, 0, 0],
    chest: [-0.35, 0, 0],
    neck: [-0.2, 0, 0],
    head: [-0.5, 0, 0],
    upperArmR: [-1.4, -0.9, -0.9],
    forearmR: [-0.4, 0, 0],
    upperArmL: [-1.4, 0.9, 0.9],
    forearmL: [-0.4, 0, 0],
    off: [0, 0.04, 0],
  },
  bo_burst_hit: {
    spine: [0.4, 0, 0],
    chest: [0.35, 0, 0],
    head: [0.1, 0, 0],
    upperArmR: [-0.6, -0.4, -1.3],
    forearmR: [-0.1, 0, 0],
    upperArmL: [-0.6, 0.4, 1.3],
    forearmL: [-0.1, 0, 0],
    thighR: [-0.5, 0, -0.2],
    shinR: [0.7, 0, 0],
    thighL: [-0.5, 0, 0.2],
    shinL: [0.7, 0, 0],
    off: [0, -0.3, 0],
  },
  bo_wave_wind: {
    spine: [0.2, -0.4, 0],
    chest: [0.1, -0.7, 0],
    head: [-0.1, 0.8, 0],
    upperArmR: [-0.6, -1.2, -0.7],
    forearmR: [-0.2, 0, 0],
    upperArmL: [-0.5, 0, 0.5],
    off: [0, -0.2, 0],
  },
  bo_wave_hit: {
    spine: [0.55, 0.2, 0],
    chest: [0.4, 0.5, 0],
    head: [-0.5, -0.4, 0],
    upperArmR: [-1.2, 0.3, -0.1],
    forearmR: [-0.05, 0, 0],
    upperArmL: [-0.4, 0, 0.6],
    thighR: [-0.9, 0, 0],
    shinR: [1.0, 0, 0],
    off: [0, -0.35, 0.25],
  },
  bo_roar: {
    spine: [-0.3, 0, 0],
    chest: [-0.35, 0, 0],
    neck: [-0.3, 0, 0],
    head: [-0.55, 0, 0],
    upperArmR: [-0.9, 0, -1.2],
    forearmR: [-0.9, 0, 0],
    upperArmL: [-0.9, 0, 1.2],
    forearmL: [-0.9, 0, 0],
    off: [0, 0.02, -0.05],
  },
};

/** Full-body key poses (stance base + spec). */
export const KEY_POSES: Record<string, Pose> = (() => {
  const out: Record<string, Pose> = {};
  for (const [name, spec] of Object.entries(RAW)) {
    const base = name.startsWith('cr_') && name !== 'cr_base' ? poseFrom(STANCE_POSE, RAW.cr_base) : STANCE_POSE;
    out[name] = poseFrom(base, spec);
  }
  return out;
})();

export function keyPose(name: string): Pose {
  const p = KEY_POSES[name];
  if (!p) throw new Error(`Unknown pose ${name}`);
  return p;
}

// ---------------------------------------------------------------------------
// Procedural full-body sequences
// ---------------------------------------------------------------------------
/** Forward dodge roll; u in 0..1. */
export function rollPose(out: Pose, u: number): Pose {
  out.set(STANCE_POSE);
  const spin = easeInOut(clamp01((u - 0.04) / 0.72)) * TAU;
  const tuck = Math.sin(Math.PI * clamp01(u / 0.86));
  setJoint(out, 'hips', wrapAngle(spin), 0, 0);
  setJoint(out, 'spine', 0.5 * tuck, 0, 0);
  setJoint(out, 'chest', 0.45 * tuck, 0, 0);
  setJoint(out, 'neck', 0.3 * tuck, 0, 0);
  setJoint(out, 'head', 0.35 * tuck, 0, 0);
  setJoint(out, 'thighR', -1.7 * tuck - 0.2, 0, -0.1);
  setJoint(out, 'shinR', 2.1 * tuck + 0.2, 0, 0);
  setJoint(out, 'thighL', -1.5 * tuck - 0.1, 0, 0.1);
  setJoint(out, 'shinL', 2.2 * tuck + 0.2, 0, 0);
  setJoint(out, 'upperArmR', -0.9 * tuck - 0.2, 0, -0.3);
  setJoint(out, 'forearmR', -1.3 * tuck - 0.4, 0, 0);
  setJoint(out, 'upperArmL', -1.0 * tuck - 0.3, 0, 0.3);
  setJoint(out, 'forearmL', -1.4 * tuck - 0.3, 0, 0);
  out[OFF + 1] = -0.5 * tuck - 0.05;
  return out;
}

/** Backstep hop; u in 0..1. */
export function backstepPose(out: Pose, u: number): Pose {
  out.set(STANCE_POSE);
  const k = Math.sin(Math.PI * clamp01(u));
  setJoint(out, 'spine', 0.25 * k, 0, 0);
  setJoint(out, 'chest', 0.15 * k, 0, 0);
  setJoint(out, 'thighR', -0.5 * k, 0, -0.05);
  setJoint(out, 'shinR', 0.8 * k + 0.2, 0, 0);
  setJoint(out, 'thighL', -0.3 * k, 0, 0.05);
  setJoint(out, 'shinL', 0.9 * k + 0.2, 0, 0);
  out[OFF + 1] = -0.12 * k;
  return out;
}

export function deathPose(out: Pose, u: number): Pose {
  const a = keyPose('death_knees');
  const b = keyPose('death_down');
  if (u < 0.45) {
    const t = easeInOut(u / 0.45);
    for (let i = 0; i < out.length; i++) out[i] = STANCE_POSE[i] + (a[i] - STANCE_POSE[i]) * t;
  } else {
    const t = easeInOut((u - 0.45) / 0.55);
    for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  }
  return out;
}

/** Random pose for corpses frozen in place. */
export function corpsePose(kind: 'crawl' | 'reach' | 'slump' | 'hang' | 'curl', seed: number): Pose {
  const p = poseFrom(null, {});
  const r = (k: number): number => noise1(seed * 3.7 + k, seed) * 0.25;
  switch (kind) {
    case 'crawl':
      applySpec(p, {
        hips: [1.5, 0.2 + r(1), 0],
        spine: [0.1, 0, r(2)],
        head: [-0.6, 0.5, 0],
        upperArmR: [-2.9, 0.2 + r(3), -0.3],
        forearmR: [-0.2, 0, 0],
        upperArmL: [-1.8, -0.3, 0.6],
        forearmL: [-1.2, 0, 0],
        thighR: [-0.1, 0, -0.1],
        shinR: [0.6 + r(4), 0, 0],
        thighL: [0.05, 0, 0.2],
        shinL: [0.2, 0, 0],
        footR: [0.9, 0, 0],
        footL: [0.9, 0, 0],
        off: [0, -0.8, 0],
      });
      break;
    case 'reach':
      applySpec(p, {
        hips: [1.2, 0, 0.2],
        spine: [-0.2, 0, 0],
        chest: [-0.2, 0.3, 0],
        head: [-0.9, 0, 0.3],
        upperArmR: [-2.5, 0.4 + r(1), 0],
        forearmR: [-0.1, 0, 0],
        upperArmL: [-0.4, 0, 0.9],
        forearmL: [-0.5, 0, 0],
        thighR: [-0.9, 0, -0.2],
        shinR: [1.6, 0, 0],
        thighL: [-0.3, 0, 0.1],
        shinL: [0.4, 0, 0],
        off: [0, -0.72, 0],
      });
      break;
    case 'slump':
      applySpec(p, {
        spine: [0.5 + r(1), 0, 0.2],
        chest: [0.3, 0, 0],
        head: [0.8, 0.3, 0.3],
        upperArmR: [0.05, 0, -0.2],
        forearmR: [-0.3, 0, 0],
        upperArmL: [0.05, 0, 0.4],
        forearmL: [-0.2, 0, 0],
        thighR: [-1.5, 0.2, -0.2],
        shinR: [0.2, 0, 0],
        thighL: [-1.5, -0.2, 0.3],
        shinL: [0.5, 0, 0],
        off: [0, -0.78, 0],
      });
      break;
    case 'hang':
      applySpec(p, {
        head: [0.7 + r(1), 0, 0.3],
        upperArmR: [0.05, 0, -0.08],
        upperArmL: [0.05, 0, 0.08],
        thighR: [0.05, 0, 0],
        thighL: [0.02, 0, 0],
        footR: [0.7, 0, 0],
        footL: [0.7, 0, 0],
      });
      break;
    case 'curl':
      applySpec(p, {
        hips: [1.5, 0, 1.4],
        spine: [0.7, 0, 0],
        chest: [0.5, 0, 0],
        head: [0.6, 0, 0],
        upperArmR: [-1.2, 0, -0.3],
        forearmR: [-2.0, 0, 0],
        upperArmL: [-1.2, 0, 0.3],
        forearmL: [-2.0, 0, 0],
        thighR: [-1.9, 0, 0],
        shinR: [2.2, 0, 0],
        thighL: [-1.8, 0, 0],
        shinL: [2.3, 0, 0],
        off: [0, -0.75, 0],
      });
      break;
  }
  return p;
}
