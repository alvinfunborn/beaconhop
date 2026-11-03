// Bundle the identical dependency-free SDK into VSIX; development hosts use it too.
import {copyFile, mkdir} from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await mkdir(new URL('plugins/vscode/sdk/', root), {recursive: true});
for (const file of ['index.cjs', 'index.d.ts', 'LICENSE']) {
  await copyFile(new URL(`plugins/sdk/${file}`, root), new URL(`plugins/vscode/sdk/${file}`, root));
}
