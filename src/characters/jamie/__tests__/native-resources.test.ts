import { describe, expect, it } from "vitest";
import {
  advanceDriveRecovery,
  applyDriveChange,
  applySuperChange,
  JAMIE_RESOURCE_LIMITS,
  jamieOffensivePercent,
  jamieSuperGainPercent,
  nativeDamagePercent,
  nativeScaledDamage,
  setDriveRecoveryWait,
  type DriveRecoveryContext,
  type DriveResourceState,
} from "../combat/resources";

const ground: DriveRecoveryContext = {
  airborne: false,
  forwardWalking: false,
  damageState: false,
  holdNegativeWait: false,
  canRegenerate: true,
  canExitBurnout: true,
};

function resource(overrides: Partial<DriveResourceState> = {}): DriveResourceState {
  return { drive: 30000, burnout: false, driveRecoveryWait: 0, ...overrides };
}

describe("installed Jamie resource and style values", () => {
  it("retains the native HP, Drive, SA and gauge units", () => {
    expect(JAMIE_RESOURCE_LIMITS).toEqual({ health: 10000, drive: 60000, super: 30000, gaugeUnit: 10000 });
    expect(Array.from({ length: 9 }, (_, style) => jamieOffensivePercent(style))).toEqual([90, 95, 100, 105, 110, 105, 105, 105, 105]);
    expect(Array.from({ length: 9 }, (_, style) => jamieSuperGainPercent(style))).toEqual([100, 100, 100, 100, 100, 0, 0, 0, 0]);
  });
});

describe("native signed Drive recovery waits", () => {
  it.each([[undefined, 120], [4, 240], [5, 20]] as const)("starts the native use kind %s delay", (useKind, frames) => {
    const state = resource();
    expect(applyDriveChange(state, -10000, { cause: "use", useKind })).toBe(-10000);
    expect(state.driveRecoveryWait).toBe(-frames);
  });

  it("holds the negative wait during an action, then flips, counts down, and regenerates on the following invocation", () => {
    const state = resource({ driveRecoveryWait: -2 });
    for (let frame = 0; frame < 20; frame += 1) {
      expect(advanceDriveRecovery(state, { ...ground, holdNegativeWait: true })).toBe(0);
    }
    expect(state.driveRecoveryWait).toBe(-2);
    expect(advanceDriveRecovery(state, ground)).toBe(0);
    expect(state.driveRecoveryWait).toBe(2);
    expect(advanceDriveRecovery(state, ground)).toBe(0);
    expect(state.driveRecoveryWait).toBe(1);
    expect(advanceDriveRecovery(state, ground)).toBe(0);
    expect(state.driveRecoveryWait).toBe(0);
    expect(advanceDriveRecovery(state, ground)).toBe(40);
  });

  it("starts hit delay only for actual Drive loss and preserves the greater absolute delay", () => {
    const state = resource({ driveRecoveryWait: 120 });
    expect(applyDriveChange(state, -1000, { cause: "hit" })).toBe(-1000);
    expect(state.driveRecoveryWait).toBe(-120);
    setDriveRecoveryWait(state, 240);
    expect(state.driveRecoveryWait).toBe(-240);
    setDriveRecoveryWait(state, 20, true);
    expect(state.driveRecoveryWait).toBe(-20);
    state.driveRecoveryWait = 0;
    applyDriveChange(state, -1000, { cause: "hit" });
    expect(state.driveRecoveryWait).toBe(-90);
    applyDriveChange(state, 1000, { cause: "hit" });
    expect(state.driveRecoveryWait).toBe(-90);
  });

  it("skips the full recovery invocation when the scene/actor gate forbids it", () => {
    const state = resource({ driveRecoveryWait: 1 });
    expect(advanceDriveRecovery(state, { ...ground, eligible: false })).toBe(0);
    expect(state.driveRecoveryWait).toBe(1);
    state.driveRecoveryWait = 0;
    expect(advanceDriveRecovery(state, { ...ground, canRegenerate: false })).toBe(0);
    expect(state.drive).toBe(30000);
  });
});

describe("native Drive recovery rates and Burnout", () => {
  it.each([
    [false, false, false, false, 40],
    [false, false, true, false, 80],
    [false, true, false, false, 20],
    [false, false, false, true, 20],
    [true, false, false, false, 50],
    [true, true, false, false, 20],
    [true, false, true, false, 100],
    [true, false, false, true, 25],
    [true, true, false, true, 25],
  ])("burnout=%s air=%s forwardWalk=%s damage=%s adds %s", (burnout, airborne, forwardWalking, damageState, amount) => {
    const state = resource({ burnout: Boolean(burnout) });
    expect(advanceDriveRecovery(state, { ...ground, airborne: Boolean(airborne), forwardWalking: Boolean(forwardWalking), damageState: Boolean(damageState), canExitBurnout: !damageState })).toBe(amount);
  });

  it("recovers gradually for 1200 eligible stationary ground invocations and exits at full Drive", () => {
    const state = resource({ drive: 0, burnout: true });
    for (let frame = 0; frame < 1199; frame += 1) advanceDriveRecovery(state, ground);
    expect(state).toMatchObject({ drive: 59950, burnout: true });
    expect(advanceDriveRecovery(state, ground)).toBe(50);
    expect(state).toMatchObject({ drive: 60000, burnout: false });
  });

  it("clamps depletion to zero and ignores further Burnout losses without extending its wait", () => {
    const state = resource({ drive: 500 });
    expect(applyDriveChange(state, -1000, { cause: "use" })).toBe(-500);
    expect(state).toEqual({ drive: 0, burnout: true, driveRecoveryWait: -120 });
    state.driveRecoveryWait = 10;
    expect(applyDriveChange(state, -1000, { cause: "hit" })).toBe(0);
    expect(applyDriveChange(state, -10000, { cause: "use", useKind: 4 })).toBe(0);
    expect(state.driveRecoveryWait).toBe(10);
    state.driveRecoveryWait = 0;
    advanceDriveRecovery(state, ground);
    expect(state.drive).toBe(50);
    expect(applyDriveChange(state, -10000, { cause: "use" })).toBe(0);
    expect(state).toMatchObject({ drive: 50, burnout: true, driveRecoveryWait: 0 });
  });

  it("retains Burnout at full Drive until its recovery-state gate permits exit", () => {
    const state = resource({ drive: 59980, burnout: true });
    expect(advanceDriveRecovery(state, { ...ground, damageState: true, canExitBurnout: false })).toBe(20);
    expect(state).toMatchObject({ drive: 60000, burnout: true });
    advanceDriveRecovery(state, { ...ground, holdNegativeWait: true, canExitBurnout: false });
    expect(state.burnout).toBe(true);
    advanceDriveRecovery(state, ground);
    expect(state.burnout).toBe(false);
  });

  it("supports the caller-established native parry branch that preserves one Drive", () => {
    const state = resource({ drive: 500 });
    expect(applyDriveChange(state, -1000, { cause: "hit", preserveOneOnDepletion: true })).toBe(-499);
    expect(state).toMatchObject({ drive: 1, burnout: false, driveRecoveryWait: -90 });
  });
});

describe("native positive SA gains and integer damage scaling", () => {
  it("suppresses SA growth in every SA2 install style while leaving SA costs unscaled", () => {
    for (const styleId of [5, 6, 7, 8]) {
      const state = { super: 30000 };
      expect(applySuperChange(state, -10000, { styleId, comboPercent: 50, modePercent: 50 })).toBe(-10000);
      expect(state.super).toBe(20000);
      expect(applySuperChange(state, 10000, { styleId })).toBe(0);
      expect(state.super).toBe(20000);
    }
  });

  it("truncates each positive gain stage before applying the next and clamps to the native maximum", () => {
    const state = { super: 0 };
    expect(applySuperChange(state, 3, { styleId: 0, comboPercent: 50, modePercent: 80 })).toBe(0);
    expect(applySuperChange(state, 2501, { styleId: 4, comboPercent: 85 })).toBe(2125);
    state.super = 29999;
    expect(applySuperChange(state, 100, { styleId: 2 })).toBe(1);
    expect(state.super).toBe(30000);
  });

  it("truncates the combined damage rate to integer percent before scaling each contact", () => {
    expect(nativeDamagePercent([85, 90])).toBe(76);
    expect(nativeScaledDamage(300, [85, 90])).toBe(228);
    expect(nativeScaledDamage(800, [jamieOffensivePercent(0)])).toBe(720);
    expect(nativeScaledDamage(800, [jamieOffensivePercent(4)])).toBe(880);
    expect(nativeScaledDamage(800, [jamieOffensivePercent(5)])).toBe(840);
  });

  it("retains fractional Q32 rate between stages instead of flooring every percentage stage", () => {
    expect(nativeDamagePercent([85, 95, 105])).toBe(84);
    expect(nativeScaledDamage(300, [85, 95, 105])).toBe(252);
  });
});
