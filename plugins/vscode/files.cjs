// Workspace discovery stays in VS Code, so multi-root and remote URIs work too.
const fold = text => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
function score(text, query) {
  text = fold(text).replaceAll('\\', '/');
  let score = 0;
  for (const word of fold(query).replaceAll('\\', '/').trim().split(/\s+/)) {
    if (!word) continue;
    const direct = text.indexOf(word);
    if (direct >= 0) { score += 10000 - direct; continue; }
    let from = 0;
    for (const char of word) {
      const at = text.indexOf(char, from);
      if (at < 0) return null;
      score += 20 - (at - from);
      from = at + 1;
    }
  }
  return score;
}
function workspaceFiles(vscode, subscriptions) {
  let pending;
  const invalidate = () => { pending = undefined; };
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  subscriptions.push(watcher, watcher.onDidCreate(invalidate), watcher.onDidDelete(invalidate),
    vscode.workspace.onDidChangeWorkspaceFolders(invalidate), vscode.workspace.onDidChangeConfiguration(invalidate));
  return () => {
    if (!pending) {
      const search = Promise.all((vscode.workspace.workspaceFolders || []).map(folder => {
        const config = vscode.workspace.getConfiguration(undefined, folder.uri);
        const excluded = {...config.get('files.exclude', {}), ...config.get('search.exclude', {})};
        const patterns = Object.entries(excluded).filter(([, value]) => value === true).map(([pattern]) => pattern);
        const exclude = patterns.length > 1 ? `{${patterns.join(',')}}` : patterns[0];
        // No maxResults: rank the complete workspace before bounding the reply.
        return vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), exclude);
      })).then(groups => [...new Map(groups.flat().map(uri => [uri.toString(), uri])).values()]);
      pending = search;
      search.catch(() => { if (pending === search) pending = undefined; });
    }
    return pending;
  };
}
module.exports = {score, workspaceFiles};
