import { getJamieState } from "../state";
import { JAMIE_VARIANTS, JAMIE_VARIANT_BY_ID, type JamieVariant } from "../moves";
import { ARENA, type BattleState, type Fighter } from "../../../engine/types";
import { AISituation } from "../../../engine/ai/StandardAI";
import { getJamieNormalThrowSource } from "../combat/execution";
import { nativeJamieDistance } from "./spacing";

export interface AIPlayerSnapshot {
  crouching: boolean;
  jumpDirection: "forward" | "neutral" | "back";
  moveId: string | null;
  actionCount: number;
  comboScale: number;
  comboHits: number;
  styleTimer: boolean;
  armorHits: number;
  counterHit: boolean;
  punishCounter: boolean;
  perfectParry: boolean;
  hpRatio: number;
  height: number;
  drinkLevel: number;
  drive: number;
  super: number;
  burnout: boolean;
  stunned: boolean;
  knockedDown: boolean;
  caughtInNormalThrow: boolean;
  waking: boolean;
  guarding: boolean;
  canAct: boolean;
  attacking: boolean;
  recovering: boolean;
  lowAttack: boolean;
  actionId: string | null;
  actionStartTick: number;
  actionFrame: number;
  actionRemaining: number;
  connected: boolean;
  blocked: boolean;
  nearWall: boolean;
}

export interface JamieAISnapshot {
  tick: number;
  distance: number;
  /** Physical arena distance; distance above uses the original AI's units. */
  arenaDistance: number;
  directionX: number;
  directionY: number;
  self: AIPlayerSnapshot;
  opponent: AIPlayerSnapshot;
  projectile: { vx: number; vy: number; time: number; distance: number; height: number } | null;
  legalVariants: ReadonlySet<string>;
  ownProjectile: boolean;
  plusFrame: number;
  canCheckPlusFrame: boolean;
}

export type JamieAIInput =
  | { kind: "keys"; direction: number; buttons: number }
  | { kind: "move"; variantId: string }
  | { kind: "approach" | "retreat" | "sidestep" | "guard" };

function playerSnapshot(state: BattleState, fighter: Fighter): AIPlayerSnapshot {
  const jamie = getJamieState(fighter);
  const action = jamie?.action;
  const variant = action ? JAMIE_VARIANT_BY_ID[action.variantId] : undefined;
  const lastActive = variant ? Math.max(variant.startup, ...variant.active.map((window) => window[1])) : 0;
  const knockedDown = !fighter.capture && fighter.knockdownUntilTick > state.tick;
  const stunned = fighter.stunUntilTick > state.tick;
  return {
    crouching: Boolean(fighter.crouching),
    jumpDirection: jamie && jamie.jumpUntilTick > state.tick ? jamie.jumpDirection ?? "neutral" : "neutral",
    moveId: action?.moveId ?? null, actionCount: Object.values(jamie?.movesUsed ?? {}).reduce((sum, count) => sum + count, 0),
    comboScale: jamie?.comboMultiplier ?? 1, comboHits: jamie?.comboCount ?? 0,
    styleTimer: (jamie?.sa2UntilTick ?? 0) > state.tick, armorHits: action?.armorHits ?? 0,
    counterHit: (jamie?.counterHitUntilTick ?? 0) > state.tick,
    punishCounter: (jamie?.punishCounterUntilTick ?? 0) > state.tick,
    perfectParry: Boolean(action && (action.perfectParryUntilTick ?? -1) >= state.tick),
    hpRatio: fighter.hp / fighter.maxHp, height: fighter.height,
    drinkLevel: jamie?.sa2UntilTick && jamie.sa2UntilTick > state.tick ? 4 : jamie?.drinkLevel ?? 0,
    drive: jamie?.drive ?? 0, super: jamie?.super ?? 0, burnout: jamie?.burnout ?? false,
    stunned, knockedDown, caughtInNormalThrow: Boolean(getJamieNormalThrowSource(state, fighter)),
    waking: knockedDown && fighter.knockdownUntilTick - state.tick <= 5,
    guarding: (jamie?.guardUntilTick ?? 0) >= state.tick && (jamie?.lastContactTick ?? -100) >= state.tick - 18,
    canAct: fighter.hp > 0 && !fighter.capture && !stunned && !knockedDown && !action,
    attacking: action ? Boolean(variant?.active.length && action.frame <= lastActive) : fighter.attackUntilTick > state.tick,
    recovering: Boolean(action && !action.captureTargetId && action.frame > lastActive), lowAttack: variant?.low ?? false,
    actionId: action?.variantId ?? null, actionStartTick: action?.startTick ?? -1,
    actionFrame: action?.frame ?? 0, actionRemaining: action ? Math.max(0, action.duration - action.frame) : 0,
    connected: action?.connected ?? false, blocked: action?.blocked ?? false,
    nearWall: fighter.x < ARENA.left + 85 || fighter.x > ARENA.right - 85 || fighter.y < ARENA.top + 150 || fighter.y > ARENA.bottom - 55,
  };
}

/** Predict the current projectile segment only. Future ricochets are not observed. */
function incomingProjectile(state: BattleState, fighter: Fighter): JamieAISnapshot["projectile"] {
  let nearest: JamieAISnapshot["projectile"] = null;
  for (const projectile of state.projectiles) {
    if (projectile.ownerId === fighter.id || projectile.expiresAt <= state.tick) continue;
    const speedSquared = projectile.vx ** 2 + projectile.vy ** 2;
    if (speedSquared < 1) continue;
    const dx = fighter.x - projectile.x;
    const dy = fighter.y - 20 - projectile.y;
    const time = Math.max(0, Math.min(49 / 60, (dx * projectile.vx + dy * projectile.vy) / speedSquared));
    const closest = Math.hypot(projectile.x + projectile.vx * time - fighter.x, projectile.y + projectile.vy * time - (fighter.y - 20));
    if (closest <= fighter.radius + projectile.radius + 12 && (!nearest || time < nearest.time)) nearest = { vx: projectile.vx, vy: projectile.vy, time, distance: Math.hypot(dx, dy), height: 20 };
  }
  return nearest;
}

export function makeJamieAISnapshot(state: BattleState, fighter: Fighter, opponent: Fighter,
  canStart: (state: BattleState, fighter: Fighter, variant: JamieVariant) => boolean): JamieAISnapshot {
  const dx = opponent.x - fighter.x;
  const dy = opponent.y - fighter.y;
  const distance = Math.hypot(dx, dy);
  return {
    tick: state.tick, distance: nativeJamieDistance(distance), arenaDistance: distance,
    directionX: dx / (distance || 1), directionY: dy / (distance || 1),
    self: playerSnapshot(state, fighter), opponent: playerSnapshot(state, opponent),
    projectile: incomingProjectile(state, fighter),
    ownProjectile: state.projectiles.some(p => p.ownerId === fighter.id),
    plusFrame: Math.max(opponent.stunUntilTick, opponent.knockdownUntilTick) - state.tick - Math.max(0, (getJamieState(fighter)?.action?.duration ?? 0) - (getJamieState(fighter)?.action?.frame ?? 0)),
    canCheckPlusFrame: Boolean(getJamieState(fighter)?.action?.connected || getJamieState(fighter)?.action?.blocked || playerSnapshot(state, opponent).recovering),
    legalVariants: new Set(JAMIE_VARIANTS.filter((variant) => canStart(state, fighter, variant)).map((variant) => variant.id)),
  };
}

/** Host observations for native situation IDs. Ordering comes from the recovered constructor. */
export function getJamieSituations(snapshot: JamieAISnapshot): AISituation[] {
  const { self, opponent, arenaDistance: distance } = snapshot;
  if (snapshot.tick <= 1 && !snapshot.projectile && !opponent.attacking && self.canAct) return [AISituation.Start];
  const checks: [AISituation, boolean][] = [
    [AISituation.AIRise, self.waking], [AISituation.AIDown, self.knockedDown],
    [AISituation.NormalThrowCatched, self.caughtInNormalThrow],
    [11, self.stunned && !self.guarding && !self.waking],
    [3, self.height > 25 && opponent.height > 25],
    [5, opponent.moveId?.startsWith("T") === true], [6, opponent.moveId === "S08"],
    [9, opponent.stunned && !opponent.guarding],
    [AISituation.AIGuard, self.guarding], [AISituation.AntiProjectile, snapshot.projectile !== null],
    [AISituation.AntiAir, opponent.height > 25],
    [AISituation.AntiLand, opponent.attacking && distance < 155],
    [AISituation.Punish, opponent.recovering && distance < 155],
    [AISituation.SwingPunish, opponent.recovering && !opponent.connected && !opponent.blocked],
    [AISituation.OpponentDown, opponent.knockedDown],
    [AISituation.OpponentRecovery, opponent.recovering], [AISituation.AIRecovery, self.recovering],
    [AISituation.Standard, true],
  ];
  return checks.filter(([, matches]) => matches).map(([situation]) => situation);
}
