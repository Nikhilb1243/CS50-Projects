import type * as THREE from 'three';
import type { Physics } from './physics';
import type { Time } from './time';
import type { Input } from './input';
import type { ThirdPersonCamera } from './camera';
import type { AudioEngine } from '../audio/audio';
import type { Ambience } from '../audio/ambience';
import type { Particles } from '../fx/particles';
import type { GpuParticles } from '../fx/gpuparticles';
import type { Abilities } from '../combat/abilities';
import type { CombatSystem } from '../combat/combat';
import type { HazardSystem } from '../combat/hazards';
import type { LightManager } from '../world/lights';
import type { NoiseBus } from '../ai/noise';
import type { World } from '../world/world';
import type { Player } from '../entities/player';
import type { Enemy } from '../ai/enemy';

export interface DebugFlags {
  enabled: boolean;
  hitboxes: boolean;
  god: boolean;
  fps: boolean;
}

/** Shared services handed to entities and systems. */
export interface GameContext {
  scene: THREE.Scene;
  physics: Physics;
  audio: AudioEngine;
  ambience: Ambience;
  particles: Particles;
  gpu: GpuParticles;
  abilities: Abilities;
  combat: CombatSystem;
  hazards: HazardSystem;
  lights: LightManager;
  noise: NoiseBus;
  time: Time;
  cam: ThirdPersonCamera;
  input: Input;
  debug: DebugFlags;
  world: World;
  player: Player;
  enemies: Enemy[];
  /** Deep-region bosses (lockable, not Enemy subclasses). */
  bosses: import('../ai/bosses').DeepBoss[];
  hitstop(duration: number, scale?: number): void;
  shake(amount: number): void;
  flash(amount: number, color?: THREE.ColorRepresentation): void;
  message(text: string, duration?: number): void;
}
