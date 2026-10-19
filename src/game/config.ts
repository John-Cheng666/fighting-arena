import type { BattleConfig } from "../engine/types";
import { characters } from "../characters/catalog";

export const DEFAULT_CONFIG: BattleConfig = { seed: 428003, roundTimeSeconds: 99, fighters: ["jamie", "jamie"] };
export const DEFAULT_MATCH_CONFIG = DEFAULT_CONFIG;
export const CHARACTER_IDS = characters.list().map((module) => module.id);
export const FIGHTER_INFO = Object.fromEntries(characters.list().map((module) => [module.id, module.metadata]));
export function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}
