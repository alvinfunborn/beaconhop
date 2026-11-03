import { useEffect, useRef, useState } from "react";
import { call } from "./api";
import type { ScreenBuoyConfig } from "./types";
import { defaultScreenBuoy, keyLabel, physicalHintKey, physicalKeys } from "./hintKeys";
import "./screenBuoy.css";
import { Icon } from "./Icons";

type Installation = { installed: boolean; compatible: boolean; path: string; platform: "macos" | "windows" };
type Connection = { version: string; permissions: { required: boolean; accessibility: boolean; keyboardHook: boolean; ready: boolean; appPath: string } };
type Download = { version: string; compatible: boolean };

export function ScreenBuoyIntegration({ value, alphabet, onChange, t }: {
  value: ScreenBuoyConfig; alphabet: string; onChange: (v: ScreenBuoyConfig) => void; t: (en: string, zh: string) => string;
}) {
  const [installation, setInstallation] = useState<Installation>();
  const [connection, setConnection] = useState<Connection>();
  const [download, setDownload] = useState<Download>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [extra, setExtra] = useState("Enter");
  const generation = useRef(0);
  const checkSequence = useRef(0);
  const mac = installation ? installation.platform === "macos" : navigator.platform.toLowerCase().includes("mac");
  const patch = (v: Partial<ScreenBuoyConfig>) => onChange({ ...value, ...v });
  async function detect() {
    const epoch = generation.current, sequence = ++checkSequence.current;
    try {
      const result = await call<Installation>("get_screen_buoy_status", { applicationPath: value.applicationPath });
      if (generation.current === epoch && checkSequence.current === sequence) {
        setInstallation(result);
        if (!result.compatible) setConnection(undefined);
      }
    } catch (e) { if (generation.current === epoch) setError(String(e)); }
  }
  useEffect(() => {
    generation.current++;
    setInstallation(undefined); setConnection(undefined); setBusy(""); setError(""); setNotice("");
    const timer = setTimeout(() => void detect(), 250);
    window.addEventListener("focus", detect);
    return () => { generation.current++; clearTimeout(timer); window.removeEventListener("focus", detect); };
  }, [value.applicationPath]);
  async function run(kind: string, operation: () => Promise<void>) {
    if (busy) return;
    const epoch = generation.current;
    setBusy(kind); setError(""); setNotice("");
    try { await operation(); }
    catch (e) { if (generation.current === epoch) setError(String(e)); }
    finally { if (generation.current === epoch) setBusy(""); }
  }
  async function connect(settings: boolean) {
    const epoch = generation.current;
    const result = await call<Connection>("connect_screen_buoy", { applicationPath: value.applicationPath, settings });
    if (generation.current === epoch) {
      setConnection(result);
      setNotice(settings ? t("Screen Buoy settings opened.", "已打开 SB 设置。") : "");
    }
  }
  async function downloadLatest() {
    const epoch = generation.current;
    const release = await call<Download>("get_screen_buoy_download");
    if (generation.current !== epoch) return;
    setDownload(release);
    if (release.compatible) {
      await call("open_screen_buoy_download", { tag: release.version });
      setNotice(t("Download opened in your browser. Install Screen Buoy, then check installation again.", "已在浏览器中打开下载。安装完成后，点击「重新检测安装」。"));
    }
  }
  const hintKeys = [...new Set([...alphabet].map(physicalHintKey))];
  const noNeighbour = hintKeys.filter(key => !value.keys.some(binding => {
    if (binding === "HintLeftKey") return !!value.neighbours[key]?.left;
    if (binding === "HintRightKey") return !!value.neighbours[key]?.right;
    return binding !== key;
  }));
  return <div className="sb-integration">
    <div className="companion-hero">
      <div className="companion-products"><div><img src="/beaconhop.svg" alt="" /><strong>BeaconHop</strong><span>{t("Reach your target", "抵达目标")}</span></div><Icon name="arrow" size={24} /><div><img src="/screen-buoy.png" alt="" /><strong>Screen Buoy</strong><span>{t("Act inside it", "操作目标区域")}</span></div></div>
      <div className="companion-caption"><Icon name="layers" size={15} />{t("Two apps. One continuous workflow.", "同系列工具，衔接每一步操作。")}</div>
    </div>
    <section className="integration-toggle">
      <div className="setting">
        <div><h3>{t("Enable Screen Buoy integration", "启用 Screen Buoy 集成")}</h3><p>{t("Continue from any navigation layer to controls on the selected desktop or window.", "从任意导航层继续操作所选桌面或窗口中的元素。")}</p></div>
        <button type="button" role="switch" aria-checked={value.enabled} aria-label={t("Enable Screen Buoy integration", "启用 Screen Buoy 集成")} className={"toggle " + (value.enabled ? "on" : "")} onClick={() => patch({ enabled: !value.enabled })}><span /></button>
      </div>
      <p className="muted">{t("Two independent apps. Enabling this option does not start SB. A gesture or connection check starts it when needed; its own settings control whether it stays running or launches at login. Turning this off does not quit SB.", "两个独立应用。打开此开关不会启动 SB；使用扩展手势或检查连接时才启动。SB 是否常驻、是否登录时启动，由 SB 自己管理。关闭集成不会退出 SB。")}</p>
    </section>

    <div className="integration-progress" aria-label={t("Integration setup status", "集成配置状态")}>
      <div><span className={installation?.compatible ? "step-state complete" : "step-state"}>{installation?.compatible ? <Icon name="check" size={14} /> : "1"}</span><span><strong>{t("Installation", "安装")}</strong><small>{!installation ? t("Checking…", "检测中…") : installation.compatible ? t("Compatible", "版本兼容") : installation.installed ? t("Update needed", "需要更新") : t("Not installed", "尚未安装")}</small></span></div>
      <div><span className={connection?.permissions.ready ? "step-state complete" : "step-state"}>{connection?.permissions.ready ? <Icon name="check" size={14} /> : "2"}</span><span><strong>{t("Connection & access", "连接与权限")}</strong><small>{!installation?.compatible ? t("Waiting for a compatible version", "等待兼容版本") : !connection ? t("Not checked", "尚未检查") : connection.permissions.ready ? t("Ready", "已就绪") : !connection.permissions.accessibility ? t("Access needed", "需要授权") : t("Keyboard listener pending", "键盘监听未就绪")}</small></span></div>
      <div><span className="step-state">3</span><span><strong>{t("Extension gesture", "扩展手势")}</strong><small>{t("Configure below", "在下方配置")}</small></span></div>
    </div>
    <section className="integration-step">
      <h2>{t("1 · Download and install", "1 · 下载与安装")}</h2>
      <p role="status">{!installation ? t("Checking installation…", "正在检测安装…") : !installation.installed ? t("Screen Buoy was not found.", "尚未找到 Screen Buoy。") : !installation.compatible ? t("Screen Buoy is installed, but this version needs an integration update.", "已安装 Screen Buoy，但此版本还不支持 BH 集成，需要更新。") : t("A compatible Screen Buoy installation was found.", "已找到支持 BH 集成的 Screen Buoy。")}</p>
      {installation?.path && <p className="app-path">{installation.path}</p>}
      <div className="sb-actions">
        <button className="button primary" disabled={!!busy} onClick={() => run("download", downloadLatest)}>{busy === "download" ? t("Checking release…", "正在检查版本…") : mac ? t("Download Screen Buoy for macOS", "下载 macOS 版 Screen Buoy") : t("Download Screen Buoy for Windows", "下载 Windows 版 Screen Buoy")}</button>
        <button className="button secondary" disabled={!!busy} onClick={() => run("detect", detect)}>{t("Check installation again", "重新检测安装")}</button>
        <button className="button ghost" disabled={!!busy} onClick={() => run("releases", () => call("open_screen_buoy_download", { tag: null }))}>{t("Official releases", "官方发布页")}</button>
      </div>
      {download && !download.compatible && <p className="sb-attention" role="status">{t(`The latest public release (${download.version}) does not support this integration yet. Download will become available here after a compatible release is published. You can also select a compatible local build below.`, `当前公开版本（${download.version}）尚不支持本次集成。支持版本发布后，这里才会提供下载；也可以在下方指定兼容的本地构建。`)}</p>}
      <details className="sb-install-guide" open={!installation?.compatible}><summary>{t("Installation guide", "安装说明")}</summary>
      <ol className="sb-steps">
        {mac ? <>
          <li>{t("Unzip the download and move ScreenBuoy.app to Applications before opening it.", "解压下载文件，将 ScreenBuoy.app 拖入「应用程序」后再打开。")}</li>
          <li>{t("When updating, quit the old Screen Buoy from its menu bar before replacing the app. Keep its existing settings.", "更新时先从菜单栏退出旧 SB，再替换应用，保留原有设置。")}</li>
          <li>{t("If macOS blocks a trusted download from the official release, use Privacy & Security → Open Anyway. Then return here to check installation.", "如果 macOS 拦截了你已确认来自官方发布页的下载，请到「隐私与安全性」中选择「仍要打开」，然后回到这里检测安装。")}</li>
        </> : <>
          <li>{t("Run the downloaded Windows installer and keep its default installation directory.", "运行下载的 Windows 安装程序，建议使用默认安装目录。")}</li>
          <li>{t("Quit an older running Screen Buoy before updating. For a portable ZIP, extract the entire archive and select screen-buoy.exe below.", "更新前先退出正在运行的旧 SB。若使用便携 ZIP，请完整解压，并在下方指定 screen-buoy.exe。")}</li>
          <li>{t("Return here and check installation again.", "安装完成后回到这里，重新检测安装。")}</li>
        </>}
      </ol></details>
      <details><summary>{t("Installed somewhere else?", "安装在其他位置？")}</summary>
        <label className="sb-path">{t("Screen Buoy application path", "Screen Buoy 应用路径")}<input aria-label={t("Screen Buoy application path", "Screen Buoy 应用路径")} disabled={!!busy} value={value.applicationPath} placeholder={mac ? "/Applications/ScreenBuoy.app" : "C:\\…\\screen-buoy.exe"} onChange={e => patch({ applicationPath: e.target.value })} /></label>
        <p className="muted small">{t("Leave empty for automatic detection. A custom path takes priority; no other copy will be started if it is missing.", "留空则自动检测。填写后仅使用此路径；路径不存在时不会启动其他副本。")}</p>
      </details>
    </section>

    <section className="integration-step">
      <h2>{t("2 · Connection & access", "2 · 连接与权限")}</h2>
      {!installation?.compatible ? <p>{installation?.installed
        ? t("Update SB to a compatible version first. This is a version mismatch; its permissions have not been checked.", "请先更新到兼容的 SB 版本。当前是版本不匹配，尚未检查权限。")
        : t("Install a compatible SB version before checking the connection.", "安装兼容的 SB 版本后，即可检查连接。")}</p>
        : !connection ? <p>{t("Check the connection to read SB’s current permissions and keyboard status. Existing access does not need to be granted again.", "点击检查连接，读取 SB 当前的权限和键盘状态。已经授予的权限无需重复开启。")}</p>
        : !connection.permissions.ready && <p>{!connection.permissions.accessibility
          ? t("SB reports that Accessibility access is missing. Enable it for the SB application shown below, then check again.", "SB 报告尚无辅助功能权限。请为下方路径对应的 SB 开启权限，再重新检查。")
          : t("Accessibility is granted, but SB’s keyboard listener is not ready. Restart SB, then check again.", "辅助功能已授权，但 SB 的键盘监听尚未就绪。请重启 SB，再重新检查。")}</p>}
      {installation?.compatible && !connection?.permissions.ready && <p className="muted small">{t("These buttons start SB if needed. Its permission status is independent of BeaconHop’s.", "以下按钮会按需启动 SB。SB 的权限状态与 BeaconHop 独立。")}</p>}
      <div className="sb-actions">
        <button className="button secondary" disabled={!!busy || !installation?.compatible} onClick={() => run("settings", () => connect(true))}>{t("Open Screen Buoy settings", "打开 SB 设置")}</button>
        <button className="button primary" disabled={!!busy || !installation?.compatible} onClick={() => run("connect", () => connect(false))}>{busy === "connect" ? t("Connecting…", "正在连接…") : t("Check connection and permissions", "检查连接与权限")}</button>
      </div>
      {connection && <div className={"sb-connection " + (connection.permissions.ready ? "ready" : "pending")} role="status">
        <p><strong>{t("Connected to SB", "已连接 SB")} {connection.version}</strong></p>
        <p>{connection.permissions.ready ? t("Permissions and keyboard input are ready.", "权限与键盘监听已就绪。") : !connection.permissions.accessibility ? t("Connected; Accessibility access is missing.", "已连接；缺少辅助功能权限。") : t("Connected; the keyboard listener is not ready.", "已连接；键盘监听尚未就绪。")}</p>
        {connection.permissions.required && <p>{t("Accessibility", "辅助功能")}: {connection.permissions.accessibility ? "✓" : t("Not granted", "未授权")}</p>}
        <p>{t("Keyboard listener", "键盘监听")}: {connection.permissions.keyboardHook ? "✓" : t("Not ready", "未就绪")}</p>
        {connection.permissions.appPath && <p className="app-path">{connection.permissions.appPath}</p>}
      </div>}
    </section>

    <section className="integration-step">
      <h2>{t("3 · Choose the extension gesture", "3 · 配置扩展手势")}</h2>
      <p>{t("After a desktop, window, application-window or tab hint, keep the last hint key held and press an extension key to open SB. Desktop hints open desktop-wide SB; the other three layers open SB inside the selected window. The held BH keys will not type into SB. Release the hint without an extension key for an ordinary jump.", "桌面、窗口、应用窗口、tab 四层 hint 均可接续 SB：保持最后一个 hint 键按住，再按扩展键即可。桌面 hint 进入桌面级 SB，其余三层进入目标窗口级 SB。仍按住的 BH 按键不会输入到 SB。不按扩展键，松开 hint 就是普通跳转。")}</p>
      <p className="muted small">{t("Desktop scope also works on an empty desktop. On macOS it covers the selected Space’s display; on Windows it covers all displays of that virtual desktop.", "空桌面也可进入桌面级 SB。macOS 覆盖所选 Space 所在的显示器；Windows 覆盖该虚拟桌面的所有显示器。")}</p>
      <div className="sb-keys">
        {["HintLeftKey", "HintRightKey"].map(key => <label key={key}><input type="checkbox" checked={value.keys.includes(key)} onChange={e => patch({ keys: e.target.checked ? [...value.keys, key] : value.keys.filter(k => k !== key) })} />{key} · {key === "HintLeftKey" ? t("Left neighbour", "左邻键") : t("Right neighbour", "右邻键")}</label>)}
      </div>
      <p className="muted small">{t("Both neighbours are enabled by default. Any selected key opens SB; you do not need to press them together. For example, while holding J, press H or K. These keys still work as normal hint characters.", "默认左右邻键都可进入 SB；任意一个已选键即可触发，无需同时按下。例如保持 J 按住时，按 H 或 K 均可。这些键仍可正常用于输入 hint。")}</p>
      <div className="sb-actions">
        <select aria-label={t("Additional extension key", "其他扩展键")} value={extra} onChange={e => setExtra(e.target.value)}>{physicalKeys.map(key => <option key={key} value={key}>{keyLabel(key)}</option>)}</select>
        <button className="button secondary" disabled={value.keys.includes(extra)} onClick={() => patch({ keys: [...value.keys, extra] })}>{t("Add key", "添加按键")}</button>
        {value.keys.filter(key => !key.startsWith("Hint")).map(key => <button key={key} className="button ghost" aria-label={t(`Remove ${key}`, `移除 ${key}`)} onClick={() => patch({ keys: value.keys.filter(k => k !== key) })}>{keyLabel(key)} ×</button>)}
      </div>
      {value.enabled && !value.keys.length && <p className="error" role="alert">{t("Select at least one extension key before saving.", "请至少选择一个扩展键，再保存设置。")}</p>}
      {value.keys.length > 0 && noNeighbour.length > 0 && <p className="sb-attention">{t(`No extension key for ${noNeighbour.map(keyLabel).join(", ")}. Add a fixed key or edit the neighbours below.`, `${noNeighbour.map(keyLabel).join("、")} 尚无可用扩展键，请添加固定按键或修改下方邻键映射。`)}</p>}
      <details><summary>{t("Left / right mapping for the current hint alphabet", "当前 hint 字符集的左右键映射")}</summary>
        <p className="muted small">{t("Mappings follow physical keys, including punctuation. Shifted symbols use the same key: ? shares /, ! shares 1. Space and row edges can be assigned manually. Escape always cancels.", "按物理键映射，支持标点；? 与 / 共用一个键，! 与 1 共用一个键。空格和行首、行尾可手动指定邻键。Esc 始终用于取消。")}</p>
        <table className="sb-neighbours"><thead><tr><th>{t("Hint key", "Hint 键")}</th><th>HintLeftKey</th><th>HintRightKey</th></tr></thead><tbody>{hintKeys.map(key => <tr key={key}><td><kbd>{keyLabel(key)}</kbd></td>{(["left", "right"] as const).map(side => <td key={side}><select aria-label={`${key} ${side}`} value={value.neighbours[key]?.[side] ?? ""} onChange={e => patch({ neighbours: { ...value.neighbours, [key]: { ...(value.neighbours[key] ?? { left: null, right: null }), [side]: e.target.value || null } } })}>
          <option value="">{t("None", "无")}</option>{physicalKeys.filter(k => k !== key).map(k => <option key={k} value={k}>{keyLabel(k)}</option>)}
        </select></td>)}</tr>)}</tbody></table>
        <button className="button ghost" onClick={() => patch({ neighbours: defaultScreenBuoy().neighbours })}>{t("Reset neighbour mapping", "恢复默认邻键映射")}</button>
      </details>
      <p className="muted small">{t("Save changes below, then try the gesture on another window. A successful connection check confirms SB is reachable; the gesture tests window hints.", "在下方保存设置后，切换到另一个窗口试用手势。连接检查用于确认 SB 可连接；实际窗口提示请通过手势验证。")}</p>
    </section>
    {(error || notice) && <p className={error ? "error sb-feedback" : "sb-feedback"} role={error ? "alert" : "status"}>{error || notice}</p>}
  </div>;
}
