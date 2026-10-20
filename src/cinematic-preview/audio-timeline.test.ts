import { describe, expect, it } from "vitest";
import character from "../characters/jamie/data/audio.json";
import numerics from "../characters/jamie/data/native-numerics.json";
import manifestData from "../../public/assets/jamie/cinematic/audio.json";
import {
  cinematicAudioManifest, compileAudioTimeline,
  type CinematicAudioManifest, type CinematicMode,
} from "./audio-timeline";

describe("original cinematic sound and Japanese voice routing", () => {
  it.each([["SA3", 1212, 438], ["CA", 1216, 499]] as const)(
    "%s preserves the original in-body keys and gives the last line 15 frames to finish", (mode, actionId, bodyFrames) => {
      const track = cinematicAudioManifest.tracks[mode];
      expect(track.bodyFrames).toBe(bodyFrames);
      expect(track.tailFrames).toBe(15);
      expect(track.frameCount).toBe(bodyFrames + 15);
      const authored = character.actions[String(actionId) as "1212" | "1216"].voiceCues["0"];
      const voices = track.cues.filter(cue => cue.actor === "attacker" && cue.channel === "voice");
      expect(voices.map(cue => [cue.frame, cue.voiceId])).toEqual(authored.filter(cue => cue.frame <= bodyFrames)
        .map(cue => [cue.frame, cue.voiceId]));
      expect(track.cues.every(cue => cue.frame <= bodyFrames)).toBe(true);
      const finalVoice = compileAudioTimeline(mode).filter(cue => cue.actor === "attacker" && cue.channel === "voice").at(-1)!;
      expect(finalVoice.until).toBeGreaterThan(bodyFrames / 60);
      expect(finalVoice.until).toBeLessThan(track.frameCount / 60);
      expect(track.cues.some(cue => cue.voiceId === 21339 || cue.voiceId === 21349)).toBe(false);
    },
  );

  it.each(["SA3", "CA"] as CinematicMode[])("%s uses the full frame-1 compositions without guessed impact duplicates", mode => {
    const track = manifestData.tracks[mode];
    const compositions = track.compositions;
    expect(compositions).toHaveLength(2);
    expect(compositions.every(cue => cue.seconds > 9 && cue.mediaCount === 6
      && cue.nodeCount === 10 && cue.initialDelayPreserved)).toBe(true);
    expect(track.cues.filter(cue => cue.source.kind === "contact")).toHaveLength(0);
    const capture = numerics.rows.find(row => row.row === (mode === "SA3" ? 89 : 90))!.captured!;
    expect(track.contacts).toEqual(capture.hits.map(hit => ({ frame: hit.from, attackId: hit.attackId, damage: hit.damage })));
    expect(track.cues.filter(cue => cue.source.kind === "contact-voice").map(cue => cue.frame))
      .toEqual(capture.hits.filter(hit => hit.damage > 0).map(hit => hit.from));
  });

  it.each([0.25, 0.5, 1, 2])("keeps Japanese pitch unchanged and one voice per actor at %sx", speed => {
    for (const mode of ["SA3", "CA"] as const) {
      const compiled = compileAudioTimeline(mode, speed);
      expect(compiled).toEqual(compileAudioTimeline(mode, speed));
      for (const actor of ["attacker", "defender"] as const) {
        const voices = compiled.filter(cue => cue.channel === "voice" && cue.actor === actor);
        expect(voices.length).toBeGreaterThan(0);
        expect(voices.every(cue => cue.playbackRate === 1)).toBe(true);
        for (let i = 1; i < voices.length; i++) expect(voices[i - 1].until).toBeLessThanOrEqual(voices[i].at);
      }
      const se = compiled.find(cue => cue.channel === "sfx" && cue.frame === 1)!;
      expect(se.at).toBeCloseTo(1 / (60 * speed));
      expect(se.playbackRate).toBe(speed);
    }
  });

  it("honors original priority and prioritize-first before choosing a damage variant", () => {
    const cues = [
      { id: "initial", frame: 0, actor: "attacker", channel: "voice", voiceId: 1 },
      { id: "victim", frame: 10, actor: "defender", channel: "voice", voiceId: 1 },
      { id: "blocked-equal", frame: 20, actor: "attacker", channel: "voice", voiceId: 1 },
      { id: "replace", frame: 30, actor: "attacker", channel: "voice", voiceId: 2 },
      { id: "blocked-low", frame: 35, actor: "attacker", channel: "voice", voiceId: 1 },
      { id: "later", frame: 60, actor: "attacker", channel: "voice", voiceId: 1 },
    ] as CinematicAudioManifest["tracks"]["SA3"]["cues"];
    const track = { bodyFrames: 240, tailFrames: 15, frameCount: 255, cues, contacts: [] };
    const request = { clips: ["low-a", "low-b"], priority: 70, prioritizeFirst: true, skipRate: 0,
      limit: 1, releaseMs: 50, avoidRepeat: 1 };
    const manifest: CinematicAudioManifest = { schemaVersion: 1, framesPerSecond: 60, language: "ja",
      clips: { "low-a": { url: "/a.ogg", seconds: 2 }, "low-b": { url: "/b.ogg", seconds: 2 },
        high: { url: "/high.ogg", seconds: 0.25 } }, voiceRequests: {
        1: request, 2: { ...request, clips: ["high"], priority: 80, prioritizeFirst: false },
      }, tracks: { SA3: track, CA: track } };
    const plan = compileAudioTimeline("SA3", 1, manifest);
    expect(plan.map(cue => cue.id)).toEqual(["initial", "victim", "replace", "later"]);
    expect(plan.find(cue => cue.id === "initial")!.until).toBe(0.5);
    expect(plan.find(cue => cue.id === "later")!.clipId).toBe("low-b");
  });
});
