import { useEffect, useRef, useState } from "react";
import { call } from "./api";
import { Icon } from "./Icons";

export type InstallationStatus = {
  edge: { detected:boolean; storeAvailable:boolean; canRepair:boolean; instances:number };
  vscode: { detected:boolean; name:string; installedVersion:string|null; bundledVersion:string; instances:number };
};
export function PluginSetup({status,t,refresh}:{status:InstallationStatus;t:(en:string,zh:string)=>string;refresh:()=>Promise<void>}) {
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
    <p>{t("Choose an application below. BeaconHop handles installation and connection; keep this page open to see when it is ready.","选择要连接的应用，BeaconHop 会完成安装配置，并在连接成功后更新状态。")}</p>
    <div className="plugin-install-cards">
      <article className="plugin-install-card" data-installer="edge" aria-busy={busy?.startsWith("edge")??false}>
        <div className="plugin-install-heading"><Icon name="browser" size={24}/><h3>Microsoft Edge</h3></div>
        <p>{t("Switch tabs in your browser window. Enable optional page previews in the extension after connecting.","快速切换浏览器窗口中的标签页。连接后，可在扩展中开启网页缩略图。")}</p>
        <ol><li>{t("Click Install and connect below","点击下方「安装并连接」")}</li><li>{t("Confirm Add extension in Edge","在 Edge 中确认「添加扩展」")}</li><li>{t("Return here to check the connection","返回这里查看连接结果")}</li></ol>
        <p className={"plugin-install-state "+(status.edge.instances>0?"good":"")} role="status">
          {connected(status.edge.instances) || (!status.edge.detected?t("Microsoft Edge was not detected","未检测到 Microsoft Edge"):!status.edge.storeAvailable?t("Store installation is not available yet","扩展尚未上架，暂不能从商店安装"):waiting.edge?t("Waiting for Edge to connect…","等待 Edge 连接…"):t("Ready to install","可以安装"))}
        </p>
        {status.edge.instances===0 && waiting.edge && <p className="small">{now-waiting.edge>75000?t("Not connected yet. Finish adding the extension in the Edge profile you use, then click its icon to reconnect. If Edge blocks it, check the Extensions page.","尚未连接。请在常用的 Edge 配置文件中完成添加扩展，然后点击扩展图标重新连接；如被禁用，请检查扩展页面。"):t("Connection is automatic after confirmation. An existing extension may take up to one minute to retry.","确认添加后会自动连接；已安装的扩展可能需要等待一分钟重试。")}</p>}
        <div className="plugin-install-actions">
          {status.edge.instances===0 && <button className="button secondary" disabled={!!busy || !status.edge.detected || !status.edge.storeAvailable} onClick={()=>void install("edge")}>{busy==="edge"?t("Opening Edge…","正在打开 Edge…"):waiting.edge?t("Open installation page again","重新打开安装页"):t("Install and connect","安装并连接")}</button>}
          {status.edge.canRepair && <button className="button" disabled={!!busy || !status.edge.detected} onClick={()=>void install("edge-repair")}>{busy==="edge-repair"?t("Repairing…","正在修复…"):t("Repair connection","修复连接")}</button>}
        </div>
      </article>
      <article className="plugin-install-card" data-installer="vscode" aria-busy={busy==="vscode"}>
        <div className="plugin-install-heading"><Icon name="code" size={24}/><h3>{status.vscode.name}</h3></div>
        <p>{t("Switch files, diffs and notebooks. The extension is included with BeaconHop; no separate download is needed.","切换文件、差异比较和笔记本。扩展已包含在 BeaconHop 安装包中，无需另外下载。")}</p>
        <ol><li>{t("Click One-click install below","点击下方「一键安装」")}</li><li>{t("Open VS Code and wait for the connection","打开 VS Code，等待自动连接")}</li></ol>
        <p className={"plugin-install-state "+(status.vscode.instances>0?"good":"")} role="status">
          {busy==="vscode"?t("Installing and verifying…","正在安装并验证…"):connected(status.vscode.instances) || (!status.vscode.detected?t("VS Code was not detected","未检测到 VS Code"):status.vscode.installedVersion || waiting.vscode?t("Installed · waiting for VS Code","已安装 · 等待 VS Code 连接"):t("Ready to install","可以安装"))}
        </p>
        <p className="small muted">{t("Installs into the default VS Code profile. If you use a different profile, enable BeaconHop Tabs in that profile's Extensions view.","安装到 VS Code 默认配置文件。如使用其他配置文件，请在其扩展页面启用 BeaconHop Tabs。")}</p>
        {status.vscode.instances===0 && (status.vscode.installedVersion || waiting.vscode) && <p className="small">{t("If it stays disconnected, enable BeaconHop Tabs in VS Code's Extensions view. Save your work before using Developer: Reload Window.","如果仍未连接，请在 VS Code 扩展页面启用 BeaconHop Tabs。需要执行「开发人员：重新加载窗口」时，请先保存工作。")}</p>}
        <div className="plugin-install-actions"><button className="button secondary" disabled={!!busy || !status.vscode.detected} onClick={()=>void install("vscode")}>{busy==="vscode"?t("Installing…","安装中…"):status.vscode.installedVersion?t("Check / update extension","检查 / 更新扩展"):t("One-click install","一键安装")}</button><span className="muted small">v{status.vscode.bundledVersion}</span></div>
      </article>
    </div>
    {error && <p role="alert">{error}</p>}
    <p className="small muted">{t("After connecting, return to the application and press Ctrl+Tab to switch tabs. If disabled below, enable the plugin first.","连接后回到目标应用，使用默认 Ctrl+Tab 切换标签页。如果下方插件已停用，请先启用。")}</p>
  </div>;
}
