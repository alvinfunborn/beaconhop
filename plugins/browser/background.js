import {createPreviews} from './previews.js';
// Titles, URLs, favicons and optional previews stay on this computer.
const previews = createPreviews(chrome);
previews.start();
let port;
let connected = false;
let reconnecting = false;
const icons = new Map();
const iconKey = tab => `${tab.url}\n${tab.favIconUrl ?? ''}`;
function favicon(tab) {
  const key = iconKey(tab);
  if (!icons.has(key)) {
    if (icons.size >= 256) icons.delete(icons.keys().next().value);
    const entry = {};
    icons.set(key, entry);
    entry.pending = (async () => {
      try {
        if (!/^https?:/.test(tab.url ?? '')) return undefined;
        const url = new URL(chrome.runtime.getURL('/_favicon/'));
        url.searchParams.set('pageUrl', tab.url);
        url.searchParams.set('size', '32');
        const response = await fetch(url, {signal: AbortSignal.timeout(500)});
        if (!response.ok) return undefined;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 6000 || ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return undefined;
        entry.image = 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes));
        return entry.image;
      } catch { icons.delete(key); return undefined; }
    })();
  }
  return icons.get(key)?.pending;
}
function identity() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return ['com.microsoft.edgemac', 'msedge.exe'];
  if (navigator.brave) return ['com.brave.browser', 'brave.exe'];
  return ['com.google.Chrome', 'chrome.exe', 'org.chromium.Chromium', 'chromium.exe'];
}
// Warm icons on browser events, never on the inventory critical path.
chrome.tabs.onUpdated.addListener((_id, _change, tab) => { void favicon(tab); });
void chrome.windows.getAll({populate:true, windowTypes:['normal']}).then(windows => {
  for (const tab of windows.filter(w => w.focused).flatMap(w => w.tabs ?? []).slice(0,64)) void favicon(tab);
}).catch(() => {});
async function execute(method, params) {
  if (method === 'thumbnails') return previews.read(params);
  if (method === 'list') {
    const windows = await chrome.windows.getAll({populate:true, windowTypes:['normal']});
    // Bound both latency and frame size. Missing icons never block tab switching.
    const focusedTabs = windows.filter(w => w.focused).flatMap(w => w.tabs ?? []).slice(0,64);
    const iconIds = new Set(focusedTabs.map(tab => tab.id));
    for (const tab of focusedTabs) void favicon(tab);
    return {contexts: windows.map(window => ({
      id: String(window.id), focused: window.focused,
      items: (window.tabs ?? []).sort((a,b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)).map(tab => ({
        id: String(tab.id), title: tab.title || tab.url || 'Tab', subtitle: tab.url || '', active: tab.active,
        icon: iconIds.has(tab.id) ? icons.get(iconKey(tab))?.image : undefined,
        preview: previews.has(tab),
      })),
    }))};
  }
  if (method === 'activate') {
    if (!/^\d+$/.test(params.context) || !/^\d+$/.test(params.item)) throw new Error('Invalid tab identity');
    const windowId = Number(params.context), tabId = Number(params.item);
    const target = await chrome.tabs.get(tabId);
    if (target.windowId !== windowId) throw new Error('That tab moved to another window. Reopen BeaconHop.');
    await chrome.tabs.update(tabId, {active:true});
    await chrome.windows.update(windowId, {focused:true});
    const [tab, window] = await Promise.all([chrome.tabs.get(tabId), chrome.windows.get(windowId)]);
    if (!tab.active || tab.windowId !== windowId || !window.focused) throw new Error('Browser did not confirm the selected tab');
    return {context:params.context, item:params.item, verified:true};
  }
  throw new Error('Unsupported BeaconHop method');
}
function connect() {
  if (port || reconnecting) return;
  reconnecting = true;
  try {
    const connection = chrome.runtime.connectNative('com.beaconhop.tabs');
    port = connection;
    connection.onMessage.addListener(async message => {
      if (message.type === "ready" && message.protocol === 1) {
        connected = true;
        chrome.action.setBadgeText({text:""});
        chrome.action.setTitle({title:"Connected to BeaconHop / 已连接 BeaconHop"});
      }
      if (!message.id) return;
      try { connection.postMessage({id:message.id, result:await execute(message.method, message.params ?? {})}); }
      catch (error) { try { connection.postMessage({id:message.id, error:String(error.message ?? error)}); } catch {} }
    });
    connection.onDisconnect.addListener(() => {
      const failed = !!chrome.runtime.lastError;
      if (port === connection) { port = undefined; connected = false; }
      chrome.action.setBadgeText({text:failed ? '!' : ''});
      chrome.action.setTitle({title:failed ? 'Open BeaconHop → Application plugins to install or repair the connection. / 请打开 BeaconHop → 应用插件，安装或修复连接。' : 'Reconnect BeaconHop'});
    });
    connection.postMessage({type:'hello', version:chrome.runtime.getManifest().version, appIds:identity(), capabilities:['thumbnails']});
    chrome.action.setBadgeText({text:''});
  } finally { reconnecting = false; }
}
chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.action.onClicked.addListener(connect);
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.action === 'reconnect') connect();
  else if (message.action === 'preview-refresh') void previews.focused();
  else if (message.action === 'preview-clear') previews.clear();
  reply({...previews.stats(), connected});
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'beaconhop-reconnect') connect(); });
chrome.alarms.create('beaconhop-reconnect', {periodInMinutes:1});
connect();
