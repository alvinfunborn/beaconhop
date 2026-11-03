import type { Config } from "./types";

type Props = {
  value: Config;
  onChange: (patch: Partial<Config>) => void;
  t: (en: string, zh: string) => string;
};
const upper = (value: string) => value.replace(/[a-z]/g, c => c.toUpperCase());

export function HintCharacters({ value, onChange, t }: Props) {
  return <section className="hint-characters" id="hint-characters" tabIndex={-1}>
    <h2>{t("Hint characters", "提示字符集")}</h2>
    <p className="muted">{t("Single-character hints first; automatically use two characters when needed. Never more than two.", "优先单字符，不够时自动使用双字符，最多两位。")}</p>
    <label className="charset-row"><span>{t("Characters in priority order", "字符优先顺序")}</span>
      <input className="alphabet" aria-label={t("Hint characters", "提示字符")} value={value.hintAlphabet}
        spellCheck={false} onChange={e => onChange({ hintAlphabet: upper(e.target.value) })} />
      <small className="muted">{t("At least 2 unique characters: letters, digits, punctuation or spaces. Earlier characters are preferred; ␣ on a hint means Space. Letters are case-insensitive. Symbols use English keyboard positions (Shift for !, ?, etc.).", "至少 2 个不重复字符，可用英文字母、数字、标点和空格，靠前的字符优先使用。Hint 中的 ␣ 表示空格键；字母不区分大小写，标点按英文键位输入（!、? 等需按 Shift）。")}</small>
    </label>
  </section>;
}
