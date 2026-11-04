import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Config, Session, Permissions, Destination, DesktopPreview } from "./types";
import { call, subscribe, defaults, native, preview, panelLabel, shareSearchDraft } from "./api";
import { tileWindows, textRows, desktopOverviewTiles, type Tile, type DesktopAnchor } from "./layout";
import { presentation } from "./presentation";
import { usePreviews } from "./previews";
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
  const tabs: [string, IconName, string, string][] = [
    ["general", "keyboard", t("Shortcuts", "快捷键"), t("Go from a keystroke to the window you need.", "从一个按键开始，快速抵达目标窗口。")],
    ["scope", "windows", t("Window scope", "窗口范围"), t("Choose what appears across desktops and displays.", "定义跨桌面、跨显示器的窗口查找范围。")],
    ["navigation", "layers", t("Navigation layers", "导航层级"), t("Move between windows, apps, tabs and desktops with one familiar gesture.", "使用熟悉的手势，在窗口、应用、Tab 与桌面之间流畅切换。")],
    ["appearance", "appearance", t("Appearance", "外观"), t("A clear view of your workspace, in your own style.", "调整切换面板与提示样式，让工作空间清晰有序。")],
    ["plugins", "tabs", t("Application plugins", "应用插件"), t("Install extensions and connect your applications.", "安装扩展，连接常用应用。")],
    ["screen-buoy", "cursor", "Screen Buoy", t("Reach a desktop or window with BeaconHop. Take action inside it with Screen Buoy.", "用 BeaconHop 抵达桌面或窗口，用 Screen Buoy 操作其中的元素。")],
    ["system", "settings", t("System & access", "系统与权限"), t("Manage startup, permissions and app health in one place.", "集中管理启动行为、系统权限与应用运行状态。")],
    ["about", "info", t("About", "关于"), t("Thoughtful tools for a keyboard-first desktop.", "为键盘操作而设计，让桌面工作更专注。")],
  ];
  const current = tabs.find(x => x[0] === tab)!;
  const destinations: SettingsDestination[] = [
    ...tabs.map(([page, icon, title, keywords]) => ({ page, icon, title, keywords: `${page} ${keywords}`, group: t("Settings", "设置") })),
    ...([
      ["general", "shortcut-settings", t("Hold & search shortcuts", "按住切换与搜索快捷键"), "keyboard", "hotkey activation 快捷键 热键 搜索"],
      ["general", "hint-characters", t("Hint characters", "提示字符集"), "keyboard", "alphabet letters symbols 字母 标点 hint"],
      ["navigation", "continuation-settings", t("Continuation gestures", "后续层级手势"), "layers", "hold hint keys 继续 按住 邻键"],
      ["plugins", "plugin-settings", t("Application plugins", "应用插件"), "tabs", "browser chrome edge vscode codex 浏览器 扩展"],
      ["scope", "excluded-apps", t("Excluded applications", "排除应用"), "windows", "ignore filter 过滤 排除"],
      ["appearance", "switcher-settings", t("Theme, language & layout", "主题、语言与布局"), "appearance", "light dark Chinese English 深色 浅色 中英文"],
      ["appearance", "opacity-settings", t("Switcher background opacity", "切换面板背景不透明度"), "appearance", "transparency blur glass 透明 毛玻璃"],
      ["appearance", "hint-appearance", t("Hint style", "Hint 样式"), "appearance", "font color border radius shadow 字号 颜色 边框 阴影"],
      ["system", "permissions-settings", t("Permissions & health", "权限与运行状态"), "shield", "accessibility keyboard screen recording 辅助功能 键盘 录屏"],
      ["system", "updates-settings", t("App updates", "应用更新"), "info", "version download release 版本 下载 升级"],
    ] as [string, string, string, IconName, string][]).map(([page, anchor, title, icon, keywords]) => ({page, anchor, title, icon, keywords, group: tabs.find(x => x[0] === page)![2]})),
  ];
  return (
    <div className="settings-shell">
      <aside>
        <div className="brand">
          <img src="/beaconhop.svg" alt="" />
          <span>BeaconHop<small>{t("Desktop navigation", "桌面导航")}</small></span>
        </div>
        <nav aria-label={t("Settings navigation", "设置导航")}>
          {tabs.map(([id, icon, label], index) => (
            <div className="nav-entry" key={id}>
              {(index === 0 || id === "plugins" || id === "system") && <div className="nav-caption">{index === 0 ? t("WORKSPACE", "工作空间") : id === "plugins" ? t("CONNECTED TOOLS", "协同工具") : t("APPLICATION", "应用")}</div>}
              <button aria-label={label} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => { setDestination(undefined); setTab(id); }}>
                <Icon name={icon} /><span className="nav-label">{label}</span>
                {id === "system" && (needsAccess || needsPreviews) && <span className="permission-nav-dot" aria-label={t("Access needed", "需要授权")} />}
                {tab === id && <span className="nav-active-dot" />}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="runtime-status"><span className={"status-dot " + (permissions?.ready ? "ready" : "")} />
            {!permissions ? t("Checking access…", "正在检测权限…") : permissions.ready ? t("Ready to hop", "随时跳转") : t("Access needed", "需要授权")}
          </div>
          <div className="sidebar-version"><span>BeaconHop</span><span>v{__APP_VERSION__}{preview ? " · Preview" : ""}</span></div>
        </div>
      </aside>
      <main className="settings-main">
        <header className="settings-toolbar">
          <div className="settings-breadcrumb"><span>{t("Settings", "设置")}</span><Icon name="chevron" size={12} /><strong>{current[2]}</strong></div>
          <SettingsSearch destinations={destinations} t={t} onNavigate={item => { setTab(item.page); setDestination(item); }} />
        </header>
        <div className="settings-scroll" ref={scrollArea}>
          <header className="page-header">
            <div><h1>{current[2]}</h1><p>{current[3]}</p></div>
            {tab === "general" ? <button className="button secondary try-hop" onClick={() => call("open_search").catch(e => setError(String(e)))}><Icon name="hop" size={15} />{t("Try a hop", "试着跳转")}</button> : <span className="page-icon"><Icon name={current[1]} size={24} /></span>}
          </header>
          {tab !== "system" && (needsAccess || needsPreviews) && <div className="permission-banner" role="alert">
            <div><strong>{needsAccess ? t("Allow access to start switching windows", "先完成授权，才能切换窗口") : t("Allow Screen Recording to see window previews", "开启屏幕录制，才能显示窗口缩略图")}</strong>
              <p>{needsAccess ? t("Global shortcuts are unavailable. You can still edit and save settings.", "当前全局快捷键不可用，仍可编辑和保存设置。") : t("Window switching is ready; previews still need access.", "窗口切换已就绪，缩略图还需要授权。")}</p></div>
            <button className="button secondary" onClick={() => setTab("system")}>{t("Set up access", "前往授权")}</button>
          </div>}
          {tab === "plugins" && <PluginStatus t={t} />}
          {tab === "general" && (
            <>
              <div className="plugin-welcome"><div><strong>{t("Connect your browser and editor", "连接浏览器和编辑器")}</strong><p>{t("Install application plugins to switch tabs with BeaconHop.", "安装应用插件，即可用 BeaconHop 切换标签页。")}</p></div><button className="button secondary" onClick={()=>setTab("plugins")}>{t("Set up plugins", "安装插件")}</button></div>
              <div className="hero">
                <div className="hero-copy"><span className="eyebrow">{t("A SHORTER PATH TO YOUR WORK", "从目标到行动，更少一步")}</span>
                  <h2>{t("Your next window. One hint away.", "一个提示，直达目标窗口。")}</h2>
                  <p>{t("Hold the shortcut. Type a hint. You’re there.", "按住快捷键，输入提示字符，即刻切换。")}</p>
                  <div className="hero-flow"><kbd>{shortcut(draft.holdShortcut)}</kbd><Icon name="arrow" size={14} /><kbd>{[...draft.hintAlphabet][0]?.replace(" ", "␣") || "A"}</kbd><Icon name="arrow" size={14} /><span><Icon name="windows" size={14} />{t("Your window", "目标窗口")}</span></div>
                </div>
                <div className="hero-window" aria-hidden="true"><div className="hero-window-bar"><i /><i /><i /></div><div className="hero-window-content"><div /><div /><kbd>{[...draft.hintAlphabet][0]?.replace(" ", "␣") || "A"}</kbd></div></div>
              </div>
              <section id="shortcut-settings" tabIndex={-1}>
                <h2>{t("Two ways to get there", "两种抵达方式")}</h2>
                {toggle(
                  "holdEnabled",
                  t("Hold to switch", "按住切换"),
                  t(
                    "Hold the modifier, then type a hint to jump immediately.",
                    "按住修饰键，输入屏幕提示字符后立即切换。",
                  ),
                )}
                <Setting
                  title={t("Hold shortcut", "按住模式快捷键")}
                  description={t(
                    `${shortcut(draft.holdShortcut)} cycles forward; ${shortcut(reverseShortcut(draft.holdShortcut))} cycles backward. Keep the modifiers held, then release to switch. Esc cancels and returns to the original window.`,
                    `${shortcut(draft.holdShortcut)} 正向循环；${shortcut(reverseShortcut(draft.holdShortcut))} 反向循环。保持修饰键按住，松开后切换到选中窗口。Esc 取消本次切换并返回原窗口。`,
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
                    "Open search directly. Type a title or application name. Esc cancels and returns to the original window.",
                    "直接打开搜索，可以松开快捷键，输入标题或应用名。Esc 取消本次切换并返回原窗口。",
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
              <HintCharacters value={draft} onChange={patch => { setDraft(old => ({...old, ...patch})); setNotice(""); setError(""); }} t={t} />
            </>
          )}
          {tab === "navigation" && <>
            <div className="layer-overview" aria-label={t("Four navigation layers", "四个导航层级")}>
              {([
                ["windows", t("All windows", "全部窗口"), draft.holdShortcut],
                ["windows", t("App windows", "应用窗口"), draft.applicationHoldShortcut],
                ["tabs", t("Tabs & sessions", "Tab 与会话"), draft.tabsHoldShortcut],
                ["desktop", t("Desktops", "桌面"), draft.desktopsHoldShortcut],
              ] as [IconName, string, string][]).map(([icon, title, keys], index) => <div className="layer-tile" key={title}><span className="layer-number">0{index + 1}</span><Icon name={icon} size={21} /><strong>{title}</strong><kbd>{shortcut(keys)}</kbd></div>)}
            </div>
            <section>
              <h2>{t("One gesture, four layers", "同一套手势，四个层级")}</h2>
              <p>{t("Each layer has its own hold and search shortcut. Hold to cycle through targets, or open search and type. Customize the application, tab and desktop layers below.", "每个层级都有独立的按住切换与搜索快捷键。按住时循环选择目标，或进入搜索后输入关键词。在下方配置应用、Tab 和桌面层级。")}</p>
              {([
                ["applicationEnabled", "applicationHoldShortcut", "applicationSearchShortcut", t("Application windows", "应用窗口")],
                ["tabsEnabled", "tabsHoldShortcut", "tabsSearchShortcut", t("Tabs & sessions", "Tab 与会话")],
                ["desktopsEnabled", "desktopsHoldShortcut", "desktopsSearchShortcut", t("Desktops", "桌面")],
              ] as const).map(([enabled, hold, search, label]) => <div className="layer-settings" key={enabled}>
                <Setting title={label} description={enabled === "tabsEnabled" ? t("Applications without a connected plugin keep their native shortcuts.", "未连接插件的应用保留原生快捷键。") : ""}>
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
              <h2>{t("Keep holding the last hint key", "继续按住最后一个 hint 键")}</h2>
              <p>{t("After a hint selects a target, keep its last key held and press a continuation key. BH and Screen Buoy start on that key press. In the next BH layer, you can use a new hint while the old keys remain held; releasing or holding those old keys will not select anything. Desktop hints open desktop-wide SB; the other layers open window-wide SB. Each action accepts multiple alternative keys; SB defaults to HintLeftKey or HintRightKey when enabled.", "用 hint 选中目标后，继续按住最后一键，再按任一后续键，立即进入 BH 下一层或接续 SB。进入 BH 新层后可直接输入新 hint，无需先松开旧键；旧键长按或松开不会误选。桌面 hint 进入桌面级 SB，其余层进入窗口级。每个动作可配置多个备选键；启用 SB 后，默认 HintLeftKey 或 HintRightKey 都可触发。")}</p>
              {([
                ["windowsHintKeys", t("Continue to windows", "继续进入窗口层")],
                ["applicationHintKeys", t("Continue to application windows", "继续进入应用窗口层")],
                ["tabsHintKeys", t("Continue to tabs", "继续进入 tab 层")],
              ] as const).map(([key,label]) => <Setting key={key} title={label}>
                <ContinuationKeys label={label} value={draft[key]} onChange={keys=>change(key,keys)} t={t} />
              </Setting>)}
              <p className="muted small">{t("Super = Win / Command. The Screen Buoy page controls its trigger and the physical neighbour map.", "Super = Win / Command。SB 触发键与物理邻键映射在 Screen Buoy 页面设置。")}</p>
            </section>
            <button className="button" onClick={()=>setTab("plugins")}>{t("Set up application plugins", "安装应用插件")}</button>
            <section><Setting title={t("Codex data folder", "Codex 数据目录")} description={t("Leave empty to use Codex’s default. This adapter lists recent sessions; it does not read full conversations. Session links cannot confirm which GUI tab is selected, so automatic continuation is disabled for Codex.", "留空使用 Codex 默认目录。适配器列出最近会话，不读取完整对话。会话链接无法确认 GUI 中的选中状态，因此 Codex 会话跳转后暂不自动接后续层。") }>
              <input aria-label={t("Codex data folder", "Codex 数据目录")} value={draft.codexHome} onChange={e=>change("codexHome",e.target.value)} />
            </Setting></section>
          </>}
          {tab === "screen-buoy" && <ScreenBuoyIntegration value={draft.screenBuoy} alphabet={draft.hintAlphabet} onChange={v => change("screenBuoy", v)} t={t} />}
          {tab === "scope" && (
            <>
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
              <section id="excluded-apps" tabIndex={-1}>
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
              <section id="switcher-settings" tabIndex={-1}>
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
              <section id="opacity-settings" tabIndex={-1}>
                <Setting title={t("Switcher background opacity", "切换面板背景不透明度")} description={t("Applies to the window overview opened by a shortcut. Lower values reveal more of the frosted desktop; thumbnails and hints stay clear. Save, then open the switcher to try it.", "控制快捷键唤起后的整个窗口总览背景。数值越低，毛玻璃透出越多；缩略图与 Hint 保持清晰。保存后唤起即可查看。") }>
                  <input aria-label={t("Switcher background opacity", "切换面板背景不透明度")} type="range" min={0} max={100} value={draft.panelOpacity} onChange={e => change("panelOpacity",Number(e.target.value))} /><output>{draft.panelOpacity}%</output>
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
              <section id="permissions-settings" tabIndex={-1}>
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
          <section id="updates-settings" tabIndex={-1} hidden={tab !== "system"}><Updates t={t} dirty={dirty} onBusy={setUpdateBusy} /></section>
          {tab === "about" && (
            <div className="about">
              <img src="/beaconhop.svg" alt="" />
              <h1>BeaconHop</h1>
              <p className="tagline">Follow the hint. Make the hop.</p>
              <p>
                {t(
                  "A little beacon for any window you want to reach.",
                  "想去哪个窗口，就循着提示抵达。",
                )}
              </p>
              <span className="badge">{__APP_VERSION__} · macOS & Windows</span>
              <button className="about-companion" onClick={() => setTab("screen-buoy")}><img src="/screen-buoy.png" alt="" /><span><strong>Screen Buoy</strong><small>{t("Continue inside desktops and windows", "在桌面或窗口内继续操作")}</small></span><Icon name="arrow" /></button>
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
        <footer className={"settings-footer " + (dirty ? "has-changes" : "")}>
          <span
            role={error ? "alert" : "status"}
            className={"save-status " + (error ? "error" : dirty ? "pending" : "muted")}
          ><Icon name={error ? "info" : dirty ? "info" : "check"} size={15} />
            {error ||
              notice ||
              (dirty
                ? t("Unsaved changes", "有未保存的修改")
                : t(
                    "All changes saved",
                    "所有更改已保存",
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
                setNotice("");
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
  const [inspected, setInspected] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const draftQuery = useRef<string | null>(null);
  const [stacked, setStacked] = useState(false);
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
    draftQuery.current = null;
    setStacked(false);
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
  const panel = session?.overview?.find(p => p.label === panelLabel);
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
  const tiles: {columns:number; tiles:(Tile | undefined)[]; regions?:DesktopAnchor[]} = useMemo(() => panel ? (() => {
    const all=desktopOverviewTiles(panel, localWindows, available.width, available.height, stacked, session?.spatialIds ?? [], session?.desktops);
    return {...all,tiles:visible.map(w=>all.tiles[localWindows.findIndex(a=>a.id===w.id)])};
  })() : desktopGrid ? (() => {
    const columns = Math.max(1, Math.min(3, visible.length, Math.floor(available.width / 260)));
    const width = Math.max(0, (available.width - (columns - 1) * 14) / columns);
    const height = width * 9 / 16 + 48;
    return {columns, tiles: visible.map((_,i) => ({x:(i % columns) * (width + 14), y:Math.floor(i / columns) * (height + 14), width, height, preview:height - 48, meta:48}))};
  })() : contentLayer && listLayout
    ? textRows(visible, available.width)
    : tileWindows(visible, available.width, available.height, listLayout, session?.layer === "tabs"), [session, available, listLayout, contentLayer, desktopGrid, stacked]);
  const desktopRegions = tiles.regions ?? [];
  const localSession = session ? {...session, windows: [...new Map([...localWindows, ...spatialWindows].map(w => [w.id,w])).values()]} : undefined;
  const images = usePreviews(localSession, participating && config.thumbnails && (!listLayout || !!panel) && (!!panel || contentLayer || !windowsNative));
  useEffect(()=>{ if ((panel || contentLayer) && session?.selected) document.getElementById("window-"+session.selected)?.scrollIntoView({block:"nearest"}); },[session?.selected,contentLayer,tiles]);
  useEffect(() => setInspected(null), [session?.sessionId, session?.selected]);
  const layerName = session?.layer === "tabs" ? t("Tabs & sessions", "Tab 与会话") : session?.layer === "desktops" ? t("Desktops", "桌面") : session?.layer === "application" ? t("Application windows", "应用窗口") : t("All windows", "全部窗口");
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
          <div className="switcher-context">BeaconHop <span>/</span> {panel ? panel.display.name || `${t("Display", "显示器")} ${(session?.overview?.indexOf(panel) ?? 0) + 1}` : isSearch ? layerName : t("Workspace navigation", "工作空间导航")}</div>
          {isSearch ? (
            <input
              ref={input}
              aria-label={contentLayer ? t("Search targets", "搜索目标") : t("Search windows", "搜索窗口")}
              disabled={session?.loading}
              placeholder={t("Title, app or Chinese pinyin / initials", "搜索标题、应用名、拼音或首字母") }
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
              <h1>{layerName}</h1>
              <p>
                {t("Type a hint to go there", "按下提示字符，直接抵达")}
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
          {visible.length} {contentLayer ? t("targets", "个目标") : t("windows", "个窗口")}
        </span>
        <button
          className="icon-button"
          aria-label={t("Close", "关闭")}
          onClick={() => action("cancel")}
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      {panel && (session?.overview?.length ?? 0) > 1 && <div className="display-route" aria-label={t("Display navigation order", "跨屏导航顺序")}>
        {session!.overview!.map((p, i) => <span key={p.display.id} className={p === selectedPanel ? "display-route-selected" : ""} aria-current={p === selectedPanel ? "true" : undefined}>
          {i > 0 && <span aria-hidden="true"> → </span>}{p === panel ? "● " : ""}{p.display.name || `${t("Display", "显示器")} ${i + 1}`}
        </span>)}
        <span className="display-route-target" role="status">{selectedPanel && selectedPanel !== panel ? t("Selected on ", "当前选中：") + (selectedPanel.display.name || selectedPanel.display.id) : ""}</span>
      </div>}
      {(error || session?.error) && (
        <div className="switcher-error" role="alert">
          {error || session?.error}
        </div>
      )}
      {!isSearch && visible.some(w => !w.hint) && <div className="switcher-warning">
        {t("Hint combinations are exhausted. Use arrows, search or click for windows without a hint, or add characters in Settings.", "Hint 组合已用完。无 Hint 的窗口可用方向键、搜索或点击选择，也可在设置中增加字符。")}
      </div>}
      {session?.warnings.map((w) => (
        <div className="switcher-warning" key={w}>
          {w}
        </div>
      ))}
      {panel && <div className="spatial-toolbar">
        <span>{desktopRegions.length > 1 ? t("Desktop areas follow window counts · ", "桌面按窗口数量分配空间 · ") : ""}{stacked ? t("Actual positions & front-to-back order", "真实位置与前后遮挡") : t("Expanded previews · positions adjusted to avoid overlap", "展开预览 · 位置经避让调整")}</span>
        <button className="spatial-toggle" title={t("Restore desktop positions, sizes and occlusion", "还原桌面位置、大小与遮挡")} aria-pressed={stacked} onClick={()=>setStacked(v=>!v)}>{t("Original stack", "原始堆叠")}</button>
      </div>}
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
        {desktopRegions.map(region => <div className={"desktop-anchor " + (region.desktop.current ? "current-desktop" : "")} key={region.desktop.id}
          data-desktop-id={region.desktop.id} style={{left:region.x+region.width/2+14,top:region.y+18,maxWidth:Math.max(1,region.width-16)}}>
          <div className="desktop-anchor-title"><strong>{region.desktop.id === "__unknown" ? t("Unknown desktop", "桌面归属未知") : region.desktop.label && zh ? `${region.desktop.label.fullScreen ? "全屏空间" : "桌面"} ${region.desktop.label.number}` : region.desktop.name}</strong>
            <span>{region.desktop.current ? t("Current · ", "当前 · ") : ""}{region.ids.length}</span></div>
        </div>)}
        {panel && !stacked && <WindowSpatialOverview windows={localWindows}
          highlighted={inspected ?? session?.selected ?? null} width={available.width} height={available.height}
          tile={tiles.tiles[visible.findIndex(w=>w.id===(inspected ?? session?.selected))]}
          zh={zh} />}
        {visible.map((w, index) => (
          <WindowCard
            key={`${session?.sessionId}:${w.id}`}
            window={w}
            image={images[w.id] ?? null}
            desktopPreview={desktopGrid ? session?.desktopPreviews?.[w.id] : undefined}
            desktopImages={images}
            tile={tiles.tiles[index]}
            depth={panel ? (session?.spatialIds?.includes(w.id) ? session.spatialIds.length - session.spatialIds.indexOf(w.id) : 1) : undefined}
            nativeStack={session?.spatialIds?.includes(w.id)}
            selected={w.id === session?.selected}
            departure={w.id === session?.origin?.id}
            hintStyle={config.hintStyle}
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
              {session?.loading ? t("Loading targets…", "正在读取目标…") : query
                ? (contentLayer ? t("No matching targets", "没有匹配的目标") : t("No matching windows", "没有匹配的窗口"))
                : (contentLayer ? t("No targets in this window", "当前窗口没有可切换目标") : t("Nothing in view yet", "暂时没有窗口"))}
            </h2>
            <p>
              {session?.loading ? t("Esc cancels", "按 Esc 取消") : contentLayer ? t("Check the plugin connection or try another search.", "检查插件连接，或换个搜索词。") : query
                ? t("Try another title or app name.", "试试其他标题或应用名。")
                : t(
                    "Open a window, or check your scope and Accessibility settings.",
                    "打开一个窗口，或检查范围设置与辅助功能权限。",
                  )}
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
              <span title={shortcut(layerHold)}>
                <kbd>{shortcut(layerHold.split("+").at(-1)!)}</kbd> {t("next", "正向")}
              </span>
              <span title={shortcut(reverseShortcut(layerHold))}>
                <kbd>Shift + {shortcut(layerHold.split("+").at(-1)!)}</kbd> {t("previous", "反向")}
              </span>
              <span>
                <kbd>{shortcut(config.searchEntryKey)}</kbd> {t("search", "搜索")}
              </span>
            </>
          )}
          <span>
            <kbd>Esc</kbd> {t("cancel & return", "取消并返回")}
          </span>
        </div>
      </footer>
    </div>
  );
}
function WindowCard({
  window: w,
  image,
  desktopPreview,
  desktopImages,
  tile,
  depth,
  nativeStack,
  selected,
  departure,
  thumbnails,
  textContent,
  hintStyle,
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
  tile?: Tile;
  depth?: number;
  nativeStack?: boolean;
  selected: boolean;
  departure: boolean;
  thumbnails: boolean;
  textContent: boolean;
  hintStyle: Config["hintStyle"];
  sessionId: number;
  search: boolean;
  onSelect: () => void;
  onInspect?: (id: string | null) => void;
  zh: boolean;
}) {
  const title = w.desktopTarget && zh && w.desktopLabel
    ? `${w.desktopLabel.fullScreen ? "全屏空间" : "桌面"} ${w.desktopLabel.number}` : w.title;
  const appName = w.desktopTarget ? (zh ? "桌面" : "Desktop") : w.appName;
  const previewArea = useRef<HTMLDivElement>(null);
  const element = useRef<HTMLButtonElement>(null);
  const previousTile = useRef<Tile>();
  useLayoutEffect(() => {
    const node=element.current, from=previousTile.current ?? tile?.origin;
    previousTile.current=tile;
    if(depth === undefined || !node || !tile || !from || !tile.width || !tile.height || matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    if(from.x===tile.x && from.y===tile.y && from.width===tile.width && from.height===tile.height)return;
    const animation=node.animate([
      {transformOrigin:"0 0",transform:`translate(${from.x-tile.x}px, ${from.y-tile.y}px) scale(${from.width/tile.width}, ${from.height/tile.height})`,filter:"brightness(.8)"},
      {transformOrigin:"0 0",transform:"none",filter:"brightness(1)"},
    ],{duration:320,easing:"cubic-bezier(.2,.7,.25,1)"});
    return ()=>animation.cancel();
  },[tile?.x,tile?.y,tile?.width,tile?.height,depth]);

  useEffect(() => {
    if (!windowsNative || w.content || !thumbnails || !previewArea.current) return;
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
      data-origin={departure || undefined}
      className={"window-card " + (depth !== undefined ? "spatial-card " : "") + (selected ? "selected " : "") + (departure ? "departure " : "") + (tile && tile.meta < 40 ? "dense" : "")}
      style={tile ? { zIndex: depth, left: tile.x + 14, top: tile.y + 14, width: tile.width, height: tile.height,
        "--tile-preview": `${tile.preview}px`, "--tile-meta": `${tile.meta}px`,
        "--hint-size": `${Math.max(8, Math.min(
          (tile.preview - 2 * hintStyle.borderWidth - 12) / 1.55,
          (tile.width - 2 * hintStyle.borderWidth - 12) / (w.hint.length * .65 + .96),
        ))}px`,
      } as CSSProperties : { visibility: "hidden" }}
      onClick={onSelect}
      onMouseEnter={() => onInspect?.(w.id)}
      onMouseLeave={() => onInspect?.(null)}
      title={[appName, title, w.content?.subtitle, w.content?.description].filter(Boolean).join(" — ")}
    >
      {depth !== undefined && <span className="spatial-depth" title={nativeStack ? (zh ? "原始堆叠层级，数字越大越靠前" : "Original stack order: higher numbers are nearer the front") : undefined} aria-hidden="true">{w.minimized ? (zh ? "最小化" : "Minimized") : w.hidden ? (zh ? "已隐藏" : "Hidden") : !nativeStack ? (zh ? "其他桌面" : "Other desktop") : `${zh ? "层" : "Layer "}${depth}`}</span>}
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
            <small>{w.content ? (zh ? "暂无预览" : "No preview") : appName}</small>
          </div>
        )}
        {!search && w.hint && <kbd className="window-hint hint-badge" style={hintVariables(hintStyle)}>{w.hint.replaceAll(" ", "␣")}</kbd>}
        {w.minimized && (
          <span className="window-state">{zh ? "最小化" : "Minimized"}</span>
        )}
      </div>
      <div className="window-meta">
        {w.icon ? (
          <img src={w.icon} alt="" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />
        ) : (
          <span className="app-initial">{(w.content ? title : appName).slice(0, 1)}</span>
        )}
        <div>
          <h2>{title}</h2>
          <p>
            {w.content?.subtitle || (w.desktopTarget && w.currentDesktop ? (zh ? "当前桌面" : "Current desktop") : appName)}
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
          {departure && <span className="departure-badge">{zh ? "出发窗口" : "Origin"}</span>}
          {selected && <span className="selection-badge">{zh ? "将切换" : "Selected"}</span>}
        </span>}
        {selected && <span className="selected-arrow"><Icon name="hop" size={16} /></span>}
      </div>
    </button>
  );
}
