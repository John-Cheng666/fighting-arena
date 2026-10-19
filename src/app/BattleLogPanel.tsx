import { useEffect, useMemo, useState } from "react";
import type { ContactEvent, FighterId } from "../engine/types";
import { TICK_RATE } from "../engine/types";
import type { BattleLog, BattleRuntime, BattleSummary } from "../runtime/BattleRuntime";
import { Icon } from "./Icon";

const PAGE_SIZE = 20;
const CATEGORIES = [
  ["all", "全部事件"], ["damage", "伤害"], ["defense", "防御 / 格挡"],
  ["heal", "生命回复"], ["action", "动作 / 状态"], ["result", "胜负"],
] as const;

function timestamp(tick: number): string {
  const seconds = Math.floor(tick / TICK_RATE);
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}.${(tick % TICK_RATE).toString().padStart(2, "0")}`;
}

function sourceOf(log: BattleLog): FighterId | undefined {
  const event = log.event;
  return "sourceId" in event ? event.sourceId : "fighterId" in event ? event.fighterId : "targetId" in event ? event.targetId : undefined;
}

function ContactDetail({ event }: { event: ContactEvent }) {
  const tags = [
    event.damageType === "chip" && "Burnout 削血", event.damageType === "throw" && "投技",
    event.damageType === "projectile" && "弹体", event.armor && "霸体承伤",
    event.recoverable && "可恢复伤害", event.captured && "捕获", event.finish && "收尾",
    event.punish && "确反", event.counter && !event.punish && "反击",
  ].filter(Boolean);
  const calculation = event.calculation;
  return (
    <details className="contact-detail">
      <summary>HP {event.hpBefore.toLocaleString()} → {event.hpAfter.toLocaleString()} · 实扣 {event.hpLoss.toLocaleString()}{tags.length > 0 ? ` · ${tags.join(" / ")}` : ""}</summary>
      <div>
        <p>招式：{event.moveId ?? "未命名"}{event.variantId ? ` / ${event.variantId}` : ""}{event.segment !== undefined ? ` / 第 ${event.segment + 1} 段` : ""}</p>
        {calculation && <>
          <p>基础伤害 {calculation.baseDamage} · 补正 {calculation.factors.map(factor => `${factor}%`).join(" × ")} · 设置倍率 {calculation.multiplier}×{calculation.minimum > 0 ? ` · 保底 ${calculation.minimum}` : ""}</p>
          <p>{calculation.rounding === "native" ? "补正按原生定点精度合并并截断，应用保底与设置倍率后向下取整。" : "应用补正后四舍五入。"}</p>
        </>}
        <p>{event.deferred ? `此前伤害已结算，捕获结束时扣除保留的 ${event.hpLoss} HP，不重复计入输出。` : `结算伤害 ${event.amount} · 实际扣血 ${event.hpLoss}${event.amount > event.hpLoss ? "（受剩余生命或捕获保留生命限制）" : ""}`}</p>
      </div>
    </details>
  );
}

export function BattleLogPanel({ runtime, summary, onNotice }: { runtime: BattleRuntime; summary: BattleSummary; onNotice: (message: string) => void }) {
  const [category, setCategory] = useState("all");
  const [source, setSource] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [following, setFollowing] = useState(true);
  const [captured, setCaptured] = useState<BattleLog[]>([]);
  useEffect(() => { setFollowing(true); setCaptured([]); }, [summary.revision]);
  const logs = following ? summary.logs : captured;
  useEffect(() => { setPage(0); }, [category, source, query, summary.revision]);
  const filtered = useMemo(() => logs.filter(log =>
    (category === "all" || log.category === category || category === "defense" && log.event.type === "contact" && log.event.outcome === "block") &&
    (source === "all" || sourceOf(log) === source) &&
    (!query.trim() || `${log.text} ${"variantId" in log.event ? log.event.variantId ?? "" : ""} ${"moveId" in log.event ? log.event.moveId ?? "" : ""}`.toLowerCase().includes(query.trim().toLowerCase())),
  ), [logs, category, source, query]);
  const sources = useMemo(() => {
    const groups = new Map<string, { source: FighterId; name: string; damage: number; hpLoss: number; contacts: number; chip: number }>();
    for (const log of logs) {
      const event = log.event;
      if (event.type !== "contact" || event.amount <= 0 && event.hpLoss <= 0) continue;
      const key = `${event.sourceId}:${event.variantId ?? event.moveId ?? event.damageType}`;
      const group = groups.get(key) ?? { source: event.sourceId, name: event.name ?? event.moveId ?? "攻击", damage: 0, hpLoss: 0, contacts: 0, chip: 0 };
      group.damage += event.amount; group.hpLoss += event.hpLoss;
      if (event.amount > 0) group.contacts += 1;
      if (event.damageType === "chip") group.chip += event.amount;
      groups.set(key, group);
    }
    return [...groups.entries()].sort((a, b) => b[1].damage - a[1].damage);
  }, [logs]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  function download() {
    const url = URL.createObjectURL(new Blob([runtime.exportLog()], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `arena-${summary.mode}-${summary.seed}-f${runtime.getState().tick}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotice("对局 JSON 已导出，包含完整事件与双方参数");
  }

  function changePage(next: number) {
    if (following && summary.phase === "running") { setCaptured(summary.logs); setFollowing(false); }
    setPage(next);
  }
  function clearFilters() { setCategory("all"); setSource("all"); setQuery(""); }

  return <section id="battle-log" aria-labelledby="battle-log-title" className="battle-log">
    <div className="records-heading"><div><span className="section-kicker">MATCH RECORDS</span><h2 id="battle-log-title">对局记录 <span>{summary.logs.length}</span></h2><p>从出招到胜负，完整保留这一局的每个事件。</p></div><div className="records-actions"><button className="secondary-button" type="button" disabled={summary.logs.length === 0} aria-pressed={!following} onClick={() => { if (following) setCaptured(summary.logs); else setPage(0); setFollowing(!following); }}><Icon name={following ? "pause" : "play"} size={16} />{following ? "暂停列表更新" : "继续列表更新"}</button><button className="secondary-button export-button" type="button" onClick={download} disabled={summary.logs.length === 0}><Icon name="download" size={17} />导出 JSON</button></div></div>
    <div className="log-toolbar">
      <div className="log-filters">
        <label className="field"><span>事件类型</span><select aria-label="日志事件类型" value={category} onChange={event => setCategory(event.target.value)}>{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span>事件来源</span><select aria-label="日志来源" value={source} onChange={event => setSource(event.target.value)}><option value="all">双方来源</option>{summary.fighters.map(fighter => <option key={fighter.id} value={fighter.id}>{fighter.label}</option>)}</select></label>
        <label className="field log-search"><span>搜索记录</span><span className="search-input"><Icon name="search" size={18} /><input type="search" aria-label="搜索对局日志" placeholder="搜索招式、事件或编号…" value={query} onChange={event => setQuery(event.target.value)} /></span></label>
        {(query || category !== "all" || source !== "all") && <button type="button" className="clear-filters" onClick={clearFilters}>清除筛选</button>}
      </div>
      <div className="log-meta"><span className={following && summary.phase === "running" ? "is-live" : ""}><i />{following ? summary.phase === "running" ? "实时记录中" : "本局记录" : "列表更新已暂停，对局仍正常记录"} · {filtered.length} 条</span><span>最新事件在前 · 时间为 分:秒.帧</span></div>
    </div>
    {sources.length > 0 && <details className="damage-sources"><summary>伤害来源汇总 · {sources.length} 项</summary>
      <p className="log-help">统计整局双方输出，含削血；结算伤害可能高于实际扣血。</p>
      <div className="damage-source-list">{sources.map(([key, group]) => <div key={key} className={group.source}>
        <span>{group.source === "p1" ? "1P" : "2P"} · {group.name}<small>{group.contacts} 次伤害{group.chip > 0 ? ` · 削血 ${group.chip}` : ""}</small></span>
        <span><strong>{group.damage.toLocaleString()}</strong><small>实扣 {group.hpLoss.toLocaleString()}</small></span>
      </div>)}</div>
    </details>}
    {summary.logs.length === 0 ? <div className="empty-log"><span className="empty-icon"><Icon name="document" size={26} /></span><strong>好戏还没开始，记录也在等待</strong><p>点击竞技场上方的「{summary.mode === "demonstration" ? "开始演练" : "开始对战"}」，这里会记录出招、伤害与胜负。</p><a href="#arena">前往竞技场<Icon name="arrow" size={15} /></a></div>
      : visible.length === 0 ? <div className="empty-log"><Icon name="search" size={26} /><strong>没有找到符合条件的记录</strong><p>试试其他关键词，或清除筛选查看全部事件。</p><button className="secondary-button" onClick={clearFilters}>清除筛选</button></div>
      : <ol className="complete-log-list">{visible.map(log => <li key={`${summary.revision}:${log.id}`} className={log.kind}>
        <span className="log-time" title={`第 ${log.tick} 帧`}>{timestamp(log.tick)}<small>F{log.tick}</small></span><span className="log-marker" />
        <div className="log-message"><span className="event-category">{CATEGORIES.find(([value]) => value === log.category)?.[1] ?? "事件"}</span><p>{log.text}</p>{log.event.type === "contact" && <ContactDetail event={log.event} />}{log.event.type === "heal" && log.event.hpBefore !== undefined && <small className="heal-detail">HP {log.event.hpBefore} → {log.event.hpAfter}</small>}</div>
      </li>)}</ol>}
    {summary.logs.length > 0 && <div className="log-pagination"><button className="secondary-button" type="button" disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}>上一页</button><span>第 {currentPage + 1} / {pages} 页 · 每页 {PAGE_SIZE} 条</span><button className="secondary-button" type="button" disabled={currentPage >= pages - 1} onClick={() => changePage(currentPage + 1)}>下一页</button></div>}
    <div className="records-footnote"><Icon name="info" size={15} /><span>日志仅保留在当前页面；重开、切换模式或刷新会清空。需要留存时请先导出。每秒 60 帧。</span></div>
  </section>;
}
