import { useEffect, useRef, useState } from "react";
import { call } from "./api";
import { Icon, type IconName } from "./Icons";
import { PluginSetup, type InstallationStatus } from "./PluginSetup";
export type PluginEntry = {provider:string;name:string;description:string;versions:string[];enabled:boolean;connected:boolean;instances:number;registered:boolean;builtin:boolean;capabilities:string[]};
type Status = {entries:PluginEntry[];invalidManifests:number};
export function PluginStatus({t}:{t:(en:string,zh:string)=>string}) {
  const [status,setStatus]=useState<Status>();
  const [installation,setInstallation]=useState<InstallationStatus>();
  const [pollError,setPollError]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const [browser,setBrowser]=useState("edge");
  const [extensionId,setExtensionId]=useState("");
  const alive=useRef(true);
  const generation=useRef(0);
  const file=useRef<HTMLInputElement>(null);
  async function refresh() {
    const current=++generation.current;
    try { const [result,setup]=await Promise.all([call<Status>("get_plugin_status"),call<InstallationStatus>("get_plugin_installation")]); if(alive.current && current===generation.current){setStatus(result);setInstallation(setup);setPollError("");} }
    catch(e){if(alive.current && current===generation.current)setPollError(String(e));}
  }
  useEffect(()=>{
    alive.current=true;void refresh();const timer=setInterval(()=>void refresh(),5000);
    return ()=>{alive.current=false;clearInterval(timer);};
  },[]);
  async function action(work:()=>Promise<unknown>,message="") {
    setBusy(true);setError("");setNotice("");++generation.current;
    try { await work(); if(alive.current){setNotice(message);await refresh();} }
    catch(e){if(alive.current)setError(String(e));}
    finally {if(alive.current)setBusy(false);}
  }
  const iconFor=(id:string):IconName=>({browser:"browser",vscode:"code",codex:"terminal"} as Record<string,IconName>)[id] ?? "tabs";
  return <section id="plugin-settings" tabIndex={-1} className="plugin-settings">
    {installation && !pollError && <PluginSetup status={installation} t={t} refresh={refresh}/>}
    <h2>{t("Plugin connections", "插件连接")}</h2>
    <p>{t("Installed application extensions connect automatically. Enable or disable their use in BeaconHop here; changes apply immediately.", "应用扩展安装后自动连接。在这里启用或停用 BeaconHop 对它们的使用，立即生效。")}</p>
    {(error || pollError) && <p role="alert">{error || pollError}</p>}
    {notice && <p role="status">{notice}</p>}
    {!status && <p>{t("Checking…","检测中…")}</p>}
    {status?.entries.map(plugin=>{
      const label=plugin.provider==="browser" ? t("Browser","浏览器") : plugin.name;
      return <div className="setting plugin-row" key={plugin.provider} data-provider={plugin.provider}>
        <div className="plugin-identity"><span className="plugin-icon"><Icon name={iconFor(plugin.provider)} size={20}/></span><div>
          <h3>{label}{plugin.versions.length>0 && <small className="muted"> {plugin.versions.join(" / ")}</small>}</h3>
          <p>{plugin.description || plugin.provider}</p>
          {plugin.instances>0 && <p className="muted small">{plugin.instances} {t("connected instances","个已连接实例")}{plugin.capabilities.includes("thumbnails") ? ` · ${t("Previews supported","支持缩略图")}` : ""}</p>}
        </div></div>
        <div className="plugin-actions"><span className={"badge "+(!pollError && plugin.enabled && plugin.connected?"good":"")}>
          {pollError?t("Status unavailable","状态暂不可用"):!plugin.enabled?t("Disabled","已停用"):plugin.connected?t("Available","可用"):t("Extension not connected","未连接扩展")}
        </span><label className="plugin-toggle"><input type="checkbox" checked={plugin.enabled} disabled={busy || !!pollError} aria-label={`${t("Enable","启用")} ${label}`} onChange={e=>void action(()=>call("set_plugin_enabled",{provider:plugin.provider,enabled:e.target.checked}))}/>{t("Enabled","启用")}</label>
        {!plugin.builtin && plugin.registered && !plugin.connected && <button className="button" disabled={busy} onClick={()=>void action(()=>call("forget_plugin",{provider:plugin.provider}))}>{t("Remove record","移除记录")}</button>}</div>
      </div>;
    })}
    {!!status?.invalidManifests && <p role="alert">{t("Some plugin records could not be read. Re-import their manifest files.","部分插件记录无法读取，请重新导入插件信息文件。")}</p>}
    <details className="plugin-setup"><summary>{t("Advanced: connect a development browser extension","高级：连接开发版浏览器扩展")}</summary>
      <p>{t("Load the BeaconHop browser extension, copy its ID from the browser's Extensions page, then register it below. Click the extension to reconnect.","加载 BeaconHop 浏览器扩展，从浏览器的扩展页面复制 ID，在下面注册，然后点击扩展重新连接。")}</p>
      <div className="plugin-install-row"><select aria-label={t("Browser","浏览器")} value={browser} onChange={e=>setBrowser(e.target.value)}><option value="edge">Edge</option><option value="chrome">Chrome</option><option value="chromium">Chromium</option><option value="brave">Brave</option></select>
        <input aria-label={t("Extension ID","扩展 ID")} placeholder={t("32-letter extension ID","32 位扩展 ID")} value={extensionId} onChange={e=>setExtensionId(e.target.value.trim())} spellCheck={false} maxLength={32}/>
        <button className="button" disabled={busy || !/^[a-p]{32}$/.test(extensionId)} onClick={()=>void action(()=>call("register_browser_host",{browser,extensionId}),t("Registered. Click the browser extension to reconnect.","注册完成，请点击浏览器扩展重新连接。"))}>{t("Register","注册")}</button>
      </div>
    </details>
    <details className="plugin-setup"><summary>{t("Add another plugin","添加其他插件")}</summary>
      <p>{t("Install the author's application extension first. Compatible adapters appear automatically when the application starts. You can also import beaconhop.plugin.json to keep an offline record; importing information does not install or run the extension.","先安装作者提供的应用扩展，兼容的适配器会在应用启动后自动出现。也可以导入 beaconhop.plugin.json 保留离线记录；导入信息不会安装或运行扩展。")}</p>
      <input ref={file} type="file" accept=".json,application/json" hidden aria-label={t("Plugin manifest","插件信息文件")} onChange={e=>{
        const selected=e.target.files?.[0];e.target.value="";if(!selected)return;
        void action(async()=>{if(selected.size>8192)throw Error(t("Manifest must be smaller than 8 KiB","插件信息文件须小于 8 KiB"));return call("register_plugin_manifest",{manifest:JSON.parse(await selected.text())});});
      }}/>
      <button className="button" disabled={busy} onClick={()=>file.current?.click()}>{t("Import plugin information","导入插件信息")}</button>
    </details>
  </section>;
}
