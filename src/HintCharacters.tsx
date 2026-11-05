import type { Config } from "./types";

type Props = {
  value: Config;
  onChange: (patch: Partial<Config>) => void;
  t: (en: string, zh?: string) => string;
};
const upper = (value: string) => value.replace(/[a-z]/g, c => c.toUpperCase());

export function HintCharacters({ value, onChange, t }: Props) {
  return <section className="hint-characters" id="hint-characters" tabIndex={-1}>
    <h2>{t("Hint characters", "提示字符集")}</h2>

    <label className="charset-row"><span>{t("Characters in priority order")}</span>
      <input className="alphabet" aria-label={t("Hint characters", "提示字符")} value={value.hintAlphabet}
        spellCheck={false} onChange={e => onChange({ hintAlphabet: upper(e.target.value) })} />
      <small className="muted">{t("At least 2 unique characters, in priority order. Hints use 1–2 keys; ␣ = Space. Symbols follow English key positions.")}</small>
    </label>
  </section>;
}
