import type { ComponentType } from "react";
import type { BattleRuntime, BattleSummary } from "../runtime/BattleRuntime";

export interface CharacterResourceProps {
  fighter: BattleSummary["fighters"][number]; elapsed: number; frozen: boolean; finished: boolean;
}
export interface CharacterUI {
  Resources?: ComponentType<CharacterResourceProps>;
  TrainingPanel?: ComponentType<{ runtime: BattleRuntime; summary: BattleSummary }>;
  TrainingStatus?: ComponentType<{ summary: BattleSummary }>;
}
