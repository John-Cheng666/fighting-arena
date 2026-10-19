import { Battle } from "./Battle";
import type { BattleFactory } from "../engine/characters";
import type { BattleConfig } from "../engine/types";
import { DEFAULT_CONFIG } from "./config";

export function createDemonstration(characterId: string, variantId: string, config: Partial<BattleConfig> = {}, scenario: "hit" | "block" | "whiff" = "hit",
  factory: BattleFactory = (settings) => new Battle(settings), autoplay = true) {
  const resolved = { ...DEFAULT_CONFIG, ...config };
  const battle = factory(resolved);
  const training = battle.characters.get(characterId).training;
  if (!training) throw new Error("该角色没有安装招式演练模块");
  return training.create(variantId, resolved, scenario, factory, autoplay);
}
