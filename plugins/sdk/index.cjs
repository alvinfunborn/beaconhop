const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const MAX_MESSAGE = 1024 * 1024;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
const providerPattern = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const directory = () => process.env.BEACONHOP_PLUGIN_DIR || path.join(os.homedir(), '.beaconhop', 'plugins');
function string(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`Invalid ${label}`);
  return value;
}
function validateManifest(value) {
  if (!value || value.protocol !== 1 || !providerPattern.test(value.id ?? '')) throw Error('Invalid plugin ID or protocol');
  string(value.name, 100, 'plugin name');
  if (typeof value.version !== 'string' || value.version.length > 100 || !semverPattern.test(value.version)) throw Error('Use a semantic plugin version');
  if (!Array.isArray(value.appIds) || !value.appIds.length || value.appIds.length > 16) throw Error('Provide 1–16 application IDs');
  value.appIds.forEach(id => string(id, 200, 'application ID'));
  const capabilities = value.capabilities ?? [];
  if (!Array.isArray(capabilities) || capabilities.length > 16 || capabilities.some(c => c !== 'thumbnails')) throw Error('Unsupported plugin capability');
  const manifest = {protocol: 1, id: value.id, name: value.name, version: value.version, appIds: [...new Set(value.appIds)], capabilities: [...new Set(capabilities)]};
  if (value.description !== undefined) {
    if (typeof value.description !== 'string' || value.description.length > 500) throw Error('Invalid description');
    manifest.description = value.description;
  }
  if (value.homepage !== undefined) {
    const url = new URL(value.homepage);
    if (url.protocol !== 'https:' || url.username || url.password || value.homepage.length > 2048) throw Error('Homepage must be a public HTTPS URL');
    manifest.homepage = value.homepage;
  }
  if (Buffer.byteLength(JSON.stringify(manifest)) > 8192) throw Error('Manifest exceeds 8 KiB');
  return manifest;
}
async function privateWrite(filename, data) {
  await fs.mkdir(path.dirname(filename), {recursive: true, mode: 0o700});
  if (process.platform !== 'win32') await fs.chmod(path.dirname(filename), 0o700);
  const pending = `${filename}.${crypto.randomUUID()}.pending`;
  try {
    await fs.writeFile(pending, JSON.stringify(data) + '\n', {mode: 0o600, flag: 'wx'});
    await fs.rename(pending, filename);
  } finally { await fs.rm(pending, {force: true}); }
}
async function registerManifest(value, options = {}) {
  const manifest = validateManifest(value);
  await privateWrite(path.join(options.directory ?? directory(), 'registry', `${manifest.id}.json`), manifest);
  return manifest;
}
function inventory(value) {
  if (!value || !Array.isArray(value.contexts) || value.contexts.length > 256) throw Error('Invalid plugin inventory');
  const contexts = new Set();
  for (const context of value.contexts) {
    string(context.id, 512, 'context ID');
    if (context.presentation !== undefined && !['text','thumbnails'].includes(context.presentation)) throw Error('Invalid content presentation');
    if (contexts.has(context.id) || typeof context.focused !== 'boolean' || !Array.isArray(context.items) || context.items.length > 2000) throw Error('Invalid or duplicate context');
    contexts.add(context.id); const ids = new Set();
    for (const item of context.items) {
      string(item.id, 2048, 'item ID'); string(item.title, 8192, 'item title');
      if (ids.has(item.id) || (item.subtitle !== undefined && (typeof item.subtitle !== 'string' || item.subtitle.length > 8192))) throw Error('Invalid or duplicate item');
      if (item.active !== undefined && typeof item.active !== 'boolean') throw Error('Invalid active flag');
      if (item.description !== undefined && (typeof item.description !== 'string' || item.description.length > 8192)) throw Error('Invalid item description');
      if (item.preview !== undefined && typeof item.preview !== 'boolean') throw Error('Invalid preview flag');
      if (item.icon !== undefined && (typeof item.icon !== 'string' || item.icon.length > 8192 || !item.icon.startsWith('data:image/png;base64,'))) throw Error('Icon must be a small inline PNG');
      ids.add(item.id);
    }
  }
  if (value.contexts.filter(c => c.focused).length > 1) throw Error('Only one owned context may be focused');
  return value;
}
function validToken(value, token) {
  if (typeof value !== 'string') return false;
  const a = Buffer.from(value), b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function startPlugin(options) {
  const manifest = validateManifest(options.manifest);
  if (typeof options.list !== 'function' || typeof options.activate !== 'function') throw Error('Provide list and activate handlers');
  if (manifest.capabilities.includes('thumbnails') && typeof options.thumbnails !== 'function') throw Error('Provide a thumbnails handler for that capability');
  const root = options.directory ?? directory(), instance = crypto.randomUUID(), token = crypto.randomUUID();
  const filename = path.join(root, `${manifest.id}-${instance}.json`);
  const sockets = new Set();
  let disposed = false, timer, writeQueue = Promise.resolve();
  async function execute(method, params, signal) {
    const requestContext = {instance, signal};
    if (method === 'list') return inventory(await options.list(requestContext));
    if (method === 'activate') {
      string(params.context, 512, 'context'); string(params.item, 2048, 'item');
      const result = await options.activate({context: params.context, item: params.item}, requestContext);
      if (result?.context !== params.context || result?.item !== params.item || result?.verified !== true) throw Error('Adapter did not verify the exact selected target');
      return result;
    }
    if (method === 'thumbnails' && manifest.capabilities.includes('thumbnails')) {
      string(params.context, 512, 'context');
      if (!Array.isArray(params.items) || params.items.length > 8) throw Error('Thumbnail batches contain at most eight items');
      params.items.forEach(i => { string(i.id, 2048, 'item'); if (typeof i.url !== 'string' || i.url.length > 8192) throw Error('Invalid thumbnail URL'); });
      const result = await options.thumbnails(params, requestContext);
      if (result?.context !== params.context || !Array.isArray(result.items) || result.items.length > 8) throw Error('Invalid thumbnail reply');
      for (const item of result.items) {
        if (!params.items.some(i => i.id === item.id && i.url === item.url) || typeof item.image !== 'string' || item.image.length > 60 * 1024 || !item.image.startsWith('data:image/jpeg;base64,')) throw Error('Invalid cached thumbnail');
      }
      return result;
    }
    throw Error('Unsupported BeaconHop method');
  }
  const server = net.createServer(socket => {
    if (disposed || sockets.size >= 8) { socket.destroy(); return; }
    sockets.add(socket); const controller = new AbortController();
    socket.on('close', () => { sockets.delete(socket); controller.abort(); }); socket.on('error', () => {});
    socket.setTimeout(3500, () => socket.destroy());
    let buffer = Buffer.alloc(0), handled = false;
    socket.on('data', data => {
      if (handled) return;
      buffer = Buffer.concat([buffer, data]);
      if (buffer.length > MAX_MESSAGE) { socket.destroy(); return; }
      const newline = buffer.indexOf(10); if (newline < 0) return;
      handled = true;
      let request;
      try {
        request = JSON.parse(buffer.subarray(0, newline).toString('utf8'));
        if (request.protocol !== 1 || !validToken(request.token, token) || typeof request.id !== 'string' || !request.id || request.id.length > 100) throw Error('Unauthorized');
      } catch { socket.destroy(); return; }
      void (async () => {
        let timeout;
        try {
          const result = await Promise.race([
            execute(request.method, request.params ?? {}, controller.signal),
            new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(Error('Plugin operation timed out')); }, 2500); }),
          ]);
          const reply = JSON.stringify({id: request.id, result}) + '\n';
          if (Buffer.byteLength(reply) > MAX_MESSAGE) throw Error('Plugin response exceeds 1 MiB');
          if (!socket.destroyed) socket.end(reply);
        } catch (error) {
          if (!socket.destroyed) socket.end(JSON.stringify({id: request.id, error: String(error.message ?? error).slice(0, 300)}) + '\n');
        } finally { clearTimeout(timeout); }
      })();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  server.on('error', error => options.onError?.(error));
  const endpoint = {protocol: 1, provider: manifest.id, name: manifest.name, version: manifest.version, instance, appIds: manifest.appIds, capabilities: manifest.capabilities, port: server.address().port, token};
  const write = () => {
    writeQueue = writeQueue.catch(() => {}).then(() => disposed ? undefined : privateWrite(filename, endpoint));
    return writeQueue;
  };
  let disposal;
  function dispose() {
    if (disposal) return disposal;
    disposed = true; clearInterval(timer);
    for (const socket of sockets) socket.destroy();
    disposal = (async () => {
      await new Promise(resolve => server.close(resolve));
      await writeQueue.catch(() => {});
      await fs.rm(filename, {force: true});
    })();
    return disposal;
  }
  try {
    if (Buffer.byteLength(JSON.stringify(endpoint)) > 8192) throw Error('Discovery metadata exceeds 8 KiB');
    await registerManifest(manifest, {directory: root}); await write();
    timer = setInterval(() => { void write().catch(error => options.onError?.(error)); }, 5000);
    timer.unref(); server.unref();
  } catch (error) { await dispose(); throw error; }
  // Secrets stay internal; callers only need an epoch for context IDs and disposal.
  return {instance, manifest, dispose};
}
module.exports = {startPlugin, registerManifest, validateManifest, directory, MAX_MESSAGE};
