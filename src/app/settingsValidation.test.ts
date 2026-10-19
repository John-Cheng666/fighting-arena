import { describe, expect, it } from "vitest";
import { validateNumber } from "./settingsValidation";

describe("settings number validation", () => {
  const cpu = { label: "CPU 等级", min: 1, max: 8, step: 1 };
  it.each(["", "   "])("rejects empty input %j before conversion to zero", value => {
    expect(validateNumber(value, { label: "种子", min: 0 })).toBe("请输入种子");
  });
  it.each(["NaN", "Infinity", "abc"])("rejects non-finite input %s", value => {
    expect(validateNumber(value, cpu)).not.toBe("");
  });
  it.each(["0", "9", "1.5"])("rejects out-of-range or fractional difficulty %s", value => {
    expect(validateNumber(value, cpu)).not.toBe("");
  });
  it("accepts range endpoints, zero seeds and fractional damage settings", () => {
    expect(validateNumber("1", cpu)).toBe("");
    expect(validateNumber("8", cpu)).toBe("");
    expect(validateNumber("0", { label: "种子", min: 0, max: 2147483647, step: 1 })).toBe("");
    expect(validateNumber("0.29", { label: "伤害倍率", min: 0.01, max: 3, step: 0.01 })).toBe("");
  });
});
