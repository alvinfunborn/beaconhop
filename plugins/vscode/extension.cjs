const vscode = require('vscode');
const crypto = require('node:crypto');
const {startPlugin} = require('./sdk/index.cjs');
const {score, workspaceFiles} = require('./files.cjs');
const manifest = require('./beaconhop.plugin.json');
let connection;

exports.activate = async function activate(context) {
  const instance = crypto.randomUUID();
  const ids = new WeakMap();
  const idOf = tab => { if (!ids.has(tab)) ids.set(tab, crypto.randomUUID()); return ids.get(tab); };
  const supported = tab => tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputTextDiff || tab.input instanceof vscode.TabInputNotebook;
  const tabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs.filter(supported).map(tab => ({group, tab})));
  const uriOf = tab => tab.input.uri || tab.input.modified;
  const files = workspaceFiles(vscode, context.subscriptions);
  const fileTargets = new Map();
  async function search({context: requestedContext, query}, {signal}) {
    if (requestedContext !== instance) throw Error('This VS Code window is no longer connected');
    const opened = tabs();
    const items = opened.map(({group, tab}) => ({
      id: idOf(tab), title: tab.label,
      subtitle: `${vscode.workspace.asRelativePath(uriOf(tab), true)} · Group ${group.viewColumn}`,
      active: group.isActive && tab.isActive,
    }));
    if (query.trim()) {
      const openedUris = new Set(opened.map(({tab}) => uriOf(tab).toString()));
      for (const uri of await files()) {
        if (signal.aborted) throw Error('Search cancelled');
        if (openedUris.has(uri.toString())) continue;
        const relative = vscode.workspace.asRelativePath(uri, true);
        const title = uri.path.split('/').pop();
        items.push({id: `file:${uri.toString()}`, title, subtitle: relative, active: false});
      }
    }
    const ranked = items.map((item, index) => {
      const pathScore = score(item.subtitle, query);
      const nameScore = score(item.title, query);
      return {item, index, score: pathScore === null && nameScore === null ? null : Math.max(pathScore ?? -Infinity, (nameScore ?? -Infinity) + 20000)};
    }).filter(row => row.score !== null);
    ranked.sort((a, b) => Number(a.item.id.startsWith('file:')) - Number(b.item.id.startsWith('file:')) || b.score - a.score || a.index - b.index);
    const selected = [];
    let bytes = 0;
    for (const {item} of ranked) {
      bytes += Buffer.byteLength(JSON.stringify(item));
      if (selected.length >= 200 || bytes > 900000) break;
      selected.push(item);
      if (item.id.startsWith('file:')) {
        fileTargets.delete(item.id);
        fileTargets.set(item.id, vscode.Uri.parse(item.id.slice(5)));
      }
    }
    // Bound retained activation handles across successive searches.
    while (fileTargets.size > 2000) fileTargets.delete(fileTargets.keys().next().value);
    return {id: instance, focused: vscode.window.state.focused, items: selected};
  }
  async function execute(method, params, signal) {
    if (method === 'list') return {contexts:[{
      id:instance, focused:vscode.window.state.focused,
      items:tabs().map(({group,tab}) => ({id:idOf(tab),title:tab.label,subtitle:`Group ${group.viewColumn} · ${uriOf(tab).toString()}`,active:group.isActive && tab.isActive})),
    }]};
    if (method !== 'activate' || params.context !== instance) throw new Error('This VS Code window is no longer connected');
    const file = fileTargets.get(params.item);
    if (file) {
      if (signal?.aborted) throw Error('Activation cancelled');
      await vscode.workspace.fs.stat(file); // Deleted files must not become new untitled editors.
      if (signal?.aborted) throw Error('Activation cancelled');
      await vscode.commands.executeCommand('vscode.open', file, {preserveFocus: false, preview: false});
      for (let i = 0; i < 20; i++) {
        if (signal?.aborted) throw Error('Activation cancelled');
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        const textReady = !(tab?.input instanceof vscode.TabInputText) || vscode.window.activeTextEditor?.document.uri.toString() === file.toString();
        if (tab?.input.uri?.toString() === file.toString() && textReady) return {context: instance, item: params.item, verified: true};
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw Error('VS Code did not confirm the selected file');
    }
    const match = tabs().find(({tab}) => idOf(tab) === params.item);
    if (!match) throw new Error('That editor closed or changed. Reopen BeaconHop.');
    if (signal?.aborted) throw Error('Activation cancelled');
    const {group,tab} = match;
    const options = {viewColumn:group.viewColumn, preserveFocus:false, preview:tab.isPreview};
    if (tab.input instanceof vscode.TabInputText) await vscode.window.showTextDocument(tab.input.uri, options);
    else if (tab.input instanceof vscode.TabInputTextDiff) await vscode.commands.executeCommand('vscode.diff', tab.input.original, tab.input.modified, tab.label, options);
    else await vscode.window.showNotebookDocument(tab.input.uri, options);
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    // Opening can emit the active-tab event just after the command resolves.
    for (let i=0;i<20;i++) {
      if (signal?.aborted) throw Error('Activation cancelled');
      const textReady = !(tab.input instanceof vscode.TabInputText) || (vscode.window.activeTextEditor?.document.uri.toString() === tab.input.uri.toString() && vscode.window.activeTextEditor.viewColumn === group.viewColumn);
      if (vscode.window.tabGroups.activeTabGroup === group && group.activeTab === tab && textReady) return {context:instance,item:params.item,verified:true};
      await new Promise(resolve => setTimeout(resolve,25));
    }
    throw new Error('VS Code did not confirm the selected editor');
  }
  const plugin = await startPlugin({
    manifest,
    list: () => execute('list', {}),
    search,
    activate: (params, {signal}) => execute('activate', params, signal),
  });
  connection = plugin;
  context.subscriptions.push({dispose() { void plugin.dispose(); }});
};

// VS Code awaits this promise before shutting down the extension host.
exports.deactivate = () => connection?.dispose();
