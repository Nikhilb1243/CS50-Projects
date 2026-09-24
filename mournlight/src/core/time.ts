/**
 * Simulation clock. The game loop runs a fixed 60 Hz simulation; this class
 * owns the time scale used for hit-stop and slow motion.
 */
export class Time {
  static readonly FIXED_DT = 1 / 60;

  /** Seconds of real (wall) time since start. */
  real = 0;
  /** Seconds of simulated time since start (affected by time scale). */
  sim = 0;
  /** Number of fixed steps executed. */
  step = 0;
  /** Base time scale (1 = normal). */
  scale = 1;

  private hitstopRemaining = 0;
  private hitstopScale = 0.05;
  private slowmoRemaining = 0;
  private slowmoScale = 1;

  /** Freeze the simulation almost completely for `duration` real seconds. */
  hitstop(duration: number, scale = 0.04): void {
    if (duration > this.hitstopRemaining) {
      this.hitstopRemaining = duration;
      this.hitstopScale = scale;
    }
  }

  slowmo(duration: number, scale: number): void {
    this.slowmoRemaining = Math.max(this.slowmoRemaining, duration);
    this.slowmoScale = scale;
  }

  get currentScale(): number {
    let s = this.scale;
    if (this.hitstopRemaining > 0) s *= this.hitstopScale;
    else if (this.slowmoRemaining > 0) s *= this.slowmoScale;
    return s;
  }

  get inHitstop(): boolean {
    return this.hitstopRemaining > 0;
  }

  /** Advance real time; returns scaled seconds to feed the fixed-step accumulator. */
  advance(realDt: number): number {
    this.real += realDt;
    const s = this.currentScale;
    this.hitstopRemaining = Math.max(0, this.hitstopRemaining - realDt);
    this.slowmoRemaining = Math.max(0, this.slowmoRemaining - realDt);
    return realDt * s;
  }

  resetEffects(): void {
    this.hitstopRemaining = 0;
    this.slowmoRemaining = 0;
  }
}
