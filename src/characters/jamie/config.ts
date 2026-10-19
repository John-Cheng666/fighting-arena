import type { CharacterSetting } from "../../engine/characters";
import type { CharacterSettings } from "../../engine/types";
import { JAMIE_RESOURCE_LIMITS } from "./combat/resources";

export const JAMIE_SETTINGS: readonly CharacterSetting[] = [
  { key: "cpuLevel", label: "CPU 等级", kind: "number", default: 6, min: 1, max: 8, step: 1 },
  { key: "aiStyle", label: "行为风格", kind: "select", default: 0, options: [
    { value: 0, label: "原版 STANDARD" },
  ] },
  { key: "maxHp", label: "初始生命", kind: "number", default: JAMIE_RESOURCE_LIMITS.health, min: 300, max: 30000, step: 100 },
  { key: "damageScale", label: "伤害倍率", kind: "number", default: 1, min: 0.01, max: 3, step: 0.01 },
  { key: "startDrinkLevel", label: "初始酒级", kind: "number", default: 0, min: 0, max: 4, step: 1 },
  { key: "driveBars", label: "初始 Drive", kind: "number", default: 6, min: 0, max: 6, step: 1 },
  { key: "superBars", label: "初始 SA", kind: "number", default: 0, min: 0, max: 3, step: 1 },
];

export function normalizeJamieSettings(input: CharacterSettings = {}): CharacterSettings {
  for (const key of Object.keys(input)) if (!JAMIE_SETTINGS.some((field) => field.key === key)) throw new Error(`杰米不支持设置项：${key}`);
  return Object.fromEntries(JAMIE_SETTINGS.map((field) => {
    const value = input[field.key] ?? field.default;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field.label}必须是有效数字`);
    if (field.kind === "select") {
      if (!field.options?.some((option) => option.value === value)) throw new Error(`${field.label}无效`);
    } else if (value < field.min! || value > field.max! || field.key !== "damageScale" && Math.abs((value - field.min!) / field.step! - Math.round((value - field.min!) / field.step!)) > 1e-7) {
      throw new Error(`${field.label}须在${field.min}至${field.max}之间，步长${field.step}`);
    }
    return [field.key, value];
  }));
}
