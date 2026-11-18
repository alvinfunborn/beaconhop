import { translate } from "./copy";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Config, Session, Permissions, Destination, DesktopPreview } from "./types";
import { call, subscribe, defaults, native, preview, panelLabel, shareSearchDraft } from "./api";
import { tileWindows, textRows, type Tile, type DesktopAnchor } from "./layout";
import { createOverviewCache } from "./overviewCache";
import { presentation } from "./presentation";
import { usePreviews } from "./previews";
import { timing, afterFrame } from "./performance";
import { DesktopOverview } from "./DesktopOverview";
import { WindowSpatialOverview, intersects } from "./WindowSpatialOverview";
import { Updates } from "./Updates";
import { HintCharacters } from "./HintCharacters";
import { ScreenBuoyIntegration } from "./ScreenBuoyIntegration";
import { PluginStatus } from "./PluginStatus";
import { ContinuationKeys } from "./ContinuationKeys";
import { HintAppearance } from "./HintAppearance";
import { hintVariables } from "./hints";
import { Icon, type IconName } from "./Icons";
import { SettingsSearch, type SettingsDestination } from "./SettingsSearch";
const isMac = navigator.platform.toLowerCase().includes("mac");
const windowsNative =
  native && navigator.platform.toLowerCase().includes("win");
function shortcut(s: string) {
  return s
    .replace("Super", isMac ? "⌘" : "Win")
    .replace("Alt", isMac ? "⌥" : "Alt")
    .replace("Backquote", "`")
    .replace("Backslash", "\\")
    .replace("Control", isMac ? "⌃" : "Ctrl")
    .replaceAll("+", " + ");
}
function reverseShortcut(value: string) {
  const parts = value.split("+");
  parts.splice(parts.length - 1, 0, "Shift");
  return parts.join("+");
}
function parseShortcutText(text: string, singleKey = false): string | null {
  const parts = text.trim().replace(/[⌘⌥⌃⇧]\s*\+?\s*/g, (s) => ({ "⌘": "Super+", "⌥": "Alt+", "⌃": "Ctrl+", "⇧": "Shift+" })[s[0]]!).split("+").map((s) => s.trim());
  const modifiers = new Set<string>();
  let key = "";
  for (const part of parts) {
    const token = part.toLowerCase();
    const modifier = ({ alt: "Alt", option: "Alt", ctrl: "Ctrl", control: "Ctrl", super: "Super", cmd: "Super", command: "Super", win: "Super", meta: "Super", shift: "Shift" } as Record<string, string>)[token];
    if (modifier) {
      if (modifiers.has(modifier)) return null;
      modifiers.add(modifier);
    } else {
      if (key) return null;
      key = ({ tab: "Tab", space: "Space", backquote: "Backquote", "`": "Backquote", backslash: "Backslash", "\\": "Backslash" } as Record<string, string>)[token] || (/^[a-z0-9]$/i.test(part) ? part.toUpperCase() : "");
      if (!key) return null;
    }
  }
  if (singleKey) return key && key !== "Tab" && modifiers.size === 0 ? key : null;
  if (!key || !["Ctrl", "Alt", "Super"].some((m) => modifiers.has(m))) return null;
  return [...["Ctrl", "Alt", "Super", "Shift"].filter((m) => modifiers.has(m)), key].join("+");
}
function useSettings() {
  const [config, setConfig] = useState<Config>(defaults);
  useEffect(() => {
    let disposed = false;
    let off = () => {};
    subscribe<Config>("settings", (c) => setConfig(c)).then((f) =>
      disposed ? f() : (off = f),
    );
    call<Config>("get_settings")
      .then((c) => {
        if (!disposed) setConfig(c);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      off();
    };
  }, []);
  return [config, setConfig] as const;
}
export default function App() {
  const [config] = useSettings();
  const zh =
    config.language === "zh" ||
    (config.language === "system" && navigator.language.startsWith("zh"));
  useEffect(() => {
    document.documentElement.dataset.theme = config.theme;
    document.documentElement.lang = zh ? "zh-CN" : "en";
  }, [config.theme, zh]);
  if (!native && !preview)
    return (
      <div className="standalone">
        <img src="/beaconhop.svg" alt="" />
        <h1>BeaconHop</h1>
        <p>Open the desktop app to navigate your windows.</p>
      </div>
    );
  return new URLSearchParams(location.search).get("view") === "switcher" ? (
    <Switcher config={config} zh={zh} />
  ) : (
    <Settings initial={config} zh={zh} />
  );
}
function Settings({ initial, zh }: { initial: Config; zh: boolean }) {
  const t = (en: string, cn?: string) => translate(zh, en, cn);
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState("general");
  const [permissions, setPermissions] = useState<Permissions>();
  const [pendingPermission, setPendingPermission] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState("");
  const checkedStartupPermissions = useRef(false);
  const scrollArea = useRef<HTMLDivElement>(null);
  const [destination, setDestination] = useState<SettingsDestination>();
  useEffect(() => {
    scrollArea.current?.scrollTo({ top: 0 });
    if (destination?.page === tab && destination.anchor) {
      const target = document.getElementById(destination.anchor);
      target?.scrollIntoView({ block: "start" });
      target?.focus({ preventScroll: true });
    }
  }, [tab, destination]);
  useEffect(() => setDraft(initial), [initial]);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      call<Permissions>("get_permissions")
        .then((status) => { if (alive) setPermissions(status); })
        .catch(() => {});
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 2500);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => {
    if (!permissions || checkedStartupPermissions.current) return;
    if (!permissions.required || permissions.ready) {
      checkedStartupPermissions.current = true;
      return;
    }
    const show = () => { checkedStartupPermissions.current = true; setTab("system"); };
    if (!permissions.accessibility) { show(); return; }
    const timer = setTimeout(show, 2000);
    return () => clearTimeout(timer);
  }, [permissions?.required, permissions?.ready, permissions?.accessibility]);
  useEffect(() => {
    let disposed = false;
    const off = subscribe("show-permissions", () => { if (!disposed) setTab("system"); });
    return () => { disposed = true; void off.then((f) => f()); };
  }, []);
  useEffect(() => {
    const off = subscribe<string>("screen-buoy-error", (message) => { setTab("screen-buoy"); setError(message); });
    return () => { void off.then(f => f()); };
  }, []);
  const needsAccess = permissions?.required && !permissions.ready;
  const needsPreviews = permissions?.required && draft.thumbnails && !permissions.screenRecording;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  function change<K extends keyof Config>(key: K, value: Config[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setNotice("");
    setError("");
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      await call("save_settings", { config: draft });
      setNotice(t("Settings saved"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function requestPermission(kind: string) {
    setPendingPermission(kind);
    setError("");
    setNotice("");
    try {
      await call("request_permission", { kind });
      setNotice(t("System Settings opened. Enable BeaconHop, then return here."));
      setPermissions(await call<Permissions>("get_permissions"));
    } catch (error) {
      setError(String(error));
    } finally {
      setPendingPermission(null);
    }
  }
  function permissionSetting(
    key: "accessibility" | "inputMonitoring" | "screenRecording",
    kind: string,
    title: string,
    description: string,
  ) {
    return (
      <Setting key={key} title={title} description={description}>
        {permissions?.[key] ? (
          <span className="badge good">{t("Granted")}</span>
        ) : (
          <button
            className="button secondary"
            aria-label={t(`Open ${title} settings`, `打开${title}设置`)}
            disabled={pendingPermission !== null}
            onClick={() => requestPermission(kind)}
          >
            {pendingPermission === kind
              ? t("Opening…")
              : t("Open settings")}
          </button>
        )}
      </Setting>
    );
  }
  function toggle(
    key:
      | "holdEnabled"
      | "includeMinimized"
      | "includeHidden"
      | "thumbnails"
      | "startAtLogin"
      | "startInTray",
    title: string,
    description: string,
  ) {
    return (
      <Setting title={title} description={description}>
        <button
          className={"toggle " + (draft[key] ? "on" : "")}
          role="switch"
          aria-checked={draft[key]}
          aria-label={title}
          onClick={() => change(key, !draft[key])}
        >
          <span />
        </button>
      </Setting>
    );
  }
  function select(
    key: "desktopScope" | "displayScope" | "layout" | "theme" | "language",
    title: string,
    description: string,
    choices: [string, string][],
  ) {
    return (
      <Setting title={title} description={description}>
        <select
          aria-label={title}
          value={draft[key]}
          onChange={(e) => change(key, e.target.value as never)}
        >
          {choices.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Setting>
    );
  }
  const tabs: [string, IconName, string, string][] = [
    ["general", "keyboard", t("Shortcuts"), t("Go from a keystroke to the window you need.")],
    ["scope", "windows", t("Window scope"), t("Choose what appears across desktops and displays.")],
    ["navigation", "layers", t("Navigation layers"), t("Move between windows, apps, tabs and desktops with one familiar gesture.")],
    ["appearance", "appearance", t("Appearance"), t("A clear view of your workspace, in your own style.")],
    ["plugins", "tabs", t("Application plugins"), t("Install extensions and connect your applications.")],
    ["screen-buoy", "cursor", "Screen Buoy", t("Reach a desktop or window with BeaconHop. Take action inside it with Screen Buoy.")],
    ["system", "settings", t("System & access"), t("Manage startup, permissions and app health in one place.")],
    ["about", "info", t("About"), t("Thoughtful tools for a keyboard-first desktop.")],
  ];
  const current = tabs.find(x => x[0] === tab)!;
  const destinations: SettingsDestination[] = [
    ...tabs.map(([page, icon, title, keywords]) => ({ page, icon, title, keywords: `${page} ${keywords}`, group: t("Settings") })),
    ...([
      ["general", "shortcut-settings", t("Hold & search shortcuts"), "keyboard", "hotkey activation 快捷键 热键 搜索"],
      ["general", "hint-characters", t("Hint characters", "提示字符集"), "keyboard", "alphabet letters symbols 字母 标点 hint"],
      ["navigation", "continuation-settings", t("Continuation gestures"), "layers", "hold hint keys 继续 按住 邻键"],
      ["plugins", "plugin-settings", t("Application plugins"), "tabs", "browser chrome edge vscode codex 浏览器 扩展"],
      ["scope", "excluded-apps", t("Excluded applications"), "windows", "ignore filter 过滤 排除"],
      ["appearance", "switcher-settings", t("Theme, language & layout"), "appearance", "light dark Chinese English 深色 浅色 中英文"],
      ["appearance", "opacity-settings", t("Switcher background opacity"), "appearance", "transparency blur glass 透明 毛玻璃"],
      ["appearance", "hint-appearance", t("Hint style"), "appearance", "font color border radius shadow 字号 颜色 边框 阴影"],
      ["system", "permissions-settings", t("Permissions & health"), "shield", "accessibility keyboard screen recording 辅助功能 键盘 录屏"],
      ["system", "updates-settings", t("App updates"), "info", "version download release 版本 下载 升级"],
    ] as [string, string, string, IconName, string][]).map(([page, anchor, title, icon, keywords]) => ({page, anchor, title, icon, keywords, group: tabs.find(x => x[0] === page)![2]})),
  ];
  return (
    <div className="settings-shell">
      <aside>
        <div className="brand">
          <img src="/beaconhop.svg" alt="" />
          <span>BeaconHop<small>{t("Desktop navigation")}</small></span>
        </div>
        <nav aria-label={t("Settings navigation")}>
          {tabs.map(([id, icon, label], index) => (
            <div className="nav-entry" key={id}>
              {(index === 0 || id === "plugins" || id === "system") && <div className="nav-caption">{index === 0 ? t("WORKSPACE") : id === "plugins" ? t("CONNECTED TOOLS") : t("APPLICATION")}</div>}
              <button aria-label={label} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => { setDestination(undefined); setTab(id); }}>
                <Icon name={icon} /><span className="nav-label">{label}</span>
                {id === "system" && (needsAccess || needsPreviews) && <span className="permission-nav-dot" aria-label={t("Access needed")} />}
                {tab === id && <span className="nav-active-dot" />}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="runtime-status"><span className={"status-dot " + (permissions?.ready ? "ready" : "")} />
            {!permissions ? t("Checking access…") : permissions.ready ? t("Ready to hop") : t("Access needed")}
          </div>
          <div className="sidebar-version"><span>BeaconHop</span><span>v{__APP_VERSION__}{preview ? " · Preview" : ""}</span></div>
        </div>
      </aside>
      <main className="settings-main">
        <header className="settings-toolbar">
          <div className="settings-breadcrumb"><span>{t("Settings")}</span><Icon name="chevron" size={12} /><strong>{current[2]}</strong></div>
          <SettingsSearch destinations={destinations} t={t} onNavigate={item => { setTab(item.page); setDestination(item); }} />
        </header>
        <div className="settings-scroll" ref={scrollArea}>
          <header className="page-header">
            <div><h1>{current[2]}</h1></div>
            {tab === "general" ? <button className="button secondary try-hop" onClick={() => call("open_search").catch(e => setError(String(e)))}><Icon name="hop" size={15} />{t("Try a hop")}</button> : <span className="page-icon"><Icon name={current[1]} size={24} /></span>}
          </header>
          {tab !== "system" && (needsAccess || needsPreviews) && <div className="permission-banner" role="alert">
            <div><strong>{needsAccess ? t("Allow access to start switching windows") : t("Allow Screen Recording to see window previews")}</strong>
              <p>{needsAccess ? t("Global shortcuts are unavailable. You can still edit and save settings.") : t("Window switching is ready; previews still need access.")}</p></div>
            <button className="button secondary" onClick={() => setTab("system")}>{t("Set up access")}</button>
          </div>}
          {tab === "plugins" && <PluginStatus t={t} />}
          {tab === "general" && (
            <>


              <section id="shortcut-settings" tabIndex={-1}>
                <h2>{t("Two ways to get there")}</h2>
                {toggle(
                  "holdEnabled",
                  t("Hold to switch"),
                  t("Type a hint while holding."),
                )}
                <Setting
                  title={t("Hold shortcut")}
                  description={t("Release to switch. Shift reverses; Esc cancels.")}
                >
                  <Shortcut
                    value={draft.holdShortcut}
                    onChange={(v) => change("holdShortcut", v)}
                    label={t("Hold shortcut")}
                    zh={zh}
                    defaultValue={defaults.holdShortcut}
                  />
                </Setting>
                <Setting
                  title={t("Search shortcut")}
                  description={t("Search by title or app.")}
                >
                  <Shortcut
                    value={draft.searchShortcut}
                    onChange={(v) => change("searchShortcut", v)}
                    label={t("Search shortcut")}
                    zh={zh}
                    defaultValue={defaults.searchShortcut}
                  />
                </Setting>
                <Setting
                  title={t("Search key while holding")}
                  description={t("Use a key outside the hint alphabet.")}
                >
                  <Shortcut
                    value={draft.searchEntryKey}
                    onChange={(v) => change("searchEntryKey", v)}
                    label={t("Search key while holding")}
                    zh={zh}
                    defaultValue={defaults.searchEntryKey}
                    singleKey
                  />
                </Setting>
              </section>
              <HintCharacters value={draft} onChange={patch => { setDraft(old => ({...old, ...patch})); setNotice(""); setError(""); }} t={t} />
            </>
          )}
          {tab === "navigation" && <>
            <div className="layer-overview" aria-label={t("Four navigation layers")}>
              {([
                ["windows", t("All windows"), draft.holdShortcut],
                ["windows", t("App windows"), draft.applicationHoldShortcut],
                ["tabs", t("Tabs & sessions"), draft.tabsHoldShortcut],
                ["desktop", t("Desktops"), draft.desktopsHoldShortcut],
              ] as [IconName, string, string][]).map(([icon, title, keys], index) => <div className="layer-tile" key={title}><span className="layer-number">0{index + 1}</span><Icon name={icon} size={21} /><strong>{title}</strong><kbd>{shortcut(keys)}</kbd></div>)}
            </div>
            <section>
              <h2>{t("One gesture, four layers")}</h2>

              {([
                ["applicationEnabled", "applicationHoldShortcut", "applicationSearchShortcut", t("Application windows")],
                ["tabsEnabled", "tabsHoldShortcut", "tabsSearchShortcut", t("Tabs & sessions")],
                ["desktopsEnabled", "desktopsHoldShortcut", "desktopsSearchShortcut", t("Desktops")],
              ] as const).map(([enabled, hold, search, label]) => <div className="layer-settings" key={enabled}>
                <Setting title={label} description={enabled === "tabsEnabled" ? t("Applications without a connected plugin keep their native shortcuts.") : ""}>
                  <input type="checkbox" aria-label={label} checked={draft[enabled]} onChange={e=>change(enabled,e.target.checked)} />
                </Setting>
                <Setting title={t(`${label} · hold`, `${label} · 按住切换`)}>
                  <Shortcut value={draft[hold]} onChange={v=>change(hold,v)} label={t(`${label} hold shortcut`, `${label}按住快捷键`)} zh={zh} defaultValue={defaults[hold]} />
                </Setting>
                <Setting title={t(`${label} · search`, `${label} · 搜索`)}>
                  <Shortcut value={draft[search]} onChange={v=>change(search,v)} label={t(`${label} search shortcut`, `${label}搜索快捷键`)} zh={zh} defaultValue={defaults[search]} />
                </Setting>
              </div>)}
            </section>
            <section id="continuation-settings" tabIndex={-1}>
              <h2>{t("Keep holding the last hint key")}</h2>
              <p>{t("Hold the last hint key, then press a key below.")}</p>
              {([
                ["windowsHintKeys", t("Continue to windows")],
                ["applicationHintKeys", t("Continue to application windows")],
                ["tabsHintKeys", t("Continue to tabs")],
              ] as const).map(([key,label]) => <Setting key={key} title={label}>
                <ContinuationKeys label={label} value={draft[key]} onChange={keys=>change(key,keys)} t={t} />
              </Setting>)}
              <p className="muted small">{t("Super = Win / Command. The Screen Buoy page controls its trigger and the physical neighbour map.")}</p>
            </section>
            <button className="button" onClick={()=>setTab("plugins")}>{t("Set up application plugins")}</button>
            <section><Setting title={t("Codex data folder")} description={t("Empty uses the default folder. Session links do not support continuation.") }>
              <input aria-label={t("Codex data folder")} value={draft.codexHome} onChange={e=>change("codexHome",e.target.value)} />
            </Setting></section>
          </>}
          {tab === "screen-buoy" && <ScreenBuoyIntegration value={draft.screenBuoy} alphabet={draft.hintAlphabet} onChange={v => change("screenBuoy", v)} t={t} />}
          {tab === "scope" && (
            <>
              <section>
                <h2>{t("Where to look")}</h2>
                {select(
                  "desktopScope",
                  t("Virtual desktops"),
                  t("A hop follows the window to its desktop; it does not move the window."),
                  [
                    ["all", t("All desktops")],
                    ["current", t("Current desktop")],
                  ],
                )}
                {select(
                  "displayScope",
                  t("Displays"),
                  t("Current display follows the window you are working in."),
                  [
                    ["all", t("All displays")],
                    ["current", t("Current display")],
                  ],
                )}
                {toggle(
                  "includeMinimized",
                  t("Minimized windows"),
                  t(""),
                )}
                {toggle(
                  "includeHidden",
                  t("Hidden applications"),
                  t(""),
                )}
              </section>
              <section id="excluded-apps" tabIndex={-1}>
                <h2>{t("Keep these out")}</h2>
                <p className="muted">
                  {t("One app name, bundle ID or executable path per line.")}
                </p>
                <textarea
                  aria-label={t("Excluded applications")}
                  placeholder={
                    isMac
                      ? "com.example.app\nExample App"
                      : "notepad\nC:\\Apps\\example.exe"
                  }
                  value={draft.excludedApps.join("\n")}
                  onChange={(e) =>
                    change("excludedApps", e.target.value.split("\n"))
                  }
                  rows={5}
                />
              </section>
            </>
          )}
          {tab === "appearance" && (
            <>
              <section id="switcher-settings" tabIndex={-1}>
                <h2>{t("Switcher")}</h2>
                {toggle(
                  "thumbnails",
                  t("Window previews"),
                  t("Previews load in the background. Protected windows may show an app placeholder."),
                )}
                {select(
                  "layout",
                  t("Layout"),
                  t("Used for application windows; all-window overview stays spatial."),
                  [
                    ["grid", t("Grid")],
                    ["list", t("List")],
                  ],
                )}
                {select("theme", t("Theme"), "", [
                  ["system", t("Follow system")],
                  ["dark", t("Dark")],
                  ["light", t("Light")],
                ])}
                {select("language", t("Language"), "", [
                  ["system", t("Follow system")],
                  ["en", "English"],
                  ["zh", "简体中文"],
                ])}
              </section>
              <section id="opacity-settings" tabIndex={-1}>
                <Setting title={t("Switcher background opacity")} description={t("Lower values reveal more of the desktop.") }>
                  <input aria-label={t("Switcher background opacity")} type="range" min={0} max={100} value={draft.panelOpacity} onChange={e => change("panelOpacity",Number(e.target.value))} /><output>{draft.panelOpacity}%</output>
                </Setting>
              </section>
              <HintAppearance value={draft.hintStyle} defaults={defaults.hintStyle} onChange={value => change("hintStyle",value)} t={t} />

            </>
          )}
          {tab === "system" && (
            <>
              {permissions?.required && (needsAccess || needsPreviews) && <section className="permission-setup" role="region" aria-label={t("Finish setting up BeaconHop")}>

                <h2>{!permissions.accessibility ? t("Enable Accessibility to start hopping") : !permissions.keyboardHook ? t("Accessibility is allowed. Connect the keyboard listener.") : t("One more step for window previews")}</h2>
                <p>{!permissions.accessibility ? t("Open System Settings, enable BeaconHop under Privacy & Security → Accessibility, then return here. The status refreshes automatically.") : !permissions.keyboardHook ? t("Wait briefly for the listener. If it stays disconnected, restart BeaconHop.") : t("Screen Recording is used for thumbnails. You can switch windows without granting it.")}</p>

                <div className="permission-actions">
                  {!permissions.accessibility ? <button className="button primary" disabled={pendingPermission !== null} onClick={() => requestPermission("accessibility")}>{t("Open Accessibility settings")}</button>
                    : !permissions.keyboardHook ? <button className="button primary" onClick={() => call("restart_application").catch((e) => setError(String(e)))}>{t("Restart BeaconHop")}</button>
                    : <button className="button primary" disabled={pendingPermission !== null} onClick={() => requestPermission("screen")}>{t("Enable window previews")}</button>}
                  <button className="button secondary" onClick={() => call<Permissions>("get_permissions").then(setPermissions).catch((e) => setError(String(e)))}>{t("Check again")}</button>
                </div>
                <details className="permission-troubleshooting"><summary>{t("Already enabled, but still not working?")}</summary><p>{t("After an app update, remove the old BeaconHop entry from Accessibility, add this installed app again and restart.")}</p><p className="app-path">{permissions.appPath}</p><button className="button secondary" onClick={() => call("restart_application").catch((e) => setError(String(e)))}>{t("Restart BeaconHop")}</button></details>
              </section>}
              <section>
                <h2>{t("Make it part of your day")}</h2>
                {toggle(
                  "startAtLogin",
                  t("Launch at login"),
                  t(""),
                )}
                {toggle(
                  "startInTray",
                  t("Start quietly"),
                  t("Keep settings closed and run from the menu bar or system tray."),
                )}
              </section>
              <section id="permissions-settings" tabIndex={-1}>
                <h2>{t("Permissions & health")}</h2>
                {permissions?.required ? (
                  <>
                    {[
                      [
                        "accessibility",
                        "accessibility",
                        t("Accessibility"),
                        t("Find and focus individual windows."),
                      ],
                      [
                        "screenRecording",
                        "screen",
                        t("Screen recording"),
                        t("Capture window previews. Switching works without previews."),
                      ],
                    ].map(([key, kind, title, description]) =>
                      permissionSetting(
                        key as "accessibility" | "screenRecording",
                        kind, title, description,
                      ),
                    )}
                    <p className="small muted">
                      {t("After changing macOS permissions, a restart may be required.")}
                    </p>
                  </>
                ) : (
                  <p className="muted">
                    {t("No additional permissions are normally required on Windows.")}
                  </p>
                )}
                <Setting
                  title={t("Keyboard listener")}
                  description={t("The native listener must be running for global shortcuts.")}
                >
                  <span
                    className={
                      "badge " +
                      (permissions?.keyboardHook ? "good" : "pending")
                    }
                  >
                    {permissions?.keyboardHook
                      ? t("Running")
                      : t("Not ready")}
                  </span>
                </Setting>
                {permissions?.required && !permissions.keyboardHook && (
                  <details className="permission-troubleshooting">
                    <summary>{t("Keyboard troubleshooting")}</summary>
                    <p className="small muted">
                      {t("Accessibility normally enables shortcuts. If it is already granted and the listener is still unavailable, check Input Monitoring and restart BeaconHop.")}
                    </p>
                    {permissionSetting(
                      "inputMonitoring", "input",
                      t("Input monitoring"),
                      t("Optional keyboard-listener recovery."),
                    )}
                  </details>
                )}
              </section>
              <section>
                <h2>{t("Diagnostics")}</h2>
                <button
                  className="button secondary"
                  onClick={() =>
                    call("get_diagnostics")
                      .then((v) => setDiagnostics(JSON.stringify(v, null, 2)))
                      .catch((e) => setError(String(e)))
                  }
                >
                  {t("Show diagnostics")}
                </button>
                {diagnostics && (
                  <pre className="diagnostics">{diagnostics}</pre>
                )}
              </section>
            </>
          )}
          <section id="updates-settings" tabIndex={-1} hidden={tab !== "system"}><Updates t={t} dirty={dirty} onBusy={setUpdateBusy} /></section>
          {tab === "about" && (
            <div className="about">
              <img src="/beaconhop.svg" alt="" />
              <h1>BeaconHop</h1>
              <p className="tagline">Follow the hint. Make the hop.</p>

              <span className="badge">{__APP_VERSION__} · macOS & Windows</span>
              <button className="about-companion" onClick={() => setTab("screen-buoy")}><img src="/screen-buoy.png" alt="" /><span><strong>Screen Buoy</strong><small>{t("Continue inside desktops and windows")}</small></span><Icon name="arrow" /></button>
              <div className="about-details">
                <p>
                  {t("Built on Screen Buoy. Licensed under MIT.")}
                </p>
                <p>
                  {t("Window discovery, search and previews stay on your computer.")}
                </p>
              </div>
            </div>
          )}
        </div>
        <footer className={"settings-footer " + (dirty ? "has-changes" : "")}>
          <span
            role={error ? "alert" : "status"}
            className={"save-status " + (error ? "error" : dirty ? "pending" : "muted")}
          ><Icon name={error ? "info" : dirty ? "info" : "check"} size={15} />
            {error ||
              notice ||
              (dirty
                ? t("Unsaved changes")
                : t("All changes saved"))}
          </span>
          <div>
            <button className="button ghost" disabled={dirty || busy || updateBusy}
              title={dirty ? t("Save or discard your changes before restarting") : undefined}
              onClick={async () => {
                try { setNotice(t("Restarting…")); await call("restart_application"); }
                catch (e) { setError(String(e)); }
              }}>{t("Restart BeaconHop")}</button>
            <button
              className="button ghost"
              disabled={!dirty || busy || updateBusy}
              onClick={() => {
                setDraft(initial);
                setError("");
                setNotice("");
              }}
            >
              {t("Discard")}
            </button>
            <button
              className="button primary"
              disabled={!dirty || busy || updateBusy}
              onClick={save}
            >
              {busy ? t("Saving…") : t("Save changes")}
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}
function Setting({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting">
      <div>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
function Shortcut({ value, onChange, label, zh, defaultValue, singleKey = false }: {
  value: string; onChange: (v: string) => void; label: string; zh: boolean; defaultValue: string; singleKey?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [manual, setManual] = useState(false);
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState("");
  const finish = useRef((next: string) => {});
  finish.current = (next) => {
    if (next) {
      setFeedback(next === value ? (translate(zh, "Shortcut unchanged")) : (translate(zh, "Recorded. Save to apply.")));
      onChange(next);
    } else setFeedback(translate(zh, "Recording cancelled"));
    setRecording(false);
    setManual(false);
  };
  const applyText = () => {
    const next = parseShortcutText(text, singleKey);
    if (next) finish.current(next);
    else setFeedback(singleKey
      ? (translate(zh, "Use one key without modifiers, such as `, \\ or Space."))
      : (translate(zh, "Use a modifier and key, such as Win + ` or Win + \\")));
  };
  useEffect(() => {
    if (!recording) return;
    let disposed = false;
    let off = () => {};
    (async () => {
      off = await subscribe<string>("shortcut-recorded", (next) => finish.current(next));
      if (disposed) { off(); return; }
      const ready = await call<boolean>("record_shortcut", { enabled: true, singleKey });
      if (disposed) { await call("record_shortcut", { enabled: false }); return; }
      if (native && !ready) setFeedback(translate(zh, "Accessibility is not ready. Use manual entry if another app or macOS intercepts the keys."));
    })().catch((e) => { if (!disposed) { setFeedback(String(e)); setRecording(false); } });
    return () => {
      disposed = true;
      off();
      call("record_shortcut", { enabled: false }).catch(() => {});
    };
  }, [recording, singleKey]);
  return <div className="shortcut-editor">
    <button
      className={"shortcut " + (recording ? "recording" : "")}
      aria-label={label}
      aria-pressed={recording}
      onClick={event => { event.currentTarget.focus(); setManual(false); setFeedback(""); setRecording(true); }}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        if (e.key === "Escape") { finish.current(""); return; }
        if (["Control", "Alt", "Meta", "Shift"].includes(e.key)) return;
        const modifiers = [e.ctrlKey ? "Ctrl" : "", e.altKey ? "Alt" : "", e.metaKey ? "Super" : "", e.shiftKey ? "Shift" : ""].filter(Boolean);
        const key = e.code === "Backquote" || (e.code === "IntlBackslash" && ["`", "~"].includes(e.key)) ? "Backquote"
          : e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : e.code;
        const next = parseShortcutText([...modifiers, key].join("+"), singleKey);
        if (next) finish.current(next);
        else setFeedback(singleKey
          ? (translate(zh, "Press the target key on its own, without modifiers."))
          : (translate(zh, "Hold Alt, Ctrl or Win / Command with the target key.")));
      }}
    >{recording ? (translate(zh, "Press shortcut…")) : shortcut(value)}</button>
    <button className="shortcut-reset" aria-label={zh ? `手动输入${label}` : `Enter ${label} manually`} onClick={() => { setRecording(false); setManual(true); setText(value); setFeedback(""); }}>{translate(zh, "Enter manually")}</button>
    <button className="shortcut-reset" aria-label={zh ? `恢复${label}默认值` : `Restore default ${label}`} onClick={() => finish.current(defaultValue)}>{translate(zh, "Restore default")}</button>
    {manual && <div className="shortcut-manual">
      <input autoFocus value={text} aria-label={zh ? `${label}文本` : `${label} text`} spellCheck={false} placeholder={singleKey ? "`" : "Win + `"} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); applyText(); }
        if (e.key === "Escape") { e.preventDefault(); finish.current(""); }
      }} />
      <button className="shortcut-reset" onClick={applyText}>{translate(zh, "Apply")}</button>
      <button className="shortcut-reset" onClick={() => finish.current("")}>{translate(zh, "Cancel")}</button>
    </div>}
    <span className="shortcut-feedback" role="status">{feedback}</span>
  </div>;
}

type PanelPresentation = { label: string; generation: number; width: number; height: number; session: Session };

function Switcher({ config, zh }: { config: Config; zh: boolean }) {
  const t = (en: string, cn?: string) => translate(zh, en, cn);
  const [session, setSession] = useState<Session>();
  const [frame, setFrame] = useState<PanelPresentation>();
  const overviewCache = useRef(createOverviewCache());
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [inspected, setInspected] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const draftQuery = useRef<string | null>(null);
  const [stack, setStack] = useState<{sessionId?:number; mode?:string; value:boolean}>({value:false});
  const stacked = stack.sessionId === session?.sessionId && stack.mode === session?.mode && stack.value;
  const list = useRef<HTMLDivElement>(null);
  const measuredSession = useRef<number>();
  useEffect(() => {
    let disposed = false;
    const off: Array<() => void> = [];
    const accept = (s: Session) => {
      if (s.mode !== "inactive" && measuredSession.current !== s.sessionId) {
        measuredSession.current = s.sessionId;
        timing("session_received", s.sessionId, 0, s.windows.length);
      }
      setSession((old) =>
        !old ||
        s.sessionId > old.sessionId ||
        (s.sessionId === old.sessionId && s.revision >= old.revision)
          ? s
          : old,
      );
    };
    const keep = (f: () => void) => disposed ? f() : off.push(f);
    subscribe<Session>("session", accept).then(keep);
    if (native) {
      const prepare = (next: PanelPresentation | null) => {
        if (!next || disposed || next.label !== panelLabel) return;
        accept(next.session);
        setFrame(old => !old || next.generation >= old.generation ? next : old);
      };
      // Fetch after subscribing: a freshly-created WebView may have missed the event.
      subscribe<PanelPresentation>("panel-presentation", prepare).then(f => {
        keep(f);
        if (!disposed) call<PanelPresentation | null>("get_panel_presentation").then(prepare).catch(e => setError(String(e)));
      });
    }
    call<Session>("get_session")
      .then((s) => {
        if (!disposed) accept(s);
      })
      .catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      off.forEach(f => f());
    };
  }, []);
  useEffect(() => {
    draftQuery.current = null;
    setQuery(session?.query ?? "");
    setError("");
  }, [session?.sessionId, session?.mode]);
  useEffect(() => {
    if (session?.mode !== "search" || session.loading) return;
    let disposed = false;
    let frame = 0;
    const off: Array<() => void> = [];
    const focusSearch = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!disposed) input.current?.focus({ preventScroll: true });
      });
    };
    // Rendering can precede native activation. Refocus once the panel is ready,
    // including repeated search shortcuts that keep the same session and mode.
    if (panelLabel === "switcher") focusSearch();
    window.addEventListener("focus", focusSearch);
    subscribe("search-focus", focusSearch).then(f => disposed ? f() : off.push(f));
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("focus", focusSearch);
      off.forEach(f => f());
    };
  }, [session?.sessionId, session?.mode, session?.loading]);
  useEffect(() => {
    if (!composing.current && (draftQuery.current === null || draftQuery.current === session?.query)) {
      setQuery(session?.query ?? "");
      draftQuery.current = null;
    }
  }, [session?.query]);
  useEffect(() => {
    let disposed=false, off=()=>{};
    subscribe<{sessionId:number;query:string;source:string}>("search-draft", draft => {
      if (draft.sessionId !== session?.sessionId || draft.source === panelLabel || composing.current) return;
      draftQuery.current=draft.query;
      setQuery(draft.query);
    }).then(f=>disposed ? f() : off=f);
    return ()=>{disposed=true;off();};
  }, [session?.sessionId]);
  function updateQuery(value:string) {
    draftQuery.current=value;
    setQuery(value);
    shareSearchDraft(session?.sessionId ?? 0,value).catch(()=>{});
  }
  const panel = session?.overview?.find(p => p.label === panelLabel);
  const overviewMode = !!panel;
  const [available, setAvailable] = useState({ width: 0, height: 0, overview: false });
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const refresh = () => {
      const width = Math.max(0, node.clientWidth - 28), height = Math.max(0, node.clientHeight - 28);
      setAvailable(old => old.width === width && old.height === height && old.overview === overviewMode
        ? old : {width, height, overview: overviewMode});
    };
    const observer = new ResizeObserver(refresh);
    observer.observe(node);
    refresh();
    return () => observer.disconnect();
  }, [frame?.generation, session?.sessionId, session?.mode, overviewMode]);
  async function action(name: string, args: Record<string, unknown> = {}) {
    try {
      await call(name, args);
    } catch (e) {
      setError(String(e));
    }
  }
  const participating = !!panel || panelLabel === "switcher" && !session?.overview?.length;
  const localWindows = participating ? session?.windows.filter(w => !panel || panel.slots.includes(w.id)) ?? [] : [];
  const spatialWindows = panel ? (session?.spatialIds ?? []).flatMap(id => {
    const w = session?.windows.find(w => w.id === id);
    return w && intersects(w.bounds, panel.display.bounds) ? [w] : [];
  }) : [];
  const visible =
    localWindows
      .filter((w) => session?.resultIds.includes(w.id))
      .sort(
        (a, b) =>
          session!.resultIds.indexOf(a.id) - session!.resultIds.indexOf(b.id),
      ) ?? [];
  const contentLayer = session?.layer === "tabs" || session?.layer === "desktops";
  const textContent = session?.layer === "tabs" && presentation(session, config.layout) === "text";
  const listLayout = config.layout === "list" || textContent;
  const desktopGrid = session?.layer === "desktops" && config.layout === "grid";
  // Hint input filters targets, but keeps the full held-session canvas. Hidden
  // cards retain their slots and scroll extent so the remaining previews stay put.
  const layoutWindows = session?.mode === "held" ? localWindows : visible;
  // Selection and search update the session frequently; collision avoidance
  // depends only on the full inventory and its geometry.
  const overviewKey=panel ? JSON.stringify([panel,localWindows.map(w=>[w.id,w.bounds,w.desktopId,w.hidden,w.minimized]),[...(session?.spatialIds ?? [])].sort(),session?.desktops]) : null;
  const overviewLayout=useMemo(()=>{
    if (!panel) return undefined;
    if (!available.overview || !available.width || !available.height) return {columns:0,tiles:[]};
    const start=performance.now();
    const layout=overviewCache.current(panel,localWindows,available.width,available.height,stacked,session?.spatialIds ?? [],session?.desktops);
    timing("layout",session?.sessionId ?? 0,performance.now()-start,layout.tiles.length);
    return layout;
  },[overviewKey,available,stacked]);
  useEffect(()=>{
    if (session?.mode === "inactive" || !overviewLayout?.tiles.length) return;
    return afterFrame(()=>timing("overview_frame",session?.sessionId ?? 0,0,overviewLayout.tiles.length));
  },[session?.sessionId,session?.mode,overviewLayout]);
  const layout: {columns:number; tiles:(Tile | undefined)[]; regions?:DesktopAnchor[]} = useMemo(() => panel ? (() => {
    const all=overviewLayout!;
    return {...all,tiles:layoutWindows.map(w=>all.tiles[localWindows.findIndex(a=>a.id===w.id)])};
  })() : desktopGrid ? (() => {
    const columns = Math.max(1, Math.min(3, layoutWindows.length, Math.floor(available.width / 260)));
    const width = Math.max(0, (available.width - (columns - 1) * 14) / columns);
    const height = width * 9 / 16 + 48;
    return {columns, tiles: layoutWindows.map((_,i) => ({x:(i % columns) * (width + 14), y:Math.floor(i / columns) * (height + 14), width, height, preview:height - 48, meta:48}))};
  })() : contentLayer && listLayout
    ? textRows(layoutWindows, available.width)
    : tileWindows(layoutWindows, available.width, available.height, listLayout, session?.layer === "tabs"), [session, available, listLayout, contentLayer, desktopGrid, stacked, overviewLayout]);
  const tiles = {...layout, tiles: visible.map(w => layout.tiles[layoutWindows.findIndex(a => a.id === w.id)])};
  useLayoutEffect(() => {
    if (!native || !frame || !session || session.mode === "inactive" || !participating
      || frame.session.sessionId !== session.sessionId || session.revision < frame.session.revision) return;
    const canvas = list.current;
    if (!canvas || available.width <= 0 || available.height <= 0
      || available.width !== Math.max(0, canvas.clientWidth - 28)
      || available.height !== Math.max(0, canvas.clientHeight - 28)
      || Math.abs(innerWidth - frame.width) > 1 || Math.abs(innerHeight - frame.height) > 1
      || visible.some((_, i) => !tiles.tiles[i])) return;
    // Flush the final DOM layout before acknowledging it. Hidden native WebViews
    // can suspend rAF, so the commit acknowledgement uses the next task instead.
    canvas.getBoundingClientRect();
    const timer = setTimeout(() => {
      call("panel_ready", {generation: frame.generation}).catch(e => setError(String(e)));
    }, 0);
    return () => clearTimeout(timer);
  }, [frame, session, participating, available, tiles]);
  const desktopRegions = (layout.regions ?? []).map(region=>({...region,labelWindowId:layoutWindows
    .map((w,i)=>({id:w.id,tile:layout.tiles[i]})).filter(w=>region.ids.includes(w.id)&&w.tile)
    .sort((a,b)=>a.tile!.y-b.tile!.y||a.tile!.x-b.tile!.x)[0]?.id}));
  const localSession = session ? {...session, windows: [...new Map([...localWindows, ...spatialWindows].map(w => [w.id,w])).values()]} : undefined;
  const images = usePreviews(localSession, participating && config.thumbnails && (!listLayout || !!panel) && (!!panel || contentLayer || !windowsNative));
  useEffect(()=>{ if ((panel || contentLayer) && session?.selected && !session.prefix) document.getElementById("window-"+session.selected)?.scrollIntoView({block:"nearest"}); },[session?.sessionId,session?.selected,contentLayer,available.width,available.height]);
  useEffect(() => setInspected(null), [session?.sessionId, session?.selected]);
  const lastSelection = useRef<{sessionId:number; at:number}>();
  useLayoutEffect(() => {
    if (!session?.selected) return;
    const now = performance.now(), previous = lastSelection.current;
    lastSelection.current = {sessionId:session.sessionId, at:now};
    // Track all selections, including the other display, so rapid Tab repeats
    // settle directly instead of starting a fresh pop on every card.
    if (previous?.sessionId === session.sessionId && now - previous.at < 180) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const marker = document.getElementById("window-" + session.selected)
      ?.querySelector(".spatial-card :is(.window-hint,.window-focus-marker)");
    const animation = marker?.animate([
      {transform:"translate(-50%,-50%) scale(.86)", offset:0},
      {transform:"translate(-50%,-50%) scale(1.04)", offset:.65},
      {transform:"translate(-50%,-50%) scale(1)", offset:1},
    ], {duration:150, easing:"ease-out"});
    return () => animation?.cancel();
  }, [session?.sessionId, session?.selected]);
  const layerName = session?.layer === "tabs" ? t("Tabs & sessions") : session?.layer === "desktops" ? t("Desktops") : session?.layer === "application" ? t("Application windows") : t("All windows");
  const layerHold = session?.layer === "tabs" ? config.tabsHoldShortcut : session?.layer === "application" ? config.applicationHoldShortcut : session?.layer === "desktops" ? config.desktopsHoldShortcut : config.holdShortcut;
  useEffect(() => {
    if (!session || session.mode === "inactive" || !participating) return;
    const rectangles=Object.fromEntries(visible.flatMap(w => {
      const node = document.getElementById("window-" + w.id);
      if (!node || !tiles.tiles.length) return [];
      const tile = tiles.tiles[visible.findIndex(v=>v.id===w.id)];
      const canvas = list.current;
      if (!tile || !canvas) return [];
      const b = canvas.getBoundingClientRect();
      // DOM transforms still show the old stack during the unfolding animation.
      // Publish the final layout immediately, including offscreen content rows.
      return [[w.id, {x:b.x+tile.x+14-canvas.scrollLeft, y:b.y+tile.y+14-canvas.scrollTop,
        width:tile.width, height:tile.height}]];
    }));
    call("set_navigation", {sessionId:session.sessionId,rectangles}).catch(()=>{});
  }, [session,tiles]);
  const isSearch = session?.mode === "search";
  const selectedPanel = session?.overview?.find(p => p.slots.includes(session?.selected ?? ""));
  return (
    <div
      className={"switcher " + (panel ? "display-overview " : "") + (listLayout && !panel ? "list-layout " : "") + (textContent ? "text-content " : "") + (contentLayer ? "content-layer " : "") + (desktopGrid ? "desktop-layer" : "")}
      data-display-id={panel?.display.id}
      style={{...hintVariables(config.hintStyle), "--surface-opacity": `${config.panelOpacity}%`} as CSSProperties}
      onKeyDown={(e) => {
        if (
          !isSearch ||
          composing.current ||
          e.nativeEvent.isComposing ||
          e.keyCode === 229
        )
          return;
        if (e.key === "Escape") {
          e.preventDefault();
          action("cancel");
        }
        if (e.key === "Enter") {
          e.preventDefault();
          action("activate", {
            id: session?.selected,
            sessionId: session?.sessionId,
          });
        }
        if (
          ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Tab"].includes(
            e.key,
          )
        ) {
          e.preventDefault();
          if (e.key === "Tab") action("navigate", {delta:e.shiftKey ? -1 : 1,sessionId:session?.sessionId});
          else action("navigate_direction", {direction:e.key,sessionId:session?.sessionId});
        }
      }}
    >
      <header className="switcher-header">
        <img src="/beaconhop.svg" alt="" />
        <div className="switcher-heading">
          <div className="switcher-context">BeaconHop <span>/</span> {panel ? panel.display.name || `${t("Display")} ${(session?.overview?.indexOf(panel) ?? 0) + 1}` : isSearch ? layerName : t("Workspace navigation")}</div>
          {isSearch ? (
            <input
              ref={input}
              aria-label={contentLayer ? t("Search targets") : t("Search windows")}
              disabled={session?.loading}
              placeholder={t("Search windows…") }
              value={query}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={(e) => {
                composing.current = false;
                updateQuery(e.currentTarget.value);
                action("search", {
                  query: e.currentTarget.value,
                  sessionId: session?.sessionId,
                });
              }}
              onChange={(e) => {
                updateQuery(e.target.value);
                if (!composing.current)
                  action("search", {
                    query: e.target.value,
                    sessionId: session?.sessionId,
                  });
              }}
            />
          ) : (
            <>
              <h1>{layerName}{session?.prefix && <kbd className="hint-prefix">{session.prefix}</kbd>}</h1>
            </>
          )}
        </div>
        {panel && <button className="icon-button" title={t("Original stack")} aria-label={t("Original stack")} aria-pressed={stacked} onClick={()=>setStack({sessionId:session?.sessionId,mode:session?.mode,value:!stacked})}><Icon name="layers" /></button>}
        <span className="count">{visible.length}</span>
        <button
          className="icon-button"
          aria-label={t("Close")}
          onClick={() => action("cancel")}
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      {panel && (session?.overview?.length ?? 0) > 1 && <div className="display-route sr-only" aria-label={t("Display navigation order")}>
        {session!.overview!.map((p, i) => <span key={p.display.id} className={p === selectedPanel ? "display-route-selected" : ""} aria-current={p === selectedPanel ? "true" : undefined}>
          {i > 0 && <span aria-hidden="true"> → </span>}{p === panel ? "● " : ""}{p.display.name || `${t("Display")} ${i + 1}`}
        </span>)}
        <span className="display-route-target" role="status">{selectedPanel && selectedPanel !== panel ? t("Selected on ") + (selectedPanel.display.name || selectedPanel.display.id) : ""}</span>
      </div>}
      {(error || session?.error) && (
        <div className="switcher-error" role="alert">
          {error || session?.error}
        </div>
      )}
      {!isSearch && layoutWindows.some(w => !w.hint) && <div className="switcher-warning">
        {t("No hint? Use arrows, search or click.")}
      </div>}
      {session?.warnings.map((w) => (
        <div className="switcher-warning" key={w}>
          {w}
        </div>
      ))}

      <div className={panel ? "overview-workspace" : "switcher-workspace"}>
      <div
        className="window-list"
        ref={list}
        role="listbox"
        aria-label={layerName}
        aria-activedescendant={
          visible.some(w => w.id === session?.selected) ? "window-" + session?.selected : undefined
        }
      >
        {desktopRegions.map((region,index) => <div className="desktop-wash" key={"wash-"+region.desktop.id}
          data-desktop-id={region.desktop.id} aria-hidden="true"
          style={{left:region.x+14,top:region.y+14,width:region.width,height:region.height,
            "--desktop-color":`hsl(${[258,186,34,330,115,215][index%6]} 65% 65%)`} as CSSProperties} />)}
        {desktopRegions.filter(region=>!region.labelWindowId).map(region=><DesktopMarker key={region.desktop.id}
          region={region} zh={zh} style={{left:region.centerX+14,top:region.y+18,maxWidth:Math.max(1,region.width-16)}} />)}
        {panel && !stacked && <WindowSpatialOverview windows={localWindows}
          highlighted={inspected ?? session?.selected ?? null} width={available.width} height={available.height}
          tile={tiles.tiles[visible.findIndex(w=>w.id===(inspected ?? session?.selected))]}
          zh={zh} />}
        {layoutWindows.map((w, index) => (
          <WindowCard
            key={`${session?.sessionId}:${w.id}`}
            window={w}
            image={images[w.id] ?? null}
            desktopPreview={desktopGrid ? session?.desktopPreviews?.[w.id] : undefined}
            desktopImages={images}
            desktop={desktopRegions.find(region=>region.labelWindowId===w.id)}
            tile={layout.tiles[index]}
            filtered={!session?.resultIds.includes(w.id)}
            depth={panel ? (session?.spatialIds?.includes(w.id) ? session.spatialIds.length - session.spatialIds.indexOf(w.id) : 1) : undefined}
            nativeStack={session?.spatialIds?.includes(w.id)}
            stacked={panel ? stacked : undefined}
            selected={w.id === session?.selected}
            departure={w.id === session?.origin?.id}
            hintStyle={config.hintStyle}
            prefix={session?.prefix ?? ""}
            thumbnails={config.thumbnails && (!listLayout || !!panel) && !w.desktopTarget}
            textContent={textContent}
            sessionId={session?.sessionId ?? 0}
            search={isSearch}
            onSelect={() =>
              action("activate", { id: w.id, sessionId: session?.sessionId })
            }
            zh={zh}
            onInspect={panel ? setInspected : undefined}
          />
        ))}
        {!visible.length && (
          <div className="empty">
            <span className="empty-icon"><Icon name="search" size={30} /></span>
            <h2>
              {session?.searching ? t("Searching files…", "正在搜索文件…") : session?.loading ? t("Loading targets…") : query
                ? (contentLayer ? t("No matching targets") : t("No matching windows"))
                : (contentLayer ? t("No targets in this window") : t("Nothing in view yet"))}
            </h2>
            <p>
              {session?.loading || session?.searching ? t("Esc cancels") : contentLayer ? t("Check the plugin connection or try another search.") : query
                ? t("Try another title or app name.")
                : t("Open a window, or check your scope and Accessibility settings.")}
            </p>
          </div>
        )}
      </div>
      </div>
      <footer className="switcher-footer">
        <span>
          <span className="tiny-beacon" />
          BeaconHop{preview ? " · Preview" : ""}
        </span>
        <div>
          <span>
            <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> {t("navigate")}
          </span>
          {isSearch ? (
            <>
              <span>
                <kbd>↵</kbd> {t("hop")}
              </span>
            </>
          ) : (
            <>
              <span title={shortcut(layerHold)}>
                <kbd>{shortcut(layerHold.split("+").at(-1)!)}</kbd> {t("next")}
              </span>
              <span title={shortcut(reverseShortcut(layerHold))}>
                <kbd>Shift + {shortcut(layerHold.split("+").at(-1)!)}</kbd> {t("previous")}
              </span>
              <span>
                <kbd>{shortcut(config.searchEntryKey)}</kbd> {t("search")}
              </span>
            </>
          )}
          <span>
            <kbd>Esc</kbd> {t("cancel & return")}
          </span>
        </div>
      </footer>
    </div>
  );
}
function DesktopMarker({region,zh,style}:{region:DesktopAnchor;zh:boolean;style?:CSSProperties}) {
  const desktop=region.desktop;
  const name=desktop.id==="__unknown" ? translate(zh,"Unknown desktop") : desktop.label && zh
    ? `${desktop.label.fullScreen ? "全屏空间" : "桌面"} ${desktop.label.number}` : desktop.name;
  return <span className={"desktop-anchor " + (desktop.current ? "current-desktop" : "")} data-desktop-id={desktop.id} style={style}>
    <span className="desktop-anchor-title"><strong>{name}</strong>{desktop.current && <span>●</span>}</span>
  </span>;
}
function WindowCard({
  window: w,
  image,
  desktopPreview,
  desktopImages,
  desktop,
  tile,
  depth,
  nativeStack,
  filtered,
  stacked,
  selected,
  departure,
  thumbnails,
  textContent,
  hintStyle,
  prefix,
  sessionId,
  search,
  onSelect,
  onInspect,
  zh,
}: {
  window: Destination;
  image: string | null;
  desktopPreview?: DesktopPreview;
  desktopImages: Record<string, string>;
  desktop?:DesktopAnchor;
  tile?: Tile;
  depth?: number;
  nativeStack?: boolean;
  filtered: boolean;
  stacked?: boolean;
  selected: boolean;
  departure: boolean;
  thumbnails: boolean;
  textContent: boolean;
  hintStyle: Config["hintStyle"];
  prefix: string;
  sessionId: number;
  search: boolean;
  onSelect: () => void;
  onInspect?: (id: string | null) => void;
  zh: boolean;
}) {
  const remainingHint = w.hint.startsWith(prefix) ? w.hint.slice(prefix.length) : w.hint;
  const title = w.desktopTarget && zh && w.desktopLabel
    ? `${w.desktopLabel.fullScreen ? "全屏空间" : "桌面"} ${w.desktopLabel.number}` : w.title;
  const appName = w.desktopTarget ? (translate(zh, "Desktop")) : w.appName;
  const previewArea = useRef<HTMLDivElement>(null);
  const element = useRef<HTMLButtonElement>(null);
  const previousTile = useRef<Tile>();
  const previousStack = useRef(stacked);
  useLayoutEffect(() => {
    // Opening should land directly on the final layout. Only an explicit
    // in-session geometry change (e.g. Original stack) animates between tiles.
    const node=element.current, from=previousTile.current;
    const toggled = previousStack.current !== stacked;
    previousStack.current=stacked;
    previousTile.current=tile;
    if(!toggled || depth === undefined || !node || !tile || !from || !tile.width || !tile.height || matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    if(from.x===tile.x && from.y===tile.y && from.width===tile.width && from.height===tile.height)return;
    const animation=node.animate([
      {transformOrigin:"0 0",transform:`translate(${from.x-tile.x}px, ${from.y-tile.y}px) scale(${from.width/tile.width}, ${from.height/tile.height})`,filter:"brightness(.8)"},
      {transformOrigin:"0 0",transform:"none",filter:"brightness(1)"},
    ],{duration:320,easing:"cubic-bezier(.2,.7,.25,1)"});
    return ()=>animation.cancel();
  },[tile?.x,tile?.y,tile?.width,tile?.height,depth,stacked]);

  useEffect(() => {
    if (!windowsNative || w.content || !thumbnails || filtered || !previewArea.current) return;
    const node = previewArea.current;
    let frame = 0;
    let alive = true;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = node.getBoundingClientRect(),
          container = node.closest(".window-list")!.getBoundingClientRect();
        const scale = devicePixelRatio;
        const bounds =
          r.top >= container.top && r.bottom <= container.bottom
            ? {
                x: r.x * scale,
                y: r.y * scale,
                width: r.width * scale,
                height: r.height * scale,
              }
            : null;
        const badge = element.current?.querySelector<HTMLElement>(".window-hint,.window-focus-marker");
        const hint = badge?.getBoundingClientRect();
        // DWM previews sit above the webview. Reserve the static sign's whole
        // footprint, including its pointer, origin dot and maximum pop scale.
        const sign = depth !== undefined && selected;
        const extra = sign && badge ? parseFloat(getComputedStyle(badge).fontSize) * .22 + 4 : 3;
        const width = badge ? badge.offsetWidth * (sign ? 1.04 : 1) + extra * 2 : 0;
        const height = badge ? badge.offsetHeight * (sign ? 1.04 : 1) + extra * 2 : 0;
        const hintBounds = hint ? { x: (hint.x + hint.width / 2 - width / 2) * scale,
          y: (hint.y + hint.height / 2 - height / 2) * scale, width:width * scale, height:height * scale } : null;
        if (alive)
          call("set_live_preview", { id: w.id, sessionId, bounds, hintBounds }).catch(
            () => {},
          );
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    const badge = element.current?.querySelector(".window-hint,.window-focus-marker");
    if (badge) observer.observe(badge);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    update();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      call("set_live_preview", { id: w.id, sessionId, bounds: null, hintBounds: null }).catch(
        () => {},
      );
    };
  }, [w.id, sessionId, thumbnails, filtered, search, selected, departure, depth, tile?.x, tile?.y, tile?.width, tile?.height]);
  return (
    <button
      ref={element}
      id={"window-" + w.id}
      role="option"
      aria-hidden={filtered || undefined}
      tabIndex={filtered ? -1 : undefined}
      aria-selected={selected}
      data-origin={departure || undefined}
      className={"window-card " + (depth !== undefined ? "spatial-card " : "") + (selected ? "selected " : "") + (departure ? "departure " : "") + (tile && tile.meta < 40 ? "dense" : "")}
      style={tile ? { visibility: filtered ? "hidden" : undefined, zIndex: depth, left: tile.x + 14, top: tile.y + 14, width: tile.width, height: tile.height,
        "--tile-preview": `${tile.preview}px`, "--tile-meta": `${tile.meta}px`,
        "--hint-size": `${Math.max(8, Math.min(
          (tile.preview - 2 * hintStyle.borderWidth - 12) / 1.55,
          (tile.width - 2 * hintStyle.borderWidth - 12) / (w.hint.length * .65 + .96),
        ))}px`,
        "--state-hint-size": `${Math.max(4, Math.min(
          (tile.preview - 18) / (selected ? 2.3 : 1.8),
          (tile.width - 18) / (Math.max(1.7, (search ? 1 : w.hint.length) * .65 + .44) + .08),
        ))}px`,
      } as CSSProperties : { visibility: "hidden" }}
      onClick={onSelect}
      onMouseEnter={() => onInspect?.(w.id)}
      onMouseLeave={() => onInspect?.(null)}
      title={[appName, title, w.content?.subtitle, w.content?.description].filter(Boolean).join(" — ")}
    >

      <div className="preview-frame">
        {windowsNative && !w.content && thumbnails && (
          <div className="native-preview-area" ref={previewArea} />
        )}{" "}
        {desktopPreview ? <DesktopOverview preview={desktopPreview} images={desktopImages} zh={zh} /> : image && thumbnails ? (
          <img className="window-preview" src={image} alt="" />
        ) : !textContent && (
          <div className="window-placeholder">
            {w.icon ? (
              <img src={w.icon} alt="" />
            ) : (
              <span>{appName.slice(0, 1)}</span>
            )}
            <small>{w.content ? (translate(zh, "No preview")) : appName}</small>
          </div>
        )}
        {!search && remainingHint && <kbd className="window-hint hint-badge" style={hintVariables(hintStyle)}>{remainingHint.replaceAll(" ", "␣")}</kbd>}
        {depth !== undefined && (search || !w.hint) && (selected || departure) && <span className="window-focus-marker hint-badge" style={hintVariables(hintStyle)} aria-hidden="true">{selected ? "↵" : "●"}</span>}
        {w.minimized && (
          <span className="window-state">{"−"}</span>
        )}
      </div>
      <div className="window-meta">
        {desktop && <DesktopMarker region={desktop} zh={zh} />}
        {w.icon ? (
          <img src={w.icon} alt="" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />
        ) : (
          <span className="app-initial">{(w.content ? title : appName).slice(0, 1)}</span>
        )}
        <div>
          <h2>{title}</h2>
          <p>
            {w.content?.subtitle || (w.desktopTarget && w.currentDesktop ? (translate(zh, "Current desktop")) : appName)}
            {!w.content && w.desktopName && (
              <>
                {" "}
                <span>· {w.desktopName}</span>
              </>
            )}
          </p>
          {textContent && w.content?.description && <p className="target-description">{w.content.description}</p>}
        </div>
        {(selected || departure) && <span className="card-state">
          {departure && <span className="departure-badge sr-only">{translate(zh, "Origin")}</span>}
          {selected && <span className="selection-badge sr-only">{translate(zh, "Selected")}</span>}
        </span>}
        {selected && <span className="selected-arrow"><Icon name="hop" size={16} /></span>}
      </div>
    </button>
  );
}
