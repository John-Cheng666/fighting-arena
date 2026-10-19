import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { BattleRuntime } from "../runtime/BattleRuntime";
import { validateConfig } from "../engine/types";
import { Icon } from "./Icon";
import { validateNumber } from "./settingsValidation";

const FIELDS = [
  { key: "roundTimeSeconds", label: "回合时长", min: 30, max: 300, step: 1, hint: "30 – 300 秒；超时按剩余生命比例判定胜负。" },
  { key: "seed", label: "随机种子", min: 0, max: 2147483647, step: 1, hint: "相同的种子与双方参数，可以重现同一场对局。" },
] as const;
type Key = typeof FIELDS[number]["key"];

export function MatchSettings({ runtime, onApplied }: { runtime: BattleRuntime; onApplied: (message: string) => void }) {
  const configuration = JSON.stringify(Object.fromEntries(FIELDS.map(({ key }) => [key, runtime.battle.config[key]])));
  const [draft, setDraft] = useState<Record<Key, string>>(() => Object.fromEntries(FIELDS.map(({ key }) => [key, String(runtime.battle.config[key])])) as Record<Key, string>);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [formError, setFormError] = useState("");
  const errorSummary = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const config = JSON.parse(configuration) as Record<Key, number>;
    setDraft(Object.fromEntries(FIELDS.map(({ key }) => [key, String(config[key])])) as Record<Key, string>);
    setErrors({}); setFormError("");
  }, [configuration]);
  const dirty = FIELDS.some(({ key }) => draft[key] !== String(runtime.battle.config[key]));
  const started = runtime.getSummary().phase !== "ready";

  function apply(event: FormEvent) {
    event.preventDefault();
    const nextErrors = Object.fromEntries(FIELDS.map(field => [field.key, validateNumber(draft[field.key], field)]));
    setErrors(nextErrors); setFormError("");
    if (Object.values(nextErrors).some(Boolean)) { requestAnimationFrame(() => errorSummary.current?.focus()); return; }
    try {
      const config = validateConfig({ ...runtime.battle.config, roundTimeSeconds: Number(draft.roundTimeSeconds), seed: Number(draft.seed) });
      runtime.restart(config, runtime.getSummary().phase === "running");
      onApplied(`对局规则已应用${started ? "，对局已重置" : ""}`);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "请检查对局参数后重试");
      requestAnimationFrame(() => errorSummary.current?.focus());
    }
  }

  return <form className="settings-form" onSubmit={apply} noValidate aria-label="对局规则设置">
    <div className="settings-intro"><span className="section-kicker">MATCH RULES</span><h3>设定这一局的规则</h3><p>选手的 CPU、生命与资源在「参赛选手」中单独调整。</p></div>
    {(Object.values(errors).some(Boolean) || formError) && <div className="error-summary" ref={errorSummary} role="alert" tabIndex={-1}><strong>请检查以下设置</strong>{FIELDS.filter(field => errors[field.key]).map(field => <a key={field.key} href={`#${id}-${field.key}`} onClick={event => { event.preventDefault(); document.getElementById(`${id}-${field.key}`)?.focus(); }}>{field.label}：{errors[field.key]}</a>)}{formError && <p>{formError}</p>}</div>}
    <div className="settings-grid">{FIELDS.map(field => <div className="field" key={field.key}>
      <div className="field-label-row"><label htmlFor={`${id}-${field.key}`}>{field.label}{field.key === "roundTimeSeconds" && <small> / 秒</small>}</label>{field.key === "seed" && <button type="button" className="random-seed" onClick={() => { setDraft(current => ({ ...current, seed: String(Math.floor(Math.random() * 1000000)) })); setErrors(current => ({ ...current, seed: "" })); }}><Icon name="dice" size={16} />随机生成</button>}</div>
      <input id={`${id}-${field.key}`} type="number" inputMode="numeric" required min={field.min} max={field.max} step={field.step} value={draft[field.key]} onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} onBlur={() => setErrors(current => ({ ...current, [field.key]: validateNumber(draft[field.key], field) }))} aria-invalid={Boolean(errors[field.key])} aria-describedby={`${id}-${field.key}-hint${errors[field.key] ? ` ${id}-${field.key}-error` : ""}`} />
      <small className="field-hint" id={`${id}-${field.key}-hint`}>{field.hint}</small>{errors[field.key] && <small className="field-error" id={`${id}-${field.key}-error`}>{errors[field.key]}</small>}
    </div>)}</div>
    {started && <p className="settings-notice"><Icon name="info" size={17} /><span>应用规则会重开当前对局并清空日志。需要保留的记录可先在下方导出。</span></p>}
    <button className="apply-button" disabled={!dirty}><Icon name="check" size={16} />{started ? "应用并重开对局" : "应用对局规则"}</button>
  </form>;
}
