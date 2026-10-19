import type { BattleEvent, CharacterId, FighterId } from "../../engine/types";

export class BattleAudio {
  private context: AudioContext | null = null;
  private enabled = false;
  private lastNoteTime = 0;
  constructor(private readonly profile: (id: string) => { hitFrequency: number; hitWave: OscillatorType } | undefined = () => undefined) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      void this.context?.suspend().catch(() => undefined);
      return;
    }
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => undefined);
    } catch {
      this.enabled = false;
    }
  }

  consume(events: readonly BattleEvent[], fighters: readonly { id: FighterId; characterId: CharacterId }[]): void {
    if (!this.enabled || !this.context || this.context.state !== "running")
      return;
    for (const event of events) {
      if (event.type === "hit") {
        const character = fighters.find((fighter) => fighter.id === event.sourceId)?.characterId;
        this.tone(
          this.profile(character ?? "")?.hitFrequency ?? 190,
          0.07,
          this.profile(character ?? "")?.hitWave ?? "triangle",
        );
      }
      else if (event.type === "drink") {
        this.tone(440, 0.09, "sine");
        this.tone(660, 0.12, "sine", 0.09);
      }
      else if (event.type === "block")
        this.tone(event.perfect ? 880 : 320, 0.045, "triangle");
      else if (event.type === "move" && event.category === "super") {
        this.tone(110, 0.16, "sawtooth");
        this.tone(220, 0.19, "triangle", 0.09);
      }
      else if (event.type === "cast") this.tone(440, 0.1, "sine");
      else if (event.type === "finished") {
        [523.25, 659.25, 783.99, 1046.5].forEach((frequency, i) =>
          this.tone(frequency, 0.22, "sine", i * 0.12),
        );
      }
    }
  }

  pause(): void {
    void this.context?.suspend().catch(() => undefined);
  }

  resume(): void {
    if (this.enabled) void this.context?.resume().catch(() => undefined);
  }

  dispose(): void {
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }

  private tone(
    frequency: number,
    duration: number,
    wave: OscillatorType,
    delay = 0,
  ): void {
    const context = this.context!;
    const start = context.currentTime + delay;
    if (delay === 0 && start - this.lastNoteTime < 0.035) return;
    this.lastNoteTime = start;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.045, start + 0.009);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }
}
