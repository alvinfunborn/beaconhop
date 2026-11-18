const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const {startPlugin,validateManifest,MAX_MESSAGE} = require('../index.cjs');
const manifest = {protocol:1,id:'example.notes',name:'Notes',version:'1.0.0',appIds:['com.example.notes']};
async function fixture(t, overrides={}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'bh-sdk-'));
  let plugin;
  t.after(async()=>{await plugin?.dispose();await fs.rm(root,{recursive:true,force:true});});
  plugin = await startPlugin({manifest,directory:root,list:()=>({contexts:[{id:'window',focused:true,items:[{id:'doc',title:'工作'}]}]}),activate:target=>({...target,verified:true}),...overrides});
  const filename = (await fs.readdir(root)).find(f=>f.startsWith('example.notes-'));
  const endpoint = JSON.parse(await fs.readFile(path.join(root,filename),'utf8'));
  return {root,plugin,endpoint,filename};
}
function rpc(endpoint,method,params={},override={}) {
  return new Promise((resolve,reject)=>{
    const socket=net.connect(endpoint.port,'127.0.0.1');let data=Buffer.alloc(0);
    socket.setTimeout(4000,()=>{socket.destroy();reject(Error('Test timed out'));});
    socket.on('error',reject);
    socket.on('connect',()=>socket.write(JSON.stringify({protocol:1,id:'qa',token:endpoint.token,method,params,...override})+'\n'));
    socket.on('data',chunk=>data=Buffer.concat([data,chunk]));
    socket.on('end',()=>{try{resolve(data.length?JSON.parse(data.toString()):null);}catch(e){reject(e);}});
  });
}
test('manifest validates versions, capabilities and bounded metadata',()=>{
  assert.equal(validateManifest(manifest).id,manifest.id);
  for(const bad of [{id:'../escape'},{version:'01.0.0'},{version:'1.0.0-01'},{version:'latest'},{capabilities:['execute']},{appIds:[]},{homepage:'http://local.test'},{homepage:'https://user:pass@example.test'}]) assert.throws(()=>validateManifest({...manifest,...bad}));
  for(const version of ['1.0.0-alpha.1','1.0.0+meta','0.0.0']) assert.equal(validateManifest({...manifest,version}).version,version);
});
test('SDK discovers, authenticates, verifies exact targets and cleans up only its endpoint',async t=>{
  let activation;
  const {root,plugin,endpoint,filename}=await fixture(t,{activate:target=>{activation=target;return {...target,verified:target.item!=='closed'};}});
  assert.equal(endpoint.name,'Notes');assert.equal(endpoint.version,'1.0.0');
  const listed=await rpc(endpoint,'list');assert.equal(listed.result.contexts[0].items[0].title,'工作');
  assert.equal(await rpc(endpoint,'list',{}, {token:'wrong'}),null);
  const target={context:'window',item:'doc'};assert.equal((await rpc(endpoint,'activate',target)).result.verified,true);assert.deepEqual(activation,target);
  assert.match((await rpc(endpoint,'activate',{context:'window',item:'closed'})).error,/verify/);
  assert.match((await rpc(endpoint,'unknown')).error,/Unsupported/);
  await fs.writeFile(path.join(root,'unrelated.json'),'{}');
  const closing = plugin.dispose();assert.equal(plugin.dispose(),closing);await closing;
  await assert.rejects(fs.access(path.join(root,filename)));
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'registry/example.notes.json'),'utf8')).id,manifest.id);
  await fs.access(path.join(root,'unrelated.json'));
});
test('inventories and image caches reject ambiguity, mismatches and remote image loads',async t=>{
  let list={contexts:[{id:'x',focused:true,items:[]},{id:'y',focused:true,items:[]}]};
  let image='data:image/jpeg;base64,/9j/test';
  const {endpoint}=await fixture(t,{manifest:{...manifest,capabilities:['thumbnails']},list:()=>list,thumbnails:params=>({context:params.context,items:params.items.map(i=>({...i,image}))})});
  assert.match((await rpc(endpoint,'list')).error,/focused/);
  list={contexts:[{id:'x',focused:true,items:[{id:'1',title:'A'},{id:'1',title:'B'}]}]};assert.match((await rpc(endpoint,'list')).error,/duplicate/);
  const request={context:'x',items:[{id:'1',url:'revision-1'}]};assert.equal((await rpc(endpoint,'thumbnails',request)).result.items[0].image,image);
  image='https://example.test/image';assert.match((await rpc(endpoint,'thumbnails',request)).error,/thumbnail/);
  assert.match((await rpc(endpoint,'thumbnails',{...request,items:Array(9).fill(request.items[0])})).error,/eight/);
});
test('timeout aborts adapter work and a later connection still works',async t=>{
  let aborted=false,slow=true;
  const {endpoint}=await fixture(t,{list:({signal})=>slow?new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve({contexts:[]});})):({contexts:[]})});
  assert.match((await rpc(endpoint,'list')).error,/timed out/);assert.equal(aborted,true);
  slow=false;assert.deepEqual((await rpc(endpoint,'list')).result,{contexts:[]});
});
test('framing rejects oversized requests and oversized output',async t=>{
  const {endpoint}=await fixture(t,{list:()=>({contexts:[{id:'x',focused:true,items:Array.from({length:2000},(_,i)=>({id:String(i),title:'x'.repeat(1000)}))}]})});
  assert.match((await rpc(endpoint,'list')).error,/1 MiB/);
  await new Promise((resolve,reject)=>{
    const socket=net.connect(endpoint.port,'127.0.0.1');let received=false;
    socket.setTimeout(4000,()=>{socket.destroy();reject(Error('Oversized frame did not close'));});
    socket.on('connect',()=>socket.write(Buffer.alloc(MAX_MESSAGE+1,120)));
    socket.on('data',()=>{received=true;});socket.on('error',()=>{});socket.on('close',()=>{assert.equal(received,false);resolve();});
  });
});
test('CLI scaffold runs as an adapter, refuses overwrites and probes without secrets',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bh-scaffold-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const dest=path.join(root,'adapter'),cli=path.resolve(__dirname,'../cli.cjs');
  await run(process.execPath,[cli,'create',dest,'example.scaffold']);
  await assert.rejects(run(process.execPath,[cli,'create',dest,'example.scaffold']));
  await run(process.execPath,[cli,'check',path.join(dest,'beaconhop.plugin.json')]);
  const previous=process.env.BEACONHOP_PLUGIN_DIR;process.env.BEACONHOP_PLUGIN_DIR=path.join(root,'discovery');
  let current;const plugin=await require(path.join(dest,'adapter.cjs')).connect({listContexts:()=>({contexts:[{id:'one',focused:true,items:[{id:'private-id',title:'Private title'}]}]}),selectItem:(context,item)=>{current={context,item};},selectedItem:()=>current});
  t.after(async()=>{await plugin.dispose();if(previous===undefined)delete process.env.BEACONHOP_PLUGIN_DIR;else process.env.BEACONHOP_PLUGIN_DIR=previous;});
  const {stdout}=await run(process.execPath,[cli,'probe','example.scaffold'],{env:process.env});
  assert.equal(JSON.parse(stdout)[0].items,1);assert(!stdout.includes('Private title'));assert(!stdout.includes('token'));
});

test('context presentation and descriptions cross the wire and reject malformed metadata',async t=>{
  let presentation='text',description='Session summary';
  const {endpoint}=await fixture(t,{list:()=>({contexts:[{id:'window',focused:true,presentation,items:[{id:'doc',title:'Title',description}]}]})});
  const reply=await rpc(endpoint,'list');
  assert.equal(reply.result.contexts[0].presentation,'text');
  assert.equal(reply.result.contexts[0].items[0].description,'Session summary');
  presentation='thumbnails';assert.equal((await rpc(endpoint,'list')).result.contexts[0].presentation,'thumbnails');
  presentation='unsupported';assert.match((await rpc(endpoint,'list')).error,/presentation/);
  presentation='text';description='x'.repeat(8193);assert.match((await rpc(endpoint,'list')).error,/description/);
});

test('optional search validates queries, context identity and result bounds', async t => {
  let result = {id:'window', focused:false, items:[{id:'unopened', title:'File.ts'}]};
  const {endpoint} = await fixture(t, {manifest:{...manifest, capabilities:['search']}, search:({context, query}) => {
    assert.equal(context, 'window'); assert.equal(query, 'file'); return result;
  }});
  assert.equal((await rpc(endpoint, 'search', {context:'window', query:'file'})).result.contexts[0].items[0].id, 'unopened');
  assert.match((await rpc(endpoint, 'search', {context:'window', query:42})).error, /query/);
  result = {...result, id:'another'};
  assert.match((await rpc(endpoint, 'search', {context:'window', query:'file'})).error, /another context/);
  result = {id:'window', focused:false, items:Array.from({length:2001}, (_, i) => ({id:String(i), title:'File'}))};
  assert.match((await rpc(endpoint, 'search', {context:'window', query:'file'})).error, /context/);
  const legacy = await fixture(t);
  assert.match((await rpc(legacy.endpoint, 'search', {context:'window', query:'file'})).error, /Unsupported/);
});
