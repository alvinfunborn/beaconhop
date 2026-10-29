import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManifest } from './create-update-manifest.mjs';

test('manifest publishes supported Mac and Windows architectures with inline signatures', () => {
  const directory = mkdtempSync(join(tmpdir(), 'beaconhop-update-'));
  try {
    for (const name of ['beaconhop-macos-arm64.app.tar.gz', 'beaconhop-windows-setup.exe']) {
      writeFileSync(join(directory, name), 'fixture');
      writeFileSync(join(directory, `${name}.sig`), 'signed-package\n');
    }
    const manifest = createManifest(directory, 'v1.2.4', 'owner/repo', new Date('2026-10-23T00:00:00Z'));
    assert.equal(manifest.version, '1.2.4');
    assert.deepEqual(Object.keys(manifest.platforms), ['darwin-aarch64', 'windows-x86_64']);
    assert.equal(manifest.platforms['darwin-x86_64'], undefined);
    assert.equal(manifest.platforms['windows-x86_64'].url, 'https://github.com/owner/repo/releases/download/v1.2.4/beaconhop-windows-setup.exe');
    assert.equal(manifest.platforms['darwin-aarch64'].signature, 'signed-package');
    assert.throws(() => createManifest(directory, 'v2.0.0-beta.1', 'owner/repo'), /stable/);
    writeFileSync(join(directory, 'beaconhop-windows-setup.exe.sig'), '\n');
    assert.throws(() => createManifest(directory, 'v1.2.4', 'owner/repo'), /Missing signature/);
    unlinkSync(join(directory, 'beaconhop-windows-setup.exe'));
    assert.throws(() => createManifest(directory, 'v1.2.4', 'owner/repo'), /ENOENT/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
