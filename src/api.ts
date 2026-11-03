import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, emit as nativeEmit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Config, Session, Permissions } from "./types";
import { defaultScreenBuoy } from "./hintKeys";
export const native = isTauri();
export const preview =
  !native &&
  import.meta.env.DEV &&
  new URLSearchParams(location.search).has("preview");
export const panelLabel = native ? getCurrentWindow().label : new URLSearchParams(location.search).get("panel") ?? "switcher";
export const defaults: Config = {
  screenBuoy: defaultScreenBuoy(),
  holdShortcut: "Super+Tab",
  searchShortcut: "Super+Backquote",
  searchEntryKey: "Backquote",
  holdEnabled: true,
  applicationEnabled: true,
  applicationHoldShortcut: "Alt+Tab",
  applicationSearchShortcut: "Alt+Backquote",
  tabsEnabled: true,
  tabsHoldShortcut: "Ctrl+Tab",
  tabsSearchShortcut: "Ctrl+Backquote",
  desktopsEnabled: true,
  desktopsHoldShortcut: "Ctrl+Super+Tab",
  desktopsSearchShortcut: "Ctrl+Super+Backquote",
  windowsHintKeys: ["Super"],
  applicationHintKeys: ["Alt"],
  tabsHintKeys: ["Control"],
  codexHome: "",
  desktopScope: "all",
  displayScope: "all",
  includeMinimized: true,
  includeHidden: true,
  hintAlphabet: "ASDFGHJKLQWERTYUIOPZXCVBNM",
  thumbnails: true,
  panelOpacity: 24,
  hintStyle: { fontSize: 28, fontWeight: 700, color: "#19130a", background: "#ffcf48", opacity: 100, radius: 8, borderColor: "#30220c", borderWidth: 2, shadow: true },
  layout: "grid",
  theme: "system",
  language: "system",
  startAtLogin: false,
  startInTray: false,
  excludedApps: [],
};
let rectangles: Record<string,{x:number;y:number;width:number;height:number}> = {};
const listeners = new Map<string, Set<(v: any) => void>>();
let config = { ...defaults };
let pluginEntries = [
  {provider:"browser",name:"Browser",description:"Chrome / Edge",connected:false},
  {provider:"vscode",name:"VS Code",description:"Editors & notebooks",connected:false},
  {provider:"codex",name:"Codex",description:"Recent local sessions",connected:true},
].map(p=>({...p,versions:[] as string[],enabled:true,instances:0,registered:false,builtin:true,capabilities:[] as string[]}));
const disabledPlugins = new Set<string>();
let session: Session = {
  sessionId: 1,
  revision: 1,
  mode: "held",
  layer: "windows", sticky: false, loading: false,
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
    desktopId: i === 2 ? "2" : "1",
    desktopName: i === 2 ? "Desktop 2" : "Desktop 1",
    currentDesktop: i !== 2,
    minimized: i === 4,
    hidden: false,
    bounds: { x: 0, y: 0, width: i === 4 ? 700 : 1440, height: i === 4 ? 1000 : 900 },
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
if (preview && new URLSearchParams(location.search).has("layer")) {
  session.layer = new URLSearchParams(location.search).get("layer") as Session["layer"];
  if (session.layer === "tabs") {
    session.windows = session.windows.map((w,i) => ({...w,appName:"Browser",title:["项目设计","API reference","Review changes","工作记录","Inbox","Settings"][i],content:{presentation:"thumbnails",provider:"browser",instance:"preview",context:"1",item:w.id,parentId:"window",subtitle:`https://example.test/${i}`,active:i===0}}));
  }
  if (session.layer === "desktops") {
    const nativeWindows = session.windows;
    session.windows = nativeWindows.slice(0,3).map((w,i)=>({...w,id:`desktop:${i+1}`,desktopId:String(i+1),title:`Desktop ${i+1}`,appName:"Desktop",desktopName:"",currentDesktop:i===0,minimized:false,desktopTarget:true,desktopLabel:{number:i+1,fullScreen:false}}));
    session.desktopPreviews = Object.fromEntries(session.windows.map(d => [d.id, {
      displays: [{id:"1",bounds:{x:0,y:0,width:1920,height:1080}}],
      windows: nativeWindows.filter(w=>w.desktopId===d.desktopId&&!w.minimized).map((w,i)=>({...w,bounds:{x:80+i*220,y:70+i*80,width:1100,height:720}})),
    }]));
    session.selected = session.windows[0].id;
  }
  session.resultIds = session.windows.map(w=>w.id);
}
if (preview && new URLSearchParams(location.search).get("displays") === "2" && session.layer === "windows") {
  session.overview = [
    {label:"switcher",display:{id:"1",name:"Left display",scale:1,bounds:{x:-1440,y:0,width:1440,height:900}},bounds:{x:-1408,y:48,width:1376,height:804},slots:["0","1","2"]},
    {label:"switcher-display-32",display:{id:"2",name:"Right display",scale:2,bounds:{x:0,y:0,width:1920,height:1080}},bounds:{x:32,y:48,width:1856,height:984},slots:["3","4","5"]},
  ];
  session.windows.forEach((w,i) => {
    w.displayId = i < 3 ? "1" : "2";
    w.bounds = i < 3
      ? [{x:-1340,y:100,width:1120,height:680},{x:-1390,y:60,width:1300,height:800},{x:-1200,y:180,width:900,height:600}][i]
      : {x:100+(i-3)*100,y:120+(i-3)*60,width:1320-(i-3)*160,height:750-(i-3)*70};
  });
  session.windows[2].currentDesktop = true;
  session.spatialIds = ["0","3","1","2","5"];
}
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
    case "get_plugin_installation": {
      const fixture=new URLSearchParams(location.search).get("plugins");
      const installed=pluginEntries.find(p=>p.provider==="vscode");
      value={edge:{detected:fixture!=="missing",storeAvailable:fixture==="store",canRepair:false,instances:0},vscode:{detected:fixture!=="missing",name:"VS Code",installedVersion:installed?.versions[0]??null,bundledVersion:"0.2.0",instances:installed?.instances??0}};
      break;
    }
    case "install_application_plugin":
      if(new URLSearchParams(location.search).get("plugins")==="failure")throw Error("VS Code installation failed / VS Code 安装失败");
      if(args.target==="vscode")pluginEntries=pluginEntries.map(p=>p.provider==="vscode"?{...p,versions:["0.2.0"]}:p);
      value={state:args.target==="vscode"?"installed":"waiting-browser"};
      break;
    case "get_plugin_status":
      value = {entries:pluginEntries,invalidManifests:0};
      break;
    case "set_plugin_enabled":
      if(args.enabled)disabledPlugins.delete(String(args.provider));else disabledPlugins.add(String(args.provider));
      pluginEntries=pluginEntries.map(p=>p.provider===args.provider?{...p,enabled:!!args.enabled}:p);
      break;
    case "register_plugin_manifest": {
      const m=args.manifest as any;
      if(m.protocol!==1 || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(m.id??"") || !m.name || !m.version || !m.appIds?.length)throw Error("Invalid plugin manifest");
      pluginEntries=pluginEntries.filter(p=>p.provider!==m.id).concat({provider:m.id,name:m.name,description:m.description??"",versions:[m.version],enabled:!disabledPlugins.has(m.id),instances:0,registered:true,builtin:false,connected:false,capabilities:m.capabilities??[]});
      break;
    }
    case "forget_plugin":
      pluginEntries=pluginEntries.filter(p=>p.provider!==args.provider);
      break;
    case "register_browser_host":
      if(!/^[a-p]{32}$/.test(String(args.extensionId)))throw Error("Invalid extension ID");
      value="preview-host.json";
      break;
    case "get_screen_buoy_status": {
      const fixture = new URLSearchParams(location.search).get("sb");
      value = { installed: fixture === "ready" || fixture === "permissions" || fixture === "old", compatible: fixture === "ready" || fixture === "permissions", path: fixture ? "/Applications/ScreenBuoy.app/Contents/MacOS/screen-buoy" : "", platform: "macos" };
      break;
    }
    case "connect_screen_buoy":
      value = { version: "1.4.3-dev", protocol: 3, permissions: { required: true, accessibility: !location.search.includes("sb=permissions"), inputMonitoring: true, keyboardHook: !location.search.includes("sb=permissions"), ready: !location.search.includes("sb=permissions"), appPath: "/Applications/ScreenBuoy.app" } };
      break;
    case "get_screen_buoy_download":
      value = { version: "v1.4.3", compatible: false };
      break;
    case "open_screen_buoy_download": break;
    case "get_release_status":
      value = { currentVersion: __APP_VERSION__, published: false, version: "", notes: "", newer: false, canInstall: false };
      break;
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
        version: __APP_VERSION__,
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
          (w.appName + " " + w.title + " " + w.appId + " " + (w.content?.subtitle ?? "") + " " + (w.content?.description ?? ""))
            .toLowerCase()
            .includes(session.query.toLowerCase()),
        )
        .map((w) => w.id);
      session.selected = session.resultIds[0];
      session.revision++;
      emit("session", session);
      break;
    case "set_navigation": rectangles=args.rectangles as typeof rectangles; break;
    case "navigate_direction": {
      const direction=String(args.direction),current=rectangles[session.selected ?? ""];
      const vertical=["ArrowUp","ArrowDown"].includes(direction),positive=["ArrowRight","ArrowDown"].includes(direction);
      const options=current ? session.resultIds.filter(id=>rectangles[id]).map(id=> {
        const b=rectangles[id];
        const start=vertical?current.y:current.x,size=vertical?current.height:current.width;
        const crossStart=vertical?current.x:current.y,crossSize=vertical?current.width:current.height;
        const other=vertical?b.y:b.x,otherSize=vertical?b.height:b.width;
        const otherCross=vertical?b.x:b.y,otherCrossSize=vertical?b.width:b.height;
        const delta=other+otherSize/2-start-size/2,forward=positive?delta:-delta;
        const cross=Math.abs(otherCross+otherCrossSize/2-crossStart-crossSize/2);
        const overlap=Math.min(crossStart+crossSize,otherCross+otherCrossSize)-Math.max(crossStart,otherCross);
        const lane=overlap>Math.min(crossSize,otherCrossSize)*.25;
        const gap=Math.max(0,positive?other-start-size:start-other-otherSize);
        return {id,forward,cross,lane,score:gap*gap+2*cross*cross+forward*forward*.01};
      }).filter(c=>c.forward>.5&&(c.lane||c.cross<=c.forward))
        .sort((a,b)=>Number(b.lane)-Number(a.lane)||a.score-b.score||a.forward-b.forward||a.id.localeCompare(b.id)) : [];
      session.selected=options[0]?.id ?? session.selected;session.revision++;emit("session",session);break;
    }
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
    case "get_cached_thumbnails":
    case "get_tab_thumbnails":
    case "get_thumbnails":
      value = {};
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

// Drafts also travel during IME composition; committed search remains engine-owned.
const draftChannel = preview ? new BroadcastChannel("beaconhop-search-draft") : null;
draftChannel?.addEventListener("message", e => emit("search-draft", e.data));
export function shareSearchDraft(sessionId:number, query:string) {
  const data={sessionId,query,source:panelLabel};
  if(native) return nativeEmit("search-draft",data);
  draftChannel?.postMessage(data);
  return Promise.resolve();
}
