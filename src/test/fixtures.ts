import type { ResolvedBattleConfig } from "../engine/types";
import { normalizeJamieSettings } from "../characters/jamie/config";

// Explicit small-scale fixture preserves the combat regression suite's original damage budgets.
// Production defaults use 10,000 HP and the published move damage at scale 1.
export const DEFAULT_CONFIG: ResolvedBattleConfig = {
  seed: 428003, roundTimeSeconds: 90,
  fighters: [0, 1].map(() => ({ characterId: "jamie", settings: normalizeJamieSettings({ maxHp: 1500, damageScale: 20 / 300 }) })) as ResolvedBattleConfig["fighters"],
};
export const DEFAULT_MATCH_CONFIG = DEFAULT_CONFIG;
