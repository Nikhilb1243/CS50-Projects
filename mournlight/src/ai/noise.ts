import * as THREE from 'three';

export interface NoiseEvent {
  pos: THREE.Vector3;
  radius: number;
  time: number;
}

/** Sounds the player makes that creatures can hear (footsteps, combat, landing). */
export class NoiseBus {
  readonly events: NoiseEvent[] = [];
  private now = 0;

  setTime(t: number): void {
    this.now = t;
    while (this.events.length && this.now - this.events[0].time > 0.6) this.events.shift();
  }

  emit(pos: THREE.Vector3, radius: number): void {
    this.events.push({ pos: pos.clone(), radius, time: this.now });
    if (this.events.length > 64) this.events.shift();
  }

  /** Loudest recent noise audible at `p` (scaled by hearing), or null. */
  heard(p: THREE.Vector3, hearing: number): NoiseEvent | null {
    let best: NoiseEvent | null = null;
    let bestScore = 0;
    for (const e of this.events) {
      const d = e.pos.distanceTo(p);
      const r = e.radius * hearing;
      if (d < r) {
        const score = 1 - d / r;
        if (score > bestScore) {
          bestScore = score;
          best = e;
        }
      }
    }
    return best;
  }
}
