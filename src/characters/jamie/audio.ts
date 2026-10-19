import catalogData from "../../content/audio/catalog.json";
import audioData from "./data/audio.json";
import type { AudioCatalog, CharacterAudio } from "../../content/audio/types";
import type { HitContext } from "../../engine/characters";
import type { BattleEvent, BattleState, Fighter } from "../../engine/types";
import { JAMIE_THROW_DRINK, JAMIE_VARIANT_BY_ID, type JamieVariant } from "./moves";
import { getJamieState } from "./state";
import type { JamieAction } from "./types";

const sounds = audioData as CharacterAudio;
const catalog = catalogData as AudioCatalog;
type Track = { id: number; frame: number; key: string; start?: number };

function emit(state: BattleState, fighter: Fighter, events: BattleEvent[], clipId: string, channel: "sfx" | "voice", scope: string): void {
  if (!catalog.clips[clipId]) return;
  events.push({ type: "audio", tick: state.tick, fighterId: fighter.id, clipId, channel, scope });
}

export function emitJamieVoice(state: BattleState, fighter: Fighter, events: BattleEvent[], voiceId: number, scope?: string, stopWithAction = false): void {
  if (!catalog.voices?.[fighter.characterId]?.requests[voiceId]) return;
  events.push({ type: "voice", tick: state.tick, fighterId: fighter.id, characterId: fighter.characterId, voiceId, scope, stopWithAction });
}

function track(state: BattleState, fighter: Fighter, action: JamieAction, value: Track, events: BattleEvent[], slot: "audio" | "audioVictim" = "audio"): void {
  const definition = sounds.actions[value.id];
  if (!definition) return;
  let cursor = action[slot];
  if (!cursor || cursor.key !== value.key) {
    if (cursor) events.push({ type: "audio-stop", tick: state.tick, fighterId: fighter.id, scope: cursor.scope, loopsOnly: true });
    if (cursor) events.push({ type: "voice-stop", tick: state.tick, fighterId: fighter.id, scope: cursor.scope, actionOnly: true });
    cursor = action[slot] = { key: value.key, actionId: value.id, frame: (value.start ?? 0) - 1,
      fired: [], scope: `${fighter.id}:${action.startTick}:${action.variantId}:${value.key}` };
  }
  const end = definition.marginFrame !== undefined && definition.marginFrame >= 0 ? definition.marginFrame : Infinity;
  const dispatched = new Set<string>();
  for (let index = 0; index < definition.cues.length; index++) {
    const cue = definition.cues[index];
    if (cursor.fired.includes(index) || cue.frame <= cursor.frame || cue.frame > value.frame || cue.frame >= end) continue;
    cursor.fired.push(index);
    // Collapse aliases on one authored frame, independently of how often the
    // consumer drains events. Several intro frames may share a combat tick.
    const alias = `${cue.frame}:${cue.clipId}`;
    if (dispatched.has(alias)) continue;
    dispatched.add(alias);
    emit(state, fighter, events, cue.clipId, cue.kind === "voice" ? "voice" : "sfx", cursor.scope);
  }
  const style = slot === "audio" ? action.nativeStyleAtStart ?? 0 : getJamieState(fighter)?.drinkLevel ?? 0;
  const voices = definition.voiceCues?.[style] ?? definition.voiceCues?.[0] ?? [];
  for (let index = 0; index < voices.length; index++) {
    const cue = voices[index], token = definition.cues.length + index;
    if (cursor.fired.includes(token) || cue.frame <= cursor.frame || cue.frame > value.frame || cue.frame >= end) continue;
    cursor.fired.push(token);
    emitJamieVoice(state, fighter, events, cue.voiceId, cursor.scope, cue.stopWithAction);
  }
  for (let index = 0; index < (definition.controls?.length ?? 0); index++) {
    const control = definition.controls![index], token = -index - 1;
    if (cursor.fired.includes(token) || control.frame <= cursor.frame || control.frame > value.frame) continue;
    cursor.fired.push(token);
    // Only byte-verified stop targets are actionable. An unresolved control is never global silence.
    if (control.stopClipIds?.length) events.push({ type: "audio-stop", tick: state.tick, fighterId: fighter.id, clipIds: control.stopClipIds, fadeMs: control.fadeMs });
  }
  cursor.frame = Math.max(cursor.frame, value.frame);
}

function actionTrack(state: BattleState, fighter: Fighter, action: JamieAction, variant: JamieVariant, raw: number): Track | null {
  const jamie = getJamieState(fighter)!;
  const capture = action.throwPunish ? variant.nativePunishCapture ?? variant.nativeCapture : variant.nativeCapture;
  if (action.confirmedAtFrame !== undefined && capture) {
    const elapsed = action.frame - action.confirmedAtFrame;
    if (variant.id === "row-91-drink" && action.connected && elapsed >= JAMIE_THROW_DRINK.branchFrame) return { id: 728, frame: elapsed - JAMIE_THROW_DRINK.branchFrame, key: "throw-drink" };
    return { id: capture.actionId, frame: elapsed, key: `capture:${capture.actionId}` };
  }
  let id = variant.nativeActionId;
  if (id === undefined) return null;
  if (variant.id === "row-87-drink" && raw >= 119) return { id: (action.nativeStyleAtStart ?? 0) >= 4 ? 1202 : 1201, frame: raw - 119, key: "sa1-drink" };
  if (variant.moveId === "S01") {
    const full = (action.nativeStyleAtStart ?? 0) >= 4;
    if (variant.held && action.frame >= 23 && (action.held || action.audioHoldEntered)) {
      action.audioHoldEntered = true;
      const exit = action.audioExitFrame ?? action.duration - 25;
      if (action.frame >= exit) return { id: full ? 1016 : 1012, frame: action.frame - exit, key: "drink-release" };
      const cycle = Math.floor((action.frame - 23) / 48);
      return { id: full ? 1015 : 1011, frame: (action.frame - 23) % 48, key: `drink:${cycle}` };
    }
    id = full ? 1014 : 1010;
  }
  if (variant.moveId === "S03" && [918, 922, 926, 930].includes(id) && (action.nativeStyleAtStart ?? 0) >= 4) id++;
  if (variant.moveId === "S08") id = variant.strength === "OD" ? 990 : 982;
  if (variant.moveId === "S05" && !action.connected) {
    const branch = ({ L: 13, M: 15, H: 17, OD: 13 } as Record<string, number>)[variant.strength];
    if (raw >= branch) {
      const start = variant.strength === "L" ? 0 : 15;
      return { id: 973, frame: start + raw - branch, key: "arrow-miss", start };
    }
  }
  if (variant.moveId === "S06" && state.tick >= jamie.jumpUntilTick) {
    return { id: id + 4, frame: Math.max(0, state.tick - jamie.jumpUntilTick), key: "dive-land" };
  }
  return { id, frame: raw, key: `action:${id}` };
}

/** Native regular rows are one-based in this host; capture rows retain raw zero-based time. */
export function advanceJamieAudio(state: BattleState, fighter: Fighter, events: BattleEvent[], intro = false): void {
  const action = getJamieState(fighter)?.action;
  if (!action) return;
  const variant = JAMIE_VARIANT_BY_ID[action.variantId];
  const inIntro = intro || action.frame === 0 && (action.introFrame ?? 0) < (action.introDuration ?? 0);
  const raw = Math.max(0, (inIntro ? action.introFrame ?? 0 : action.frame + (action.introDuration ?? 0)) - 1);
  const value = actionTrack(state, fighter, action, variant, raw);
  if (!value) return;
  track(state, fighter, action, value, events);
  if (value.key.startsWith("capture:")) {
    const target = state.fighters.find(f => f.id === action.captureTargetId);
    if (target && sounds.actions[value.id + 1]) track(state, target, action, { ...value, id: value.id + 1, key: `${value.key}:victim` }, events, "audioVictim");
  }
}

export function stopJamieAudio(state: BattleState, fighter: Fighter, events: BattleEvent[]): void {
  const action = getJamieState(fighter)?.action;
  for (const [cursor, actor] of [[action?.audio, fighter], [action?.audioVictim, state.fighters.find(f => f.id === action?.captureTargetId)]] as const) {
    if (cursor && actor) events.push({ type: "audio-stop", tick: state.tick, fighterId: actor.id, scope: cursor.scope, loopsOnly: true });
    if (cursor && actor) events.push({ type: "voice-stop", tick: state.tick, fighterId: actor.id, scope: cursor.scope, actionOnly: true });
  }
}

/** Upgrade feedback is tied to an actual resource transition, including drink finish branches. */
export function emitJamieDrinkAudio(state: BattleState, fighter: Fighter, before: number, events: BattleEvent[]): void {
  const jamie = getJamieState(fighter)!;
  if (before >= 4 || jamie.drinkLevel < 4 || jamie.action?.audioLevel4Played) return;
  if (jamie.action) jamie.action.audioLevel4Played = true;
  for (const cue of sounds.actions[1013]?.cues ?? []) if (cue.soundId === 21299) emit(state, fighter, events, cue.clipId, "sfx", `upgrade:${fighter.id}:${state.tick}`);
}

function feedback(name: string, state: BattleState, fighter: Fighter, events: BattleEvent[]): void {
  for (const id of new Set(catalog.feedback[name] ?? [])) emit(state, fighter, events, id, "sfx", `feedback:${fighter.id}:${state.tick}`);
}

/** Contacts are authoritative: no hit layer is started by a move or speculative collision window. */
export function emitJamieContactAudio(context: HitContext): void {
  const { state, hit, source, target, events, outcome, details } = context;
  if (outcome.kind === "ignored") return;
  const action = getJamieState(source)?.action;
  const variant = hit.variantId ? JAMIE_VARIANT_BY_ID[hit.variantId] : action ? JAMIE_VARIANT_BY_ID[action.variantId] : undefined;
  if (details?.parry) {
    feedback(details.perfect ? hit.projectile ? "perfect-shell" : "perfect-parry" : "parry", state, target, events);
    if (details.perfect) emitJamieVoice(state, target, events, 726);
    return;
  }
  const profile = hit.nativeAttackId === undefined ? undefined : sounds.contacts[hit.nativeAttackId];
  const ids = outcome.kind === "block" ? profile?.guard : details?.punish ? profile?.punish ?? profile?.counter ?? profile?.normal : details?.counter ? profile?.counter ?? profile?.normal : profile?.normal;
  for (const id of new Set(ids ?? [])) emit(state, source, events, id, "sfx", `contact:${source.id}:${state.tick}:${hit.nativeAttackId ?? hit.segment ?? 0}`);
  // DI's impact is already an authored action cue. Guard feedback is an independent event.
  if (variant?.moveId === "D01" && outcome.kind === "block" && !ids?.length) feedback("drive-guard", state, source, events);
  if (details?.armorBreak) feedback("armor-break", state, target, events);
  if (outcome.kind === "hit" && action?.rushEnhanced) feedback("drive-rush-hit", state, source, events);
  if (outcome.kind === "block" && variant?.moveId === "D01" && (target.wallSplatUntilTick ?? 0) > state.tick) {
    feedback(getJamieState(target)?.burnout ? "stun" : "guard-break", state, target, events);
    emitJamieVoice(state, target, events, getJamieState(target)?.burnout ? 605 : 606);
  }
  if (outcome.kind === "hit" && outcome.amount > 0 && target.hp > 0) emitJamieVoice(state, target, events, profile?.voiceId ?? 600);
}
