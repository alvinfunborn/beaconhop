# BeaconHop identity

The mark is a stack of three application windows rising toward the upper right. It shares Screen Buoy's violet palette, layered shapes and fading motion trail, replacing its cursor silhouette with windows. The front window has a bright amber **H** keycap for hints and hopping; the letter is a vector path, independent of installed fonts.

- `public/beaconhop.svg` is the canonical artwork used in the settings and switcher.
- `npm run icons` generates the Windows ICO/PNG assets and the menu bar PNG from the checked-in SVGs.
- On macOS, the same command uses Xcode Icon Composer to apply the native icon silhouette, with 824-pixel artwork centered on a transparent 1024-pixel canvas, then generates `icon-macos.png` and `icon.icns`. Full Xcode is required for this step. Other platforms preserve the checked-in native ICNS.
- The macOS menu bar uses a separate monochrome window-stack template, allowing the system to adapt it to light and dark backgrounds. Windows uses the full-color application icon in the tray.

Check the app icon at 16, 32, 64, 128 and 256 pixels and the tray template against light and dark backgrounds after changing the artwork. Keep the front window's title bar, the three-layer silhouette and the contrast between the active window and its trailing copies.
