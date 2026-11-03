// Runs inside a real isolated VS Code extension development host.
const vscode=require('vscode');
const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const assert=require('node:assert/strict');
exports.run=async()=>{
  const directory=process.env.BEACONHOP_PLUGIN_DIR;
  assert(directory,'Use an isolated plugin directory for this test');
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
  await fs.writeFile(path.join(directory,'integration-result.txt'),'PASS: real VS Code tab enumeration, exact activation across groups, closed target rejection, authentication\n');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
};
