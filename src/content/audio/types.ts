export interface AudioClip {
  /** Relative to Vite BASE_URL. */
  url: string
  seconds: number
  frames: number
  sampleRate: number
  channels: number
  gain?: number
  /** Web Audio loop points, in seconds. */
  loop?: { start: number; end: number }
}

export interface AudioCatalog {
  schemaVersion: number
  clips: Record<string, AudioClip>
  bgm: Record<string, {
    title: string
    normal: string
    danger: string
    intro?: string
    outro?: string
    varied?: string
    extended?: string
    break?: string
  }>
  feedback: Record<string, string[]>
  voices?: Record<string, CharacterVoices>
}

export interface VoiceRequest {
  clips: string[]
  randomGroup?: number
  priority: number
  prioritizeFirst: boolean
  skipRate: number
  limit: number
  releaseMs: number
  avoidRepeat: number
}

export interface CharacterVoices {
  language: string
  requests: Record<string, VoiceRequest>
  scenes: Record<string, string[]>
  victory: { scene: string; min: number; max: number; maxInclusive: boolean }[]
  ko: { normal: number; finish: number; launched: number; finishLaunched: number; down: number; finishDown: number }
}

export interface ActionVoiceCue {
  frame: number
  voiceId: number
  stopWithAction: boolean
  stopMode: number
  afterBranch: boolean
  onlyOnce: boolean
  inBattle: boolean
}

export interface ActionAudioCue {
  /** Zero-based native action time; pauses with the actor's hitstop. */
  frame: number
  clipId: string
  kind: 'se' | 'voice'
  soundId: number
  stopMode: number
  afterBranch: boolean
  onlyOnce: boolean
  targetData: number
  targetPos: number
}

export interface ActionAudio {
  cues: ActionAudioCue[]
  marginFrame?: number
  controls?: { frame: number; soundId: number; eventIds: number[]; kind: 'control'; targets?: number[]; stopClipIds?: string[]; fadeMs?: number }[]
  voiceCues?: Record<string, ActionVoiceCue[]>
}

export interface ContactAudio {
  normal: string[]
  counter?: string[]
  punish?: string[]
  guard?: string[]
  type: number
  power: number
  attr: number
  voiceId?: number
  extraSeIds?: number[]
  /** Original condition-specific sound table, for auditing/future native routing. */
  overrides?: { indexId: number; type: number; power: number; attr: number; extraSeIds: number[] }[]
}

export interface CharacterAudio {
  schemaVersion: number
  framesPerSecond: number
  actions: Record<string, ActionAudio>
  contacts: Record<string, ContactAudio>
  voice: { light: string[]; damage: string[] }
}
