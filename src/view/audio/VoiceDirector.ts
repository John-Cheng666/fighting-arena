import type { AudioCatalog, VoiceRequest } from "../../content/audio/types";
import type { BattleEvent } from "../../engine/types";

export type VoiceEvent = Extract<BattleEvent, { type: "voice" }>;
export type VoiceStop = Extract<BattleEvent, { type: "voice-stop" }>;
interface Claim { token: number; fighterId: string; scope?: string; stopWithAction: boolean; priority: number; until: number }
export interface VoiceChoice { clipId: string; token: number; replaced?: number; releaseMs: number }

/** Presentation RNG and voice arbitration never consume the simulation's RNG. */
export class VoiceDirector {
  private seed = 1;
  // Never reuse a token after reset: an old onended/decode must not release a new claim.
  private serial = 0;
  private readonly randomStates = new Map<string, number>();
  private readonly histories = new Map<string, string[]>();
  private readonly claims = new Map<string, Claim>();
  constructor(private readonly catalog: AudioCatalog) {}

  reset(seed = this.seed): void {
    this.seed = seed >>> 0;
    this.randomStates.clear(); this.histories.clear(); this.claims.clear();
  }
  private random(key: string): number {
    let value = this.randomStates.get(key);
    if (value === undefined) {
      value = this.seed ^ 0x9e3779b9;
      for (let i = 0; i < key.length; i++) value = Math.imul(value ^ key.charCodeAt(i), 16777619);
    }
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    value >>>= 0; this.randomStates.set(key, value || 0x6d2b79f5);
    return value / 0x100000000;
  }
  sceneDuration(characterId: string, scene: string): number {
    return Math.max(0, ...(this.catalog.voices?.[characterId]?.scenes[scene] ?? []).map(id => this.catalog.clips[id]?.seconds ?? 0));
  }
  victoryScene(characterId: string, hp: number, maxHp: number): string | undefined {
    if (!(maxHp > 0) || !Number.isFinite(hp)) return;
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    return this.catalog.voices?.[characterId]?.victory.find(r => ratio >= r.min && (r.maxInclusive ? ratio <= r.max : ratio < r.max))?.scene;
  }
  koRequest(characterId: string, finish: boolean, launched: boolean, down: boolean): number | undefined {
    const ko = this.catalog.voices?.[characterId]?.ko;
    return ko && (launched ? finish ? ko.finishLaunched : ko.launched : down ? finish ? ko.finishDown : ko.down : finish ? ko.finish : ko.normal);
  }
  choose(event: VoiceEvent, at: number): VoiceChoice | undefined {
    const voice = this.catalog.voices?.[event.characterId];
    if (!voice) return;
    const scene = event.scene && voice.scenes[event.scene];
    const request: VoiceRequest | undefined = scene ? { clips: scene, priority: 1000, prioritizeFirst: false, skipRate: 0, limit: 1, releaseMs: 50, avoidRepeat: 1 }
      : event.voiceId === undefined ? undefined : voice.requests[event.voiceId];
    if (!request?.clips.length) return;
    const actor = event.characterId + ':' + event.fighterId, key = actor + ':' + (event.scene ?? request.randomGroup ?? event.voiceId);
    if (!event.force && request.skipRate > 0 && this.random(actor) < request.skipRate) return;
    const old = this.claims.get(actor);
    const active = old && old.until > at;
    if (active && !event.force && (old.priority > request.priority || old.priority === request.priority && request.prioritizeFirst)) return;
    const history = this.histories.get(key) ?? [], avoid = Math.min(request.avoidRepeat, request.clips.length - 1);
    const blocked = new Set(avoid > 0 ? history.slice(-avoid) : []);
    const choices = request.clips.filter(id => !blocked.has(id) && this.catalog.clips[id]);
    if (!choices.length) return;
    const clipId = choices.length === 1 ? choices[0] : choices[Math.floor(this.random(actor) * choices.length)];
    this.histories.set(key, [...(avoid > 0 ? history.slice(-avoid) : []), clipId]);
    const token = ++this.serial;
    this.claims.set(actor, { token, fighterId: event.fighterId, scope: event.scope, stopWithAction: !!event.stopWithAction, priority: request.priority, until: at + this.catalog.clips[clipId].seconds });
    return { clipId, token, replaced: active ? old.token : undefined, releaseMs: request.releaseMs };
  }
  current(token: number): boolean { return [...this.claims.values()].some(c => c.token === token); }
  release(token: number): void { for (const [key, value] of this.claims) if (value.token === token) this.claims.delete(key); }
  cancel(event: VoiceStop): number[] {
    const tokens: number[] = [];
    for (const [key, claim] of this.claims) if ((event.fighterId === undefined || claim.fighterId === event.fighterId)
      && (event.scope === undefined || claim.scope === event.scope) && (!event.actionOnly || claim.stopWithAction)) {
      tokens.push(claim.token); this.claims.delete(key);
    }
    return tokens;
  }
}
