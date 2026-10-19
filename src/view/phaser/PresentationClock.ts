/** Counts combat updates and super-intro updates, both of which stop on pause.
 * Sampling the same state twice is inert; renderer FPS never drives the clock. */
export class PresentationClock {
  frame = 0;
  private tick = 0;
  private intros = new Map<string, number>();

  sample(tick: number, intros: readonly { key: string; introFrame: number }[]): number {
    let elapsed = Math.max(0, tick - this.tick);
    const current = new Map<string, number>();
    for (const intro of intros) {
      const frame = Math.max(0, intro.introFrame);
      elapsed += Math.max(0, frame - (this.intros.get(intro.key) ?? 0));
      current.set(intro.key, frame);
    }
    this.tick = tick;
    this.intros = current;
    this.frame += elapsed;
    return elapsed;
  }

  reset(tick = 0): void {
    this.frame = 0;
    this.tick = tick;
    this.intros.clear();
  }
}
