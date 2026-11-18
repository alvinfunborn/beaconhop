// Runs inside a real isolated VS Code extension development host.
const vscode=require('vscode');
const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const assert=require('node:assert/strict');
exports.run=async()=>{
  const directory=process.env.BEACONHOP_PLUGIN_DIR;
  assert(directory,'Use an isolated plugin directory for this test');
  await fs.rm(path.join(directory, 'integration-result.txt'), {force:true});
  const extension=vscode.extensions.getExtension('beaconhop.beaconhop-tabs');
  await extension.activate();
  let endpoint;
  for(let i=0;i<100&&!endpoint;i++) {
    const files=await fs.readdir(directory).catch(()=>[]);
    const file=files.find(f=>/^vscode-.*\.json$/.test(f));
    if(file) endpoint=JSON.parse(await fs.readFile(path.join(directory,file),'utf8'));
    else await new Promise(r=>setTimeout(r,50));
  }
  assert(endpoint,'Plugin discovery file was not created');
  const rpc=(method,params={},token=endpoint.token)=>new Promise((resolve,reject)=>{
    const socket=net.connect(endpoint.port,'127.0.0.1');let data='';
    socket.setTimeout(4000,()=>{socket.destroy();reject(Error('RPC timeout'));});socket.on('error',reject);
    socket.on('connect',()=>socket.write(JSON.stringify({protocol:1,id:'test',method,params,token})+'\n'));
    socket.on('data',chunk=>data+=chunk);
    socket.on('end',()=>{if(!data)return resolve(null);try{resolve(JSON.parse(data));}catch(e){reject(e);}});
  });
  const documents=[];
  for(let i=0;i<3;i++) {
    const filename=path.join(directory,`editor-${i}.txt`);await fs.writeFile(filename,`fixture ${i}\n`);
    const document=await vscode.workspace.openTextDocument(filename); documents.push(document);
    await vscode.window.showTextDocument(document,{preview:false,viewColumn:i===2?vscode.ViewColumn.Two:vscode.ViewColumn.One});
  }
  const listed=await rpc('list');assert(!listed.error,listed.error);
  const context=listed.result.contexts[0];assert.equal(context.items.length,3);
  assert.equal(new Set(context.items.map(i=>i.id)).size,3);
  const target=context.items.find(item=>item.title==='editor-0.txt');
  const result=await rpc('activate',{context:context.id,item:target.id});assert.equal(result.result?.verified,true,JSON.stringify(result));
  assert.equal(vscode.window.activeTextEditor.document.uri.toString(),documents[0].uri.toString());
  // A stale ID must not reopen a closed document or accidentally activate its neighbour.
  const tab=vscode.window.tabGroups.activeTabGroup.activeTab;await vscode.window.tabGroups.close(tab);
  const stale=await rpc('activate',{context:context.id,item:target.id});assert(stale.error);
  assert.equal(await rpc('list',{},'wrong-token'),null);
  const remaining=await rpc('list');assert.equal(remaining.result.contexts[0].items.length,2);
  const root = vscode.workspace.workspaceFolders?.[0];
  assert(root, 'Open an isolated fixture workspace for file search tests');
  const fixture = path.join(root.uri.fsPath, 'file-search-fixture');
  await fs.mkdir(path.join(fixture, 'nested'), {recursive:true});
  await fs.mkdir(path.join(fixture, 'excluded'), {recursive:true});
  await fs.writeFile(path.join(fixture, 'nested', 'unopened-needle.ts'), '// unopened\n');
  await fs.writeFile(path.join(fixture, 'excluded', 'hidden-needle.ts'), '// excluded\n');
  await Promise.all(Array.from({length:2100}, (_, i) => fs.writeFile(path.join(fixture, `bulk-${i}.txt`), '')));
  await vscode.workspace.getConfiguration('search', root.uri).update('exclude', {'**/excluded/**':true}, vscode.ConfigurationTarget.WorkspaceFolder);
  const found = await rpc('search', {context:context.id, query:'unopened-needle'});
  assert(!found.error, found.error);
  assert.equal(found.result.contexts[0].items.length, 1);
  const fileTarget = found.result.contexts[0].items[0];
  assert.equal(fileTarget.title, 'unopened-needle.ts');
  const opened = await rpc('activate', {context:context.id, item:fileTarget.id});
  assert.equal(opened.result?.verified, true, JSON.stringify(opened));
  assert.equal(vscode.window.activeTextEditor.document.uri.fsPath, path.join(fixture, 'nested', 'unopened-needle.ts'));
  const dedup = await rpc('search', {context:context.id, query:'unopened-needle'});
  assert.equal(dedup.result.contexts[0].items.length, 1);
  assert(!dedup.result.contexts[0].items[0].id.startsWith('file:'));
  const bulk = await rpc('search', {context:context.id, query:'bulk-2099'});
  assert.equal(bulk.result.contexts[0].items[0].title, 'bulk-2099.txt');
  const excluded = await rpc('search', {context:context.id, query:'hidden-needle'});
  assert.deepEqual(excluded.result.contexts[0].items, []);
  const pathSearch = await rpc('search', {context:context.id, query:'nested/unopened'});
  assert.equal(pathSearch.result.contexts[0].items[0].title, 'unopened-needle.ts');
  const all = await rpc('search', {context:context.id, query:'bulk'});
  assert.equal(all.result.contexts[0].items.length, 200);
  await fs.unlink(path.join(fixture, 'bulk-2099.txt'));
  assert((await rpc('activate', {context:context.id, item:bulk.result.contexts[0].items[0].id})).error);
  await assert.rejects(vscode.workspace.fs.stat(vscode.Uri.file(path.join(fixture, 'bulk-2099.txt'))));
  const newFile = path.join(fixture, 'newly-created.ts');
  await fs.writeFile(newFile, '// new file\n');
  let created;
  for (let i = 0; i < 50; i++) {
    const reply = await rpc('search', {context:context.id, query:'newly-created'});
    if (reply.result?.contexts[0].items.length) {created = reply.result.contexts[0].items[0]; break;}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(created, 'File creation must invalidate the cached index');
  const image = path.join(fixture, 'unopened-image.png');
  await fs.writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=', 'base64'));
  let imageTarget;
  for (let i = 0; i < 50; i++) {
    const reply = await rpc('search', {context:context.id, query:'unopened-image'});
    if (reply.result?.contexts[0].items.length) {imageTarget = reply.result.contexts[0].items[0]; break;}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(imageTarget);
  assert.equal((await rpc('activate', {context:context.id, item:imageTarget.id})).result?.verified, true);
  assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.input.uri.fsPath, image);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await fs.rm(fixture, {recursive:true, force:true});
  await fs.writeFile(path.join(directory,'integration-result.txt'),'PASS: real VS Code tab enumeration, exact activation across groups, closed target rejection, authentication, unopened workspace file activation, deduplication, path search, 2100-file workspace, exclusion, deleted file rejection, cache invalidation, default image editor\n');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
};
