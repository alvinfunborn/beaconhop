export type HintStyle = {
  fontSize: number; fontWeight: number; color: string; background: string;
  opacity: number; radius: number; borderColor: string; borderWidth: number; shadow: boolean;
};
export type Config = {
  screenBuoy: ScreenBuoyConfig;
  holdShortcut: string;
  searchShortcut: string;
  searchEntryKey: string;
  holdEnabled: boolean;
  desktopScope: "current" | "all";
  displayScope: "current" | "all";
  includeMinimized: boolean;
  includeHidden: boolean;
  hintAlphabet: string;
  thumbnails: boolean;
  panelOpacity: number;
  hintStyle: HintStyle;
  layout: "grid" | "list";
  theme: "system" | "dark" | "light";
  language: "system" | "zh" | "en";
  startAtLogin: boolean;
  startInTray: boolean;
  excludedApps: string[];
};
export type ScreenBuoyConfig = {
  enabled: boolean;
  applicationPath: string;
  keys: string[];
  neighbours: Record<string, { left: string | null; right: string | null }>;
};
export type Destination = {
  id: string;
  nativeId: number;
  pid: number;
  title: string;
  appName: string;
  appId: string;
  displayId: string;
  desktopId: string;
  desktopName: string;
  currentDesktop: boolean | null;
  minimized: boolean;
  hidden: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  icon: string | null;
  hint: string;
};
export type Session = {
  sessionId: number;
  revision: number;
  mode: "inactive" | "held" | "search";
  windows: Destination[];
  resultIds: string[];
  selected: string | null;
  prefix: string;
  query: string;
  error: string | null;
  warnings: string[];
};
export type Permissions = {
  required: boolean;
  accessibility: boolean;
  inputMonitoring: boolean;
  screenRecording: boolean;
  keyboardHook: boolean;
  ready: boolean;
  appPath: string;
};
