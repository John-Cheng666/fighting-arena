import type { JamieAISnapshot as Snapshot } from "./snapshot";

// Group masks and bit assignments are app.StandardAI.Condition from the local TDB.
// Arena geometry and action observations below are the host adapters to that schema.
const GROUPS = [
  [0xfn, 0xf0n, 0xff00n, 0xf0000n, 0x1f000000n, 0xe0000000n, 0xf00000000n, 0xf0000000000n, 0x3000000000000n, 0xff00000000000000n],
  [1n, 2n, 4n, 8n, 16n, 32n, 0xf00n, 0x7000n, 0x3f0000n, 0x7000000n, 0x700000000n, 0x30000000000n, 0x1000000000000n, 0x2000000000000n, 0x4000000000000n, 0x8000000000000n, 0x100000000000000n, 0x200000000000000n, 0x400000000000000n],
  [0x3n, 0x100n],
] as const;

const bit = (offset: number, index: number) => 1n << BigInt(offset + index);
const gauge = (value: number, max: number) => Math.max(0, Math.min(max, Math.floor(value / 10000)));
const vital = (ratio: number) => ratio > 0.75 ? 0 : ratio > 0.5 ? 1 : ratio > 0.25 ? 2 : 3;
const plusThresholds = [1, 4, 6, 8, 10, 12, 15];

export function nativeConditionBits(ss: Snapshot): [bigint, bigint, bigint] {
  const distance = ss.distance <= 100 ? 0 : ss.distance <= 200 ? 1 : ss.distance <= 300 ? 2 : 3;
  let plus = 7;
  for (let i = 0; i < plusThresholds.length; i++) if (ss.canCheckPlusFrame && ss.plusFrame >= plusThresholds[i]) plus = i;
  const c0 = bit(0, gauge(ss.self.super, 3)) | bit(4, gauge(ss.opponent.super, 3))
    | bit(8, ss.self.burnout ? 7 : gauge(ss.self.drive, 6)) | bit(16, distance)
    | (ss.projectile ? bit(25, ss.projectile.distance <= 200 ? 0 : ss.projectile.distance <= 300 ? 1 : 2) | bit(29, ss.projectile.height <= 75 ? 0 : ss.projectile.height <= 150 ? 1 : 2) : bit(24, 0))
    | bit(32, vital(ss.self.hpRatio)) | bit(40, vital(ss.opponent.hpRatio))
    | bit(48, ss.ownProjectile ? 1 : 0) | bit(56, plus);
  const pose = ss.opponent.height > 10 ? 2 : ss.opponent.crouching ? 1 : 0;
  const attack = ss.opponent.attacking ? bit(3, 0) | bit(ss.opponent.moveId?.startsWith("S") || ss.opponent.moveId?.startsWith("A") ? 5 : 4, 0) : 0n;
  const c1 = bit(0, pose) | attack | bit(12, ss.opponent.jumpDirection === "forward" ? 0 : ss.opponent.jumpDirection === "neutral" ? 1 : 2)
    | bit(16, 0) | bit(24, 0) | bit(32, 0) | bit(40, ss.self.styleTimer ? 1 : 0)
    | (ss.self.nearWall ? bit(48, 0) : bit(50, 0)) | (ss.opponent.nearWall ? bit(49, 0) : bit(51, 0))
    | (ss.opponent.burnout ? bit(56, 0) : 0n);
  const c2 = (ss.self.comboScale <= 0.1 ? 1n : 0n) | (ss.self.comboScale <= 0.5 ? 2n : 0n) | (ss.self.actionCount > 20 ? 0x100n : 0n);
  return [c0, c1, c2];
}

export function compileMaskCondition(conditions: readonly string[], ngConditions: readonly string[], unique: readonly number[][]): (ss: Snapshot) => boolean {
  const required = conditions.map(BigInt), forbidden = ngConditions.map(BigInt);
  return ss => {
    const actual = nativeConditionBits(ss);
    for (let bank = 0; bank < 3; bank++) {
      for (const mask of GROUPS[bank]) {
        const want = required[bank] & mask, avoid = forbidden[bank] & mask;
        // Preserve native helper early returns, including NG-only projectile/scale behavior.
        if (bank === 0 && [0x1f000000n, 0xe0000000n].includes(mask)) {
          const distanceWant = required[0] & 0x1f000000n;
          if (!(required[0] & 0xff000000n)) continue;
          if (distanceWant) { if (!(distanceWant & actual[0])) return false; continue; }
        }
        if (bank === 0 && mask === 0xff00n && ss.self.burnout && want) { if (!(want & 0x8000n)) return false; continue; }
        if (bank === 0 && mask === 0xff00000000000000n && !want && avoid && !ss.canCheckPlusFrame) return false;
        if (bank === 2 && mask === 3n) {
          if (!want) continue;
          if (ss.self.comboScale > (want & 1n ? 0.1 : 0.5)) return false;
          continue;
        }
        const positivePriority = bank === 0 && [0xf0000n, 0xf00000000n, 0xf0000000000n, 0x3000000000000n, 0xff00000000000000n].includes(mask);
        if (want && !(want & actual[bank]) || !(want && positivePriority) && (avoid & actual[bank]) !== 0n) return false;
      }
    }
    // Jamie's first unique parameter is drink level; the remaining slots are zero in this resource.
    return unique.every(([comp, value], index) => {
      if (comp === 0) return true;
      const level = index === 0 ? ss.self.drinkLevel : 0;
      return [true, level === value, level > value, level >= value, level < value, level <= value][comp] ?? false;
    });
  };
}

export function commandCondition(code: string, ss: Snapshot): boolean {
  const { self, opponent } = ss;
  if (/^APF[0-6]$/.test(code)) return ss.plusFrame >= plusThresholds[Number(code[3])];
  switch (code) {
    case "BRCH": return true;
    case "ANON": return self.canAct;
    case "ONON": return opponent.canAct;
    case "ODMG": return opponent.stunned && !opponent.guarding;
    case "OGRD": return opponent.guarding;
    case "OHIT": return self.connected || self.blocked;
    case "2HIT": return self.comboHits >= 2;
    case "OAIR": return opponent.height > 10;
    case "OLND": return opponent.height <= 10;
    case "AAIR": return self.height > 10;
    case "ALND": return self.height <= 10;
    case "OATK": return opponent.attacking;
    case "ONATK": return opponent.attacking && Boolean(opponent.moveId?.startsWith("N"));
    case "OSATK": return opponent.attacking && Boolean(opponent.moveId?.startsWith("S") || opponent.moveId?.startsWith("A"));
    case "ONTH": return Boolean(opponent.moveId?.startsWith("T"));
    case "OSTH": return opponent.moveId === "S08";
    case "OADI": return opponent.moveId === "D01";
    case "ODRP": return opponent.moveId === "D03";
    case "AGRD": return self.guarding;
    case "AAMH": return self.armorHits > 0;
    case "AJST": return self.perfectParry;
    case "ACSL": return [...ss.legalVariants].some(id => id !== self.actionId);
    case "DSTC": return ss.distance <= 100;
    case "DSTN": return ss.distance > 100 && ss.distance <= 200;
    case "DSTM": return ss.distance > 200 && ss.distance <= 300;
    case "DSTF": return ss.distance > 300;
    case "PRJN": return ss.projectile === null;
    case "PRJC": return ss.projectile !== null && ss.projectile.distance <= 100;
    case "OHTL": return opponent.height < 60;
    case "OCNT": return opponent.counterHit || opponent.punishCounter;
    case "OPNS": return opponent.punishCounter;
    case "OKZR": case "OKRD": case "OBLW": return opponent.knockedDown;
    default: return false;
  }
}
