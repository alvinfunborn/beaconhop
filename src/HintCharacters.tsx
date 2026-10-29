import type { Config } from "./types";

type Props = {
  value: Config;
  onChange: (patch: Partial<Config>) => void;
  t: (en: string, zh: string) => string;
};
const upper = (value: string) => value.replace(/[a-z]/g, c => c.toUpperCase());

export function HintCharacters({ value, onChange, t }: Props) {
  const custom = value.hintCharsets.length > 0;
  const capacity = value.hintCharsets.reduce((n, row) => n * row.length, 1) * (1 + value.hintExtra.length);
  return <section className="hint-characters">
    <h2>{t("Hint characters", "提示字符集")}</h2>
    <p className="muted">{t("Letters, digits, punctuation and spaces are supported. Each character is a key, including spaces; ␣ on a hint means Space. Letters are case-insensitive. Symbols use the English keyboard positions (Shift for !, ?, etc.).", "支持英文字母、数字、标点和空格。每个字符都是一个按键，空格也算；Hint 中的 ␣ 表示空格键。字母不区分大小写，标点按英文键位输入（!、? 等需按 Shift）。")}</p>
    <label className="charset-mode">{t("Hint length", "Hint 长度")}
      <select aria-label={t("Hint length", "Hint 长度")} value={custom ? "custom" : "auto"}
        onChange={e => onChange({ hintCharsets: e.target.value === "custom" ? ["ASDF", "JKL;"] : [] })}>
        <option value="auto">{t("Automatic · prefer short hints", "自动 · 优先短 Hint")}</option>
        <option value="custom">{t("Custom · characters for each position", "自定义 · 逐位配置字符")}</option>
      </select>
    </label>
    {!custom ? <label className="charset-row"><span>{t("Characters in priority order", "字符优先顺序")}</span>
      <input className="alphabet" aria-label={t("Hint characters", "提示字符")} value={value.hintAlphabet}
        spellCheck={false} onChange={e => onChange({ hintAlphabet: upper(e.target.value) })} />
      <small className="muted">{t("At least 2 unique characters. Longer hints are added as needed; existing window hints stay fixed.", "至少 2 个不重复字符。窗口增多时自动扩展长度，已有窗口的 Hint 保持固定。")}</small>
    </label> : <>
      <p className="muted">{t("Each row supplies one position, in preference order. Add or remove rows to change the hint length.", "每行对应 Hint 的一位，靠前的字符优先使用。添加或删除行即可改变长度。")}</p>
      {value.hintCharsets.map((row, index) => <div className="charset-row" key={index}>
        <label htmlFor={`charset-${index}`}>{t(`Position ${index + 1}`, `第 ${index + 1} 位`)}</label>
        <input id={`charset-${index}`} className="alphabet" value={row} spellCheck={false}
          onChange={e => onChange({ hintCharsets: value.hintCharsets.map((old, i) => i === index ? upper(e.target.value) : old) })} />
        <button className="button secondary" disabled={value.hintCharsets.length === 1}
          aria-label={t(`Remove position ${index + 1}`, `删除第 ${index + 1} 位`)}
          onClick={() => onChange({ hintCharsets: value.hintCharsets.filter((_, i) => i !== index) })}>×</button>
      </div>)}
      <button className="button secondary" disabled={value.hintCharsets.length >= 8}
        onClick={() => onChange({ hintCharsets: [...value.hintCharsets, "ASDF"] })}>{t("Add position", "添加一位")}</button>
      <label className="charset-row"><span>{t("Extra prefixes (optional)", "额外前缀（可选）")}</span>
        <input className="alphabet" aria-label={t("Extra prefixes", "额外前缀")} value={value.hintExtra}
          spellCheck={false} onChange={e => onChange({ hintExtra: upper(e.target.value) })} />
        <small className="muted">{t("Used after shorter combinations run out. Must not overlap the first position.", "用完短组合后才增加前缀，不能与第一位字符重复。")}</small>
      </label>
      <p className="muted" role="status">{t(`${capacity} hint combinations. Windows beyond this capacity remain selectable by search, arrows or click.`, `共 ${capacity} 个 Hint 组合。超出数量的窗口仍可搜索、方向键选择或点击切换。`)}</p>
    </>}
  </section>;
}
