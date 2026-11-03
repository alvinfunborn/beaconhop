// Event-driven, memory-only snapshots of pages the user actually visits.
export const previewLimits = {entries: 100, bytes: 4 * 1024 * 1024, image: 60 * 1024, batch: 8};
export const previewPermission = {origins: ['<all_urls>']};
const eligible = tab => tab && tab.active && !tab.incognito && tab.status === 'complete' && /^https?:\/\//.test(tab.url ?? '');

async function resize(source) {
  const bitmap = await createImageBitmap(await (await fetch(source)).blob());
  try {
    const scale = Math.min(1, 320 / bitmap.width, 180 / bitmap.height);
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({type: 'image/jpeg', quality: .55})).arrayBuffer());
    return 'data:image/jpeg;base64,' + btoa(String.fromCharCode(...bytes));
  } finally { bitmap.close(); }
}

export function createPreviews(chrome, options = {}) {
  const compress = options.resize ?? resize, now = options.now ?? Date.now;
  const later = options.setTimeout ?? setTimeout, cancel = options.clearTimeout ?? clearTimeout;
  const cache = new Map();
  let bytes = 0, timer, pendingId, generation = 0, busy = false, lastAttempt = -Infinity;
  function remove(id) { const old = cache.get(id); if (old) bytes -= old.image.length; cache.delete(id); }
  function clear() { generation++; cancel(timer); pendingId = undefined; cache.clear(); bytes = 0; }
  function invalidate(id) {
    if (id === pendingId) { generation++; cancel(timer); }
    remove(id);
  }
  async function allowed() { return chrome.permissions.contains(previewPermission).catch(() => false); }
  function schedule(id) {
    cancel(timer);
    pendingId = id;
    const revision = ++generation;
    timer = later(() => capture(id, revision), Math.max(800, 1000 - (now() - lastAttempt)));
  }
  async function capture(id, revision) {
    if (revision !== generation) return;
    if (busy) { schedule(id); return; }
    busy = true;
    try {
      if (!await allowed()) { clear(); return; }
      const tab = await chrome.tabs.get(id);
      if (!eligible(tab)) return;
      const owner = await chrome.windows.get(tab.windowId);
      if (!owner.focused || owner.type !== 'normal' || revision !== generation) return;
      const old = cache.get(id);
      if (old?.url === tab.url && now() - old.time < 10000) return;
      lastAttempt = now();
      const image = await compress(await chrome.tabs.captureVisibleTab(tab.windowId, {format: 'jpeg', quality: 55}));
      const [current, window, permission] = await Promise.all([chrome.tabs.get(id), chrome.windows.get(tab.windowId), allowed()]);
      // A page/window may have changed while the browser or image codec was busy.
      if (revision !== generation || !permission || !eligible(current) || current.url !== tab.url || current.windowId !== tab.windowId || !window.focused || window.type !== 'normal') return;
      if (!image.startsWith('data:image/jpeg;base64,') || image.length > previewLimits.image) return;
      remove(id);
      cache.set(id, {image, url: tab.url, time: now()}); bytes += image.length;
      while (cache.size > previewLimits.entries || bytes > previewLimits.bytes) remove(cache.keys().next().value);
    } catch { /* Closed tabs and denied captures must never break switching. */ }
    finally { busy = false; }
  }
  async function read(params) {
    if (!/^\d+$/.test(params.context) || !Array.isArray(params.items) || params.items.length > previewLimits.batch) throw new Error('Invalid thumbnail request');
    if (!await allowed()) { clear(); return {context: params.context, items: []}; }
    const items = [];
    for (const item of params.items) {
      if (typeof item.id !== 'string' || !/^\d+$/.test(item.id) || typeof item.url !== 'string') continue;
      const id = Number(item.id), entry = cache.get(id);
      if (!entry || entry.url !== item.url) continue;
      try {
        const tab = await chrome.tabs.get(id);
        if (tab.incognito || tab.status !== 'complete' || String(tab.windowId) !== params.context || tab.url !== entry.url) { remove(id); continue; }
        cache.delete(id); cache.set(id, entry); // LRU; reads do not capture or activate tabs.
        items.push({id: item.id, url: entry.url, image: entry.image});
      } catch { remove(id); }
    }
    // Revocation can race a cache read too.
    if (!await allowed()) { clear(); return {context: params.context, items: []}; }
    return {context: params.context, items};
  }
  async function focused(windowId) {
    const revision = ++generation;
    cancel(timer);
    try {
      const [tab] = await chrome.tabs.query(windowId === undefined ? {active: true, lastFocusedWindow: true} : {active: true, windowId});
      if (revision === generation && tab) schedule(tab.id);
    } catch {}
  }
  async function completed(tab) {
    const revision = generation;
    try {
      // A background window can finish loading without cancelling the foreground
      // page's pending snapshot. Every normal window has its own active tab.
      const window = await chrome.windows.get(tab.windowId);
      if (revision === generation && window.focused && window.type === 'normal') schedule(tab.id);
    } catch {}
  }
  function start() {
    chrome.tabs.onActivated.addListener(({tabId}) => schedule(tabId));
    chrome.tabs.onUpdated.addListener((id, change, tab) => {
      if (change.url || change.status === 'loading') invalidate(id);
      if (tab.active && change.status === 'complete') void completed(tab);
    });
    chrome.tabs.onRemoved.addListener(invalidate);
    chrome.tabs.onDetached.addListener(invalidate);
    chrome.windows.onFocusChanged.addListener(id => { if (id >= 0) void focused(id); else { generation++; cancel(timer); } });
    chrome.permissions.onRemoved.addListener(() => { clear(); });
    chrome.permissions.onAdded.addListener(() => { void focused(); });
    void focused();
  }
  const has = tab => !tab.incognito && tab.status === 'complete' && !!cache.get(tab.id) && cache.get(tab.id).url === tab.url;
  return {start, read, clear, focused, schedule, invalidate, has, stats: () => ({entries: cache.size, bytes})};
}
