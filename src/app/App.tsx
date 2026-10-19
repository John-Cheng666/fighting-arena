import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { DEFAULT_MATCH_CONFIG, formatTime } from "../game/config";
import { getStage, readSavedStage, type StageId } from "../content/stages";
import { BattleRuntime, type RuntimePhase } from "../runtime/BattleRuntime";
import { getCharacterUI } from "../characters/ui";
import { BattleCanvas } from "./BattleCanvas";
import { BattleLogPanel } from "./BattleLogPanel";
import { FighterCard } from "./FighterCard";
import { MatchSettings } from "./MatchSettings";
import { StageSelector } from "./StageSelector";
import { Icon } from "./Icon";
import { AudioSettings } from "./AudioSettings";

const PHASE_LABELS: Record<RuntimePhase, string> = { ready: "准备就绪", opening: "开场演出中", running: "对战进行中", paused: "对战已暂停", finished: "对局已结束" };
type Theme = "light" | "dark";
function readTheme(): Theme {
  try { const saved = localStorage.getItem("arena-lab-theme"); if (saved === "light" || saved === "dark") return saved; } catch { /* Storage is optional. */ }
  return "light";
}

export function App() {
  const [runtime] = useState(() => new BattleRuntime(DEFAULT_MATCH_CONFIG));
  const runtimeOwner = useRef<BattleRuntime | null>(null);
  const summary = useSyncExternalStore(runtime.subscribe, runtime.getSummary, runtime.getSummary);
  const [stageId, setStageId] = useState<StageId>(readSavedStage);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [configTab, setConfigTab] = useState<"fighters" | "rules">("fighters");
  const [notice, setNotice] = useState<{ message: string; sequence: number } | null>(null);
  const [fullscreenError, setFullscreenError] = useState("");
  const [canvasError, setCanvasError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const stage = getStage(stageId);
  const loading = !summary.loaded;
  const demonstrating = summary.mode === "demonstration";
  const { TrainingPanel } = getCharacterUI(summary.demonstration?.characterId ?? summary.fighters[0].characterId);
  const featured = runtime.characters.get(summary.fighters[0].characterId).metadata;
  const phaseLabel = canvasError ? "竞技场加载失败" : loading ? "正在加载竞技场" : demonstrating
    ? summary.phase === "paused" ? "演练已暂停" : summary.phase === "finished" ? "演练已结束" : summary.phase === "ready" ? "演练准备就绪" : "招式演练中"
    : PHASE_LABELS[summary.phase];
  const showNotice = useCallback((message: string) => setNotice({ message, sequence: Date.now() }), []);
  const primaryAction = useCallback(() => {
    const current = runtime.getSummary();
    if (!current.loaded) return;
    if (current.phase === "ready") runtime.startWithOpening();
    else if (current.phase === "finished") runtime.restart(undefined, true, true);
    else runtime.togglePause();
  }, [runtime]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f4f5f7" : "#11151c");
    try { localStorage.setItem("arena-lab-theme", theme); } catch { /* Keep the in-memory selection. */ }
  }, [theme]);
  useEffect(() => { runtime.setAudioStage(stageId); try { localStorage.setItem("arena-lab-stage", stageId); } catch { /* Keep the in-memory selection. */ } }, [runtime, stageId]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    const navigate = () => {
      if (!runtime.getSummary().loaded) return;
      const hash = location.hash;
      const current = runtime.getSummary();
      if (hash === "#training" && current.mode !== "demonstration") {
        runtime.demonstrate("row-0", "hit", false);
        heading.current?.focus({ preventScroll: true });
      } else if (hash === "#battle" && current.mode === "demonstration") {
        runtime.exitDemonstration(false);
        heading.current?.focus({ preventScroll: true });
      }
      if (hash === "#match-settings") setConfigTab("rules");
    };
    navigate();
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, [runtime, summary.loaded]);
  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, video, audio, summary, [contenteditable="true"]')) return;
      if (event.code === "Space") {
        if (event.target instanceof HTMLElement && event.target.closest("button, a")) return;
        event.preventDefault(); primaryAction();
      } else if (event.code === "KeyR" && runtime.getSummary().loaded) {
        event.preventDefault(); runtime.restart(undefined, true, true);
      } else if (event.code === "KeyM") runtime.toggleSound();
    };
    const visibility = () => { if (document.hidden) runtime.pause(); };
    const fullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener("keydown", keydown);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("fullscreenchange", fullscreenChange);
    return () => {
      window.removeEventListener("keydown", keydown);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("fullscreenchange", fullscreenChange);
    };
  }, [runtime, primaryAction]);
  useEffect(() => {
    runtimeOwner.current = runtime;
    return () => {
      runtimeOwner.current = null;
      // StrictMode rehearses effect cleanup/setup without discarding state.
      // Only dispose after an actual unmount or replacement of this runtime.
      queueMicrotask(() => { if (runtimeOwner.current !== runtime) runtime.dispose(); });
    };
  }, [runtime]);

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (viewport.current?.requestFullscreen) await viewport.current.requestFullscreen();
      else throw new Error("unavailable");
      setFullscreenError("");
    } catch { setFullscreenError("当前浏览器无法进入全屏，可使用浏览器缩放调整观看大小。"); }
  }
  function tabKeydown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "fighters" : event.key === "End" ? "rules" : configTab === "fighters" ? "rules" : "fighters";
    setConfigTab(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`#${next}-tab`)?.focus();
  }
  const primaryLabel = summary.phase === "ready" ? demonstrating ? "开始演练" : "开始对战"
    : summary.phase === "running" || summary.phase === "opening" ? "暂停" : summary.phase === "paused" ? "继续播放" : demonstrating ? "重播演练" : "再来一局";
  const totalHits = summary.fighters.reduce((sum, fighter) => sum + fighter.hits, 0);
  const totalDamage = summary.fighters.reduce((sum, fighter) => sum + fighter.damageDealt, 0);
  const remaining = Math.max(0, runtime.battle.config.roundTimeSeconds - Math.floor(summary.roundElapsed));

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">跳转到主要内容</a>
    <header className="topbar">
      <a className="brand" href="#battle" aria-label="Arena Lab 自动对战首页"><span className="brand-mark"><Icon name="swords" size={23} /></span><span>ARENA<span className="brand-slash">/</span>LAB<small>自动格斗实验场</small></span></a>
      <nav className="main-nav" aria-label="主要导航">
        <a href="#battle" aria-current={!demonstrating ? "page" : undefined}><Icon name="swords" size={18} />自动对战</a>
        <a href="#training" aria-current={demonstrating ? "page" : undefined}><Icon name="activity" size={18} />招式演练</a>
        <a href="#battle-log"><Icon name="document" size={18} />对局记录</a>
      </nav>
      <div className="topbar-actions"><span className="local-badge"><i />本地实验场</span><button className="icon-button theme-toggle" aria-label={theme === "light" ? "切换深色主题" : "切换浅色主题"} title={theme === "light" ? "切换深色主题" : "切换浅色主题"} onClick={() => setTheme(theme === "light" ? "dark" : "light")}><Icon name={theme === "light" ? "moon" : "sun"} size={20} /></button></div>
    </header>
    <main id="main-content" className="main-content" tabIndex={-1}>
      <section className="page-heading" aria-labelledby="page-title">
        <div><div className="eyebrow"><span />{demonstrating ? "THE MOVE LAB" : "THE MATCH ROOM"}<span className="version-tag">ARENA 01</span></div><h1 id="page-title" ref={heading} tabIndex={-1}>{demonstrating ? "招式演练室" : "斗蛐蛐实验室"}<span className="heading-dot">.</span></h1><p>{demonstrating ? "选一招，慢慢看。从起手到收招，每一步都有迹可循。" : "设定双方，观察交锋，复盘每一次出招。"}</p></div>
        <div className="session-meta"><span>当前对局种子</span><strong>#{String(summary.seed).padStart(6, "0")}</strong><a href={demonstrating ? "#battle" : "#match-settings"} onClick={() => { if (!demonstrating) setConfigTab("rules"); }}>{demonstrating ? "返回自动对战" : "调整对局规则"}<Icon name="arrow" size={14} /></a></div>
      </section>
      <details className="quick-guide"><summary><Icon name="help" size={17} /><span>第一次来？了解操作方法</span><Icon name="chevron" size={14} /></summary><div className="guide-steps"><p><strong>01 配置双方</strong><span>在参赛选手中调整 CPU 等级、生命和初始资源。</span></p><p><strong>02 开始观察</strong><span>点击开始，双方自动交锋。可随时暂停、慢放或切换舞台。</span></p><p><strong>03 查看记录</strong><span>下方按招式、伤害和来源筛选事件，导出 JSON 留存。</span></p></div><p className="guide-shortcuts"><kbd>空格</kbd> 播放 / 暂停 <kbd>R</kbd> 重开 <kbd>M</kbd> 音效；离开页面时自动暂停。</p></details>
      <div className={`workspace ${demonstrating ? "with-training" : ""}`}>
        {demonstrating && TrainingPanel && <TrainingPanel runtime={runtime} summary={summary} />}
        <div className="arena-column">
          <section className="arena-panel" id="arena" aria-labelledby="arena-title">
            <div className="arena-topline"><div className="arena-name"><span className="arena-index">{stage.number}</span><div><h2 id="arena-title">{stage.name}</h2><span>{stage.englishName}</span></div></div><span className={`match-status ${summary.phase}`}><i />{phaseLabel}</span></div>
            <div className="arena-controls">
              <div className="transport-controls">
                <button className="primary-button" onClick={primaryAction} disabled={loading} aria-keyshortcuts="Space"><Icon name={summary.phase === "running" || summary.phase === "opening" ? "pause" : "play"} size={18} />{primaryLabel}<kbd>空格</kbd></button>
                {summary.opening && <button className="restart-button" onClick={() => runtime.skipOpening()}>跳过开场</button>}
                <button className="restart-button" onClick={() => runtime.restart(undefined, true, true)} disabled={loading} aria-label={demonstrating ? "重播演练" : "重开对局"} title="重开（R）"><Icon name="reset" size={17} /><span>重开</span></button>
              </div>
              <div className="playback-control" role="group" aria-label="播放速度"><span>速度</span>{[0.25, 0.5, 1, 2, 4].map(speed => <button key={speed} aria-label={`${speed} 倍速`} aria-pressed={summary.speed === speed} onClick={() => runtime.setSpeed(speed)}>{speed}×</button>)}</div>
              <div className="utility-controls"><button className={`icon-button ${summary.sound ? "enabled" : ""}`} onClick={() => runtime.toggleSound()} aria-label={summary.sound ? "关闭声音" : "开启声音"} aria-pressed={summary.sound} title="声音（M）"><Icon name={summary.sound ? "sound" : "muted"} size={19} /></button><button className="icon-button" onClick={() => void fullscreen()} aria-label="全屏竞技场" title="全屏竞技场"><Icon name="expand" size={18} /></button></div>
            </div>
            <AudioSettings runtime={runtime} summary={summary} />
            <div ref={viewport} className="arena-viewport">
              <BattleCanvas runtime={runtime} stageId={stageId} matchup={summary.fighters.map(fighter => fighter.label).join(" 与 ")} onError={setCanvasError} />
              {loading && !canvasError && <div className="loading-screen" role="status"><span className="loading-ring" /><strong>正在准备竞技场</strong><span>角色和舞台即将就绪…</span></div>}
              {isFullscreen && <button className="exit-fullscreen" onClick={() => void fullscreen()}><Icon name="expand" size={17} />退出全屏 <kbd>Esc</kbd></button>}
            </div>
            <div className="arena-bottomline"><span><Icon name={summary.phase === "finished" ? "check" : "info"} size={15} />{demonstrating ? "演练自动准备所需酒级、资源与前置动作" : summary.opening ? `${summary.opening.label} · 可暂停或跳过开场` : summary.phase === "ready" ? "双方已就位，点击「开始对战」自动交锋" : summary.phase === "finished" ? "本局已结束，可查看下方记录或再来一局" : "双方自主出招，可随时暂停观察"}</span><span className="arena-coordinate">{stage.style} / {stage.time}</span></div>
            {fullscreenError && <p className="fullscreen-error" role="status">{fullscreenError}</p>}
          </section>
          <div className="match-stats" aria-label="本局统计"><div><span><Icon name="clock" size={16} />回合剩余</span><strong>{formatTime(remaining)}<small> / {runtime.battle.config.roundTimeSeconds}s</small></strong></div><div><span><Icon name="activity" size={16} />累计伤害</span><strong>{totalDamage.toLocaleString()}<small> HP</small></strong></div><div><span><Icon name="swords" size={16} />累计命中</span><strong>{String(totalHits).padStart(2, "0")}<small> 次</small></strong></div></div>
          {summary.phase === "finished" && !demonstrating && <div className="winner-banner" role="status"><Icon name="trophy" size={25} /><div><span>{summary.winner ? "本局胜者" : "本局结果"}</span><strong>{summary.winner ? runtime.fighterLabel(summary.winner) : "平局"}</strong></div><a href="#battle-log">查看完整记录<Icon name="arrow" size={17} /></a></div>}
          <StageSelector stageId={stageId} onSelect={setStageId} />
        </div>
        <aside className="sidebar" aria-label={demonstrating ? "招式选择与状态" : "对局配置"}>
          <section className="configuration-panel" id="match-settings" aria-labelledby="configuration-title">
            <div className="section-heading"><div><span className="section-kicker">{demonstrating ? "LIVE STATUS" : "MATCH SETUP"}</span><h2 id="configuration-title">{demonstrating ? "场上状态" : "对局配置"}</h2></div><span className="neutral-badge">{demonstrating ? "2 PLAYERS" : "双方独立设置"}</span></div>
            {!demonstrating && <div className="config-tabs" role="tablist" aria-label="对局配置分类" onKeyDown={tabKeydown}><button id="fighters-tab" role="tab" aria-selected={configTab === "fighters"} aria-controls="fighters-panel" tabIndex={configTab === "fighters" ? 0 : -1} onClick={() => setConfigTab("fighters")}><Icon name="users" size={17} />参赛选手</button><button id="rules-tab" role="tab" aria-selected={configTab === "rules"} aria-controls="rules-panel" tabIndex={configTab === "rules" ? 0 : -1} onClick={() => setConfigTab("rules")}><Icon name="settings" size={17} />对局规则</button></div>}
            <div id="fighters-panel" role={!demonstrating ? "tabpanel" : undefined} aria-labelledby={!demonstrating ? "fighters-tab" : undefined} hidden={!demonstrating && configTab !== "fighters"}><div className="fighter-list">{summary.fighters.map(fighter => <FighterCard key={`${fighter.player}:${fighter.characterId}`} fighter={fighter} summary={summary} runtime={runtime} onNotice={showNotice} />)}</div>{!demonstrating && runtime.characters.list().length === 1 && <p className="roster-note"><Icon name="info" size={15} />当前开放角色：{featured.name}。双方可使用不同参数。</p>}</div>
            {!demonstrating && <div id="rules-panel" role="tabpanel" aria-labelledby="rules-tab" hidden={configTab !== "rules"}><MatchSettings runtime={runtime} onApplied={showNotice} /></div>}
          </section>
          <div className="reference-note"><span><Icon name="info" size={17} />关于这个实验场</span><p>{featured.name}的二维竞技场模拟，适合观察招式与自动对战。</p>{featured.links && <div><a href={featured.links.character} target="_blank" rel="noreferrer">官方角色 ↗</a><a href={featured.links.moves} target="_blank" rel="noreferrer">官方招式表 ↗</a></div>}</div>
        </aside>
      </div>
      <BattleLogPanel runtime={runtime} summary={summary} onNotice={showNotice} />
    </main>
    <footer className="page-footer"><span>ARENA / LAB <i />把每一场交锋，看得更清楚。</span><span>本地模拟 · 随时开始下一局</span></footer>
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">{notice && <div className="toast"><Icon name="check" size={18} /><span>{notice.message}</span><button className="icon-button" onClick={() => setNotice(null)} aria-label="关闭提示"><Icon name="close" size={17} /></button></div>}</div>
    <div className="sr-only" role="status" aria-atomic="true">{phaseLabel}{summary.phase === "finished" && summary.winner ? `，${runtime.fighterLabel(summary.winner)}获胜` : ""}</div>
  </div>;
}
