import type { FighterId } from "../engine/types";

export interface OpeningStage { fighterId: FighterId; characterId: string; scene: string; label: string; duration: number }
export interface OpeningSnapshot { fighterId: FighterId; scene: string; label: string; progress: number; entrances: Partial<Record<FighterId, number>> }

/** Wall-time presentation only. Neither AI nor the round clock runs during opening. */
export class OpeningSequence {
  private index = 0;
  private elapsed = 0;
  private announced = false;
  constructor(readonly stages: readonly OpeningStage[]) {}
  get complete(): boolean { return this.index >= this.stages.length; }
  advance(delta: number): OpeningStage | undefined {
    if (this.complete) return;
    const stage = this.stages[this.index], announce = !this.announced ? stage : undefined;
    this.announced = true;
    this.elapsed += delta;
    // A slow render may lengthen a gap, but never queues several expired lines together.
    if (this.elapsed >= stage.duration + .08) { this.index++; this.elapsed = 0; this.announced = false; }
    return announce;
  }
  snapshot(): OpeningSnapshot | null {
    if (this.complete) return null;
    const stage = this.stages[this.index], entrances: OpeningSnapshot["entrances"] = {};
    this.stages.forEach((s, i) => { if (s.scene === "entrance") entrances[s.fighterId] = i < this.index ? 1 : i > this.index ? 0 : Math.min(1, this.elapsed / Math.min(1.1, s.duration)); });
    return { fighterId: stage.fighterId, scene: stage.scene, label: stage.label, progress: Math.min(1, this.elapsed / stage.duration), entrances };
  }
}
