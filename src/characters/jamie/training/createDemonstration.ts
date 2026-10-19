import { getJamieState } from "../state";
import type { Battle } from "../../../engine/Battle";
import type { BattleFactory } from "../../../engine/characters";
import { JAMIE_VARIANT_BY_ID, type JamieVariant } from "../moves";
import type { BattleConfig, MoveDemonstration } from "../../../engine/types";

export type JamieDemoScenario = "hit" | "block" | "whiff";

function prerequisitePlan(variant: JamieVariant): string[] {
  if (variant.row === 102) return ["row-0", variant.id];
  if (variant.airborne) return ["jump", variant.id];
  if (!variant.predecessors.length) return [variant.id];
  const predecessor = JAMIE_VARIANT_BY_ID[`row-${variant.predecessors[0]}`];
  return [...prerequisitePlan(predecessor), variant.id];
}

/** A deterministic practice match. Drinks and prerequisite moves use the real move API. */
export function createJamieDemonstration(
  variantId: string,
  config: BattleConfig,
  scenario: JamieDemoScenario = "hit",
  factory: BattleFactory,
  autoplay = true,
): Battle {
  const variant = JAMIE_VARIANT_BY_ID[variantId];
  if (!variant) throw new Error(`Unknown Jamie variant: ${variantId}`);
  const battle = factory({ ...config, fighters: [0, 1].map((index) => { const choice = config.fighters?.[index]; return typeof choice === "object" && choice.characterId === "jamie" ? choice : "jamie"; }) as BattleConfig["fighters"] });
  const [source, target] = battle.state.fighters;
  source.x = source.previousX = 290;
  source.y = source.previousY = 450;
  target.x = target.previousX = 345;
  target.y = target.previousY = 450;
  source.vx = source.vy = target.vx = target.vy = 0;
  // A zero-drink practice baseline also keeps lower-level variants available.
  getJamieState(source)!.drinkLevel = 0;
  getJamieState(source)!.drive = 60000;
  getJamieState(source)!.burnout = false;
  getJamieState(source)!.driveRecoveryWait = 0;
  getJamieState(source)!.super = 30000;
  if (variant.row === 90) source.hp = Math.floor(source.maxHp * 0.25);
  const metadata: MoveDemonstration = { characterId: "jamie", variantId, status: "preparing", scenario, outcome: "pending", title: variant.name, startedAtTick: -1 };
  const special = [96, 97, 99, 100].includes(variant.row);
  const plan = special ? [] : prerequisitePlan(variant);
  if (!special && scenario === "block") {
    getJamieState(target)!.guardUntilTick = 10000;
    getJamieState(target)!.guardLow = JAMIE_VARIANT_BY_ID[plan[0]].low;
    target.facing = -source.facing;
  }
  let next = 0;
  let wallSteps = 0;
  let baselineHits = 0;
  let baselineDamage = 0;
  let seenHit = false;
  let seenBlock = false;
  let endedAt = -1;
  let specialStarted = false;

  function finish(unavailable = false): void {
    metadata.status = "complete";
    metadata.completedAtTick = battle.state.tick;
    const nonAttack = variant.damage === 0 && !variant.throw;
    metadata.outcome = unavailable ? "unavailable" : seenHit ? "hit" : seenBlock ? "block" : nonAttack ? "success" : "whiff";
    battle.state.phase = "finished";
    battle.state.winner = null;
    battle.state.result = "draw";
    battle.state.projectiles = [];
    battle.state.superFreezeRemaining = 0;
    battle.state.superFreezeSourceId = null;
    for (const fighter of battle.state.fighters) { fighter.capture = undefined; fighter.juggleUntilTick = 0; fighter.juggleSourceId = undefined; fighter.pendingHardKnockdown = false; const jamie = getJamieState(fighter); if (jamie) jamie.action = null; }
  }

  function startTarget(): void {
    metadata.status = "running";
    metadata.startedAtTick = battle.state.tick;
    baselineHits = source.hits;
    baselineDamage = source.damageDealt;
    getJamieState(source)!.comboCount = 0;
    getJamieState(source)!.comboUntilTick = 0;
    if (![99, 100].includes(variant.row) && !target.capture) {
      const contactDistance = variant.moveId === "S06" ? 50 + variant.travel * variant.startup / (variant.startup + 10) : 50;
      target.x = Math.min(620, source.x + (scenario === "whiff" ? 300 : contactDistance));
      target.y = source.y;
      getJamieState(target)!.guardUntilTick = scenario === "block" ? battle.state.tick + 1000 : 0;
      getJamieState(target)!.guardLow = variant.low;
      target.facing = -source.facing;
    }
  }

  battle.configureDemonstration(metadata, () => {
    if (metadata.status === "complete") return;
    wallSteps += 1;
    if (wallSteps > 2400) { finish(true); return; }
    const tick = battle.state.tick;
    if (metadata.status === "running") {
      seenHit ||= source.hits > baselineHits;
      seenBlock ||= getJamieState(source)!.action?.blocked ?? false;
      metadata.hits = source.hits - baselineHits;
      metadata.damage = source.damageDealt - baselineDamage;
      metadata.blockCount = Math.max(metadata.blockCount ?? 0, getJamieState(source)!.action?.blockedSegments?.length ?? 0);
      const action = getJamieState(source)!.action;
      if (variant.row === 99 || variant.row === 100) seenHit = false;
      if (battle.state.phase === "finished") { finish(); return; }
      if (!action && endedAt < 0) endedAt = tick;
      if (endedAt >= 0 && tick >= endedAt + 48 && (target.juggleUntilTick ?? 0) <= tick) {
        const outcomeReached = variant.row !== 99 && variant.row !== 100 || (getJamieState(source)!.movesUsed[variant.id] ?? 0) > 0;
        finish(!outcomeReached);
      }
      return;
    }
    // The partner is a stationary training opponent during setup, never a fabricated contact flag.
    if (!target.capture) {
      target.x = Math.min(615, source.x + 50);
      target.y = source.y;
      target.vx = target.vy = 0;
    }
    // Earn the unlock through real drink completion, retrying if interrupted.
    // The shared move gates also require the final drink's recovery to finish.
    if (getJamieState(source)!.drinkLevel < variant.drinkMin) {
      battle.requestMove(source.id, "S01", "row-38");
      return;
    }
    if (special) {
      if (!specialStarted) {
        specialStarted = true;
        if (variant.row === 100) {
          battle.state.projectiles.push({ id: 1, ownerId: target.id, x: source.x + 70, y: source.y - 20, previousX: source.x + 70, previousY: source.y - 20, vx: -180, vy: 0, radius: 10, damage: 5, expiresAt: 300, bounces: 0, gold: false });
        } else {
          if (variant.row === 96) { getJamieState(source)!.guardUntilTick = 200; getJamieState(source)!.guardLow = false; }
          battle.requestMove(target.id, variant.row === 97 ? "N12" : "N01", variant.row === 97 ? "row-11" : "row-0");
        }
      }
      const enemy = getJamieState(target)!.action;
      const startParry = variant.row === 99 && enemy && enemy.frame >= 3 || variant.row === 100 && tick >= 10;
      if (startParry && !getJamieState(source)!.action) {
        if (battle.requestMove(source.id, "D03", "row-98")) startTarget();
      } else if ((variant.row === 96 || variant.row === 97) && battle.requestMove(source.id, variant.moveId, variant.id)) {
        startTarget();
      }
      return;
    }
    const desiredId = plan[next];
    if (!desiredId) { finish(true); return; }
    const desired = JAMIE_VARIANT_BY_ID[desiredId];
    const isTarget = next === plan.length - 1;
    if (desired.airborne && getJamieState(source)!.action?.moveId === "jump" && getJamieState(source)!.action!.frame < 30) return;
    if (isTarget) {
      getJamieState(source)!.comboCount = 0; getJamieState(source)!.comboUntilTick = 0; getJamieState(source)!.comboMoveCount = 0;
      getJamieState(source)!.comboStarterPenalty = 0; getJamieState(source)!.comboImmediatePenalty = 0; getJamieState(source)!.comboMultiplier = 1;
    }
    if (battle.requestMove(source.id, desired.moveId, desired.id)) {
      next += 1;
      if (isTarget) {
        startTarget();
      }
    }
  });
  if (autoplay) battle.start();
  return battle;
}
