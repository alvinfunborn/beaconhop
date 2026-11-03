import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icons";

export type SettingsDestination = { page: string; anchor?: string; title: string; group: string; keywords: string; icon: IconName };
export function SettingsSearch({ destinations, onNavigate, t }: {
  destinations: SettingsDestination[];
  onNavigate: (destination: SettingsDestination) => void;
  t: (en: string, zh: string) => string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/);
  const results = destinations.filter(item => terms.every(term => `${item.title} ${item.group} ${item.keywords}`.toLocaleLowerCase().includes(term)));
  const open = () => { setQuery(""); setActive(0); dialog.current?.showModal(); input.current?.focus(); };
  const close = () => { dialog.current?.close(); trigger.current?.focus(); };
  const choose = (item: SettingsDestination) => { close(); onNavigate(item); };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !event.isComposing && !document.querySelector(".shortcut.recording")) {
        event.preventDefault();
        if (dialog.current?.open) close(); else open();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => { document.getElementById(`settings-result-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, query]);
  return <>
    <button ref={trigger} className="settings-search-trigger" onClick={open} aria-label={t("Search settings", "搜索设置")}>
      <Icon name="search" size={15} /><span>{t("Search settings", "搜索设置")}</span><kbd>{navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl"} K</kbd>
    </button>
    <dialog ref={dialog} className="settings-search-dialog" aria-label={t("Search settings", "搜索设置")}
      onCancel={event => { event.preventDefault(); close(); }}
      onClick={e => { if (e.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } }}>
      <div className="settings-search-input"><Icon name="search" size={20} />
        <input ref={input} role="combobox" aria-label={t("Search settings", "搜索设置")} aria-autocomplete="list" aria-expanded="true" aria-controls="settings-search-results" aria-activedescendant={results[active] ? `settings-result-${active}` : undefined}
          placeholder={t("Search shortcuts, hints, permissions…", "搜索快捷键、提示、权限…")} value={query}
          onChange={e => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive(index => results.length ? (index + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length : 0); }
            if (e.key === "Enter" && results[active]) { e.preventDefault(); choose(results[active]); }
          }} />
        <button className="icon-button" aria-label={t("Close search", "关闭搜索")} onClick={close}><Icon name="close" /></button>
      </div>
      <div className="search-caption">{query ? t(`${results.length} results`, `${results.length} 个结果`) : t("GO TO A SETTING", "快速前往设置")}</div>
      <div id="settings-search-results" role="listbox" aria-label={t("Settings results", "设置搜索结果")} className="settings-search-results">
        {results.map((item, index) => <div role="option" id={`settings-result-${index}`} aria-selected={index === active} className={index === active ? "active" : ""} key={`${item.page}-${item.anchor || "page"}`} onMouseMove={() => setActive(index)} onMouseDown={e => e.preventDefault()} onClick={() => choose(item)}>
          <Icon name={item.icon} /><span>{item.title}<small>{item.group}</small></span><Icon name="arrow" size={16} />
        </div>)}
      </div>
      {!results.length && <div className="settings-search-empty"><Icon name="search" size={28} /><strong>{t("No matching settings", "没有找到相关设置")}</strong><p>{t("Try “shortcut”, “Screen Buoy” or “permissions”.", "试试「快捷键」「Screen Buoy」或「权限」。")}</p></div>}
      <div className="settings-search-help"><span><kbd>↑ ↓</kbd> {t("Navigate", "选择")}</span><span><kbd>↵</kbd> {t("Open", "打开")}</span><span><kbd>Esc</kbd> {t("Close", "关闭")}</span></div>
    </dialog>
  </>;
}
