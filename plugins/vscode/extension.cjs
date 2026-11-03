const vscode = require('vscode');
const crypto = require('node:crypto');
const {startPlugin} = require('./sdk/index.cjs');
const manifest = require('./beaconhop.plugin.json');
let connection;

exports.activate = async function activate(context) {
  const instance = crypto.randomUUID();
  const ids = new WeakMap();
  const idOf = tab => { if (!ids.has(tab)) ids.set(tab, crypto.randomUUID()); return ids.get(tab); };
  const supported = tab => tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputTextDiff || tab.input instanceof vscode.TabInputNotebook;
  const tabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs.filter(supported).map(tab => ({group, tab})));
  const uriOf = tab => tab.input.uri || tab.input.modified;
  async function execute(method, params, signal) {
    if (method === 'list') return {contexts:[{
      id:instance, focused:vscode.window.state.focused,
      items:tabs().map(({group,tab}) => ({id:idOf(tab),title:tab.label,subtitle:`Group ${group.viewColumn} · ${uriOf(tab).toString()}`,active:group.isActive && tab.isActive})),
    }]};
    if (method !== 'activate' || params.context !== instance) throw new Error('This VS Code window is no longer connected');
    const match = tabs().find(({tab}) => idOf(tab) === params.item);
    if (!match) throw new Error('That editor closed or changed. Reopen BeaconHop.');
    if (signal?.aborted) throw Error('Activation cancelled');
    const {group,tab} = match;
    const options = {viewColumn:group.viewColumn, preserveFocus:false, preview:tab.isPreview};
    if (tab.input instanceof vscode.TabInputText) await vscode.window.showTextDocument(tab.input.uri, options);
    else if (tab.input instanceof vscode.TabInputTextDiff) await vscode.commands.executeCommand('vscode.diff', tab.input.original, tab.input.modified, tab.label, options);
    else await vscode.window.showNotebookDocument(tab.input.uri, options);
    // Opening can emit the active-tab event just after the command resolves.
    for (let i=0;i<20;i++) {
      if (signal?.aborted) throw Error('Activation cancelled');
      if (vscode.window.tabGroups.activeTabGroup === group && group.activeTab === tab) return {context:instance,item:params.item,verified:true};
      await new Promise(resolve => setTimeout(resolve,25));
    }
    throw new Error('VS Code did not confirm the selected editor');
  }
  const plugin = await startPlugin({
    manifest,
    list: () => execute('list', {}),
    activate: (params, {signal}) => execute('activate', params, signal),
  });
  connection = plugin;
  context.subscriptions.push({dispose() { void plugin.dispose(); }});
};

// VS Code awaits this promise before shutting down the extension host.
exports.deactivate = () => connection?.dispose();
