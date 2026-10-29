# Signed updates

BeaconHop checks for updates manually from **System & access → App updates**. It discovers the latest stable GitHub release, compares semantic versions, then uses Tauri's updater to download, verify and install the package for the current platform. It never offers a downgrade. A missing/private release, network failure and a current version have separate states. Checking does not download or install anything.

Downloads show progress when the server provides a content length. Installation is disabled until settings edits are saved or discarded. macOS offers a restart after installation; Windows runs its passive installer and can close the application. Settings live outside the application bundle and are preserved. Ad-hoc macOS builds can require renewed Accessibility authorization after replacement.

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
