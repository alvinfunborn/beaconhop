import { useEffect, useRef, useState } from "react";
import { call } from "./api";
import { Icon } from "./Icons";

export type InstallationStatus = {
  edge: { detected:boolean; storeAvailable:boolean; canRepair:boolean; instances:number };
  vscode: { detected:boolean; name:string; installedVersion:string|null; bundledVersion:string; instances:number };
};
export function PluginSetup({status,t,refresh}:{status:InstallationStatus;t:(en:string,zh?:string)=>string;refresh:()=>Promise<void>}) {
  const [busy,setBusy]=useState<string>();
  const [error,setError]=useState("");
  const [waiting,setWaiting]=useState<Record<string,number>>({});
  const [now,setNow]=useState(Date.now());
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>{mounted.current=false;clearInterval(timer);};},[]);
  async function install(target:string) {
    if(busy)return;
    setBusy(target);setError("");
    try {
      await call("install_application_plugin",{target});
      if(mounted.current){setWaiting(old=>({...old,[target.startsWith("edge")?"edge":"vscode"]:Date.now()}));await refresh();}
    } catch(e){if(mounted.current)setError(String(e));}
    finally{if(mounted.current)setBusy(undefined);}
  }
  const connected=(count:number)=>count>0?t(`Connected · ${count} instance${count===1?"":"s"}`,`已连接 · ${count} 个实例`):"";
  return <div className="plugin-onboarding">

    <div className="plugin-install-cards">
      <article className="plugin-install-card" data-installer="edge" aria-busy={busy?.startsWith("edge")??false}>
        <div className="plugin-install-heading"><Icon name="browser" size={24}/><h3>Microsoft Edge</h3></div>
        <p>{t("Browser tabs. Enable previews in the extension.")}</p>

        <p className={"plugin-install-state "+(status.edge.instances>0?"good":"")} role="status">
          {connected(status.edge.instances) || (!status.edge.detected?t("Microsoft Edge was not detected"):!status.edge.storeAvailable?t("Store installation is not available yet"):waiting.edge?t("Waiting for Edge to connect…"):t("Ready to install"))}
        </p>
        {status.edge.instances===0 && waiting.edge && <p className="small">{now-waiting.edge>75000?t("Not connected yet. Finish adding the extension in the Edge profile you use, then click its icon to reconnect. If Edge blocks it, check the Extensions page."):t("Connection is automatic after confirmation. An existing extension may take up to one minute to retry.")}</p>}
        <div className="plugin-install-actions">
          {status.edge.instances===0 && <button className="button secondary" disabled={!!busy || !status.edge.detected || !status.edge.storeAvailable} onClick={()=>void install("edge")}>{busy==="edge"?t("Opening Edge…"):waiting.edge?t("Open installation page again"):t("Install and connect")}</button>}
          {status.edge.canRepair && <button className="button" disabled={!!busy || !status.edge.detected} onClick={()=>void install("edge-repair")}>{busy==="edge-repair"?t("Repairing…"):t("Repair connection")}</button>}
        </div>
      </article>
      <article className="plugin-install-card" data-installer="vscode" aria-busy={busy==="vscode"}>
        <div className="plugin-install-heading"><Icon name="code" size={24}/><h3>{status.vscode.name}</h3></div>
        <p>{t("Files, diffs and notebooks.")}</p>

        <p className={"plugin-install-state "+(status.vscode.instances>0?"good":"")} role="status">
          {busy==="vscode"?t("Installing and verifying…"):connected(status.vscode.instances) || (!status.vscode.detected?t("VS Code was not detected"):status.vscode.installedVersion || waiting.vscode?t("Installed · waiting for VS Code"):t("Ready to install"))}
        </p>
        <p className="small muted">{t("Other profiles: enable BeaconHop Tabs in Extensions.")}</p>
        {status.vscode.instances===0 && (status.vscode.installedVersion || waiting.vscode) && <p className="small">{t("If it stays disconnected, enable BeaconHop Tabs in VS Code's Extensions view. Save your work before using Developer: Reload Window.")}</p>}
        <div className="plugin-install-actions"><button className="button secondary" disabled={!!busy || !status.vscode.detected} onClick={()=>void install("vscode")}>{busy==="vscode"?t("Installing…","安装中…"):status.vscode.installedVersion?t("Check / update extension"):t("One-click install")}</button><span className="muted small">v{status.vscode.bundledVersion}</span></div>
      </article>
    </div>
    {error && <p role="alert">{error}</p>}

  </div>;
}
