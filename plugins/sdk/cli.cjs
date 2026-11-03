#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const {execFileSync} = require('node:child_process');
const {validateManifest, registerManifest, directory, MAX_MESSAGE} = require('./index.cjs');
const usage = `BeaconHop plugin tools (Node 18+)
  create DIRECTORY PLUGIN_ID   Scaffold an application adapter; never overwrites files
  check MANIFEST.json          Validate plugin metadata
  register MANIFEST.json       Import metadata; does not start application code
  install-vsix FILE.vsix [--code PATH] [--extensions-dir PATH] [--user-data-dir PATH]
  register-browser BROWSER EXTENSION_ID --beaconhop PATH
  probe PLUGIN_ID              Read-only connection check; does not activate anything
`;
async function readManifest(filename) {
  if (!filename || (await fs.stat(filename)).size > 8192) throw Error('Provide a manifest smaller than 8 KiB');
  return validateManifest(JSON.parse(await fs.readFile(filename, 'utf8')));
}
function flags(args, allowed) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || result[args[i]]) throw Error('Unknown, duplicate or incomplete option');
    result[args[i]] = path.resolve(args[i + 1]);
  }
  return result;
}
async function vscodeCommand(explicit) {
  const candidates = explicit ? [explicit] : process.platform === 'darwin'
    ? ['Code','Electron'].flatMap(name=>[path.join('/Applications/Visual Studio Code.app/Contents/MacOS',name),path.join(os.homedir(),'Applications/Visual Studio Code.app/Contents/MacOS',name)])
    : process.platform === 'win32'
      ? [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe'), process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft VS Code/Code.exe')].filter(Boolean)
      : [];
  for (const executable of candidates) {
    try { await fs.access(executable); } catch { continue; }
    const base = path.basename(executable).toLowerCase();
    if ((process.platform === 'darwin' && ['electron','code'].includes(base)) || base === 'code.exe' || base === 'code - insiders.exe') {
      const cli = process.platform === 'darwin' ? path.resolve(executable, '../../Resources/app/out/cli.js') : path.join(path.dirname(executable), 'resources/app/out/cli.js');
      await fs.access(cli);
      return {executable, args: [cli], env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}};
    }
    if (process.platform === 'win32') throw Error('On Windows pass --code pointing to Code.exe, not a .cmd file');
    return {executable, args: [], env: process.env};
  }
  throw Error('VS Code was not found. Pass --code with its absolute executable path');
}
async function probe(id) {
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(id ?? '')) throw Error('Invalid plugin ID');
  const root = directory(), results = [];
  for (const file of await fs.readdir(root).catch(() => [])) {
    if (!file.endsWith('.json')) continue;
    const filename = path.join(root, file), stat = await fs.lstat(filename).catch(() => null);
    if (!stat?.isFile() || stat.size > 8192 || Date.now() - stat.mtimeMs > 20000) continue;
    let endpoint; try { endpoint = JSON.parse(await fs.readFile(filename, 'utf8')); } catch { continue; }
    if (endpoint.provider !== id || endpoint.protocol !== 1 || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 || typeof endpoint.token !== 'string') continue;
    const result = await new Promise((resolve, reject) => {
      const socket = net.connect(endpoint.port, '127.0.0.1'); let body = Buffer.alloc(0), done = false;
      const finish = (error, reply) => { if (done) return; done = true; socket.destroy(); error ? reject(error) : resolve(reply); };
      socket.setTimeout(3500, () => finish(Error('Plugin timed out')));
      socket.on('error', () => finish(Error('Plugin disconnected')));
      socket.on('connect', () => socket.write(JSON.stringify({protocol:1,id:'probe',token:endpoint.token,method:'list',params:{}})+'\n'));
      socket.on('data', chunk => {
        body = Buffer.concat([body, chunk]); if (body.length > MAX_MESSAGE) return finish(Error('Oversized reply'));
        if (!body.includes(10)) return;
        try { const reply = JSON.parse(body.subarray(0, body.indexOf(10)).toString());
          if (reply.id !== 'probe' || reply.error || !Array.isArray(reply.result?.contexts)) throw Error(reply.error || 'Invalid inventory');
          finish(null, reply.result);
        } catch (error) { finish(error); }
      });
      socket.on('end', () => { if (!done) finish(Error('Incomplete reply')); });
    });
    // Do not print tokens, titles, URLs or document contents.
    results.push({provider:id,version:endpoint.version,contexts:result.contexts.length,items:result.contexts.reduce((sum,c)=>sum+c.items.length,0)});
  }
  if (!results.length) throw Error('No live adapter found. Start the application with its extension enabled');
  return results;
}
async function main(args) {
  const [command, ...rest] = args;
  if (!command || command === '--help') { console.log(usage); return; }
  if (command === 'create') {
    if (rest.length !== 2) throw Error('Usage: create DIRECTORY PLUGIN_ID');
    const manifest = validateManifest({protocol:1,id:rest[1],name:rest[1],version:'0.1.0',appIds:['com.example.app','example.exe'],capabilities:[]});
    const dest = path.resolve(rest[0]); await fs.mkdir(dest); // Refuse even an existing empty directory.
    await fs.mkdir(path.join(dest, 'sdk'));
    for (const name of ['index.cjs','index.d.ts','LICENSE']) await fs.copyFile(path.join(__dirname,name),path.join(dest,'sdk',name));
    await fs.copyFile(path.join(__dirname,'template.cjs'),path.join(dest,'adapter.cjs'));
    await fs.writeFile(path.join(dest,'beaconhop.plugin.json'),JSON.stringify(manifest,null,2)+'\n');
    await fs.writeFile(path.join(dest,'package.json'),JSON.stringify({name:manifest.id,version:'0.1.0',private:true,main:'adapter.cjs'},null,2)+'\n');
    await fs.copyFile(path.join(__dirname,'README.md'),path.join(dest,'README.md'));
    console.log(`Created ${dest}. Implement the application binding in adapter.cjs, then start it from your application extension.`);
  } else if (command === 'check' || command === 'register') {
    if (rest.length !== 1) throw Error(`Usage: ${command} MANIFEST.json`);
    const manifest = await readManifest(rest[0]); if (command === 'register') await registerManifest(manifest);
    console.log(`${command === 'check' ? 'Valid' : 'Registered metadata for'} ${manifest.id} ${manifest.version}`);
  } else if (command === 'install-vsix') {
    if (!rest[0] || !rest[0].toLowerCase().endsWith('.vsix')) throw Error('Provide a .vsix package');
    const file = path.resolve(rest[0]), stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 100 * 1024 * 1024) throw Error('Invalid or oversized VSIX');
    const options = flags(rest.slice(1),['--code','--extensions-dir','--user-data-dir']);
    const cli = await vscodeCommand(options['--code']);
    const args = [...cli.args,'--install-extension',file];
    for (const key of ['--extensions-dir','--user-data-dir']) if (options[key]) args.push(key,options[key]);
    execFileSync(cli.executable,args,{env:cli.env,stdio:'inherit',timeout:120000});
    console.log('Installed. Open or reload a VS Code window to connect its adapter to BeaconHop.');
  } else if (command === 'register-browser') {
    if (!['chrome','edge','chromium','brave'].includes(rest[0]) || !/^[a-p]{32}$/.test(rest[1] ?? '')) throw Error('Provide a supported browser and its 32-letter extension ID');
    const options = flags(rest.slice(2),['--beaconhop']);
    if (!options['--beaconhop']) throw Error('Provide --beaconhop with the installed BeaconHop executable');
    execFileSync(options['--beaconhop'],['--register-browser-host',rest[0],rest[1]],{stdio:'inherit',timeout:10000});
    console.log('Registered. Click the browser extension to reconnect.');
  } else if (command === 'probe') {
    if (rest.length !== 1) throw Error('Usage: probe PLUGIN_ID');
    console.log(JSON.stringify(await probe(rest[0]),null,2));
  } else throw Error(usage);
}
if (require.main === module) main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports = {main,probe,vscodeCommand};
