import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The SVG is the shared source for the app, settings and Windows assets.
mkdirSync("src-tauri/icons", { recursive: true });
const nativeIcns = "src-tauri/icons/icon.icns";
const savedMacIcon = process.platform !== "darwin" && existsSync(nativeIcns)
  ? readFileSync(nativeIcns)
  : undefined;
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

await sharp("src-tauri/icons/tray_icon.svg").png().toFile("src-tauri/icons/tray_icon.png");

if (process.platform === "darwin") {
  // Match Screen Buoy's native macOS silhouette and 824px artwork inside a
  // transparent 1024px canvas. This avoids an oversized Dock icon/backing plate.
  const developerDir = execFileSync("xcode-select", ["-p"], { encoding: "utf8" }).trim();
  const ictool = join(developerDir, "../Applications/Icon Composer.app/Contents/Executables/ictool");
  if (!existsSync(ictool)) throw new Error("Xcode Icon Composer is required to generate the macOS icon.");
  mkdirSync("logs/macos-icon", { recursive: true });
  const work = mkdtempSync("logs/macos-icon/generate.");
  try {
    const icon = join(work, "BeaconHop.icon");
    mkdirSync(join(icon, "Assets"), { recursive: true });
    // Icon Composer provides the native corner mask; use full-bleed artwork.
    const fullBleed = readFileSync("public/beaconhop.svg", "utf8")
      .replace('<rect width="1024" height="1024" rx="224"/>', '<rect width="1024" height="1024"/>');
    await sharp(Buffer.from(fullBleed)).png().toFile(join(icon, "Assets/artwork.png"));
    writeFileSync(join(icon, "icon.json"), JSON.stringify({
      fill: { solid: "srgb:0.06275,0.01961,0.18431,1.00000" },
      groups: [{ layers: [{ "image-name": "artwork.png", name: "BeaconHop" }] }],
      "supported-platforms": { squares: "shared" },
    }));
    let help;
    try { help = execFileSync(ictool, ["--help"], { encoding: "utf8" }); }
    catch (error) { help = String(error.stdout ?? "") + String(error.stderr ?? ""); }
    const artwork = join(work, "artwork.png");
    execFileSync(ictool, help.includes("--export-image")
      ? [icon, "--export-image", "--output-file", artwork, "--platform", "macOS", "--rendition", "Default", "--width", "824", "--height", "824", "--scale", "1"]
      : [icon, "--export-preview", "macOS", "Default", "824", "824", "1", "-45", artwork],
    { stdio: "inherit" });
    await sharp(artwork).extend({ top: 100, bottom: 100, left: 100, right: 100,
      background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile("src-tauri/icons/icon-macos.png");
    const iconset = join(work, "BeaconHop.iconset");
    mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        await sharp("src-tauri/icons/icon-macos.png").resize(size * scale, size * scale)
          .png().toFile(join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`));
      }
    }
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", nativeIcns], { stdio: "inherit" });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
} else if (savedMacIcon) {
  // Preserve the checked-in native silhouette when regenerating on Windows.
  writeFileSync(nativeIcns, savedMacIcon);
}
