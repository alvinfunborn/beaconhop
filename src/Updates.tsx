import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { call, native } from "./api";

interface Release {
  currentVersion: string;
  published: boolean;
  version: string;
  notes: string;
  newer: boolean;
  canInstall: boolean;
}
type Phase = "idle" | "checking" | "unpublished" | "latest" | "available" | "downloading" | "installing" | "ready" | "error";
type Translate = (en: string, zh?: string) => string;

export function Updates({ t, dirty, onBusy }: { t: Translate; dirty: boolean; onBusy: (value: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [release, setRelease] = useState<Release>();
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number>();
  const candidate = useRef<Update>();
  const busy = useRef(false);
  const mounted = useRef(false);
  const working = ["checking", "downloading", "installing"].includes(phase);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (!busy.current) void candidate.current?.close().catch(() => {});
    };
  }, []);
  const lock = (value: boolean) => { busy.current = value; onBusy(value); };
  async function discover() {
    if (busy.current || phase === "ready") return;
    lock(true); setPhase("checking"); setError(""); setRelease(undefined);
    try {
      await candidate.current?.close(); candidate.current = undefined;
      const latest = await call<Release>("get_release_status");
      if (latest.newer && latest.canInstall) {
        const found = native ? await check({ timeout: 15000 }) : await call<Update | null>("preview_update_check");
        if (!found || found.version !== latest.version) {
          await found?.close();
          throw new Error(t("The release changed while checking. Please check again."));
        }
        candidate.current = found;
        latest.notes = found.body || latest.notes;
      }
      if (mounted.current) {
        setRelease(latest);
        setPhase(!latest.published ? "unpublished" : latest.newer ? "available" : "latest");
      }
    } catch (cause) {
      if (mounted.current) { setError(String(cause)); setPhase("error"); }
    } finally {
      lock(false);
      if (!mounted.current) void candidate.current?.close().catch(() => {});
    }
  }
  async function install() {
    if (busy.current || !candidate.current || dirty) return;
    lock(true); setPhase("downloading"); setError(""); setProgress(undefined);
    let downloaded = 0, total: number | undefined;
    try {
      await candidate.current.download(event => {
        if (event.event === "Started") total = event.data.contentLength;
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (mounted.current && total) setProgress(Math.min(100, Math.floor(downloaded / total * 100)));
        }
      }, { timeout: 120000 });
      if (mounted.current) setPhase("installing");
      await candidate.current.install();
      if (mounted.current) setPhase("ready");
    } catch (cause) {
      if (mounted.current) { setError(String(cause)); setPhase("error"); }
    } finally {
      await candidate.current?.close().catch(() => {}); candidate.current = undefined;
      lock(false);
    }
  }
  return <div className="app-updates">
    <h2>{t("App updates")}</h2>

    <div className="update-actions">
      <span>{t("Current version")} {release?.currentVersion ?? __APP_VERSION__}</span>
      {phase !== "ready" && <button className="button secondary" disabled={working} onClick={() => void discover()}>{t("Check for updates")}</button>}
      <button className="button ghost" disabled={working} onClick={() => call("open_releases_page").catch(e => setError(String(e)))}>{t("Release page")}</button>
    </div>
    <div role={phase === "idle" ? undefined : "status"} aria-live="polite">
      {phase === "checking" && t("Checking…", "正在检查…")}
      {phase === "unpublished" && t("No public release is available yet, or the update source is private.")}
      {phase === "latest" && t("You’re up to date.")}
      {phase === "available" && release && <>
        <p>{t("New version available")} {release.version}</p>
        {release.canInstall ? <>
          <p className="muted">{t("Your settings are preserved. Installation may close the app. macOS may ask for Accessibility again.")}</p>
          <button className="button primary" disabled={dirty} onClick={() => void install()}>{t("Download and install")}</button>
          {dirty && <p>{t("Save or discard your changes before installing.")}</p>}
        </> : <p>{t("Open the release page to download this version.")}</p>}
      </>}
      {phase === "downloading" && <><p>{t("Downloading and verifying…")} {progress !== undefined && `${progress}%`}</p><progress max={100} value={progress} /></>}
      {phase === "installing" && t("Installing…", "正在安装…")}
      {phase === "ready" && <><p>{t("Update installed. Restart to use the new version.")}</p><button className="button primary" disabled={dirty} onClick={() => call("restart_application").catch(e => setError(String(e)))}>{t("Restart to update")}</button></>}
    </div>
    {error && <div role="alert" className="error"><p>{t("Update failed. You can try again.")}</p><details><summary>{t("Details")}</summary><pre>{error}</pre></details></div>}
    {release?.newer && release.notes && <details><summary>{t("Release notes")}</summary><pre>{release.notes}</pre></details>}
  </div>;
}
