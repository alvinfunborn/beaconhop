import { useState } from "react";
import { keyLabel, physicalKeys } from "./hintKeys";

export function ContinuationKeys({ value, onChange, label, t }: {
  value: string[];
  onChange: (keys: string[]) => void;
  label: string;
  t: (en: string, zh?: string) => string;
}) {
  const [extra, setExtra] = useState("Enter");
  const choices = ["Super", "Alt", "Control", "Shift", "HintLeftKey", "HintRightKey", ...physicalKeys];
  return <div className="continuation-keys" role="group" aria-label={label}>
    <div className="continuation-selected">
      {value.map(key => <button key={key} className="button ghost"
        aria-label={t(`Remove ${key}`, `移除 ${key}`)}
        onClick={() => onChange(value.filter(k => k !== key))}>{keyLabel(key)} ×</button>)}
      {!value.length && <span className="muted small">{t("No continuation key")}</span>}
    </div>
    <div className="continuation-add">
      <select aria-label={t("Additional continuation key")}
        value={extra} onChange={e => setExtra(e.target.value)}>
        {choices.map(key => <option key={key} value={key}>{keyLabel(key)}</option>)}
      </select>
      <button className="button secondary" disabled={value.includes(extra)}
        onClick={() => onChange([...value, extra])}>{t("Add key")}</button>
    </div>
  </div>;
}
