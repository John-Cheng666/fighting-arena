import { describe, expect, it } from "vitest";
import { PresentationClock } from "./PresentationClock";

describe("battle presentation clock", () => {
  it("advances during super intros without advancing the combat tick", () => {
    const clock = new PresentationClock();
    expect(clock.sample(10, [])).toBe(10);
    expect(clock.sample(10, [{ key: "sa3", introFrame: 12 }])).toBe(12);
    expect(clock.sample(10, [{ key: "sa3", introFrame: 12 }])).toBe(0);
    expect(clock.frame).toBe(22);
    expect(clock.sample(12, [{ key: "sa3", introFrame: 14 }])).toBe(4);
  });

  it("counts complete and abbreviated render samples equally at different playback speeds", () => {
    const slow = new PresentationClock(), fast = new PresentationClock();
    for (let introFrame = 1; introFrame <= 84; introFrame++) slow.sample(0, [{ key: "sa3", introFrame }]);
    for (let introFrame = 4; introFrame <= 84; introFrame += 4) fast.sample(0, [{ key: "sa3", introFrame }]);
    slow.sample(10, []); fast.sample(10, []);
    expect(slow.frame).toBe(94);
    expect(fast.frame).toBe(slow.frame);
  });

  it("starts a new effect timeline on replay and keeps two fighters' intros separate", () => {
    const clock = new PresentationClock();
    clock.sample(20, [{ key: "p1:sa1", introFrame: 55 }]);
    clock.sample(30, [{ key: "p2:sa2", introFrame: 4 }]);
    expect(clock.frame).toBe(89);
    clock.reset();
    expect(clock.frame).toBe(0);
    expect(clock.sample(0, [{ key: "p1:sa1", introFrame: 1 }])).toBe(1);
  });
});
