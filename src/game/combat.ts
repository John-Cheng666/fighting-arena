import { characters } from "../characters/catalog";
import { resolveHits as resolve } from "../engine/systems/damage";
import { resolveVictory as finish } from "../engine/systems/victory";
import type { BattleState, BattleEvent, PendingHit } from "../engine/types";

export function resolveHits(state: BattleState, hits: readonly PendingHit[], events: BattleEvent[]): void { resolve(state, hits, events, characters); }
export function resolveVictory(state: BattleState, events: BattleEvent[], maxTicks?: number): void { finish(state, events, characters, maxTicks); }
