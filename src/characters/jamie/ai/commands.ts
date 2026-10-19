import type { AICommand, AIDuration } from "../../../engine/ai/StandardAI";
import type { JamieAIInput, JamieAISnapshot } from "./snapshot";
import { commandCondition } from "./conditions";
import original from "../data/standard-ai.json";

export const NATIVE_KEY_CODES: Readonly<Record<string, number>> = {
  "1": 6, "2": 2, "3": 10, "4": 4, "5": 0, "6": 8, "7": 5, "8": 1, "9": 9,
  l: 0x10, m: 0x20, h: 0x40, L: 0x80, M: 0x100, H: 0x200, P: 0x70, K: 0x380, d: 0x120, D: 0x240,
};
type Command = AICommand<JamieAISnapshot, JamieAIInput>;
type Token = { kind: "button"; keys: number; duration: AIDuration }
  | { kind: "predicate"; code: string; not: boolean; group?: string; duration: AIDuration }
  | { kind: "loop"; duration: AIDuration; end: number } | { kind: "endLoop"; begin: number };
function direction(keys: number): number {
  const x = Number(Boolean(keys & 8)) - Number(Boolean(keys & 4));
  const y = Number(Boolean(keys & 1)) - Number(Boolean(keys & 2));
  return y > 0 ? x + 8 : y < 0 ? x + 2 : x + 5;
}

/** Native translate_key/condition/bracket/branch/loop grammar. */
export function compileNativeCommands(source: string, flags: { doHitStop: boolean; doWorldStop: boolean }): Command[] {
  const tokens: Token[] = [];
  let plus = false, loop = -1;
  for (let i = 0; i < source.length;) {
    const char = source[i++];
    if (/\s/.test(char)) continue;
    if (char === "+") { plus = true; continue; }
    if (char === "?" || char === "!") {
      const code = ["BRCH", ...Object.keys(original.commandTypes)].find(name => source.startsWith(name, i));
      if (!code) throw new Error(`Invalid native condition: ${source.slice(i)} in ${source}`);
      i += code.length;
      tokens.push({ kind: "predicate", code, not: char === "!", duration: 0 }); continue;
    }
    if (char === '"') {
      const end = source.indexOf('"', i), token = tokens.at(-1);
      if (end < 0 || token?.kind !== "predicate") throw new Error(`Invalid native branch: ${source}`);
      token.group = source.slice(i, end); i = end + 1; continue;
    }
    if (char === "(") {
      const end = source.indexOf(")", i), token = tokens.at(-1);
      const match = source.slice(i, end).match(/^(\d+)(?:-(\d+))?$/);
      if (end < 0 || !match || !token || token.kind === "endLoop") throw new Error(`Invalid native duration: ${source}`);
      token.duration = match[2] ? { min: Number(match[1]), max: Number(match[2]) } : Number(match[1]);
      i = end + 1; continue;
    }
    if (char === "[") {
      if (loop >= 0) throw new Error(`Nested native loop: ${source}`);
      loop = tokens.length; tokens.push({ kind: "loop", duration: 0, end: -1 }); continue;
    }
    if (char === "]") {
      const begin = tokens[loop];
      if (begin?.kind !== "loop") throw new Error(`Unbalanced native loop: ${source}`);
      begin.end = tokens.length; tokens.push({ kind: "endLoop", begin: loop }); loop = -1; continue;
    }
    const keys = NATIVE_KEY_CODES[char];
    if (keys === undefined) throw new Error(`Unknown native key ${char}: ${source}`);
    const previous = tokens.at(-1);
    if (plus && previous?.kind === "button") previous.keys |= keys;
    else tokens.push({ kind: "button", keys, duration: 1 });
    plus = false;
  }
  if (loop >= 0 || plus) throw new Error(`Incomplete native program: ${source}`);
  return [...tokens.map((token): Command => {
    if (token.kind === "button") return { type: "button", input: { kind: "keys", direction: direction(token.keys), buttons: token.keys & 0x3f0 }, frames: token.duration, ...flags };
    if (token.kind === "predicate") return { type: "predicate", test: ss => commandCondition(token.code, ss) !== token.not, frames: token.duration, group: token.group, ...flags };
    if (token.kind === "loop") return { type: "nativeLoop", count: token.duration, end: token.end };
    return { type: "endLoop", begin: token.begin };
  }), { type: "stop" }];
}
