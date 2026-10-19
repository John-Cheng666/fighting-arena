import { getJamieState } from "../state";
import { useRef, useState } from "react";
import { JAMIE_MOVE_CATALOG, JAMIE_SOURCES, JAMIE_VARIANTS, JAMIE_VARIANT_BY_ID, type JamieVariant } from "../moves";
import type { JamieAction } from "../types";
import type { BattleRuntime, BattleSummary } from "../../../runtime/BattleRuntime";
import { Icon } from "../../../app/Icon";

const CATEGORIES = [
  { id: "normal", label: "普通技" },
  { id: "unique", label: "特殊技" },
  { id: "special", label: "必杀技" },
  { id: "super", label: "超级艺术" },
  { id: "throw", label: "投技" },
  { id: "drive", label: "Drive" },
  { id: "movement", label: "移动与共通" },
] as const;
type Category = typeof CATEGORIES[number]["id"];

function categoryOf(variant: JamieVariant): Category {
  if (variant.moveId.startsWith("N")) return "normal";
  if (variant.moveId.startsWith("U")) return "unique";
  if (variant.moveId.startsWith("S")) return "special";
  if (variant.moveId.startsWith("A")) return "super";
  if (variant.moveId.startsWith("T")) return "throw";
  if (variant.moveId.startsWith("D")) return "drive";
  return "movement";
}

export function actionPhaseLabel(action: JamieAction | null, frozen = false): string {
  if (!action) return "调整步法";
  if (frozen && action.moveId === "A02") return (action.introFrame ?? 0) < (action.introDuration ?? 100) * 0.58 ? "SA2 · 举壶饮用" : "SA2 · 拭嘴收势";
  if (frozen) return "超级技起手 · 定格";
  if (action.cinematicPhase === "finish") return "终结段";
  if (action.cinematicPhase === "combo") return "命中确认 · 连续攻击";
  if (action.cinematicPhase === "startup") return "起手";
  const variant = JAMIE_VARIANT_BY_ID[action.variantId];
  if (action.frame < (variant?.startup ?? 0)) return "起手";
  if (action.pose === "drink") return action.drinkApplied ? "饮酒完成 · 收势" : "举壶饮酒";
  const lastActive = Math.max(0, ...(variant?.active.map((window) => window[1]) ?? []));
  if (lastActive && action.frame > lastActive) return action.connected ? "命中 · 收招" : action.blocked ? "被防御 · 收招" : "落空 · 收招";
  if (action.connected) return "命中确认";
  if (action.blocked) return "对手防御";
  return lastActive ? "攻击段" : "动作中";
}

const OUTCOMES = {
  pending: "等待结果",
  hit: "命中",
  block: "对手防御",
  whiff: "落空",
  success: "动作完成",
  unavailable: "此情境未能完成，请换一种对手状态",
};

export function TrainingStateStrip({ summary }: { summary: BattleSummary }) {
  return <div className="training-state-strip" role="group" aria-label="演练双方资源">
    {summary.fighters.map((fighter) => {
      const jamie = getJamieState(fighter);
      const temporary = Boolean(jamie && jamie.sa2UntilTick > summary.elapsed * 60);
      const level = jamie ? temporary ? jamie.sa2OriginalDrinkLevel : jamie.drinkLevel : 0;
      return <div key={fighter.id} className={`player-${fighter.player}`}>
        <div><strong>{fighter.label}</strong><span>HP {fighter.hp.toLocaleString()}</span></div>
        <p><span>酒级 {level}/4</span><span>Drive {((jamie?.drive ?? 0) / 10000).toFixed(1)}</span><span>SA {((jamie?.super ?? 0) / 10000).toFixed(1)}</span></p>
        {temporary && <small>SA2 · 临时4级</small>}
      </div>;
    })}
  </div>;
}

export function JamieTrainingPanel({ runtime, summary }: { runtime: BattleRuntime; summary: BattleSummary }) {
  const [variantId, setVariantId] = useState(summary.demonstration?.variantId ?? "row-0");
  const [scenario, setScenario] = useState<"hit" | "block" | "whiff">(summary.demonstration?.scenario ?? "hit");
  const [error, setError] = useState("");
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const selected = JAMIE_VARIANT_BY_ID[variantId] ?? JAMIE_VARIANTS[89];
  const category = categoryOf(selected);
  const variants = JAMIE_VARIANTS.filter((variant) => variant.moveId === selected.moveId);
  const groups = [...new Map(JAMIE_VARIANTS.filter((variant) => categoryOf(variant) === category).map((variant) => [variant.moveId, variant])).values()];
  const source = JAMIE_MOVE_CATALOG.find((move) => move.id === selected.moveId);
  const demonstration = summary.demonstration;
  const action = getJamieState(summary.fighters[0])?.action ?? null;
  const playingSelected = demonstration?.variantId === selected.id;
  const currentTarget = action?.variantId === demonstration?.variantId;
  const phase = summary.phase === "ready" ? "准备就绪，点击开始演练" : demonstration?.status === "complete" ? "演练结束" : demonstration?.status === "preparing" ? "准备饮酒 / 资源 / 前置" : action?.variantId === demonstration?.variantId ? actionPhaseLabel(action, summary.superFreezeRemaining > 0) : "衔接前置动作";
  const outcome = demonstration?.outcome === "pending" && currentTarget
    ? action?.connected ? "已命中 · 招式进行中" : action?.blocked ? "被防御 · 招式进行中" : selected.damage === 0 && !selected.throw ? "动作进行中" : "等待接触"
    : demonstration ? OUTCOMES[demonstration.outcome] : "等待演练";

  function select(id: string): void {
    setVariantId(id);
    runtime.demonstrate(id, scenario, false);
    setVideoError(false);
    setError("");
  }

  function demonstrate(): void {
    try {
      runtime.demonstrate(selected.id, scenario);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "这次演练没能准备好，请重新选择招式");
    }
  }

  return (
    <section className="training-panel" aria-labelledby="training-title">
      <div className="training-heading">
        <div><span>JAMIE / MOVE LAB</span><h2 id="training-title">选择演练招式</h2></div>
        <Icon name="swords" size={21} />
      </div>
      <div className="move-categories" role="group" aria-label="招式分类">
        {CATEGORIES.map(({ id, label }) => <button key={id} type="button" aria-pressed={category === id} onClick={() => {
          const first = JAMIE_VARIANTS.find((variant) => categoryOf(variant) === id);
          if (first) select(first.id);
        }}>{label}</button>)}
      </div>
      <label className="training-field"><span>招式</span><select aria-label="选择演练招式" value={selected.moveId} onChange={(event) => {
        const first = JAMIE_VARIANTS.find((variant) => variant.moveId === event.target.value);
        if (first) select(first.id);
      }}>{groups.map((variant) => <option key={variant.moveId} value={variant.moveId}>{JAMIE_MOVE_CATALOG.find((move) => move.id === variant.moveId)?.officialName ?? variant.name}</option>)}</select></label>
      <label className="training-field"><span>强度 / 阶段</span><select aria-label="选择招式变体" value={selected.id} onChange={(event) => select(event.target.value)}>
        {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}
      </select></label>
      <div className="move-input"><span>输入</span><code>{selected.input || source?.input || "共通动作"}</code></div>
      <p className="move-condition">
        {selected.drinkMin > 0 ? `酒级 ${selected.drinkMin} 以上` : "酒级 0 可用"}
        {selected.driveCost > 0 && ` · Drive ${selected.driveCost / 10000} 格`}
        {selected.superCost > 0 && ` · SA ${selected.superCost / 10000} 格`}
        {selected.airborne && " · 空中"}
        {selected.row === 90 && " · 生命不高于25%"}
        {[99, 100].includes(selected.row) && " · 精准格挡成功后的结果"}
        {selected.predecessors.length > 0 && " · 从前置招式衔接"}
      </p>
      <p className="move-condition">演练从酒级 0 开始，按需饮酒解锁；初始 Drive / SA 为满。</p>
      <div className="training-scenarios" role="group" aria-label="演练对手状态">
        {([['hit', '命中'], ['block', '防御'], ['whiff', '落空']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={scenario === value} onClick={() => { setScenario(value); runtime.demonstrate(selected.id, value, false); }}>{label}</button>)}
      </div>
      <button className="training-play" onClick={demonstrate} disabled={!summary.loaded}><Icon name="play" size={15} />演练所选招式<Icon name="arrow" size={15} /></button>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className={`training-result ${demonstration?.outcome ?? "pending"}`} role="status">
        <span>{playingSelected ? phase : "已选择新招式 · 点击演练"}</span>
        {demonstration && <strong>{playingSelected ? outcome : `场上：${demonstration.title}`}</strong>}
        {playingSelected && action?.captureTargetId && <small>已确认命中{(action.hitCount ?? 0) > 1 ? ` · ${action.hitCount} 连击` : ""}</small>}
        {playingSelected && demonstration?.status === "complete" && demonstration.hits !== undefined && <small>{demonstration.hits} 次命中 · {demonstration.damage ?? 0} 伤害{(demonstration.blockCount ?? 0) > 0 ? ` · ${demonstration.blockCount} 次防御` : ""}</small>}
      </div>
      <details className="official-reference" open={videoOpen} onToggle={(event) => setVideoOpen(event.currentTarget.open)}>
        <summary>官网视频对照 <span>↗</span></summary>
        {videoOpen && selected.row === 90 && <p className="ca-source-note">官网603展示标准SA3；CA动作另见<a href="https://www.youtube.com/watch?v=eYMdCU_FiCs" target="_blank" rel="noreferrer">实机补充录像（非官网）↗</a>。该录像为2022试玩版，当前数值以官方帧表为准。</p>}
        {videoOpen && (source?.video ? <>
          <video key={selected.id} ref={video} src={`/assets/jamie/reference/${source.video.split("/").at(-1)}`} controls playsInline preload="metadata" onError={() => setVideoError(true)} aria-label={`${selected.row === 90 ? "标准SA3 " : ""}${source.officialName}官网原始演示视频`} />
          <div className="official-video-controls"><a href={source.video} target="_blank" rel="noreferrer">原始视频 ↗</a><label>慢放 <select aria-label="官网视频播放速度" defaultValue="1" onChange={(event) => { if (video.current) video.current.playbackRate = Number(event.target.value); }}><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1">1×</option></select></label></div>
          {videoError && <p>嵌入播放受限，可打开原始视频或官网招式表查看。</p>}
          <p>同一招式的各强度共用官网概览片段。</p>
        </> : <p>此动作没有单独的官网招式视频，可查阅官方帧表。</p>)}
        {videoOpen && <div className="official-source-links"><a href={JAMIE_SOURCES.moves} target="_blank" rel="noreferrer">官网招式表 ↗</a><a href={JAMIE_SOURCES.frames} target="_blank" rel="noreferrer">官方帧表 ↗</a></div>}
      </details>
      <p className="training-help">选择招式后点击开始。自动完成合法前置动作，可用竞技场上方的暂停、慢放与重播仔细看招。</p>
    </section>
  );
}
