import official from "./data/jamie-official-frame.json";
import catalog from "./data/jamie-move-catalog.json";
import type { JamieAction } from "./types";
import { JAMIE_NATIVE_MOVES, JAMIE_NATIVE_VARIANTS, nativeMoveDamage, type NativeCapture, type NativeHit, type NativeMove } from "./combat/nativeData";

export const JAMIE_SOURCES = {
  character: "https://www.streetfighter.com/6/zh-hant/character/jamie",
  moves: "https://www.streetfighter.com/6/zh-hant/character/jamie/movelist",
  frames: official.source,
  captured: official.capturedAtUtc,
};
/** Raw, locally bundled evidence: 103 official rows, including the 18 normals. */
export const JAMIE_OFFICIAL_ROWS = official.rows;
export const JAMIE_MOVE_CATALOG = catalog;
export const JAMIE_NORMAL_MOVES = official.rows.slice(0, 18).map((row, index) => ({
  id: `N${String(index + 1).padStart(2, "0")}`,
  officialName: row.name,
  input: row.input,
  drinkMin: 0,
  category: "Normal Moves",
  video: "",
}));

export interface JamieVariant {
  id: string;
  row: number;
  moveId: string;
  name: string;
  input: string;
  strength: "L" | "M" | "H" | "OD" | "normal";
  drinkMin: number;
  level4Only: boolean;
  startup: number;
  active: [number, number][];
  duration: number;
  damage: number;
  driveCost: number;
  /** Native trigger requirement can be smaller than its consumed Drive amount. */
  driveNeed?: number;
  nativeActionId?: number;
  nativeHits?: NativeHit[];
  nativeMove?: NativeMove;
  nativeCapture?: NativeCapture;
  nativePunishCapture?: NativeCapture;
  nativeTimerStops?: { from: number; to: number }[];
  nativeLevel4DriveFrame?: number;
  nativeLevel4DriveRestore?: number;
  superCost: number;
  pose: JamieAction["pose"];
  range: number;
  travel: number;
  knockdown: number;
  launch: number;
  drinkFrame: number;
  driveRestore: number;
  airborne: boolean;
  predecessors: number[];
  cancel: string;
  low: boolean;
  overhead: boolean;
  crossUp: boolean;
  throw: boolean;
  notes: string;
  behavior: "normal" | "target" | "drink" | "rekka" | "palm" | "uppercut" | "dive" | "bakkai" | "command-grab" | "super-spin" | "super-install" | "super-cinematic" | "throw" | "impact" | "reversal" | "parry" | "rush" | "movement" | "stance";
  recovery: number;
  hitAdvantage: number;
  blockAdvantage: number;
  driveGain: number;
  superGain: number;
  driveBlockLoss: number;
  punishDriveLoss: number;
  minimumScaling: number;
  hitWeights: number[];
  drinkFrames: number[];
  drinkOnCompletion: boolean;
  freezeFrames: number;
  capture: "none" | "multi" | "throw" | "cinematic";
  cinematicHits: { frame: number; weight: number; pose: JamieAction["pose"] }[];
  cinematicTimeScale: number;
  timelineSource: string;
  scaling: { starter: number; immediate: number; combo: number; multiplier: number };
  scalingSource: string;
  held?: boolean;
  jumpDirection?: "forward" | "neutral" | "back";
  posture?: "stand" | "crouch";
}

function moveId(row: number): string {
  if (row < 18) return `N${String(row + 1).padStart(2, "0")}`;
  if (row < 38) return ["U01", "U02", "U02", "U03", "U04", "U05", "U06", "U06", "U06", "U07", "U07", "U07", "U08", "U08", "U08", "U09", "U09", "U09", "U09", "U09"][row - 18];
  if (row === 38) return "S01";
  if (row < 59) return "S02";
  if (row < 67) return "S03";
  if (row < 71) return "S04";
  if (row < 75) return "S05";
  if (row < 79) return "S06";
  if (row < 83) return "S07";
  if (row < 85) return "S08";
  if (row < 87) return "S09";
  if (row === 87) return "A01";
  if (row === 88) return "A02";
  if (row < 91) return "A03";
  if (row === 91) return "T01";
  if (row === 92) return "T02";
  if (row === 93) return "dash";
  if (row === 94) return "backstep";
  if (row === 95) return "D01";
  if (row < 98) return "D02";
  if (row < 101) return "D03";
  return row === 101 ? "D04" : "D05";
}

function predecessors(row: number): number[] {
  const direct: Record<number, number[]> = {
    19: [11], 20: [19], 25: [24], 26: [25], 28: [27], 29: [28],
    31: [30], 32: [31], 34: [33], 35: [34], 36: [34], 37: [34],
    47: [39], 48: [41], 49: [43], 50: [40, 42, 44], 51: [45], 52: [46],
    53: [47], 54: [48], 55: [49], 56: [50], 57: [51], 58: [52],
    59: [39, 40], 60: [41, 42], 61: [43, 44], 62: [45, 46],
    63: [59], 64: [60], 65: [61], 66: [62],
    85: [67, 68, 69], 86: [70], 101: [98, 99, 100],
  };
  return direct[row] ?? [];
}

function makeVariant(row: number): JamieVariant {
  const source = official.rows[row];
  const id = moveId(row);
  const entry = catalog.find((move) => move.id === id);
  const windows: [number, number][] = source.activeSegments.flatMap((segment) => {
    const match = segment.match(/(?:\[\*2\]\s*)?(\d+)(?:-(\d+|until landing))?/);
    return match ? [[Number(match[1]), match[2] === "until landing" ? 30 : Number(match[2] ?? match[1])] as [number, number]] : [];
  });
  const startup = Number.parseInt(source.startup, 10) || 0;
  const recovery = Number.parseInt(source.recovery, 10) || 0;
  const lastActive = Math.max(0, ...windows.map((window) => window[1]));
  const duration = source.recovery.includes("total") ? recovery : lastActive + recovery;
  const kick = /Kick|Bakkai|Breakin|Sway|Moon|Senei/.test(source.name);
  let pose: JamieAction["pose"] = kick ? "kick" : "punch";
  if (id === "S01" || [20, 29, 37].includes(row)) pose = "drink";
  if (["S07", "A01"].includes(id)) pose = "spin";
  if (["S04", "S09"].includes(id)) pose = "palm";
  if (["A02", "A03"].includes(id)) pose = "super";
  if (["T01", "T02", "S08"].includes(id)) pose = "grab";
  if (id === "D03") pose = "parry";
  if (["D04", "D05", "dash", "backstep"].includes(id)) pose = "rush";
  const behavior: JamieVariant["behavior"] = row < 18 ? "normal" : id === "S01" || [20, 29, 37].includes(row) ? "drink" : id === "S02" || id === "S03" ? "rekka" : id === "S04" || id === "S09" ? "palm" : id === "S05" ? "uppercut" : id === "S06" ? "dive" : id === "S07" ? "bakkai" : id === "S08" ? "command-grab" : id === "A01" ? "super-spin" : id === "A02" ? "super-install" : id === "A03" ? "super-cinematic" : throwMoveFor(id) ? "throw" : id === "D01" ? "impact" : id === "D02" ? "reversal" : id === "D03" ? "parry" : id === "D04" || id === "D05" ? "rush" : id === "dash" || id === "backstep" ? "movement" : row === 34 ? "stance" : "target";
  const strength = source.name.includes("OD ") ? "OD" : source.name.match(/(?:^|\])([LMH]) /)?.[1] as "L" | "M" | "H" | undefined;
  const drinkFrame = Number(source.notes.match(/(?:on|at) frame (\d+)/)?.[1] ?? 0);
  const level4 = source.name.startsWith("[Drink level 4]");
  const air = row >= 12 && row < 18 || id === "S06";
  const throwMove = ["T01", "T02", "S08"].includes(id);
  const scalingText = source.comboScaling.replaceAll("％", "%");
  const scalingPercent = (label: string) => Number(scalingText.match(new RegExp(`${label} scaling (\\d+)%`))?.[1] ?? 0) / 100;
  return {
    id: `row-${row}`, row, moveId: id, name: source.name, input: source.input,
    strength: strength ?? "normal", drinkMin: level4 ? 4 : entry?.drinkMin ?? 0,
    level4Only: level4, startup, active: windows, duration: Math.max(1, duration),
    damage: Number.parseInt(source.damage, 10) || 0,
    driveCost: [45, 46, 70, 74, 78, 82, 84].includes(row) ? 20000 : row === 95 ? 10000 : row === 101 ? 5000 : row === 96 || row === 97 ? 20000 : row === 102 ? 30000 : row === 98 ? 5000 : 0,
    superCost: row === 87 ? 10000 : row === 88 ? 20000 : row === 89 || row === 90 ? 30000 : 0,
    pose,
    range: throwMove ? 58 : id === "S04" || id === "S09" ? 95 : id === "S07" ? 92 : id.startsWith("A") ? 110 : kick ? 88 : /Heavy/.test(source.name) ? 83 : /Medium/.test(source.name) ? 75 : 67,
    travel: id === "S04" ? (strength === "H" ? 140 : strength === "M" || strength === "OD" ? 105 : 75) : id === "S07" ? strength === "L" ? 100 : strength === "M" ? 125 : strength === "H" ? 150 : 160 : id === "S02" ? 35 : ["D04", "D05", "dash"].includes(id) ? 135 : id === "backstep" ? -95 : id === "S06" ? strength === "L" ? 65 : strength === "M" ? 95 : strength === "H" ? 130 : 105 : id === "U05" || row === 33 ? 35 : 0,
    knockdown: id === "S08" || row === 89 || row === 18 ? 0 : throwMove ? 45 : source.hitAdvantage.includes("D") ? 42 : 0,
    launch: row === 89 ? 160 : id === "S05" ? 75 : row === 18 ? 58 : 0,
    drinkFrame, driveRestore: row === 38 ? 0 : row === 20 ? 2500 : row === 37 ? 10000 : 5000,
    airborne: air, predecessors: predecessors(row), cancel: source.cancel,
    low: source.properties.includes("Low"), overhead: source.properties.includes("Mid"),
    crossUp: source.notes.includes("cross-up"),
    throw: throwMove, notes: source.notes,
    behavior, recovery, hitAdvantage: Number.parseInt(source.hitAdvantage, 10) || 0,
    blockAdvantage: Number.parseInt(source.blockAdvantage, 10) || 0,
    driveGain: Number.parseInt(source.driveGainOnHit, 10) || 0,
    superGain: Number.parseInt(source.superArtGaugeGain, 10) || 0,
    driveBlockLoss: Math.abs(Number.parseInt(source.driveLossOnBlock, 10) || 0),
    punishDriveLoss: Math.abs(Number.parseInt(source.driveLossOnPunishCounter, 10) || 0),
    minimumScaling: row === 87 ? 0.3 : row === 89 || row === 90 ? 0.5 : 0.1,
    hitWeights: windows.map(() => 1), drinkFrames: drinkFrame ? [drinkFrame] : [], drinkOnCompletion: false,
    freezeFrames: id.startsWith("A") ? row === 88 ? 100 : 35 : row === 101 ? 10 : row === 102 ? 9 : 0,
    capture: row === 87 || id === "S05" ? "multi" : id === "A03" ? "cinematic" : throwMove && id !== "S08" ? "throw" : "none",
    cinematicHits: id === "A03" ? [
      { frame: 0, weight: 1, pose: "kick" }, { frame: 28, weight: 1, pose: "spin" },
      { frame: 70, weight: 0, pose: "taunt" }, { frame: 90, weight: 1, pose: "punch" },
      { frame: 120, weight: 1, pose: "grab" }, { frame: 145, weight: 1, pose: "punch" },
      { frame: 170, weight: 1, pose: row === 90 ? "grab" : "palm" },
      { frame: row === 90 ? 220 : 200, weight: 2, pose: row === 90 ? "grab" : "kick" },
      { frame: row === 90 ? 245 : 215, weight: 2, pose: row === 89 ? "kick" : "super" },
    ] : [],
    cinematicTimeScale: id === "A03" ? 2 : 1,
    timelineSource: "Official active windows and aggregate damage; unpublished per-hit damage is distributed while preserving the aggregate. Cinematic beats and intro freeze lengths are arena choreography based on the official videos, not official hitbox frames.",
    scaling: { starter: scalingPercent("Starter"), immediate: scalingPercent("Immediate"), combo: scalingPercent("Combo"), multiplier: scalingPercent("Multiplier") },
    scalingSource: "Percentages are the official row values. Arena formula: per-move base 100/100/80/70…; Starter affects later moves, Immediate/Combo reduce combo entries, and Rush multiplies by 0.85. Raw table damage is preserved, including raw SA3/CA. Exact SF6 stacking/rounding and asterisk exceptions are not certified.",
    ...(row >= 6 && row < 12 ? { posture: "crouch" as const } : {}),
  };
}

function throwMoveFor(id: string): boolean { return id === "T01" || id === "T02"; }

// Captured action720 branches at raw80 into action728. Its drink event is at
// local50; local56 is the playable margin, before the animation's trailing frames.
export const JAMIE_THROW_DRINK = { branchFrame: 80, drinkFrame: 50, recoveryFrame: 56 } as const;

/** All official strength, OD, stage and timing rows remain individually addressable. */
export const JAMIE_VARIANTS: JamieVariant[] = official.rows.map((_, row) => makeVariant(row));
// Installed resources take precedence over the independently versioned website.
// Keep the website's labels/notation, and preserve unresolved captured sequences
// as explicit arena adaptations until their unique-event evaluator is recovered.
for (const variant of JAMIE_VARIANTS) {
  const native = JAMIE_NATIVE_MOVES.get(variant.row);
  if (!native) continue;
  variant.nativeActionId = native.actionId;
  variant.nativeMove = native;
  variant.nativeTimerStops = native.timerStops;
  variant.nativeCapture = native.captured;
  variant.nativePunishCapture = native.punishCaptured;
  if (native.captured && variant.moveId === "A03") variant.cinematicTimeScale = native.captured.duration / (variant.row === 90 ? 260 : 240);
  if (native.captured && variant.moveId === "S08") variant.capture = "multi";
  variant.startup = native.startup;
  variant.active = native.hits.flatMap(hit => hit.active.map(([from, to]) => [from, to] as [number, number]));
  variant.nativeHits = native.hits.flatMap(hit => hit.active.map(() => hit));
  if (native.duration !== null) variant.duration = Math.max(1, native.duration);
  if (native.recovery !== null) variant.recovery = native.recovery;
  variant.driveNeed = native.driveNeed;
  variant.driveCost = native.driveCost;
  variant.superCost = native.superCost;
  variant.freezeFrames = native.freezeFrames;
  if (variant.row === 38) variant.driveRestore = 2500;
  if (!native.composite && native.hits.some(hit => hit.damage > 0)) variant.damage = nativeMoveDamage(native.hits);
  if (native.rawDamageTotal !== undefined) variant.damage = native.rawDamageTotal;
  variant.hitWeights = variant.nativeHits.map(hit => hit.damage);
  if (native.scaling.starter >= 0) variant.scaling.starter = native.scaling.starter / 100;
  if (native.scaling.immediate >= 0) variant.scaling.immediate = native.scaling.immediate / 100;
  if (native.scaling.combo >= 0) variant.scaling.combo = native.scaling.combo / 100;
  if (variant.nativeHits.length && !native.composite && !variant.throw) {
    const seen = new Set<number>();
    const hits = variant.nativeHits.filter((hit, index) => {
      const id = hit.hitId < 0 ? -index - 1 : hit.hitId;
      if (seen.has(id)) return false;
      seen.add(id); return true;
    });
    variant.superGain = hits.reduce((sum, hit) => sum + hit.superGain, 0);
    variant.driveGain = hits.reduce((sum, hit) => sum + hit.driveGain, 0);
    variant.driveBlockLoss = hits.reduce((sum, hit) => sum + hit.blockDriveLoss, 0);
    variant.punishDriveLoss = hits.reduce((sum, hit) => sum + hit.punishDriveLoss, 0);
  }
}
JAMIE_VARIANTS.push({ ...JAMIE_VARIANTS[87], id: "row-87-drink", name: "SA1 Breakin' (drink finish)", input: `${JAMIE_VARIANTS[87].input} > hold 2`, damage: 1850, recovery: 107, blockAdvantage: -93, duration: 133 + 107, drinkFrame: 0, drinkFrames: [], drinkOnCompletion: true, driveRestore: 0 });
JAMIE_VARIANTS.push({ ...JAMIE_VARIANTS[91], id: "row-91-drink", name: "Back Shaver (drink finish)", input: `${JAMIE_VARIANTS[91].input} > hold LP+LK`, duration: JAMIE_VARIANTS[91].duration + 50, drinkFrame: 0, drinkFrames: [], drinkOnCompletion: false, driveRestore: 0, held: true, timelineSource: "Confirmed forward throw branches at capture frame80 to action728; drink at local50 and recovery at local56. The arena automatically selects this branch below drink level4." });
for (let drinks = 1; drinks <= 4; drinks += 1) JAMIE_VARIANTS.push({ ...JAMIE_VARIANTS[38], id: drinks === 1 ? "row-38-hold" : `row-38-hold-${drinks}`, name: `The Devil Inside (hold ${drinks} drink${drinks > 1 ? "s" : ""})`, duration: 97 + (drinks - 1) * 48, drinkFrames: Array.from({ length: drinks }, (_, index) => 49 + index * 48), held: true, timelineSource: "Official first drink at 49 and single held drink total 97; continuing hold repeats the drink cycle before the same release recovery." });
JAMIE_VARIANTS.push({ ...JAMIE_VARIANTS[98], id: "parry-hold", name: "Drive Parry (hold)", input: "hold MP+MK", duration: 120 + 33, active: [[1, 120]], held: true });
for (const [id, direction, travel] of [["jump", "forward", 105], ["jump-neutral", "neutral", 0], ["jump-back", "back", -105]] as const) JAMIE_VARIANTS.push({ ...JAMIE_VARIANTS[93], id, moveId: "jump", name: `${direction[0].toUpperCase() + direction.slice(1)} Jump`, input: direction === "forward" ? "9" : direction === "back" ? "7" : "8", pose: "jump", behavior: "movement", duration: 45, travel, active: [], airborne: false, jumpDirection: direction, hitWeights: [] });
for (const [id, name, travel, posture] of [["walk-forward", "Forward Walk", 70, "stand"], ["walk-back", "Backward Walk", -55, "stand"], ["crouch", "Crouch", 0, "crouch"]] as const) JAMIE_VARIANTS.push({ ...JAMIE_VARIANTS[93], id, moveId: id, name, input: id === "walk-forward" ? "6" : id === "walk-back" ? "4" : "2", pose: "taunt", behavior: "movement", duration: 45, travel, active: [], posture, hitWeights: [] });
JAMIE_VARIANTS.push({ ...JAMIE_VARIANTS[30], id: "row-22-lv3", row: 22, moveId: "U04", name: "Hermit's Elbow (Drink Level 3+)", drinkMin: 3, predecessors: [], timelineSource: "The shared 4HP input uses official Intoxicated Assault(1) properties at Drink Level 3+." });
JAMIE_VARIANTS.push({ ...JAMIE_VARIANTS[33], id: "row-23-lv4", row: 23, moveId: "U05", name: "Senei Kick (Drink Level 4)", drinkMin: 4, predecessors: [], timelineSource: "The shared 6HK input uses official Ransui Haze(1) properties at Drink Level 4." });
export const JAMIE_VARIANT_BY_ID = Object.fromEntries(JAMIE_VARIANTS.map((variant) => [variant.id, variant]));
for (const native of JAMIE_NATIVE_VARIANTS) {
  const variant = JAMIE_VARIANT_BY_ID[native.variantId];
  if (!variant) continue;
  variant.duration = native.duration;
  variant.recovery = native.recovery;
  variant.damage = native.rawDamageTotal;
  variant.nativeHits = native.hits as NativeHit[];
  variant.active = variant.nativeHits.flatMap(hit => hit.active.map(([from, to]) => [from, to] as [number, number]));
  variant.hitWeights = variant.nativeHits.map(hit => hit.damage);
  variant.drinkFrame = native.drinkFrame;
  variant.drinkFrames = [native.drinkFrame];
  variant.drinkOnCompletion = false;
  variant.driveRestore = native.driveRestore;
  variant.nativeTimerStops = native.timerStops;
  variant.nativeLevel4DriveFrame = native.level4DriveFrame;
  variant.nativeLevel4DriveRestore = native.level4DriveRestore;
}

export const JAMIE_ARENA_ADAPTATIONS = [
  "官方名称、输入、酒级门槛、分段有效帧与恢复帧来自本地保存的官网帧表；28个官网目录视频可直接审阅。",
  "地面普通技的命中与防御帧差按官网值结算，迟命中保留帧差收益；攻击范围、空间轨迹、击退与浮空高度仍为二维竞技场适配，并非SF6逐像素判定复刻。",
  "默认生命10000、伤害倍率1；每名选手独立配置生命、伤害、CPU与初始资源。酒级倍率为90/95/100/105/110%，SA2临时4级为105%。",
  "STANDARD AI使用本机提取的1821行原版权重、冷却、条件与按键命令，按原生优先序选择单一情境。按键经竞技场输入识别后仍须通过资源、酒级、派生与接触取消窗口。",
  "站防/蹲防、Parry、两段DI霸体、Burnout和击倒起身均有实际判定；原作冻结、可恢复伤害、拆投与精确版边状态采用竞技场简化规则。",
  "官网未公开的演出分镜帧与逐击伤害采用竞技场编排，严格保持官方总伤害；SA2取壶演出100帧冻结后接官方6帧恢复。持续饮酒48帧节拍由97−49推导，属于本游戏适配，非官网确认的重复节拍。",
];
