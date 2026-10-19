import type { BattleAudioSettings, BattleRuntime, BattleSummary } from "../runtime/BattleRuntime";
import { Icon } from "./Icon";
import "./audio.css";

const VOLUMES = [["masterVolume", "总音量"], ["musicVolume", "背景音乐"], ["effectsVolume", "战斗音效"], ["voiceVolume", "角色语音"]] as const;

export function AudioSettings({ runtime, summary }: { runtime: BattleRuntime; summary: BattleSummary }) {
  const settings = summary.audio;
  const status = settings.state === "unsupported" ? "浏览器无法启用音频" : settings.state === "blocked" ? "请点击声音按钮重试" : !summary.sound ? "已静音" : settings.loading ? "正在准备声音…" : settings.failedClips ? "部分声音加载失败" : "声音已开启";
  const set = (value: Partial<BattleAudioSettings>) => runtime.setAudioSettings(value);
  return <details className="audio-settings">
    <summary><Icon name="sound" size={16} /><span>声音设置</span><span className="audio-state" role="status">{status}</span><Icon name="chevron" size={14} /></summary>
    <div className="audio-settings-content">
      <label className="audio-music-mode" htmlFor="audio-music-mode"><span>配乐方式</span><select id="audio-music-mode" value={settings.musicMode} onChange={event => set({ musicMode: event.target.value as "stage" | "jamie" })}><option value="stage">跟随舞台</option><option value="jamie">统一使用杰米主题</option></select></label>
      <div className="audio-volumes">{VOLUMES.map(([key, label]) => <label key={key} htmlFor={`audio-${key}`}><span>{label}</span><output htmlFor={`audio-${key}`}>{Math.round(settings[key] * 100)}%</output><input id={`audio-${key}`} type="range" min="0" max="100" step="1" value={Math.round(settings[key] * 100)} onChange={event => set({ [key]: Number(event.target.value) / 100 })} /></label>)}</div>
      <label className="audio-voice"><input type="checkbox" checked={settings.voiceEnabled} onChange={event => set({ voiceEnabled: event.target.checked })} /><span>角色日语语音（开场、战斗与胜利）</span></label>
      <p>任意一方生命降至 25% 时切换残血配乐。演练跟随舞台时使用训练场配乐。</p>
      {settings.failedClips > 0 && <p className="audio-notice" role="status">有 {settings.failedClips} 项声音未能加载，可关闭声音后重新开启。</p>}
    </div>
  </details>;
}
