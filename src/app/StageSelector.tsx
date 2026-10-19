import type { CSSProperties } from "react";
import { getStage, STAGES, type StageId } from "../content/stages";
import { Icon } from "./Icon";

export function StageSelector({
  stageId,
  onSelect,
}: {
  stageId: StageId;
  onSelect: (stageId: StageId) => void;
}) {
  const current = getStage(stageId);

  return (
    <section className="stage-selector" aria-labelledby="stage-selector-title">
      <div className="stage-selector-heading">
        <div>
          <span className="section-kicker">CHOOSE YOUR STAGE</span>
          <h2 id="stage-selector-title">选择对战舞台</h2>
        </div>
        <span className="stage-count">{current.number}<i>/</i>{String(STAGES.length).padStart(2, "0")}</span>
      </div>
      <div
        className="stage-selection-copy"
        style={{ "--stage-accent": current.accent } as CSSProperties}
      >
        <div className="stage-current-title">
          <span className="stage-current-dot" />
          <strong>{current.name}</strong>
          <span>{current.style}</span>
        </div>
        <p>{current.description}</p>
      </div>
      <div className="stage-grid" role="group" aria-label="选择对战地图">
        {STAGES.map((stage) => (
          <button
            key={stage.id}
            className="stage-card"
            type="button"
            aria-pressed={stage.id === stageId}
            aria-label={`${stage.name}，${stage.style}`}
            onClick={() => onSelect(stage.id)}
            style={{ "--stage-accent": stage.accent } as CSSProperties}
          >
            <img src={stage.image} alt="" width="240" height="150" loading="lazy" draggable={false} decoding="async" />
            <span className="stage-card-shade" />
            <span className="stage-card-number">{stage.number}</span>
            {stage.id === stageId && (
              <span className="stage-card-check" aria-hidden="true">
                <Icon name="check" size={12} />已选
              </span>
            )}
            <span className="stage-card-copy">
              <strong>{stage.name}</strong>
              <span>{stage.style}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="stage-selector-footnote">
        <span>{current.location}<i>·</i>{current.time}</span>
        <span>随时切换舞台</span>
      </div>
    </section>
  );
}
