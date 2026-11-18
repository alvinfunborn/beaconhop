import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import vm from 'node:vm';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createPreviews} from '../plugins/browser/previews.js';

for (const lineEnding of ['\n', '\r\n']) {
test(`browser adapter and actual native host (${lineEnding === '\n' ? 'LF' : 'CRLF'}): focus, identity, framing, authentication and cleanup`, {timeout:15000}, async()=>{
  await fs.mkdir('logs',{recursive:true});
  const directory=await fs.mkdtemp(path.resolve('logs/browser-plugin-'));
  const executable=process.env.BH_TEST_EXECUTABLE || path.resolve(process.platform==='win32'?'src-tauri/target/debug/beaconhop.exe':'src-tauri/target/debug/beaconhop');
  const child=spawn(executable,['--native-host'],{env:{...process.env,BEACONHOP_PLUGIN_DIR:directory},stdio:['pipe','pipe','pipe']});
  const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},emit(message){for(const fn of this.listeners)fn(message);}});
  const onMessage=event(),onDisconnect=event();
  const port={onMessage,onDisconnect,postMessage(message){const body=Buffer.from(JSON.stringify(message));const header=Buffer.alloc(4);header.writeUInt32LE(body.length);child.stdin.write(Buffer.concat([header,body]));}};
  let bytes=Buffer.alloc(0);let stderr='';child.stderr.on('data',d=>stderr+=d);
  child.stdout.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);while(bytes.length>=4&&bytes.length>=bytes.readUInt32LE()+4){const size=bytes.readUInt32LE();const value=JSON.parse(bytes.subarray(4,size+4));bytes=bytes.subarray(size+4);onMessage.emit(value);}});
  const tabs=[{id:1,windowId:10,title:'重名',url:'https://one.test',active:true},{id:2,windowId:10,title:'重名',url:'https://two.test',active:false},{id:3,windowId:20,title:'Other profile window',active:true}];
  const windows=[{id:10,focused:true},{id:20,focused:false}];
  const chrome={runtime:{getManifest:()=>({version:'0.2.0'}),connectNative:()=>port,onInstalled:event(),onStartup:event()},action:{onClicked:event(),setBadgeText(){},setTitle(){}},alarms:{onAlarm:event(),create(){}},
    windows:{getAll:async()=>windows.map(w=>({...w,tabs:tabs.filter(t=>t.windowId===w.id).map(t=>({...t}))})),get:async id=>({...windows.find(w=>w.id===id)}),update:async id=>windows.forEach(w=>w.focused=w.id===id)},
    tabs:{get:async id=>{const t=tabs.find(t=>t.id===id);if(!t)throw Error('Tab closed');return {...t};},update:async id=>{const target=tabs.find(t=>t.id===id);for(const t of tabs)if(t.windowId===target.windowId)t.active=t.id===id;}},
  };
  try {
    chrome.permissions={contains:async()=>false,onAdded:event(),onRemoved:event()};
    for(const name of ['onActivated','onUpdated','onRemoved','onDetached'])chrome.tabs[name]=event();
    chrome.tabs.query=async()=>[];
    chrome.windows.onFocusChanged=event();
    chrome.runtime.onMessage=event();
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO9sAAAAASUVORK5CYII=','base64');
    chrome.runtime.getURL=p=>'chrome-extension://test'+p;
    let releaseIcons;
    const iconReady=new Promise(resolve=>{releaseIcons=resolve;});
    const background=(await fs.readFile('plugins/browser/background.js','utf8')).replace(/\r?\n/g,lineEnding);
    vm.runInNewContext(background.replace(/^import [^\r\n]*\r?\n/,''),{chrome,createPreviews,navigator:{userAgent:'Chrome/155'},console,URL,AbortSignal,btoa,fetch:async url=>{assert.equal(url.protocol,'chrome-extension:');await iconReady;return {ok:true,arrayBuffer:async()=>png};}});
    let endpoint;for(let i=0;i<100&&!endpoint;i++){const filename=(await fs.readdir(directory)).find(f=>f.endsWith('.json'));if(filename)endpoint=JSON.parse(await fs.readFile(path.join(directory,filename),'utf8'));else await new Promise(r=>setTimeout(r,20));}
    assert(endpoint,`No host endpoint: ${stderr}`);
    assert.deepEqual(endpoint.capabilities,['thumbnails']);
    const rpc=(method,params={},token=endpoint.token,delay=0)=>new Promise((resolve,reject)=>{const s=net.connect(endpoint.port,'127.0.0.1');let data='';s.setTimeout(3500,()=>{s.destroy();reject(Error('timeout'));});s.on('error',reject);s.on('connect',()=>{const body=JSON.stringify({protocol:1,token,id:'request',method,params})+'\n';if(delay)setTimeout(()=>{s.write(body.slice(0,20));setTimeout(()=>s.write(body.slice(20)),delay);},delay);else s.write(body);});s.on('data',d=>data+=d);s.on('end',()=>{try{resolve(data?JSON.parse(data):null);}catch(e){reject(e);}});});
    const result=await rpc('list');assert.equal(result.result.contexts.length,2);assert.equal(result.result.contexts[0].focused,true);
    assert.deepEqual((await rpc('thumbnails',{context:'10',items:[{id:'1',url:'https://one.test'}]})).result,{context:'10',items:[]});
    assert.deepEqual(result.result.contexts[0].items.map(t=>t.id),['1','2']);assert.equal(result.result.contexts[0].items[1].title,'重名');
    // Inventory must finish even when every favicon read is still blocked.
    assert.equal(result.result.contexts[0].items[0].icon,undefined);
    releaseIcons();
    await new Promise(resolve=>setImmediate(resolve));
    assert.match((await rpc('list')).result.contexts[0].items[0].icon,/^data:image\/png;base64,/);
    assert.equal((await rpc('list',{},endpoint.token,100)).result.contexts.length,2);
    assert.equal((await rpc('activate',{context:'10',item:'1'},endpoint.token,100)).result.verified,true);
    assert.equal((await rpc('activate',{context:'10',item:'2'})).result.verified,true);assert(tabs[1].active);
    tabs[1].windowId=20;assert.match((await rpc('activate',{context:'10',item:'2'})).error,/moved/);
    tabs.splice(1,1);assert.match((await rpc('activate',{context:'20',item:'2'})).error,/closed/);
    assert.equal(await rpc('list',{},'wrong-token'),null);
    child.stdin.end();await once(child,'exit');assert.equal((await fs.readdir(directory)).filter(f=>f.endsWith('.json')).length,0);assert.equal(stderr,'');
  } finally {child.kill();await fs.rm(directory,{recursive:true,force:true});}
});
}
