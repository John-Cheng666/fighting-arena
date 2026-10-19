/** Recovered STANDARD AI control flow; game-specific inputs and tuning are supplied by the host. */
export enum AISituation {
  Standard = 0, AntiLand = 1, AntiAir = 2, AirToAir = 3, AntiProjectile = 4,
  AntiNormalThrow = 5, AntiSpecialThrow = 6, NormalThrowCatched = 7, Punish = 8,
  DamagePunish = 9, SwingPunish = 10, AIDamage = 11, AIGuard = 12, AIDown = 13,
  AIStun = 14, AIRecovery = 15, AIRise = 16, AIArmorHit = 17, AIArmorDmg = 18,
  OpponentKuzure = 19, OpponentDown = 20, OpponentStun = 21, OpponentRecovery = 22, OpponentRise = 23,
  OpponentWallBound = 24, OpponentGrdWallBound = 25, WTMPursuit = 26, WTMBackWall = 27,
  Start = 28, Always = 29, Branch = 30,
}

export type AILevels = readonly [number, number, number, number, number, number, number, number];
export type AICondition<S> = (snapshot: S) => boolean;
export type AIDuration = number | { min: number; max: number };
export type AICommand<S, I> =
  /** Native key output is independent of whether a move starts. */
  | { type: "button"; input: I; frames: AIDuration; doHitStop?: boolean; doWorldStop?: boolean }
  /** Host action adapter: retries a legal move request; this is not native key output. */
  | { type: "input"; input: I; frames?: number; timeout?: number }
  | { type: "wait"; frames?: number; until?: AICondition<S>; timeout?: number }
  | { type: "condition"; test: AICondition<S>; not?: boolean; yes: number; no: number }
  | { type: "predicate"; test: AICondition<S>; frames: AIDuration; group?: string; doHitStop?: boolean; doWorldStop?: boolean }
  | { type: "branch"; group: string }
  | { type: "loop"; count: number; end: number }
  | { type: "nativeLoop"; count: AIDuration; end: number }
  | { type: "endLoop"; begin: number }
  | { type: "stop" };

export interface AIEntry<S, I> {
  id: string;
  name: string;
  situation: AISituation;
  /** Negative means any style. Only root collection may fall back to style zero. */
  style?: number;
  probability: AILevels;
  cooldown: AILevels;
  conditions?: readonly AICondition<S>[];
  ngConditions?: readonly AICondition<S>[];
  mute?: boolean;
  breakAtChange?: boolean;
  branchWeight?: number | AILevels;
  enabledLevels?: readonly boolean[];
  commands: readonly AICommand<S, I>[];
}

export interface StandardAIData<S, I> {
  items: readonly AIEntry<S, I>[];
  branches: Readonly<Record<string, readonly AIEntry<S, I>[]>>;
  multiSituation: boolean;
  checkNGConditions: boolean;
  terminatedByBreakFlagOnly?: boolean;
  priorityList?: readonly AISituation[];
  ignoreNonSituation?: boolean;
  situationWeightBias?: Partial<Record<AISituation, number>>;
}

/** Plain per-fighter state: no closures, live fighter references, or shared cooldowns. */
export interface StandardAIState {
  level: number;
  style: number;
  currentItemId: string | null;
  branchGroup: string | null;
  commandIndex: number;
  commandFrame: number;
  commandTick: number;
  nativeCommandTick: number;
  loops: { begin: number; remaining: number }[];
  cooldowns: Record<string, number>;
  situations: AISituation[];
  selectionSituations: AISituation[];
  selectionFlags: number;
  commandDuration: number | null;
  lastCooldownTick: number;
  lastTick: number;
  lastInputTick: number;
  lastDecisionTick: number;
  selections: number;
  candidates: { id: string; weight: number }[];
}

export function createStandardAIState(level = 5, style = 0): StandardAIState {
  return {
    level: Math.max(0, Math.min(7, Math.trunc(level))), style,
    currentItemId: null, branchGroup: null, commandIndex: 0, commandFrame: 0, commandTick: -1, nativeCommandTick: -1,
    loops: [], cooldowns: {}, situations: [], selectionSituations: [], selectionFlags: 0,
    commandDuration: null, lastCooldownTick: -1, lastTick: 0,
    lastInputTick: -1, lastDecisionTick: -1, selections: 0, candidates: [],
  };
}

export function resetStandardAIProgram(ai: StandardAIState): void {
  ai.currentItemId = null;
  ai.branchGroup = null;
  ai.commandIndex = ai.commandFrame = 0;
  ai.commandDuration = null;
  ai.loops = [];
}

/** Native selectCommand uses uint16 / 65535 and the first cumulative weight >= threshold. */
export function selectWeighted<T>(candidates: readonly { value: T; weight: number }[], random: () => number): T | undefined {
  const positive = candidates.filter((candidate) => Number.isFinite(candidate.weight) && candidate.weight > 0);
  const total = positive.reduce((sum, candidate) => Math.fround(sum + Math.fround(candidate.weight)), 0);
  if (!positive.length || !Number.isFinite(total)) return undefined;
  const uint16 = Math.min(65535, Math.max(0, Math.floor(random() * 65536)));
  const threshold = Math.fround(Math.fround(uint16 / 65535) * total);
  let cumulative = 0;
  for (const candidate of positive) {
    cumulative = Math.fround(cumulative + Math.fround(candidate.weight));
    if (threshold <= cumulative) return candidate.value;
  }
  return undefined;
}

export function sampleCommandDuration(duration: AIDuration, random: () => number): number {
  if (typeof duration === "number") return duration;
  const { min, max } = duration;
  if (max <= min) return min;
  const uint16 = Math.min(65535, Math.max(0, Math.floor(random() * 65536)));
  const value = Math.fround(Math.fround(Math.fround(uint16 / 65535) * Math.fround(max - min)) + Math.fround(min));
  return Math.floor(Math.fround(value + 0.5));
}

export function situationFlags(situations: readonly AISituation[]): number {
  return situations.reduce((flags, situation) => flags | 1 << situation, 0) >>> 0;
}

export function resolveAISituations<S, I>(data: StandardAIData<S, I>, matches: readonly AISituation[]): AISituation[] {
  const ordered = data.priorityList ? data.priorityList.filter((situation) => matches.includes(situation)) : [...matches];
  const eligible = ordered.filter((situation) => !data.ignoreNonSituation || data.items.some((entry) => entry.situation === situation));
  if (!data.multiSituation) return eligible.length ? eligible.slice(0, 1) : [AISituation.Standard];
  return [...new Set([AISituation.Standard, ...eligible])];
}

/** Native postUpdateAI reduces each remaining cooldown by one, after think and contact processing. */
export function finishStandardAIFrame(ai: StandardAIState, tick: number): void {
  if (ai.lastCooldownTick === tick) return;
  ai.lastCooldownTick = tick;
  for (const id of Object.keys(ai.cooldowns)) {
    if (--ai.cooldowns[id] <= 0) delete ai.cooldowns[id];
  }
}

export function collectAIEntries<S, I>(
  ai: StandardAIState, data: StandardAIData<S, I>, snapshot: S,
  situations: readonly AISituation[], entries: readonly AIEntry<S, I>[] = data.items,
  flags = situationFlags(situations),
): { value: AIEntry<S, I>; weight: number }[] {
  const selectedSituations = data.multiSituation ? situations : situations.slice(0, 1);
  const active = selectedSituations.includes(AISituation.Start) ? [AISituation.Start]
    : [...new Set([...selectedSituations.filter((s) => s < AISituation.Always), ...((flags | 0) >= 0 ? [AISituation.Always] : [])])].sort((a, b) => a - b);
  const collect = (style: number) => active.flatMap((situation) => entries.flatMap((entry) => {
    if (entry.situation !== situation || entry.mute || entry.enabledLevels?.[ai.level] === false || (ai.cooldowns[entry.id] ?? 0) > 0
      || (entry.style ?? -1) >= 0 && entry.style !== style
      || entry.conditions?.some((test) => !test(snapshot))
      || data.checkNGConditions && entry.ngConditions?.some((test) => test(snapshot))) return [];
    const coefficient = data.multiSituation ? data.situationWeightBias?.[entry.situation] ?? 1 : 1;
    const weight = Math.trunc(Math.fround(Math.fround(entry.probability[ai.level]) * Math.fround(coefficient)));
    return weight > 0 ? [{ value: entry, weight }] : [];
  }));
  const candidates = collect(ai.style);
  return candidates.length || ai.style === 0 ? candidates : collect(0);
}

export interface StandardAIFrame<S, I> {
  tick: number;
  snapshot: S;
  situations: readonly AISituation[];
  random: () => number;
  input: (input: I) => boolean;
  /** The collision-confirmation phase resumes a program, without another neutral selection. */
  allowSelection?: boolean;
  interrupted?: boolean;
  damageState?: boolean;
  situationFlags?: number;
  hitStop?: boolean;
  worldStop?: boolean;
}

export function stepStandardAI<S, I>(ai: StandardAIState, data: StandardAIData<S, I>, frame: StandardAIFrame<S, I>): void {
  const { tick, snapshot } = frame;
  ai.lastTick = tick;
  ai.situations = [...frame.situations];
  const flags = frame.situationFlags ?? situationFlags(frame.situations);
  if (frame.interrupted) { resetStandardAIProgram(ai); return; }
  let branchJumps = 0;
  const start = (entry: AIEntry<S, I>, group: string | null) => {
    ai.currentItemId = entry.id;
    ai.branchGroup = group;
    ai.commandIndex = ai.commandFrame = 0;
    ai.commandDuration = null;
    ai.commandTick = tick;
    ai.nativeCommandTick = -1;
    ai.loops = [];
    ai.selectionSituations = [...frame.situations];
    ai.selectionFlags = flags;
    ai.selections += 1;
    const cooldown = entry.cooldown[ai.level];
    if (cooldown > 0) ai.cooldowns[entry.id] = cooldown;
  };
  const advance = (index = ai.commandIndex + 1) => {
    ai.commandIndex = index;
    ai.commandFrame = 0;
    ai.commandDuration = null;
    ai.commandTick = tick;
    ai.nativeCommandTick = -1;
  };
  const countFrame = () => {
    if (ai.commandTick !== tick) { ai.commandFrame += 1; ai.commandTick = tick; }
  };
  const enterBranch = (group: string): boolean => {
    if (++branchJumps >= 9) { resetStandardAIProgram(ai); return false; }
    const entries = data.branches[group] ?? [];
    const candidates = entries.flatMap((item) => {
      if (item.mute || item.enabledLevels?.[ai.level] === false || (ai.cooldowns[item.id] ?? 0) > 0 || item.probability[ai.level] <= 0
        || (item.style ?? -1) >= 0 && item.style !== ai.style
        || item.conditions?.some((test) => !test(snapshot))
        || data.checkNGConditions && item.ngConditions?.some((test) => test(snapshot))) return [];
      const weight = item.branchWeight;
      return [{ value: item, weight: typeof weight === "number" ? weight : weight?.[ai.level] ?? item.probability[ai.level] }];
    });
    const next = selectWeighted(candidates, frame.random);
    if (!next) { resetStandardAIProgram(ai); return false; }
    start(next, group); return true;
  };
  // A malformed branch/loop cannot monopolize a simulation frame.
  for (let budget = 0; budget <= 100; budget += 1) {
    let entry = (ai.branchGroup ? data.branches[ai.branchGroup] : data.items)?.find((item) => item.id === ai.currentItemId);
    const changesSituation = entry?.breakAtChange && (entry.situation === AISituation.Always
      ? ai.selectionFlags !== flags
      : ![8, 9, 10, 30].includes(entry.situation) && !(flags & 1 << entry.situation));
    const damageTerminates = entry && frame.damageState && !data.terminatedByBreakFlagOnly && ![7, 9, 11].includes(entry.situation);
    if (changesSituation || damageTerminates) {
      resetStandardAIProgram(ai);
      entry = undefined;
    }
    if (!entry) {
      if (frame.allowSelection === false || ai.lastDecisionTick === tick) return;
      ai.lastDecisionTick = tick;
      const candidates = collectAIEntries(ai, data, snapshot, frame.situations, data.items, flags);
      ai.candidates = candidates.map(({ value, weight }) => ({ id: value.id, weight }));
      entry = selectWeighted(candidates, frame.random);
      if (!entry) return;
      start(entry, null);
    }
    const command = entry.commands[ai.commandIndex];
    if (!command || command.type === "stop") { resetStandardAIProgram(ai); return; }
    switch (command.type) {
      case "button": {
        if (ai.lastInputTick === tick) return;
        ai.lastInputTick = tick;
        frame.input(command.input);
        if (ai.commandDuration === null) ai.commandDuration = sampleCommandDuration(command.frames, frame.random);
        if (!(frame.hitStop && !command.doHitStop || frame.worldStop && !command.doWorldStop)) {
          ai.commandFrame += 1;
          ai.commandTick = tick;
          if (ai.commandFrame >= ai.commandDuration) advance();
        }
        return;
      }
      case "input": {
        if (ai.lastInputTick === tick) return;
        ai.lastInputTick = tick;
        const accepted = frame.input(command.input);
        if (accepted) {
          ai.commandFrame += 1;
          ai.commandTick = tick;
          if (ai.commandFrame >= (command.frames ?? 1)) advance();
        } else {
          countFrame();
          if (ai.commandFrame >= (command.timeout ?? 18)) resetStandardAIProgram(ai);
        }
        return; // Input changes the world: wait for the next snapshot before interpreting conditions.
      }
      case "wait":
        if (command.until?.(snapshot)) { advance(); continue; }
        countFrame();
        if (command.until) {
          if (ai.commandFrame >= (command.timeout ?? 240)) resetStandardAIProgram(ai);
          return;
        }
        if (ai.commandFrame >= (command.frames ?? 1)) { advance(); continue; }
        return;
      case "condition":
        advance(command.test(snapshot) !== Boolean(command.not) ? command.yes : command.no);
        continue;
      case "predicate": {
        if (ai.commandDuration === null) ai.commandDuration = sampleCommandDuration(command.frames, frame.random);
        if (command.test(snapshot)) {
          if (command.group) { if (!enterBranch(command.group)) return; }
          else advance();
          continue;
        }
        if (ai.nativeCommandTick !== tick && !(frame.hitStop && !command.doHitStop || frame.worldStop && !command.doWorldStop)) {
          ai.commandFrame += 1; ai.nativeCommandTick = tick;
        }
        if (ai.commandFrame >= ai.commandDuration) {
          if (command.group) advance(); else resetStandardAIProgram(ai);
        }
        return;
      }
      case "branch": {
        if (!enterBranch(command.group)) return;
        continue;
      }
      case "loop":
        if (command.count <= 0) { advance(command.end + 1); continue; }
        ai.loops.push({ begin: ai.commandIndex, remaining: command.count });
        advance();
        continue;
      case "nativeLoop": {
        const count = sampleCommandDuration(command.count, frame.random);
        ai.loops.push({ begin: ai.commandIndex, remaining: count === 0 ? -1 : count });
        advance(); continue;
      }
      case "endLoop": {
        const loop = ai.loops.at(-1);
        if (!loop || loop.begin !== command.begin) { resetStandardAIProgram(ai); return; }
        if (loop.remaining === -1 || --loop.remaining > 0) advance(loop.begin + 1);
        else { ai.loops.pop(); advance(); }
        continue;
      }
    }
  }
  resetStandardAIProgram(ai);
}
