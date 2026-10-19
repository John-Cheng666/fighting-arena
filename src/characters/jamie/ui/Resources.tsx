import { getJamieState } from "../state";
import { actionPhaseLabel } from "./TrainingPanel";
import type { CharacterResourceProps } from "../../../app/characterUI";
export function JamieResources({ fighter, elapsed, frozen, finished }: CharacterResourceProps) {
  const jamie = getJamieState(fighter)!;
  const sa2Active = jamie.sa2UntilTick > elapsed * 60;
  const drinkLevel = sa2Active ? jamie.sa2OriginalDrinkLevel : jamie.drinkLevel;
  const burnout = jamie.burnout;
  const shownHits = jamie.action?.moveId.startsWith("A") ? jamie.action.hitCount ?? 0 : jamie.comboCount;
  return (<div className="jamie-resources">
          <div className="drink-row">
            <span>酒级</span>
            <div className="drink-pips" role="meter" aria-label={`${fighter.label}真实酒级`} aria-valuemin={0} aria-valuemax={4} aria-valuenow={drinkLevel}>
              {[1, 2, 3, 4].map((level) => <i key={level} className={level <= drinkLevel ? "filled" : ""} />)}
            </div>
            <strong>{drinkLevel}<small>/4</small></strong>
            {sa2Active && <span className="sa2-badge">SA2 · 临时4级</span>}
          </div>
          <div className={`resource-row drive ${burnout ? "burnout" : ""}`}>
            <span>DRIVE</span>
            <div role="progressbar" aria-label={`${fighter.label}Drive`} aria-valuemin={0} aria-valuemax={6} aria-valuenow={Math.round(jamie.drive / 1000) / 10} className="resource-track"><i style={{ width: `${Math.max(0, Math.min(100, jamie.drive / 600))}%` }} /></div>
            <strong>{burnout ? "耗尽" : (jamie.drive / 10000).toFixed(1)}</strong>
          </div>
          <div className="resource-row super">
            <span>SA</span>
            <div role="progressbar" aria-label={`${fighter.label}SA`} aria-valuemin={0} aria-valuemax={3} aria-valuenow={Math.round(jamie.super / 1000) / 10} className="resource-track"><i style={{ width: `${Math.max(0, Math.min(100, jamie.super / 300))}%` }} /></div>
            <strong>{(jamie.super / 10000).toFixed(1)}</strong>
          </div>
          <div className="fighter-action" title={jamie.action?.name ?? "调整步法"}>
            <span>{jamie.action?.name ?? "调整步法"}</span>
            {shownHits > 1 && <strong>{shownHits} HIT</strong>}
          </div>
          <p className="fighter-intent">{finished ? "收势，等待下一次交手" : fighter.capture ? "被命中 · 连续受击" : jamie.action ? actionPhaseLabel(jamie.action, frozen) : jamie.intent}</p>
        </div>);
}
