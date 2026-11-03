// Build-time only. End users need neither Node nor a package manager.
import './sync-plugin-sdk.mjs';
import { createVSIX } from '@vscode/vsce';
import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root));
const distribution = JSON.parse(await read('plugins/distribution.json'));
const { extensionId, storeUrl } = distribution.edge;
if (extensionId !== null || storeUrl !== null) {
  const url = new URL(storeUrl);
  if (!/^[a-p]{32}$/.test(extensionId) || url.protocol !== 'https:' ||
      url.hostname !== 'microsoftedge.microsoft.com' || url.username || url.password || url.port ||
      url.search || url.hash || !url.pathname.startsWith('/addons/detail/') ||
      url.pathname.split('/').at(-1) !== extensionId) throw Error('Invalid official Edge listing in plugins/distribution.json');
}
if (process.argv.includes('--require-store') && !extensionId) {
  throw Error('Publish BeaconHop Tabs in Edge Add-ons and fill plugins/distribution.json before a public release.');
}
const output = new URL('src-tauri/resources/plugins/', root);
await mkdir(output, { recursive: true });
const vscode = JSON.parse(await read('plugins/vscode/package.json'));
const manifest = JSON.parse(await read('plugins/vscode/beaconhop.plugin.json'));
if (vscode.version !== manifest.version) throw Error('VS Code package and plugin manifest versions differ');
await createVSIX({ cwd: fileURLToPath(new URL('plugins/vscode/', root)),
  packagePath: fileURLToPath(new URL('beaconhop-tabs.vsix', output)), dependencies: false });

const browser = JSON.parse(await read('plugins/browser/manifest.json'));
browser.icons = Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/${size}.png`]));
browser.action.default_icon = browser.icons;
const files = { 'manifest.json': Buffer.from(JSON.stringify(browser, null, 2)) };
for (const name of ['background.js', 'previews.js', 'popup.html', 'popup.js', 'popup.css']) files[name] = await read(`plugins/browser/${name}`);
files['LICENSE'] = await read('LICENSE');
for (const size of [16, 32, 48, 128]) files[`icons/${size}.png`] = await sharp(await read('public/beaconhop.svg')).resize(size, size).png().toBuffer();
// Only declared runtime files enter the store package; no tests, source maps or local state.
await writeFile(new URL('beaconhop-edge.zip', output), zipSync(files, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') }));
const vsix = await readFile(new URL('beaconhop-tabs.vsix', output));
await writeFile(new URL('payload.json', output), JSON.stringify({
  vscode: { version: vscode.version, sha256: createHash('sha256').update(vsix).digest('hex') },
  edge: { version: browser.version, ...distribution.edge },
}, null, 2) + '\n');
console.log(`Bundled VS Code ${vscode.version} and Edge ${browser.version}; Edge store ${extensionId ? 'configured' : 'awaiting publication'}.`);
