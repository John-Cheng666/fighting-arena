import manifestData from "../../public/assets/jamie/cinematic/audio.json";
import type { VoiceRequest } from "../content/audio/types";

export type CinematicMode = "SA3" | "CA";
export type CinematicActor = "attacker" | "defender";
export interface CinematicAudioClip { url: string; seconds: number; gain?: number; sha256?: string }
export interface CinematicAudioCue {
  id: string;
  frame: number;
  actor: CinematicActor;
  channel: "sfx" | "voice";
  clipId?: string;
  voiceId?: number;
  source?: { kind: string; actionId: number; soundId?: number; attackId?: number; voiceId?: number };
}
export interface CinematicAudioTrack {
  bodyFrames: number;
  tailFrames: number;
  frameCount: number;
  cues: CinematicAudioCue[];
  contacts: { frame: number; attackId: number; damage: number }[];
}
export interface CinematicAudioManifest {
  schemaVersion: number;
  framesPerSecond: number;
  language: string;
  clips: Record<string, CinematicAudioClip>;
  voiceRequests: Record<string, VoiceRequest>;
  tracks: Record<CinematicMode, CinematicAudioTrack>;
}
export interface ScheduledCinematicCue {
  id: string;
  clipId: string;
  actor: CinematicActor;
  channel: "sfx" | "voice";
  frame: number;
  /** Wall-clock seconds from the beginning of this review at the selected speed. */
  at: number;
  until: number;
  playbackRate: number;
  releaseSeconds: number;
}

export const cinematicAudioManifest = manifestData as CinematicAudioManifest;

/** A complete plan makes seeks reproduce the same voice choices and interruptions. */
export function compileAudioTimeline(
  mode: CinematicMode,
  speed = 1,
  manifest: CinematicAudioManifest = cinematicAudioManifest,
): ScheduledCinematicCue[] {
  if (!(speed > 0) || !Number.isFinite(speed)) throw new RangeError("Audio review speed must be positive");
  const track = manifest.tracks[mode], fps = manifest.framesPerSecond;
  const end = track.frameCount / (fps * speed);
  const scheduled: ScheduledCinematicCue[] = [];
  const claims = new Map<CinematicActor, { cue: ScheduledCinematicCue; priority: number }>();
  const histories = new Map<string, string[]>();
  const counters = new Map<string, number>();
  const aliases = new Set<string>();
  for (const cue of [...track.cues].sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id))) {
    if (cue.frame < 0 || cue.frame > track.bodyFrames) continue;
    const alias = `${cue.actor}:${cue.frame}:${cue.channel}:${cue.clipId ?? cue.voiceId}`;
    if (aliases.has(alias)) continue;
    aliases.add(alias);
    const at = cue.frame / (fps * speed);
    let clipId = cue.clipId, releaseSeconds = 0.008;
    if (cue.channel === "voice") {
      const request = cue.voiceId === undefined ? undefined : manifest.voiceRequests[cue.voiceId];
      if (!request?.clips.length) continue;
      const old = claims.get(cue.actor);
      if (old && old.cue.until > at
        && (old.priority > request.priority || old.priority === request.priority && request.prioritizeFirst)) continue;
      const group = `${cue.actor}:${request.randomGroup ?? cue.voiceId}`;
      const history = histories.get(group) ?? [];
      const avoid = Math.min(request.avoidRepeat, request.clips.length - 1);
      const blocked = new Set(avoid > 0 ? history.slice(-avoid) : []);
      const choices = request.clips.filter(id => manifest.clips[id] && !blocked.has(id));
      if (!choices.length) continue;
      const index = counters.get(group) ?? 0;
      clipId = choices[index % choices.length];
      counters.set(group, index + 1);
      histories.set(group, [...history, clipId]);
      // End the previous voice before the new request. Its native release time
      // becomes a fade ending here, never another simultaneous character voice.
      if (old && old.cue.until > at) old.cue.until = at;
      releaseSeconds = Math.max(0, request.releaseMs / 1000);
      const voice: ScheduledCinematicCue = {
        id: cue.id, clipId, actor: cue.actor, channel: cue.channel, frame: cue.frame,
        at, until: Math.min(end, at + manifest.clips[clipId].seconds), playbackRate: 1, releaseSeconds,
      };
      claims.set(cue.actor, { cue: voice, priority: request.priority });
      scheduled.push(voice);
    } else if (clipId && manifest.clips[clipId]) {
      scheduled.push({ id: cue.id, clipId, actor: cue.actor, channel: cue.channel, frame: cue.frame,
        at, until: Math.min(end, at + manifest.clips[clipId].seconds / speed), playbackRate: speed, releaseSeconds });
    }
  }
  return scheduled.filter(cue => cue.until > cue.at);
}
