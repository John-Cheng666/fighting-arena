import type { AudioCatalog } from "../../content/audio/types";

export interface AudioSettings {
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  voiceVolume: number;
  voiceEnabled: boolean;
  musicMode: "stage" | "jamie";
  stageId: string;
}

export interface MusicState {
  phase: "ready" | "running" | "paused" | "finished";
  fighters: readonly { hp: number; maxHp: number }[];
}

/** The host supplies a monotonic presentation tick, including super-freeze steps. */
export interface AudioClock { tick: number; speed: number }

/** Injectable platform boundaries allow scheduling/race tests without a browser. */
export interface AudioDependencies {
  catalog?: AudioCatalog;
  createContext?: () => AudioContext;
  fetch?: (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "arrayBuffer">>;
  baseUrl?: string;
}

export interface AudioStatus {
  enabled: boolean;
  state: "off" | "unsupported" | "blocked" | "paused" | "ready";
  loading: number;
  failedClips: number;
}
