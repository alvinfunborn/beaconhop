#!/usr/bin/env node
// Backward-compatible entry point. The installed BH owns platform-specific registration.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const [browser, extensionId, executable] = process.argv.slice(2);
if (!['chrome','edge','chromium','brave'].includes(browser) || !/^[a-p]{32}$/.test(extensionId ?? '') || !executable || !path.isAbsolute(executable)) {
  console.error('Usage: node scripts/install-browser-host.mjs chrome|edge|chromium|brave EXTENSION_ID /absolute/path/to/beaconhop');
  process.exit(1);
}
execFileSync(executable, ['--register-browser-host', browser, extensionId], {stdio:'inherit', timeout:10000});
console.log('Click the BeaconHop browser extension to reconnect.');
