import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
mkdirSync("src-tauri/icons", { recursive: true });
await sharp("public/beaconhop.svg")
  .resize(1024, 1024)
  .png()
  .toFile("src-tauri/icons/source.png");
execFileSync(
  "node_modules/.bin/tauri",
  ["icon", "src-tauri/icons/source.png", "--output", "src-tauri/icons"],
  { stdio: "inherit" },
);

for (const directory of ["android", "ios"])
  rmSync(`src-tauri/icons/${directory}`, { recursive: true, force: true });
