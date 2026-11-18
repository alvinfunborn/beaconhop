import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = file => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const version=JSON.parse(read('package.json')).version;
const lock=JSON.parse(read('package-lock.json'));
assert.equal(lock.version,version,'npm lockfile version');
assert.equal(lock.packages[''].version,version,'npm root package version');
for(const file of ['src-tauri/Cargo.toml','src-tauri/Tauri.toml']) {
 const found=read(file).match(/^version\s*=\s*"([^"]+)"/m)?.[1];
 if(found!==version)throw new Error(`${file}: ${found} != ${version}`);
}
assert.equal(read('src-tauri/Cargo.lock').match(/name = "beaconhop"\nversion = "([^"]+)"/)?.[1],version,'Cargo lockfile version');
for (const file of ['plugins/sdk/package.json', 'plugins/browser/manifest.json', 'plugins/vscode/package.json', 'plugins/vscode/beaconhop.plugin.json']) {
 assert.equal(JSON.parse(read(file)).version,version,`${file} version`);
}
if(process.env.GITHUB_REF_TYPE === 'tag') assert.equal(process.env.GITHUB_REF_NAME,`v${version}`,'release tag must match bundle version');
console.log(`BeaconHop ${version}: version files agree`);
