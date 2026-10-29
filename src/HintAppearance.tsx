import type { HintStyle } from "./types";
import { hintVariables } from "./hints";

export function HintAppearance({ value, defaults, onChange, t }: {
  value: HintStyle; defaults: HintStyle; onChange: (style: HintStyle) => void;
  t: (en: string, zh: string) => string;
}) {
  function change<K extends keyof HintStyle>(key: K, next: HintStyle[K]) {
    onChange({ ...value, [key]: next });
  }
  return <section className="hint-appearance">
    <div className="update-actions"><h2>{t("Hint style", "Hint 样式")}</h2>
      <button className="button ghost" onClick={() => onChange({ ...defaults })}>{t("Restore default hint style", "恢复默认 Hint 样式")}</button>
    </div>
    <p className="muted">{t("Preview changes here, then save to apply to every window. Large inventories scale hints down to fit.", "在此即时预览，保存后应用到所有窗口。窗口较多时，提示会适当缩小。")}</p>
    <div className="hint-style-preview" style={hintVariables(value)} aria-label={t("Hint style preview", "Hint 样式预览")}>
      <div className="hint-sample light"><kbd className="hint-badge">A</kbd></div>
      <div className="hint-sample dark"><kbd className="hint-badge">JK</kbd></div>
    </div>
    <div className="hint-controls">
      <label>{t("Font size", "字号")}<input type="range" min={12} max={48} aria-label={t("Font size", "字号")} value={value.fontSize} onChange={e => change("fontSize", Number(e.target.value))} /><output>{value.fontSize}px</output></label>
      <label>{t("Font weight", "字重")}<select value={value.fontWeight} onChange={e => change("fontWeight", Number(e.target.value))}><option value={500}>{t("Medium", "中等")}</option><option value={600}>{t("Semibold", "半粗")}</option><option value={700}>{t("Bold", "粗体")}</option><option value={800}>{t("Extra bold", "特粗")}</option></select></label>
      <label>{t("Text color", "文字颜色")}<input type="color" value={value.color} onChange={e => change("color", e.target.value)} /></label>
      <label>{t("Background color", "背景颜色")}<input type="color" value={value.background} onChange={e => change("background", e.target.value)} /></label>
      <label>{t("Background opacity", "背景不透明度")}<input type="range" min={0} max={100} aria-label={t("Background opacity", "背景不透明度")} value={value.opacity} onChange={e => change("opacity", Number(e.target.value))} /><output>{value.opacity}%</output></label>
      <label>{t("Corner radius", "圆角")}<input type="range" min={0} max={24} aria-label={t("Corner radius", "圆角")} value={value.radius} onChange={e => change("radius", Number(e.target.value))} /><output>{value.radius}px</output></label>
      <label>{t("Border color", "边框颜色")}<input type="color" value={value.borderColor} onChange={e => change("borderColor", e.target.value)} /></label>
      <label>{t("Border width", "边框宽度")}<input type="range" min={0} max={6} aria-label={t("Border width", "边框宽度")} value={value.borderWidth} onChange={e => change("borderWidth", Number(e.target.value))} /><output>{value.borderWidth}px</output></label>
      <label>{t("Hint shadow", "Hint 阴影")}<input type="checkbox" checked={value.shadow} onChange={e => change("shadow", e.target.checked)} /></label>
    </div>
  </section>;
}
