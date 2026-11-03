import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root));
test('bundled VSIX contains the actual adapter, exact SDK and matching signed payload metadata', () => {
  const bytes = read('src-tauri/resources/plugins/beaconhop-tabs.vsix');
  const files = unzipSync(bytes);
  const info = JSON.parse(read('src-tauri/resources/plugins/payload.json'));
  const text = file => Buffer.from(files[file]).toString();
  assert.equal(text('extension/extension.cjs'), read('plugins/vscode/extension.cjs').toString());
  assert.equal(text('extension/sdk/index.cjs'), read('plugins/sdk/index.cjs').toString());
  assert.equal(JSON.parse(text('extension/package.json')).version, info.vscode.version);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), info.vscode.sha256);
  assert(!Object.keys(files).some(file => file.includes('/test/')));
});
test('Edge submission ZIP resolves all runtime entrypoints and carries no developer-only files', () => {
  const files = unzipSync(read('src-tauri/resources/plugins/beaconhop-edge.zip'));
  const manifest = JSON.parse(Buffer.from(files['manifest.json']));
  for (const file of [manifest.background.service_worker, manifest.action.default_popup, 'popup.js', 'popup.css', 'previews.js', ...Object.values(manifest.icons)]) assert(files[file], file);
  assert.equal(manifest.version, JSON.parse(read('plugins/browser/manifest.json')).version);
  assert.equal(Buffer.from(files['background.js']).toString(), read('plugins/browser/background.js').toString());
  assert(!Object.keys(files).some(file => /test|node_modules|\.pem$|\.key$/.test(file)));
});
