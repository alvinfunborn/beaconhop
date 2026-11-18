// Keep checked-in development icons and packaged icons on the app's shared artwork.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const source = fileURLToPath(new URL('public/beaconhop.svg', root));
await mkdir(new URL('plugins/browser/icons/', root), { recursive: true });
await sharp(source).resize(256, 256).png().toFile(fileURLToPath(new URL('plugins/vscode/icon.png', root)));
for (const size of [16, 32, 48, 128]) {
  await sharp(source).resize(size, size).png().toFile(fileURLToPath(new URL(`plugins/browser/icons/${size}.png`, root)));
}
