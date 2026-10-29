import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Config, Session, Permissions, Destination } from "./types";
import { call, subscribe, defaults, native, preview } from "./api";
import { tileWindows, type Tile } from "./layout";
import { usePreviews } from "./previews";
import { Updates } from "./Updates";
import { HintAppearance } from "./HintAppearance";
import { hintVariables } from "./hints";
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
        <img src="/beaconhop.svg" />
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
  const t = (en: string, cn: string) => (zh ? cn : en);
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
      setNotice(t("Settings saved", "设置已保存"));
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
      setNotice(t(
        "System Settings opened. Enable BeaconHop, then return here.",
        "已打开系统设置，请开启 BeaconHop 后返回。",
      ));
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
          <span className="badge good">{t("Granted", "已授权")}</span>
        ) : (
          <button
            className="button secondary"
            aria-label={t(`Open ${title} settings`, `打开${title}设置`)}
            disabled={pendingPermission !== null}
            onClick={() => requestPermission(kind)}
          >
            {pendingPermission === kind
              ? t("Opening…", "正在打开…")
              : t("Open settings", "前往授权")}
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
  const tabs = [
    ["general", "⌘", t("Shortcuts", "快捷键")],
    ["scope", "▤", t("Window scope", "窗口范围")],
    ["appearance", "◐", t("Appearance", "外观")],
    ["system", "⚙", t("System & access", "系统与权限")],
    ["about", "◎", t("About", "关于")],
  ];
  return (
    <div className="settings-shell" style={{"--surface-opacity": `${draft.panelOpacity}%`} as CSSProperties}>
      <aside>
        <a className="brand">
          <img src="/beaconhop.svg" />
          <span>
            BeaconHop<small>WINDOW SWITCHER</small>
          </span>
        </a>
        <nav>
          {tabs.map(([id, icon, label]) => (
            <button
              key={id}
              aria-label={label}
              className={tab === id ? "active" : ""}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
              {id === "system" && (needsAccess || needsPreviews) && <span className="permission-nav-dot" aria-label={t("Access needed", "需要授权")} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div
            className={"status-dot " + (permissions?.ready ? "ready" : "")}
          />
          {permissions?.ready
            ? t("Ready to hop", "随时跳转")
            : t("Access needed", "需要授权")}
          <small>v{__APP_VERSION__}{preview ? " · Preview" : ""}</small>
        </div>
      </aside>
      <main className="settings-main">
        <header className="page-header">
          <div>
            <div className="eyebrow">BEACONHOP / {tab.toUpperCase()}</div>
            <h1>{tabs.find((x) => x[0] === tab)?.[2]}</h1>
          </div>
          <button
            className="button secondary"
            onClick={() =>
              call("open_search").catch((e) => setError(String(e)))
            }
          >
            {t("Try a hop", "试着跳转")}{" "}
            <kbd>{shortcut(initial.searchShortcut)}</kbd>
          </button>
        </header>
        <div className="settings-scroll">
          {tab !== "system" && (needsAccess || needsPreviews) && <div className="permission-banner" role="alert">
            <div><strong>{needsAccess ? t("Allow access to start switching windows", "先完成授权，才能切换窗口") : t("Allow Screen Recording to see window previews", "开启屏幕录制，才能显示窗口缩略图")}</strong>
              <p>{needsAccess ? t("Global shortcuts are unavailable. You can still edit and save settings.", "当前全局快捷键不可用，仍可编辑和保存设置。") : t("Window switching is ready; previews still need access.", "窗口切换已就绪，缩略图还需要授权。")}</p></div>
            <button className="button secondary" onClick={() => setTab("system")}>{t("Set up access", "前往授权")}</button>
          </div>}
          {tab === "general" && (
            <>
              <div className="hero">
                <span className="hero-signal">↗</span>
                <div>
                  <h2>
                    {t(
                      "See it. Hint it. Hop.",
                      "看见目标，按下提示，直接抵达。",
                    )}
                  </h2>
                  <p>
                    {t(
                      "Your windows are already open. Hop to the one you need.",
                      "窗口已经打开，随时轻松切换。",
                    )}
                  </p>
                </div>
                <div className="hero-keys">
                  <kbd>A</kbd>
                  <kbd>S</kbd>
                  <kbd>D</kbd>
                </div>
              </div>
              <section>
                <h2>{t("Two ways to get there", "两种抵达方式")}</h2>
                {toggle(
                  "holdEnabled",
                  t("Hold to switch", "按住切换"),
                  t(
                    "Hold the modifier, then type a hint to jump immediately.",
                    "按住修饰键，输入屏幕字母后立即切换。",
                  ),
                )}
                <Setting
                  title={t("Hold shortcut", "按住模式快捷键")}
                  description={t(
                    "Tab cycles. Shift reverses. Release to open the selection.",
                    "Tab 循环，Shift 反向，松开修饰键切换到选中窗口。",
                  )}
                >
                  <Shortcut
                    value={draft.holdShortcut}
                    onChange={(v) => change("holdShortcut", v)}
                    label={t("Hold shortcut", "按住模式快捷键")}
                    zh={zh}
                    defaultValue={defaults.holdShortcut}
                  />
                </Setting>
                <Setting
                  title={t("Search shortcut", "搜索模式快捷键")}
                  description={t(
                    "Open search directly. Type a title or application name.",
                    "直接打开搜索，可以松开快捷键，输入标题或应用名。",
                  )}
                >
                  <Shortcut
                    value={draft.searchShortcut}
                    onChange={(v) => change("searchShortcut", v)}
                    label={t("Search shortcut", "搜索模式快捷键")}
                    zh={zh}
                    defaultValue={defaults.searchShortcut}
                  />
                </Setting>
                <Setting
                  title={t("Search key while holding", "按住时进入搜索")}
                  description={t(
                    "Press this key in hold mode to enter search, then release the modifier. Choose a key that is not used for hints or cycling.",
                    "在按住模式按此键进入搜索，之后可以松开修饰键。不要与提示字母或循环键重复。",
                  )}
                >
                  <Shortcut
                    value={draft.searchEntryKey}
                    onChange={(v) => change("searchEntryKey", v)}
                    label={t("Search key while holding", "按住时进入搜索")}
                    zh={zh}
                    defaultValue={defaults.searchEntryKey}
                    singleKey
                  />
                </Setting>
              </section>
              <section>
                <h2>{t("Your hint alphabet", "顺手的提示字母")}</h2>
                <Setting
                  title={t("Letters in priority order", "字母优先顺序")}
                  description={t(
                    "4–26 unique A–Z letters. Hints stay fixed until you close the switcher.",
                    "4–26 个不重复的 A–Z 字母。一次唤起期间，提示保持不变。",
                  )}
                >
                  <input
                    className="alphabet"
                    aria-label={t("Hint letters", "提示字母")}
                    value={draft.hintAlphabet}
                    onChange={(e) =>
                      change(
                        "hintAlphabet",
                        e.target.value.toUpperCase().replace(/[^A-Z]/g, ""),
                      )
                    }
                    spellCheck={false}
                    maxLength={26}
                  />
                </Setting>
                <div className="hint-preview">
                  {draft.hintAlphabet
                    .slice(0, 12)
                    .split("")
                    .map((c, i) => (
                      <kbd key={i}>{c}</kbd>
                    ))}
                </div>
              </section>
            </>
          )}
          {tab === "scope" && (
            <>
              <p className="intro">
                {t(
                  "Choose which windows appear. Desktop and display filters are independent.",
                  "选择要显示的窗口范围。桌面和显示器可以独立设置。",
                )}
              </p>
              <section>
                <h2>{t("Where to look", "查找范围")}</h2>
                {select(
                  "desktopScope",
                  t("Virtual desktops", "虚拟桌面"),
                  t(
                    "A hop follows the window to its desktop; it does not move the window.",
                    "切换时跟随窗口前往它所在的桌面，窗口位置保持不变。",
                  ),
                  [
                    ["all", t("All desktops", "所有桌面")],
                    ["current", t("Current desktop", "当前桌面")],
                  ],
                )}
                {select(
                  "displayScope",
                  t("Displays", "显示器"),
                  t(
                    "Current display follows the window you are working in.",
                    "当前显示器以正在使用的窗口为准。",
                  ),
                  [
                    ["all", t("All displays", "所有显示器")],
                    ["current", t("Current display", "当前显示器")],
                  ],
                )}
                {toggle(
                  "includeMinimized",
                  t("Minimized windows", "包含最小化窗口"),
                  t(
                    "Restore a minimized window when you choose it.",
                    "选择后恢复最小化的窗口。",
                  ),
                )}
                {toggle(
                  "includeHidden",
                  t("Hidden applications", "包含隐藏应用"),
                  t(
                    "Include windows from applications hidden on macOS.",
                    "包含 macOS 上被隐藏的应用窗口。",
                  ),
                )}
              </section>
              <section>
                <h2>{t("Keep these out", "排除这些应用")}</h2>
                <p className="muted">
                  {t(
                    "One exact app name or bundle ID / executable path per line. Empty means no exclusions; the examples below are only suggestions.",
                    "每行一个完整应用名，或 bundle ID / 可执行文件路径。留空表示不排除；下方灰字仅为示例。",
                  )}
                </p>
                <textarea
                  aria-label={t("Excluded applications", "排除应用")}
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
              <p className="intro">
                {t(
                  "A clear view, at your own pace.",
                  "清楚看见目标，保持自己的节奏。",
                )}
              </p>
              <section>
                <h2>{t("Switcher", "切换面板")}</h2>
                {toggle(
                  "thumbnails",
                  t("Window previews", "窗口缩略图"),
                  t(
                    "Previews load in the background. Protected windows may show an app placeholder.",
                    "预览在后台加载；受保护的窗口可能显示应用占位图。",
                  ),
                )}
                {select(
                  "layout",
                  t("Layout", "布局"),
                  t(
                    "All windows fit on screen, most recently used first.",
                    "所有窗口平铺在一屏内，最近使用的窗口优先。",
                  ),
                  [
                    ["grid", t("Grid", "网格")],
                    ["list", t("List", "列表")],
                  ],
                )}
                {select("theme", t("Theme", "主题"), "", [
                  ["system", t("Follow system", "跟随系统")],
                  ["dark", t("Dark", "深色")],
                  ["light", t("Light", "浅色")],
                ])}
                {select("language", t("Language", "语言"), "", [
                  ["system", t("Follow system", "跟随系统")],
                  ["en", "English"],
                  ["zh", "简体中文"],
                ])}
              </section>
              <section>
                <Setting title={t("Panel opacity", "面板不透明度")} description={t("Lower values reveal more of the native desktop blur. Reduce Transparency in system settings can override this.", "降低数值可透出更多桌面毛玻璃。系统的“减少透明度”设置可能覆盖此效果。") }>
                  <input aria-label={t("Panel opacity", "面板不透明度")} type="range" min={0} max={100} value={draft.panelOpacity} onChange={e => change("panelOpacity",Number(e.target.value))} /><output>{draft.panelOpacity}%</output>
                </Setting>
              </section>
              <HintAppearance value={draft.hintStyle} defaults={defaults.hintStyle} onChange={value => change("hintStyle",value)} t={t} />
              <div className="appearance-preview">
                <div className="mini-card">
                  <div className="mini-screen">
                    <span>↗</span>
                  </div>
                  <div>
                    <kbd>A</kbd> BeaconHop
                  </div>
                </div>
                <div>
                  <h2>{t("A signal, then a hop.", "一个信号，一次抵达。")}</h2>
                  <p className="muted">
                    {t(
                      "High contrast hints stay easy to find.",
                      "高对比提示，让目标一眼可见。",
                    )}
                  </p>
                </div>
              </div>
            </>
          )}
          {tab === "system" && (
            <>
              {permissions?.required && (needsAccess || needsPreviews) && <section className="permission-setup" role="region" aria-label={t("Finish setting up BeaconHop", "完成 BeaconHop 授权")}>
                <div className="eyebrow">{t("SETUP REQUIRED", "需要完成授权")}</div>
                <h2>{!permissions.accessibility ? t("Enable Accessibility to start hopping", "先开启辅助功能，开始切换窗口") : !permissions.keyboardHook ? t("Accessibility is allowed. Connect the keyboard listener.", "辅助功能已授权，键盘监听尚未连接") : t("One more step for window previews", "再开启屏幕录制，显示窗口缩略图")}</h2>
                <p>{!permissions.accessibility ? t("Open System Settings, enable BeaconHop under Privacy & Security → Accessibility, then return here. The status refreshes automatically.", "打开系统设置，在「隐私与安全性 → 辅助功能」开启 BeaconHop，再返回这里，状态会自动更新。") : !permissions.keyboardHook ? t("Wait briefly for the listener. If it stays disconnected, restart BeaconHop.", "请稍候等待连接；如果仍未就绪，重启 BeaconHop。") : t("Screen Recording is used for thumbnails. You can switch windows without granting it.", "屏幕录制用于生成缩略图；暂不授权也可以切换窗口。")}</p>
                <div className="permission-steps"><span className={permissions.accessibility ? "done" : ""}>1 · {t("Accessibility · Required", "辅助功能 · 必需")}</span><span className={permissions.keyboardHook ? "done" : ""}>2 · {t("Keyboard listener", "键盘监听")}</span><span className={permissions.screenRecording ? "done" : ""}>3 · {t("Screen Recording · Previews", "屏幕录制 · 缩略图")}</span></div>
                <div className="permission-actions">
                  {!permissions.accessibility ? <button className="button primary" disabled={pendingPermission !== null} onClick={() => requestPermission("accessibility")}>{t("Open Accessibility settings", "打开辅助功能设置")}</button>
                    : !permissions.keyboardHook ? <button className="button primary" onClick={() => call("restart_application").catch((e) => setError(String(e)))}>{t("Restart BeaconHop", "重启 BeaconHop")}</button>
                    : <button className="button primary" disabled={pendingPermission !== null} onClick={() => requestPermission("screen")}>{t("Enable window previews", "开启窗口缩略图")}</button>}
                  <button className="button secondary" onClick={() => call<Permissions>("get_permissions").then(setPermissions).catch((e) => setError(String(e)))}>{t("Check again", "重新检测")}</button>
                </div>
                <details className="permission-troubleshooting"><summary>{t("Already enabled, but still not working?", "已经开启，仍显示未授权？")}</summary><p>{t("After an app update, remove the old BeaconHop entry from Accessibility, add this installed app again and restart.", "更新应用后，若开关已开启仍未就绪，请移除辅助功能中的旧 BeaconHop，重新添加当前应用并重启。")}</p><p className="app-path">{permissions.appPath}</p><button className="button secondary" onClick={() => call("restart_application").catch((e) => setError(String(e)))}>{t("Restart BeaconHop", "重启 BeaconHop")}</button></details>
              </section>}
              <section>
                <h2>{t("Make it part of your day", "随时待命")}</h2>
                {toggle(
                  "startAtLogin",
                  t("Launch at login", "登录时启动"),
                  t(
                    "Keep BeaconHop ready as soon as you log in.",
                    "登录后，BeaconHop 随时待命。",
                  ),
                )}
                {toggle(
                  "startInTray",
                  t("Start quietly", "启动时收起设置"),
                  t(
                    "Keep settings closed and run from the menu bar or system tray.",
                    "在菜单栏或系统托盘运行。",
                  ),
                )}
              </section>
              <section>
                <h2>{t("Permissions & health", "权限与运行状态")}</h2>
                {permissions?.required ? (
                  <>
                    {[
                      [
                        "accessibility",
                        "accessibility",
                        t("Accessibility", "辅助功能"),
                        t(
                          "Find and focus individual windows.",
                          "查找和聚焦具体窗口。",
                        ),
                      ],
                      [
                        "screenRecording",
                        "screen",
                        t("Screen recording", "屏幕录制"),
                        t(
                          "Capture window previews. Switching works without previews.",
                          "生成窗口预览；未授权时仍可使用窗口切换。",
                        ),
                      ],
                    ].map(([key, kind, title, description]) =>
                      permissionSetting(
                        key as "accessibility" | "screenRecording",
                        kind, title, description,
                      ),
                    )}
                    <p className="small muted">
                      {t(
                        "After changing macOS permissions, a restart may be required.",
                        "更改 macOS 权限后，可能需要退出并重新打开应用。",
                      )}
                    </p>
                  </>
                ) : (
                  <p className="muted">
                    {t(
                      "No additional permissions are normally required on Windows.",
                      "Windows 通常无需额外授权。",
                    )}
                  </p>
                )}
                <Setting
                  title={t("Keyboard listener", "键盘监听")}
                  description={t(
                    "The native listener must be running for global shortcuts.",
                    "全局快捷键需要原生监听正常运行。",
                  )}
                >
                  <span
                    className={
                      "badge " +
                      (permissions?.keyboardHook ? "good" : "pending")
                    }
                  >
                    {permissions?.keyboardHook
                      ? t("Running", "运行中")
                      : t("Not ready", "未就绪")}
                  </span>
                </Setting>
                {permissions?.required && !permissions.keyboardHook && (
                  <details className="permission-troubleshooting">
                    <summary>{t("Keyboard troubleshooting", "键盘监听排查")}</summary>
                    <p className="small muted">
                      {t(
                        "Accessibility normally enables shortcuts. If it is already granted and the listener is still unavailable, check Input Monitoring and restart BeaconHop.",
                        "辅助功能通常已能启用快捷键。如果已授权但监听仍未就绪，再检查输入监控并重启 BeaconHop。",
                      )}
                    </p>
                    {permissionSetting(
                      "inputMonitoring", "input",
                      t("Input monitoring", "输入监控"),
                      t("Optional keyboard-listener recovery.", "仅用于键盘监听异常时的排查。"),
                    )}
                  </details>
                )}
              </section>
              <section>
                <h2>{t("Diagnostics", "诊断")}</h2>
                <button
                  className="button secondary"
                  onClick={() =>
                    call("get_diagnostics")
                      .then((v) => setDiagnostics(JSON.stringify(v, null, 2)))
                      .catch((e) => setError(String(e)))
                  }
                >
                  {t("Show diagnostics", "查看诊断信息")}
                </button>
                {diagnostics && (
                  <pre className="diagnostics">{diagnostics}</pre>
                )}
              </section>
            </>
          )}
          <section hidden={tab !== "system"}><Updates t={t} dirty={dirty} onBusy={setUpdateBusy} /></section>
          {tab === "about" && (
            <div className="about">
              <img src="/beaconhop.svg" />
              <h1>BeaconHop</h1>
              <p className="tagline">Follow the hint. Make the hop.</p>
              <p>
                {t(
                  "A little beacon for any window you want to reach.",
                  "想去哪个窗口，就循着提示抵达。",
                )}
              </p>
              <span className="badge">{__APP_VERSION__} · macOS & Windows</span>
              <div className="about-details">
                <p>
                  {t(
                    "Built on Screen Buoy. Licensed under MIT.",
                    "基于 Screen Buoy 改造，采用 MIT 开源许可证。",
                  )}
                </p>
                <p>
                  {t(
                    "Window discovery, search and previews stay on your computer.",
                    "窗口发现、搜索与预览均在本机处理。",
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
        <footer className="settings-footer">
          <span
            role={error ? "alert" : "status"}
            className={error ? "error" : "muted"}
          >
            {error ||
              notice ||
              (dirty
                ? t("Unsaved changes", "有未保存的修改")
                : t(
                    "Follow the hint. Make the hop.",
                    "循着提示，轻松切换。",
                  ))}
          </span>
          <div>
            <button className="button ghost" disabled={dirty || busy || updateBusy}
              title={dirty ? t("Save or discard your changes before restarting", "请先保存或撤销修改，再重启") : undefined}
              onClick={async () => {
                try { setNotice(t("Restarting…", "正在重启…")); await call("restart_application"); }
                catch (e) { setError(String(e)); }
              }}>{t("Restart BeaconHop", "重启 BeaconHop")}</button>
            <button
              className="button ghost"
              disabled={!dirty || busy || updateBusy}
              onClick={() => {
                setDraft(initial);
                setError("");
              }}
            >
              {t("Discard", "撤销")}
            </button>
            <button
              className="button primary"
              disabled={!dirty || busy || updateBusy}
              onClick={save}
            >
              {busy ? t("Saving…", "保存中…") : t("Save changes", "保存设置")}
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
  description: string;
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
      setFeedback(next === value ? (zh ? "已是当前快捷键" : "Shortcut unchanged") : (zh ? "已录入，保存后生效" : "Recorded. Save to apply."));
      onChange(next);
    } else setFeedback(zh ? "已取消录入" : "Recording cancelled");
    setRecording(false);
    setManual(false);
  };
  const applyText = () => {
    const next = parseShortcutText(text, singleKey);
    if (next) finish.current(next);
    else setFeedback(singleKey
      ? (zh ? "请输入单个按键，例如 `、\\ 或 Space，不需要修饰键。" : "Use one key without modifiers, such as `, \\ or Space.")
      : (zh ? "请输入修饰键 + 按键，例如 Win + ` 或 Win + \\" : "Use a modifier and key, such as Win + ` or Win + \\"));
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
      if (native && !ready) setFeedback(zh ? "辅助功能尚未就绪；若按键被系统或其他应用接走，请使用手动输入。" : "Accessibility is not ready. Use manual entry if another app or macOS intercepts the keys.");
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
      onClick={() => { setManual(false); setFeedback(""); setRecording(true); }}
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
          ? (zh ? "请单独按下目标键，不需要修饰键。" : "Press the target key on its own, without modifiers.")
          : (zh ? "请同时按住 Alt、Ctrl 或 Win / ⌘，再按目标键。" : "Hold Alt, Ctrl or Win / Command with the target key."));
      }}
    >{recording ? (zh ? "请按下快捷键…" : "Press shortcut…") : shortcut(value)}</button>
    <button className="shortcut-reset" aria-label={zh ? `手动输入${label}` : `Enter ${label} manually`} onClick={() => { setRecording(false); setManual(true); setText(value); setFeedback(""); }}>{zh ? "手动输入" : "Enter manually"}</button>
    <button className="shortcut-reset" aria-label={zh ? `恢复${label}默认值` : `Restore default ${label}`} onClick={() => finish.current(defaultValue)}>{zh ? "恢复默认" : "Restore default"}</button>
    {manual && <div className="shortcut-manual">
      <input autoFocus value={text} aria-label={zh ? `${label}文本` : `${label} text`} spellCheck={false} placeholder={singleKey ? "`" : "Win + `"} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); applyText(); }
        if (e.key === "Escape") { e.preventDefault(); finish.current(""); }
      }} />
      <button className="shortcut-reset" onClick={applyText}>{zh ? "确认" : "Apply"}</button>
      <button className="shortcut-reset" onClick={() => finish.current("")}>{zh ? "取消" : "Cancel"}</button>
    </div>}
    <span className="shortcut-feedback" role="status">{feedback}</span>
  </div>;
}

function Switcher({ config, zh }: { config: Config; zh: boolean }) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [session, setSession] = useState<Session>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let off = () => {};
    const accept = (s: Session) =>
      setSession((old) =>
        !old ||
        s.sessionId > old.sessionId ||
        (s.sessionId === old.sessionId && s.revision >= old.revision)
          ? s
          : old,
      );
    subscribe<Session>("session", accept).then((f) =>
      disposed ? f() : (off = f),
    );
    call<Session>("get_session")
      .then((s) => {
        if (!disposed) accept(s);
      })
      .catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      off();
    };
  }, []);
  useEffect(() => {
    setQuery(session?.query ?? "");
    setError("");
    if (session?.mode === "search") {
      const timer = setTimeout(() => input.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
  }, [session?.sessionId, session?.mode]);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const refresh = () => setAvailable({ width: Math.max(0, node.clientWidth - 28), height: Math.max(0, node.clientHeight - 28) });
    const observer = new ResizeObserver(refresh);
    observer.observe(node);
    refresh();
    return () => observer.disconnect();
  }, []);
  async function action(name: string, args: Record<string, unknown> = {}) {
    try {
      await call(name, args);
    } catch (e) {
      setError(String(e));
    }
  }
  const visible =
    session?.windows
      .filter((w) => session.resultIds.includes(w.id))
      .sort(
        (a, b) =>
          session.resultIds.indexOf(a.id) - session.resultIds.indexOf(b.id),
      ) ?? [];
  const tiles = useMemo(() => tileWindows(visible, available.width, available.height, config.layout === "list"), [session, available, config.layout]);
  const images = usePreviews(session, config.thumbnails && config.layout === "grid" && !windowsNative);
  useEffect(() => {
    if (!session || session.mode === "inactive" || !tiles.tiles.length) return;
    const rectangles=Object.fromEntries(visible.map((w,i)=>[w.id,tiles.tiles[i]]).filter(([,tile])=>!!tile));
    call("set_navigation", {sessionId:session.sessionId,rectangles}).catch(()=>{});
  }, [session,tiles]);
  const isSearch = session?.mode === "search";
  return (
    <div
      className={"switcher " + (config.layout === "list" ? "list-layout" : "")}
      style={{"--surface-opacity": `${config.panelOpacity}%`} as CSSProperties}
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
        <img src="/beaconhop.svg" />
        <div className="switcher-heading">
          {isSearch ? (
            <input
              ref={input}
              aria-label={t("Search windows", "搜索窗口")}
              placeholder={t("Title, app or Chinese pinyin / initials", "搜索标题、应用名、拼音或首字母") }
              value={query}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={(e) => {
                composing.current = false;
                action("search", {
                  query: e.currentTarget.value,
                  sessionId: session?.sessionId,
                });
              }}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!composing.current)
                  action("search", {
                    query: e.target.value,
                    sessionId: session?.sessionId,
                  });
              }}
            />
          ) : (
            <>
              <h1>{t("Your next hop", "下一跳")}</h1>
              <p>
                {t("Type a hint to go there", "按下提示字母，直接抵达")}
                {session?.prefix && (
                  <>
                    {" "}
                    · <strong>{session.prefix}</strong>
                  </>
                )}
              </p>
            </>
          )}
        </div>
        <span className="count">
          {visible.length} {t("windows", "个窗口")}
        </span>
        <button
          className="icon-button"
          aria-label={t("Close", "关闭")}
          onClick={() => action("cancel")}
        >
          ×
        </button>
      </header>
      {(error || session?.error) && (
        <div className="switcher-error" role="alert">
          {error || session?.error}
        </div>
      )}
      {session?.warnings.map((w) => (
        <div className="switcher-warning" key={w}>
          {w}
        </div>
      ))}
      <div
        className="window-list"
        ref={list}
        role="listbox"
        aria-label={t("Open windows", "已打开的窗口")}
        aria-activedescendant={
          session?.selected ? "window-" + session.selected : undefined
        }
      >
        {visible.map((w, index) => (
          <WindowCard
            key={`${session?.sessionId}:${w.id}`}
            window={w}
            image={images[w.id] ?? null}
            tile={tiles.tiles[index]}
            selected={w.id === session?.selected}
            hintStyle={config.hintStyle}
            thumbnails={config.thumbnails && config.layout === "grid"}
            sessionId={session?.sessionId ?? 0}
            search={isSearch}
            onSelect={() =>
              action("activate", { id: w.id, sessionId: session?.sessionId })
            }
            zh={zh}
          />
        ))}
        {!visible.length && (
          <div className="empty">
            <span>⌕</span>
            <h2>
              {query
                ? t("No matching windows", "没有匹配的窗口")
                : t("Nothing in view yet", "暂时没有窗口")}
            </h2>
            <p>
              {query
                ? t("Try another title or app name.", "试试其他标题或应用名。")
                : t(
                    "Open a window, or check your scope and Accessibility settings.",
                    "打开一个窗口，或检查范围设置与辅助功能权限。",
                  )}
            </p>
          </div>
        )}
      </div>
      <footer className="switcher-footer">
        <span>
          <span className="tiny-beacon" />
          BeaconHop{preview ? " · Preview" : ""}
        </span>
        <div>
          <span>
            <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> {t("navigate", "选择")}
          </span>
          {isSearch ? (
            <>
              <span>
                <kbd>↵</kbd> {t("hop", "跳转")}
              </span>
            </>
          ) : (
            <>
              <span>
                <kbd>Tab</kbd> {t("cycle", "循环")}
              </span>
              <span>
                <kbd>{shortcut(config.searchEntryKey)}</kbd> {t("search", "搜索")}
              </span>
            </>
          )}
          <span>
            <kbd>Esc</kbd> {t("cancel", "取消")}
          </span>
        </div>
      </footer>
    </div>
  );
}
function WindowCard({
  window: w,
  image,
  tile,
  selected,
  thumbnails,
  hintStyle,
  sessionId,
  search,
  onSelect,
  zh,
}: {
  window: Destination;
  image: string | null;
  tile?: Tile;
  selected: boolean;
  thumbnails: boolean;
  hintStyle: Config["hintStyle"];
  sessionId: number;
  search: boolean;
  onSelect: () => void;
  zh: boolean;
}) {
  const previewArea = useRef<HTMLDivElement>(null);
  const element = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!windowsNative || !thumbnails || !previewArea.current) return;
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
        const hint = element.current?.querySelector(".window-hint")?.getBoundingClientRect();
        const hintBounds = hint ? { x: (hint.x - 3) * scale, y: (hint.y - 3) * scale,
          width: (hint.width + 6) * scale, height: (hint.height + 6) * scale } : null;
        if (alive)
          call("set_live_preview", { id: w.id, sessionId, bounds, hintBounds }).catch(
            () => {},
          );
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    const badge = element.current?.querySelector(".window-hint");
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
  }, [w.id, sessionId, thumbnails, search, tile?.x, tile?.y, tile?.width, tile?.height]);
  return (
    <button
      ref={element}
      id={"window-" + w.id}
      role="option"
      aria-selected={selected}
      className={"window-card " + (selected ? "selected " : "") + (tile && tile.meta < 40 ? "dense" : "")}
      style={tile ? { left: tile.x + 14, top: tile.y + 14, width: tile.width, height: tile.height,
        "--tile-preview": `${tile.preview}px`, "--tile-meta": `${tile.meta}px`,
        "--hint-size": `${Math.max(8, Math.min(
          (tile.preview - 2 * hintStyle.borderWidth - 12) / 1.55,
          (tile.width - 2 * hintStyle.borderWidth - 12) / (w.hint.length * .65 + .96),
        ))}px`,
      } as CSSProperties : { visibility: "hidden" }}
      onClick={onSelect}
      title={`${w.appName} — ${w.title}`}
    >
      <div className="preview-frame">
        {windowsNative && thumbnails && (
          <div className="native-preview-area" ref={previewArea} />
        )}{" "}
        {image ? (
          <img className="window-preview" src={image} alt="" />
        ) : (
          <div className="window-placeholder">
            {w.icon ? (
              <img src={w.icon} alt="" />
            ) : (
              <span>{w.appName.slice(0, 1)}</span>
            )}
            <small>{w.appName}</small>
          </div>
        )}
        {!search && <kbd className="window-hint hint-badge" style={hintVariables(hintStyle)}>{w.hint}</kbd>}
        {w.minimized && (
          <span className="window-state">{zh ? "最小化" : "Minimized"}</span>
        )}
      </div>
      <div className="window-meta">
        {w.icon ? (
          <img src={w.icon} alt="" />
        ) : (
          <span className="app-initial">{w.appName.slice(0, 1)}</span>
        )}
        <div>
          <h2>{w.title}</h2>
          <p>
            {w.appName}
            {w.desktopName && (
              <>
                {" "}
                <span>· {w.desktopName}</span>
              </>
            )}
          </p>
        </div>
        {selected && <span className="selected-arrow">↗</span>}
      </div>
    </button>
  );
}
