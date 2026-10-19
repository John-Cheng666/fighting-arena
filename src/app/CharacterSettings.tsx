import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { CharacterModule } from "../engine/characters";
import type { CharacterSettings as Settings } from "../engine/types";
import type { BattleRuntime, BattleSummary } from "../runtime/BattleRuntime";
import { Icon } from "./Icon";
import { validateNumber } from "./settingsValidation";

export function CharacterSettings({ runtime, fighter, module, onApplied }: {
  runtime: BattleRuntime; fighter: BattleSummary["fighters"][number];
  module: CharacterModule; onApplied: (message: string) => void;
}) {
  const encode = (settings: Settings) => Object.fromEntries(module.settings.map(field => [field.key, String(settings[field.key] ?? field.default)]));
  const [draft, setDraft] = useState<Record<string, string>>(() => encode(fighter.settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [open, setOpen] = useState(false);
  const id = useId();
  const errorSummary = useRef<HTMLDivElement>(null);
  const configuration = JSON.stringify(fighter.settings);
  useEffect(() => { setDraft(encode(JSON.parse(configuration))); setErrors({}); setFormError(""); }, [configuration, module]);
  const dirty = module.settings.some(field => draft[field.key] !== String(fighter.settings[field.key] ?? field.default));
  const started = runtime.getSummary().phase !== "ready";

  function apply(event: FormEvent): void {
    event.preventDefault();
    const nextErrors = Object.fromEntries(module.settings.filter(field => field.kind === "number").map(field => [field.key, validateNumber(draft[field.key] ?? "", field)]).filter(([, error]) => error));
    setErrors(nextErrors);
    setFormError("");
    if (Object.keys(nextErrors).length) { requestAnimationFrame(() => errorSummary.current?.focus()); return; }
    try {
      const settings = Object.fromEntries(module.settings.map(field => [field.key, typeof field.default === "number" ? Number(draft[field.key]) : draft[field.key]]));
      runtime.configureFighter(fighter.player, settings, runtime.getSummary().phase === "running");
      onApplied(`${fighter.player}P 选手设置已应用${started ? "，对局已重置" : ""}`);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "设置未能应用，请检查数值后重试");
      requestAnimationFrame(() => errorSummary.current?.focus());
    }
  }

  return <details className="character-settings" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span><Icon name="settings" size={16} />调整选手参数{dirty && <i className="unsaved-dot" title="有未应用的修改" />}</span><Icon name="chevron" size={14} /></summary>
    <form onSubmit={apply} aria-label={`${fighter.player}P ${module.metadata.name}角色设置`} noValidate>
      <p className="setting-help">只调整 {fighter.player}P；{started ? "应用后重置对局并清空日志。" : "双方参数互不影响。"}</p>
      {(Object.values(errors).some(Boolean) || formError) && <div className="error-summary" role="alert" tabIndex={-1} ref={errorSummary}>
        <strong>请检查以下设置</strong>
        {module.settings.filter(field => errors[field.key]).map(field => <a key={field.key} href={`#${id}-${field.key}`} onClick={event => { event.preventDefault(); document.getElementById(`${id}-${field.key}`)?.focus(); }}>{field.label}：{errors[field.key]}</a>)}
        {formError && <p>{formError}</p>}
      </div>}
      <div className="character-setting-fields">
        {module.settings.map(field => <label className={`field ${field.kind === "select" ? "field-wide" : ""}`} key={field.key} htmlFor={`${id}-${field.key}`}>
          <span>{field.label}</span>
          {field.kind === "select" && field.options?.length === 1 ? <output className="readonly-field" id={`${id}-${field.key}`}><Icon name="check" size={14} />{field.options[0].label}</output>
            : field.kind === "select" ? <select id={`${id}-${field.key}`} aria-label={`${fighter.player}P ${field.label}`} value={draft[field.key]} onChange={event => setDraft({ ...draft, [field.key]: event.target.value })}>{field.options?.map(option => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select>
            : <input id={`${id}-${field.key}`} aria-label={`${fighter.player}P ${field.label}`} type="number" inputMode={field.step && field.step < 1 ? "decimal" : "numeric"} min={field.min} max={field.max} step={field.step} required value={draft[field.key] ?? ""}
              onChange={event => setDraft({ ...draft, [field.key]: event.target.value })}
              onBlur={() => setErrors(current => ({ ...current, [field.key]: validateNumber(draft[field.key] ?? "", field) }))}
              aria-invalid={Boolean(errors[field.key])} aria-describedby={`${id}-${field.key}-hint${errors[field.key] ? ` ${id}-${field.key}-error` : ""}`} />}
          {field.kind === "number" && <small className="field-hint" id={`${id}-${field.key}-hint`}>{field.min} – {field.max}{field.key === "cpuLevel" ? " · 越高越强" : ""}</small>}
          {errors[field.key] && <small className="field-error" id={`${id}-${field.key}-error`}>{errors[field.key]}</small>}
        </label>)}
      </div>
      <button className="apply-button" type="submit" disabled={!dirty}><Icon name="check" size={16} />{started ? "应用并重开对局" : `应用 ${fighter.player}P 设置`}</button>
      <button className="character-reset" type="button" onClick={() => { setDraft(Object.fromEntries(module.settings.map(field => [field.key, String(field.default)]))); setErrors({}); setFormError(""); }}>填入默认参数</button>
    </form>
  </details>;
}
