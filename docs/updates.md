# Signed updates

BeaconHop checks for updates manually from **System & access → App updates**. It discovers the latest stable GitHub release, compares semantic versions, then uses Tauri's updater to download, verify and install the package for the current platform. It never offers a downgrade. A missing/private release, network failure and a current version have separate states. Checking does not download or install anything.

Downloads show progress when the server provides a content length. Installation is disabled until settings edits are saved or discarded. macOS offers a restart after installation; Windows runs its passive installer and can close the application. Settings live outside the application bundle and are preserved. Ad-hoc macOS builds can require renewed Accessibility authorization after replacement.

## Local macOS installs and permissions

For repeated installs on a development Mac, keep the installed application's signing identity stable. An ad-hoc signature can use a changing code hash as its designated requirement, so retaining the bundle ID and `/Applications/BeaconHop.app` path alone does not preserve permission grants.

Inspect the installed identity with `codesign -d -r- /Applications/BeaconHop.app` and list usable certificates with `security find-identity -v -p codesigning`. Use the same valid certificate for subsequent local builds. Set `APPLE_SIGNING_IDENTITY` to its name or fingerprint, then explicitly override the repository's ad-hoc default:

```sh
node --input-type=module -e '
import { spawnSync } from "node:child_process";
const identity = process.env.APPLE_SIGNING_IDENTITY;
if (!identity || identity === "-") throw new Error("Set a stable signing identity first");
const config = JSON.stringify({ bundle: { macOS: { signingIdentity: identity } } });
const result = spawnSync("npm", ["run", "tauri", "--", "build", "--bundles", "app", "--config", config], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
'
```

Apple Development can be used for this local workflow; it is not Developer ID distribution or notarization. Moving from an old ad-hoc signature may require one permission migration. Stop the old process, back up the app and user configuration, replace the bundle, verify its signature and installed binary, relaunch through LaunchServices, and read the installed process's permissions again. Do not reset TCC permissions as a routine installation step.

The public Accessibility and Screen Recording APIs can check or request access; the user controls approval. `tccutil reset` clears decisions and is not a grant command. See Apple's [Accessibility check API](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions) and [code signing requirements](https://developer.apple.com/library/archive/technotes/tn2206/_index.html).

## Signing identity

This project has its own updater signing key, separate from Screen Buoy. Its public key is committed in `src-tauri/Tauri.toml`. The private key is kept outside the repository and supplied as the Actions secret `TAURI_SIGNING_PRIVATE_KEY`. For an encrypted key, also supply `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Keep a protected backup of the private key: existing installations trust its public key. Never commit the private key or include it in logs, artifacts or release assets. Updater signatures verify downloaded packages; they are separate from Apple Developer ID/notarization and Windows Authenticode signing.

Normal development builds do not require the updater private key. The packaging workflow merges `src-tauri/tauri.updater.conf.json` to generate signed updater artifacts. Local signing can use Tauri's CLI with the protected key file:

```sh
npm run tauri -- signer sign --private-key-path /protected/path/updater.key /path/to/package
```

## Release channel

The default endpoint is `https://github.com/alvinfunborn/beaconhop/releases/latest/download/latest.json`. The source repository is currently private and no release has been published. Ordinary installations cannot read private GitHub release assets; no access token is embedded in the application. The UI reports that no public release is available rather than reporting that the installation is current.

Before public distribution, choose either a public source repository or a separate public packages repository. To use a separate repository:

1. Set the source repository's Actions variable `RELEASE_REPOSITORY` to `owner/public-packages-repo`.
2. Set the secret `RELEASE_TOKEN` to a token with release-writing permission for that destination. The source repository's default Actions token cannot publish to another repository.
3. The package job generates `logs/updater-channel.json` and merges it into both platform builds. Release discovery and package downloads read the same configured channel.
4. Install a build containing the public channel before expecting future updates from it. Changing an Actions variable cannot rewrite an already installed binary's endpoint.

No repository visibility changes or release publication happen automatically.

## Package workflow

`.github/workflows/package.yml` runs only through `workflow_dispatch`. Its `publish` input defaults to **false**. Ordinary pushes do not create tags or releases. The requested stable tag must match `package.json`, `Cargo.toml` and `Tauri.toml`.

The workflow builds macOS Apple Silicon and Windows x64 packages, collects both signed packages, and generates `latest.json` plus SHA-256 checksums. It refuses to create an incomplete two-platform manifest or a prerelease manifest. Intel Mac packages are not advertised.

Only an explicit run with `publish=true` creates a release. The release must contain the manifest and the exact filenames referenced by it:

- `beaconhop-macos-arm64.app.tar.gz` and its `.sig`
- `beaconhop-windows-setup.exe` and its `.sig`
- `latest.json` and `SHA256SUMS.txt`

The native package's updater signature is embedded into the manifest. Preserve filenames when uploading. After an authorized first release, verify the public manifest and downloads without authentication, then test an actual older-to-newer installation on each platform. Browser tests simulate download/install success and verification failure; they do not prove a real published update or native installation.


Application plugin payloads are generated by `npm run plugins:bundle` (also a prebuild/predev step) and included in Tauri resources. Public package publication additionally runs `npm run plugins:check-release`: a valid official Edge Add-ons identity and URL in `plugins/distribution.json` are required. A build-only package can still be generated before store approval. See [plugin distribution](../plugins/browser/STORE.md). The package workflow archives the VSIX, Edge store ZIP and payload metadata separately from application installers.
