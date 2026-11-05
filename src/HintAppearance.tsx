import type { HintStyle } from "./types";
import { hintVariables } from "./hints";

export function HintAppearance({ value, defaults, onChange, t }: {
  value: HintStyle; defaults: HintStyle; onChange: (style: HintStyle) => void;
  t: (en: string, zh?: string) => string;
}) {
  function change<K extends keyof HintStyle>(key: K, next: HintStyle[K]) {
    onChange({ ...value, [key]: next });
  }
  return <section className="hint-appearance" id="hint-appearance" tabIndex={-1}>
    <div className="update-actions"><h2>{t("Hint style")}</h2>
      <button className="button ghost" onClick={() => onChange({ ...defaults })}>{t("Restore default hint style")}</button>
    </div>

    <div className="hint-style-preview" style={hintVariables(value)} aria-label={t("Hint style preview")}>
      <div className="hint-sample light"><kbd className="hint-badge">A</kbd></div>
      <div className="hint-sample dark"><kbd className="hint-badge">JK</kbd></div>
    </div>
    <div className="hint-controls">
      <label>{t("Font size")}<input type="range" min={12} max={48} aria-label={t("Font size")} value={value.fontSize} onChange={e => change("fontSize", Number(e.target.value))} /><output>{value.fontSize}px</output></label>
      <label>{t("Font weight")}<select value={value.fontWeight} onChange={e => change("fontWeight", Number(e.target.value))}><option value={500}>{t("Medium")}</option><option value={600}>{t("Semibold")}</option><option value={700}>{t("Bold")}</option><option value={800}>{t("Extra bold")}</option></select></label>
      <label>{t("Text color")}<input type="color" value={value.color} onChange={e => change("color", e.target.value)} /></label>
      <label>{t("Background color")}<input type="color" value={value.background} onChange={e => change("background", e.target.value)} /></label>
      <label>{t("Background opacity")}<input type="range" min={0} max={100} aria-label={t("Background opacity")} value={value.opacity} onChange={e => change("opacity", Number(e.target.value))} /><output>{value.opacity}%</output></label>
      <label>{t("Corner radius")}<input type="range" min={0} max={24} aria-label={t("Corner radius")} value={value.radius} onChange={e => change("radius", Number(e.target.value))} /><output>{value.radius}px</output></label>
      <label>{t("Border color")}<input type="color" value={value.borderColor} onChange={e => change("borderColor", e.target.value)} /></label>
      <label>{t("Border width")}<input type="range" min={0} max={6} aria-label={t("Border width")} value={value.borderWidth} onChange={e => change("borderWidth", Number(e.target.value))} /><output>{value.borderWidth}px</output></label>
      <label>{t("Hint shadow")}<input type="checkbox" checked={value.shadow} onChange={e => change("shadow", e.target.checked)} /></label>
    </div>
  </section>;
}
