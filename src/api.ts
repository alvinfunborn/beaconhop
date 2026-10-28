import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Config, Session, Permissions } from "./types";
export const native = isTauri();
export const preview =
  !native &&
  import.meta.env.DEV &&
  new URLSearchParams(location.search).has("preview");
export const defaults: Config = {
  holdShortcut: "Alt+Tab",
  searchShortcut: "Super+Backquote",
  holdEnabled: true,
  desktopScope: "all",
  displayScope: "all",
  includeMinimized: true,
  includeHidden: true,
  hintAlphabet: "ASDFGHJKLQWERTYUIOPZXCVBNM",
  thumbnails: true,
  layout: "grid",
  theme: "system",
  language: "system",
  startAtLogin: false,
  startInTray: false,
  excludedApps: [],
};
const listeners = new Map<string, Set<(v: any) => void>>();
let config = { ...defaults };
let session: Session = {
  sessionId: 1,
  revision: 1,
  mode: "held",
  windows: [
    ["Figma", "BeaconHop · Product direction"],
    ["Visual Studio Code", "engine.rs — beaconhop"],
    ["Safari", "A little space for your next idea"],
    ["Terminal", "beaconhop — npm run dev"],
    ["Notes", "周末计划与产品灵感"],
    ["Finder", "Design assets"],
  ].map(([appName, title], i) => ({
    id: String(i),
    appName,
    title,
    appId: appName,
    nativeId: i,
    pid: 1,
    displayId: "1",
    desktopId: "1",
    desktopName: i === 2 ? "Desktop 2" : "Desktop 1",
    currentDesktop: i !== 2,
    minimized: i === 4,
    hidden: false,
    icon: null,
    hint: "ASDFGH"[i],
  })),
  resultIds: ["0", "1", "2", "3", "4", "5"],
  selected: "1",
  prefix: "",
  query: "",
  error: null,
  warnings: [],
};
function emit(name: string, value: any) {
  listeners.get(name)?.forEach((fn) => fn(structuredClone(value)));
}
export async function call<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (native) return invoke<T>(name, args);
  if (!preview) throw new Error("Open BeaconHop as a desktop application.");
  let value: any;
  switch (name) {
    case "get_settings":
      value = config;
      break;
    case "save_settings":
      config = args.config as Config;
      emit("settings", config);
      value = config;
      break;
    case "get_session":
      value = session;
      break;
    case "get_permissions":
      value = {
        required: true,
        accessibility: true,
        inputMonitoring: true,
        screenRecording: true,
        keyboardHook: true,
        ready: true,
        appPath: "/Applications/BeaconHop.app",
      } satisfies Permissions;
      break;
    case "get_diagnostics":
      value = {
        version: "0.1.0",
        platform: "preview",
        windowCount: 6,
        displayCount: 2,
      };
      break;
    case "open_search":
      session = {
        ...session,
        mode: "search",
        sessionId: session.sessionId + 1,
      };
      emit("session", session);
      break;
    case "search":
      session.query = String(args.query);
      session.resultIds = session.windows
        .filter((w) =>
          (w.appName + " " + w.title)
            .toLowerCase()
            .includes(session.query.toLowerCase()),
        )
        .map((w) => w.id);
      session.selected = session.resultIds[0];
      session.revision++;
      emit("session", session);
      break;
    case "navigate": {
      const i = session.resultIds.indexOf(session.selected ?? "");
      session.selected =
        session.resultIds[
          (i + Number(args.delta) + session.resultIds.length) %
            session.resultIds.length
        ];
      session.revision++;
      emit("session", session);
      break;
    }
    case "cancel":
    case "activate":
      session.mode = "inactive";
      session.revision++;
      emit("session", session);
      break;
    case "get_thumbnail":
      value = null;
      break;
  }
  return structuredClone(value) as T;
}
export async function subscribe<T>(event: string, fn: (value: T) => void) {
  if (native) return listen<T>(event, (e) => fn(e.payload));
  const set = listeners.get(event) ?? new Set();
  set.add(fn);
  listeners.set(event, set);
  return () => {
    set.delete(fn);
  };
}
