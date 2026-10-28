import {readFileSync} from 'node:fs';
const version=JSON.parse(readFileSync('package.json')).version;
for(const file of ['src-tauri/Cargo.toml','src-tauri/Tauri.toml']) {
 const found=readFileSync(file,'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
 if(found!==version)throw new Error(`${file}: ${found} != ${version}`);
}
console.log(`BeaconHop ${version}: version files agree`);
