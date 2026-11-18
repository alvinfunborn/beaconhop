# BeaconHop Tabs

Requires the [BeaconHop desktop application](https://alvinfunborn.github.io/beaconhop/). Download BeaconHop first, keep it running, then enable VS Code in **BeaconHop → Application plugins**. [Support](https://github.com/alvinfunborn/beaconhop/issues) · [Privacy policy](https://alvinfunborn.github.io/beaconhop/privacy.html).

Connect the current VS Code window to BeaconHop's Ctrl + Tab and Ctrl + backquote navigation. Text editors, diff editors and notebooks are supported, including multiple editor groups. The extension runs in the local UI host; it does not read document contents or transmit data off the computer.

Keep BeaconHop running, focus this VS Code window and open its Tab layer. BeaconHop lists the supported tabs and returns to the exact selected editor. Terminals, custom editors and webviews are not yet supported.

The extension publishes an authenticated loopback endpoint in `~/.beaconhop/plugins`. It stops when the extension host exits. No account, workspace permissions or configuration is needed. Plugin availability is shown in BeaconHop's Navigation layers settings.

Version 0.2.1 uses the shared BeaconHop SDK. It automatically registers its name/version and reconnects per VS Code window. The BH enable switch applies across all VS Code instances.

To package from the repository, run `npx @vscode/vsce package --out ../../logs/beaconhop-tabs-0.2.1.vsix` here. The prepublish script copies the SDK into the VSIX; no npm dependencies are installed in the extension host. To install, use VS Code's **Extensions: Install from VSIX…** command or `node plugins/sdk/cli.cjs install-vsix /path/to/beaconhop-tabs-0.2.1.vsix` from the repository root. Open or reload a VS Code window after installation.
