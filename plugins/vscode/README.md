# BeaconHop Tabs

Connect the current VS Code window to BeaconHop's Ctrl + Tab and Ctrl + backquote navigation. Tab switching supports text editors, diff editors and notebooks across editor groups. Search also finds unopened workspace files by name or relative path, like VS Code Quick Open (Ctrl+P / ⌘P). The extension runs in the local UI host; it does not read document contents or transmit data off the computer.

Keep BeaconHop running, focus this VS Code window and open its Tab layer. BeaconHop lists supported open tabs. Enter search to find workspace files; selecting an unopened file opens it with VS Code’s default editor. Open tabs appear before unopened files and are not duplicated in file results. Terminals, custom editors and webviews are not yet supported.

The extension publishes an authenticated loopback endpoint in `~/.beaconhop/plugins`. It stops when the extension host exits. No account, workspace permissions or configuration is needed. Plugin availability is shown in BeaconHop's Navigation layers settings.

Version 1.0.0 adds workspace file search through the shared BeaconHop SDK. It automatically registers its name/version and reconnects per VS Code window. The BH enable switch applies across all VS Code instances.

To package from the repository, run `npx @vscode/vsce package --out ../../logs/beaconhop-tabs-1.0.0.vsix` here. The prepublish script copies the SDK into the VSIX; no npm dependencies are installed in the extension host. To install, use VS Code's **Extensions: Install from VSIX…** command or `node plugins/sdk/cli.cjs install-vsix /path/to/beaconhop-tabs-1.0.0.vsix` from the repository root. Open or reload a VS Code window after installation.

File search covers all folders in the current window’s workspace, including remote folders through VS Code’s workspace API. It matches names and paths with case-insensitive fuzzy matching, ranks the complete file inventory, then returns at most 200 matches. With an empty query it shows open tabs. Boolean `files.exclude` and `search.exclude` patterns are applied per folder; conditional `when` exclusions and exact Quick Open ranking are not reproduced. Ignore-file behavior follows the host’s `workspace.findFiles` implementation. File creation, deletion, workspace changes and configuration changes invalidate the cached inventory. File contents are never searched or read by the extension. An empty window without a workspace can still search its open tabs.

Requires BeaconHop desktop **1.0.0 or later** for workspace file search. [Download BeaconHop](https://alvinfunborn.github.io/beaconhop/) · [Privacy policy](https://alvinfunborn.github.io/beaconhop/privacy.html) · [Support](https://github.com/alvinfunborn/beaconhop/issues).
