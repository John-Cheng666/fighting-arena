import { describe, expect, it } from "vitest";
import { ART_FRAMES, CEL_COUNT, CLIPS, clampFrame, contactsFor, sampleClip, type DrawnSuper } from "./timeline";

describe("redrawn cinematic review clock", () => {
  it.each(["SA3", "CA"] as DrawnSuper[])("maps %s to its own native clock and holds only its final cel for the audio tail", mode => {
    const clip = CLIPS[mode];
    expect(sampleClip(mode, 0)).toMatchObject({ cel: 0, nativeFrame: clip.nativeStart, tail: false });
    expect(sampleClip(mode, 5.999).cel).toBe(0);
    expect(sampleClip(mode, 6).cel).toBe(1);
    expect(sampleClip(mode, ART_FRAMES - 1)).toMatchObject({ cel: CEL_COUNT - 1, tail: false });
    expect(sampleClip(mode, ART_FRAMES)).toMatchObject({ cel: CEL_COUNT - 1, tail: true });
    expect(sampleClip(mode, clip.duration)).toMatchObject({ cel: CEL_COUNT - 1, nativeFrame: clip.nativeStart + clip.duration, tail: true });
    expect(clampFrame(mode, Number.NaN)).toBe(0);
    expect(clampFrame(mode, -1)).toBe(0);
    expect(clampFrame(mode, clip.duration + 1)).toBe(clip.duration);
  });

  it("retains the two distinct native finishing contacts without creating an impact at release", () => {
    expect(contactsFor("SA3").map(hit => hit.frame)).toEqual([16, 28, 36, 54, 97]);
    expect(contactsFor("CA").map(hit => hit.frame)).toEqual([69, 95, 111, 136]);
    expect(contactsFor("SA3").filter(hit => hit.finisher)).toEqual([{ frame: 97, damage: 1050, finisher: true }]);
    expect(contactsFor("CA").filter(hit => hit.finisher)).toEqual([{ frame: 136, damage: 1350, finisher: true }]);
    expect(sampleClip("SA3", 130).contact).toBeUndefined();
  });

  it("reproduces the same cel and impact after rewinding across a shot cut", () => {
    const initial = sampleClip("CA", 98.5);
    sampleClip("CA", 170);
    expect(sampleClip("CA", 98.5)).toEqual(initial);
    expect(initial).toMatchObject({ cel: 16, phase: "终结连打", contactAge: 3.5 });
    expect(sampleClip("SA3", 98.5).phase).toBe("双脚终结");
  });
});
