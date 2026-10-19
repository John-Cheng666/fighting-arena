import type { BattleRuntime, BattleSummary } from "../runtime/BattleRuntime";
import { getCharacterUI } from "../characters/ui";
import { CharacterSettings } from "./CharacterSettings";
import { Icon } from "./Icon";

export function FighterCard({ fighter, summary, runtime, onNotice }: {
  fighter: BattleSummary["fighters"][number]; summary: BattleSummary;
  runtime: BattleRuntime; onNotice: (message: string) => void;
}) {
  const module = runtime.characters.get(fighter.characterId);
  const { Resources } = getCharacterUI(fighter.characterId);
  const finished = summary.phase === "finished";
  const characters = runtime.characters.list();
  const hpPercent = Math.max(0, Math.min(100, fighter.hp / fighter.maxHp * 100));
  return <article className={`fighter-card player-${fighter.player} ${finished && summary.winner === fighter.id ? "is-winner" : ""}`} aria-label={`${fighter.label}状态与设置`}>
    <div className="fighter-header">
      <div className="portrait" style={{ backgroundImage: `url(${module.metadata.portrait})` }} aria-hidden="true" />
      <div className="fighter-identity">
        <div className="fighter-title"><span className="player-badge">{fighter.player}P</span><h3>{module.metadata.name}</h3>{finished && summary.winner === fighter.id && <span className="winner-label"><Icon name="trophy" size={14} />胜者</span>}</div>
        <p>{module.metadata.tag}</p>
      </div>
      <span className="cpu-badge">CPU <strong>{String(fighter.settings.cpuLevel ?? "—")}</strong></span>
    </div>
    <div className="hp-line"><span>生命值 <small>HP</small></span><strong>{fighter.hp.toLocaleString()}<small> / {fighter.maxHp.toLocaleString()}</small></strong></div>
    <div className={`hp-track ${hpPercent < 30 ? "critical" : ""}`} role="progressbar" aria-label={`${fighter.label}生命值`} aria-valuemin={0} aria-valuemax={fighter.maxHp} aria-valuenow={fighter.hp}><span style={{ width: `${hpPercent}%` }} /></div>
    {Resources ? <Resources fighter={fighter} elapsed={summary.elapsed} finished={finished} frozen={summary.superFreezeRemaining > 0 && summary.superFreezeSourceId === fighter.id} /> : <p className="fighter-intent">{fighter.status.actionName} · {fighter.status.intent}</p>}
    {summary.mode === "battle" && characters.length > 1 && <label className="character-select"><span>参战角色</span><select aria-label={`${fighter.player}P选择角色`} value={fighter.characterId} onChange={event => runtime.selectFighter(fighter.player, event.target.value)}>{characters.map(character => <option key={character.id} value={character.id}>{character.metadata.name}</option>)}</select></label>}
    {summary.mode === "battle" && <CharacterSettings runtime={runtime} fighter={fighter} module={module} onApplied={onNotice} />}
  </article>;
}
