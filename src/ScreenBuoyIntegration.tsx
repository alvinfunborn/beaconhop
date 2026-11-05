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
  value: ScreenBuoyConfig; alphabet: string; onChange: (v: ScreenBuoyConfig) => void; t: (en: string, zh?: string) => string;
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
      setNotice(settings ? t("Screen Buoy settings opened.") : "");
    }
  }
  async function downloadLatest() {
    const epoch = generation.current;
    const release = await call<Download>("get_screen_buoy_download");
    if (generation.current !== epoch) return;
    setDownload(release);
    if (release.compatible) {
      await call("open_screen_buoy_download", { tag: release.version });
      setNotice(t("Download opened in your browser. Install Screen Buoy, then check installation again."));
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
      <div className="companion-products"><div><img src="/beaconhop.svg" alt="" /><strong>BeaconHop</strong><span>{t("Reach your target")}</span></div><Icon name="arrow" size={24} /><div><img src="/screen-buoy.png" alt="" /><strong>Screen Buoy</strong><span>{t("Act inside it")}</span></div></div>

    </div>
    <section className="integration-toggle">
      <div className="setting">
        <div><h3>{t("Enable Screen Buoy integration")}</h3><p>{t("Continue from any navigation layer to controls on the selected desktop or window.")}</p></div>
        <button type="button" role="switch" aria-checked={value.enabled} aria-label={t("Enable Screen Buoy integration")} className={"toggle " + (value.enabled ? "on" : "")} onClick={() => patch({ enabled: !value.enabled })}><span /></button>
      </div>
      <p className="muted">{t("Gestures start SB when needed. Its startup settings are separate.")}</p>
    </section>

    <div className="integration-progress" aria-label={t("Integration setup status")}>
      <div><span className={installation?.compatible ? "step-state complete" : "step-state"}>{installation?.compatible ? <Icon name="check" size={14} /> : "1"}</span><span><strong>{t("Installation")}</strong><small>{!installation ? t("Checking…", "检测中…") : installation.compatible ? t("Compatible") : installation.installed ? t("Update needed") : t("Not installed")}</small></span></div>
      <div><span className={connection?.permissions.ready ? "step-state complete" : "step-state"}>{connection?.permissions.ready ? <Icon name="check" size={14} /> : "2"}</span><span><strong>{t("Connection & access")}</strong><small>{!installation?.compatible ? t("Waiting for a compatible version") : !connection ? t("Not checked") : connection.permissions.ready ? t("Ready") : !connection.permissions.accessibility ? t("Access needed") : t("Keyboard listener pending")}</small></span></div>
      <div><span className="step-state">3</span><span><strong>{t("Extension gesture")}</strong><small>{t("Configure below")}</small></span></div>
    </div>
    <section className="integration-step">
      <h2>{t("1 · Download and install")}</h2>
      <p role="status">{!installation ? t("Checking installation…") : !installation.installed ? t("Screen Buoy was not found.") : !installation.compatible ? t("Screen Buoy is installed, but this version needs an integration update.") : t("A compatible Screen Buoy installation was found.")}</p>
      {installation?.path && <p className="app-path">{installation.path}</p>}
      <div className="sb-actions">
        <button className="button primary" disabled={!!busy} onClick={() => run("download", downloadLatest)}>{busy === "download" ? t("Checking release…") : mac ? t("Download Screen Buoy for macOS") : t("Download Screen Buoy for Windows")}</button>
        <button className="button secondary" disabled={!!busy} onClick={() => run("detect", detect)}>{t("Check installation again")}</button>
        <button className="button ghost" disabled={!!busy} onClick={() => run("releases", () => call("open_screen_buoy_download", { tag: null }))}>{t("Official releases")}</button>
      </div>
      {download && !download.compatible && <p className="sb-attention" role="status">{t(`The latest public release (${download.version}) does not support this integration yet. Download will become available here after a compatible release is published. You can also select a compatible local build below.`, `当前公开版本（${download.version}）尚不支持本次集成。支持版本发布后，这里才会提供下载；也可以在下方指定兼容的本地构建。`)}</p>}
      <details className="sb-install-guide" open={!installation?.compatible}><summary>{t("Installation guide")}</summary>
      <ol className="sb-steps">
        {mac ? <>
          <li>{t("Unzip the download and move ScreenBuoy.app to Applications before opening it.")}</li>
          <li>{t("When updating, quit the old Screen Buoy from its menu bar before replacing the app. Keep its existing settings.")}</li>
          <li>{t("If macOS blocks a trusted download from the official release, use Privacy & Security → Open Anyway. Then return here to check installation.")}</li>
        </> : <>
          <li>{t("Run the downloaded Windows installer and keep its default installation directory.")}</li>
          <li>{t("Quit an older running Screen Buoy before updating. For a portable ZIP, extract the entire archive and select screen-buoy.exe below.")}</li>
          <li>{t("Return here and check installation again.")}</li>
        </>}
      </ol></details>
      <details><summary>{t("Installed somewhere else?")}</summary>
        <label className="sb-path">{t("Screen Buoy application path")}<input aria-label={t("Screen Buoy application path")} disabled={!!busy} value={value.applicationPath} placeholder={mac ? "/Applications/ScreenBuoy.app" : "C:\\…\\screen-buoy.exe"} onChange={e => patch({ applicationPath: e.target.value })} /></label>
        <p className="muted small">{t("Leave empty for automatic detection. A custom path takes priority; no other copy will be started if it is missing.")}</p>
      </details>
    </section>

    <section className="integration-step">
      <h2>{t("2 · Connection & access")}</h2>
      {!installation?.compatible ? <p>{installation?.installed
        ? t("Update SB to a compatible version first. This is a version mismatch; its permissions have not been checked.")
        : t("Install a compatible SB version before checking the connection.")}</p>
        : !connection ? <p>{t("Check SB’s connection and permissions.")}</p>
        : !connection.permissions.ready && <p>{!connection.permissions.accessibility
          ? t("SB reports that Accessibility access is missing. Enable it for the SB application shown below, then check again.")
          : t("Accessibility is granted, but SB’s keyboard listener is not ready. Restart SB, then check again.")}</p>}

      <div className="sb-actions">
        <button className="button secondary" disabled={!!busy || !installation?.compatible} onClick={() => run("settings", () => connect(true))}>{t("Open Screen Buoy settings")}</button>
        <button className="button primary" disabled={!!busy || !installation?.compatible} onClick={() => run("connect", () => connect(false))}>{busy === "connect" ? t("Connecting…") : t("Check connection and permissions")}</button>
      </div>
      {connection && <div className={"sb-connection " + (connection.permissions.ready ? "ready" : "pending")} role="status">
        <p><strong>{t("Connected to SB")} {connection.version}</strong></p>
        <p>{connection.permissions.ready ? t("Permissions and keyboard input are ready.") : !connection.permissions.accessibility ? t("Connected; Accessibility access is missing.") : t("Connected; the keyboard listener is not ready.")}</p>
        {connection.permissions.required && <p>{t("Accessibility")}: {connection.permissions.accessibility ? "✓" : t("Not granted")}</p>}
        <p>{t("Keyboard listener")}: {connection.permissions.keyboardHook ? "✓" : t("Not ready")}</p>
        {connection.permissions.appPath && <p className="app-path">{connection.permissions.appPath}</p>}
      </div>}
    </section>

    <section className="integration-step">
      <h2>{t("3 · Choose the extension gesture")}</h2>
      <p>{t("Hold the last hint key, then press an extension key. Desktop hints open desktop controls; other hints open window controls.")}</p>

      <div className="sb-keys">
        {["HintLeftKey", "HintRightKey"].map(key => <label key={key}><input type="checkbox" checked={value.keys.includes(key)} onChange={e => patch({ keys: e.target.checked ? [...value.keys, key] : value.keys.filter(k => k !== key) })} />{key} · {key === "HintLeftKey" ? t("Left neighbour") : t("Right neighbour")}</label>)}
      </div>
      <p className="muted small">{t("Example: hold J, then press H or K.")}</p>
      <div className="sb-actions">
        <select aria-label={t("Additional extension key")} value={extra} onChange={e => setExtra(e.target.value)}>{physicalKeys.map(key => <option key={key} value={key}>{keyLabel(key)}</option>)}</select>
        <button className="button secondary" disabled={value.keys.includes(extra)} onClick={() => patch({ keys: [...value.keys, extra] })}>{t("Add key")}</button>
        {value.keys.filter(key => !key.startsWith("Hint")).map(key => <button key={key} className="button ghost" aria-label={t(`Remove ${key}`, `移除 ${key}`)} onClick={() => patch({ keys: value.keys.filter(k => k !== key) })}>{keyLabel(key)} ×</button>)}
      </div>
      {value.enabled && !value.keys.length && <p className="error" role="alert">{t("Select at least one extension key before saving.")}</p>}
      {value.keys.length > 0 && noNeighbour.length > 0 && <p className="sb-attention">{t(`No extension key for ${noNeighbour.map(keyLabel).join(", ")}. Add a fixed key or edit the neighbours below.`, `${noNeighbour.map(keyLabel).join("、")} 尚无可用扩展键，请添加固定按键或修改下方邻键映射。`)}</p>}
      <details><summary>{t("Left / right mapping for the current hint alphabet")}</summary>
        <p className="muted small">{t("Mappings follow physical keys, including punctuation. Shifted symbols use the same key: ? shares /, ! shares 1. Space and row edges can be assigned manually. Escape always cancels.")}</p>
        <table className="sb-neighbours"><thead><tr><th>{t("Hint key")}</th><th>HintLeftKey</th><th>HintRightKey</th></tr></thead><tbody>{hintKeys.map(key => <tr key={key}><td><kbd>{keyLabel(key)}</kbd></td>{(["left", "right"] as const).map(side => <td key={side}><select aria-label={`${key} ${side}`} value={value.neighbours[key]?.[side] ?? ""} onChange={e => patch({ neighbours: { ...value.neighbours, [key]: { ...(value.neighbours[key] ?? { left: null, right: null }), [side]: e.target.value || null } } })}>
          <option value="">{t("None")}</option>{physicalKeys.filter(k => k !== key).map(k => <option key={k} value={k}>{keyLabel(k)}</option>)}
        </select></td>)}</tr>)}</tbody></table>
        <button className="button ghost" onClick={() => patch({ neighbours: defaultScreenBuoy().neighbours })}>{t("Reset neighbour mapping")}</button>
      </details>

    </section>
    {(error || notice) && <p className={error ? "error sb-feedback" : "sb-feedback"} role={error ? "alert" : "status"}>{error || notice}</p>}
  </div>;
}
