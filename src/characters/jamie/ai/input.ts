import type { BattleEvent, BattleState, Fighter, FighterId } from "../../../engine/types";
import { JAMIE_VARIANTS, JAMIE_VARIANT_BY_ID, type JamieVariant } from "../moves";
import { getJamieState } from "../state";
import { setJamieActionHold } from "../combat/execution";
import type { JamieAIInput, JamieAISnapshot } from "./snapshot";
import { jamieApproachDirection } from "./spacing";

export interface JamieAIHost {
  canStart(state: BattleState, fighter: Fighter, variant: JamieVariant): boolean;
  requestMove(state: BattleState, fighterId: FighterId, moveId: string, variantId: string, events: BattleEvent[]): boolean;
}
const BUTTONS: Readonly<Record<string, number>> = { LP: 0x10, MP: 0x20, HP: 0x40, LK: 0x80, MK: 0x100, HK: 0x200 };
const countBits = (bits: number) => bits.toString(2).replaceAll("0", "").length;
const crouch = (dir: number) => dir <= 3;

function inputPattern(variant: JamieVariant): { motion: number[]; buttons: number; any: "P" | "K" | null; count: number } {
  const text = variant.input.replace(/\([^)]*\)/g, "").split(">").at(-1)!;
  const motion = [...text.matchAll(/[1-9]/g)].map(match => Number(match[0]));
  const names: string[] = text.match(/LP|MP|HP|LK|MK|HK|P|K/g) ?? [];
  return { motion, buttons: names.reduce((bits, key) => bits | (BUTTONS[key] ?? 0), 0), any: names.includes("P") ? "P" : names.includes("K") ? "K" : null, count: names.filter(key => key === "P" || key === "K").length };
}
const patterns = new Map(JAMIE_VARIANTS.map(variant => [variant.id, inputPattern(variant)]));

function endsWithMotion(history: readonly number[], motion: readonly number[]): boolean {
  const normalized = history.filter(dir => dir !== 5);
  if (motion.length > normalized.length) return false;
  return motion.every((dir, index) => normalized[normalized.length - motion.length + index] === dir);
}

/** The installed STANDARD programs omit only the second diagonal of these supers. */
function matchesVariantMotion(history: readonly number[], variant: JamieVariant, motion: readonly number[]): boolean {
  if (endsWithMotion(history, motion)) return true;
  if (!variant.moveId.startsWith("A")) return false;
  const shortcut = motion.join("") === "236236" ? [2, 3, 6, 2, 6]
    : motion.join("") === "214214" ? [2, 1, 4, 2, 4] : null;
  return shortcut !== null && endsWithMotion(history, shortcut);
}

/** Native keys enter this host recognizer; simulation move requests still obey canStart and cancel windows.
 * Motion history/buffer windows and spatial conversion are arena adapters, not recovered SF6 command tables. */
export function applyJamieKeys(state: BattleState, fighter: Fighter, snapshot: JamieAISnapshot,
  input: Extract<JamieAIInput, { kind: "keys" }>, host: JamieAIHost, events: BattleEvent[]): boolean {
  const jamie = getJamieState(fighter)!;
  const history = jamie.keyHistory ??= [];
  if (history.at(-1)?.tick !== state.tick) history.push({ tick: state.tick, direction: input.direction, buttons: input.buttons });
  while (history.length && history[0].tick < state.tick - 35) history.shift();
  const directions = history.filter((key, index) => index === 0 || key.direction !== history[index - 1].direction).map(key => key.direction);
  const pressed = input.buttons & ~(jamie.previousButtons ?? 0);
  jamie.previousButtons = input.buttons;
  if (pressed) jamie.bufferedKeys = { tick: state.tick, direction: input.direction, buttons: input.buttons };
  const buffered = jamie.bufferedKeys && state.tick - jamie.bufferedKeys.tick <= 5 ? jamie.bufferedKeys : undefined;
  const buttons = buffered?.buttons ?? 0;
  const dir = buffered?.direction ?? input.direction;
  const request = (variant: JamieVariant) => host.requestMove(state, fighter.id, variant.moveId, variant.id, events);

  if (!jamie.action && snapshot.self.canAct) {
    fighter.crouching = crouch(input.direction);
    const moving = [4, 6].includes(input.direction) ? input.direction === 6 ? 1 : -1 : 0;
    const opponent = state.fighters.find(other => other.id !== fighter.id)!;
    const approach = moving > 0 ? jamieApproachDirection(fighter, opponent) : { x: snapshot.directionX, y: snapshot.directionY };
    fighter.vx = approach.x * fighter.speed * moving;
    fighter.vy = approach.y * fighter.speed * moving;
    if ([1, 4, 7].includes(input.direction)) {
      jamie.guardUntilTick = state.tick + 2; jamie.guardLow = crouch(input.direction);
      fighter.facing = snapshot.directionX >= 0 ? 1 : -1;
    }
  }
  if (jamie.action?.moveId === "D03" && (input.buttons & 0x120) !== 0x120) setJamieActionHold(jamie.action, false);
  if (!buttons && !jamie.action && snapshot.self.canAct && input.direction >= 7) {
    const id = input.direction === 9 ? "jump" : input.direction === 7 ? "jump-back" : "jump-neutral";
    return request(JAMIE_VARIANTS.find(v => v.id === id)!);
  }
  if (!buttons && (endsWithMotion(directions, [6, 6]) || endsWithMotion(directions, [4, 4]))) {
    const row = endsWithMotion(directions, [6, 6]) ? jamie.action?.moveId === "D03" ? 101 : jamie.action ? 102 : 93 : 94;
    const variant = JAMIE_VARIANTS[row];
    if (host.canStart(state, fighter, variant) && request(variant)) { jamie.keyHistory = []; return true; }
  }
  if (!buttons) return true;
  const physical = input.buttons || buttons;
  let candidates = JAMIE_VARIANTS.filter(variant => {
    if (!host.canStart(state, fighter, variant) || variant.row >= 99 || variant.held || variant.id.startsWith("walk") || variant.moveId === "crouch" || variant.moveId === "jump") return false;
    if ([95,96,97].includes(variant.row)) return (physical & 0x240) === 0x240 && (variant.row === 95 ? dir !== 6 || !snapshot.legalVariants.has("row-96") && !snapshot.legalVariants.has("row-97") : dir === 6);
    if (variant.row === 98) return (physical & 0x120) === 0x120;
    if (variant.row === 91 || variant.row === 92) return (physical & 0x90) === 0x90 && (variant.row === 92 ? dir === 4 : dir !== 4);
    const pattern = patterns.get(variant.id)!;
    if (pattern.buttons && (buttons & pattern.buttons) !== pattern.buttons) return false;
    if (pattern.any && countBits(buttons & (pattern.any === "P" ? 0x70 : 0x380)) < pattern.count) return false;
    if (!pattern.buttons && !pattern.any) return false;
    if (pattern.motion.length > 1 && !matchesVariantMotion(directions, variant, pattern.motion)) return false;
    if (pattern.motion.length === 1 && (pattern.motion[0] === 2 ? !crouch(dir) : dir !== pattern.motion[0])) return false;
    if (variant.row < 12 && (variant.row >= 6) !== crouch(dir)) return false;
    if (variant.row >= 38 && variant.row <= 86 && pattern.motion.length > 1 && variant.strength !== "OD" && countBits(buttons & (pattern.any === "K" || /K/.test(variant.input) ? 0x380 : 0x70)) > 1) return false;
    return true;
  });
  candidates = candidates.sort((a, b) => {
    // A recognized super motion takes priority over its final button's follow-up input.
    const score = (v: JamieVariant) => ([95,96,97,98].includes(v.row) ? 100 : v.moveId.startsWith("A") ? 95 : v.predecessors.length ? 90 : patterns.get(v.id)!.motion.length * 10 + (v.throw ? 5 : 0)) + (v.strength === "OD" ? 1 : 0);
    return score(b) - score(a);
  });
  for (const candidate of candidates) {
    const variant = candidate.row === 98 ? JAMIE_VARIANT_BY_ID["parry-hold"] : candidate;
    if (!request(variant)) continue;
    jamie.bufferedKeys = undefined;
    if (patterns.get(variant.id)!.motion.length > 1) jamie.keyHistory = [];
    if (variant.row === 98 && input.buttons & 0x120) jamie.action!.held = true;
    return true;
  }
  return true;
}
