import { Time } from './time';

/**
 * Fixed-timestep loop with interpolated rendering.
 * The simulation always advances in Time.FIXED_DT steps; the renderer receives
 * `alpha` (0..1) describing how far we are between the previous and current
 * simulation states so it can interpolate visuals.
 */
export class GameLoop {
  private accumulator = 0;
  private last = 0;
  private running = false;
  private raf = 0;
  maxDt = 0.1;
  /** Max simulation steps per rendered frame (spiral-of-death guard). */
  maxSteps = 6;

  constructor(
    private readonly time: Time,
    private readonly fixedUpdate: (dt: number) => void,
    private readonly render: (alpha: number, realDt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Drop accumulated time (e.g. after a pause) so we don't spiral. */
  resetAccumulator(): void {
    this.accumulator = 0;
    this.last = performance.now();
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const realDt = Math.min((now - this.last) / 1000, this.maxDt);
    this.last = now;

    const scaled = this.time.advance(realDt);
    this.accumulator += scaled;
    const dt = Time.FIXED_DT;
    let steps = 0;
    while (this.accumulator >= dt && steps < this.maxSteps) {
      this.fixedUpdate(dt);
      this.time.sim += dt;
      this.time.step++;
      this.accumulator -= dt;
      steps++;
    }
    if (steps >= this.maxSteps) this.accumulator = 0;
    this.render(this.accumulator / dt, realDt);
  };
}
