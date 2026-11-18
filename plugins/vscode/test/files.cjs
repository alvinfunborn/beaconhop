const {test} = require('node:test');
const assert = require('node:assert/strict');
const {score, workspaceFiles} = require('../files.cjs');
test('file matching supports names, paths, fuzzy terms, case and accents', () => {
  for (const query of ['src/files', 'src\\files', 'sfl', 'FILES', 'src fil']) assert.notEqual(score('src/files.cjs', query), null);
  assert.notEqual(score('src/Résumé.ts', 'resume'), null);
  assert.equal(score('src/files.cjs', 'absent'), null);
  assert(score('files.cjs', 'files') > score('src/files.cjs', 'files'));
});
test('workspace index scans every root without truncation, caches and invalidates', async () => {
  const events = {}, calls = [];
  const event = name => fn => {events[name] = fn; return {dispose(){}};};
  const vscode = {RelativePattern: class {constructor(folder, pattern) {this.folder = folder; this.pattern = pattern;}}, workspace:{
    workspaceFolders:[{uri:'one'}, {uri:'two'}],
    getConfiguration:(_, uri) => ({get:key => key === 'files.exclude' ? {'**/.git':true, '**/visible':true} : {'**/deps':true, '**/visible':false}}),
    createFileSystemWatcher:() => ({dispose(){}, onDidCreate:event('create'), onDidDelete:event('delete')}),
    onDidChangeWorkspaceFolders:event('folders'), onDidChangeConfiguration:event('config'),
    findFiles:async (...args) => {calls.push(args); return Array.from({length:2101}, (_, i) => ({toString:() => `${args[0].folder.uri}/${i}`}));},
  }};
  const files = workspaceFiles(vscode, []);
  assert.equal((await files()).length, 4202);
  assert.equal(calls.length, 2); assert.equal(calls[0].length, 2);
  assert.equal(calls[0][1], '{**/.git,**/deps}');
  await files(); assert.equal(calls.length, 2);
  for (const name of ['create', 'delete', 'folders', 'config']) {events[name](); await files();}
  assert.equal(calls.length, 10);
});
