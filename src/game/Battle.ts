import { Battle as Match } from "../engine/Battle";
import type { BattleConfig } from "../engine/types";
import { characters } from "../characters/catalog";

/** Application composition root. Tests and embedded games may inject their own registry. */
export class Battle extends Match {
  constructor(config: BattleConfig) { super(config, characters); }
}
