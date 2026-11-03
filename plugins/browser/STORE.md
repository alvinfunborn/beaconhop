# Edge Add-ons publication

The ordinary user flow is **BeaconHop → Application plugins → Edge → Install and connect → confirm Add extension in Edge**. BeaconHop registers its per-user Native Messaging host before opening the official listing, then observes the extension connection. No developer mode, copied ID, Node installation, admin policy or forced browser restart is part of this flow.

The listing is **not yet published**. `plugins/distribution.json` deliberately contains nulls; BH displays this state and disables the store-install button. Existing development connections can still be repaired. Do not substitute an unpacked extension ID for a store identity.

## Package and submission

1. Run `npm ci` and `npm run plugins:bundle`. The submission ZIP is `src-tauri/resources/plugins/beaconhop-edge.zip`. It contains the Manifest V3 extension, popup assets, icons and license. The VSIX and SHA-256 payload metadata are built in the same step.
2. In [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview), create an Edge extension listing and upload the ZIP. The publisher account, public support details, privacy-policy URL and listing assets must belong to the project owner. Review the [official submission requirements](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
3. Suggested single purpose: **Switch to the browser tab you need from BeaconHop's keyboard navigation panel.** Describe switching tabs in the focused browser window, favicons and optional cached previews. Explain that the BeaconHop desktop application is required.
4. Permission justifications: `tabs` enumerates tab titles, URLs and window identities and activates the selected tab; `nativeMessaging` communicates with the installed BeaconHop application; `alarms` retries the local connection; `favicon` reads browser-cached site icons. Optional `<all_urls>` is requested only when the user enables previews, to capture the page they are already viewing. Preview capture never switches to hidden tabs. No remotely hosted code is loaded.
5. Publish the reviewed [privacy notice](PRIVACY.md) at an owner-controlled public URL and use that URL in the listing. This repository file alone does not publish the notice. Provide screenshots of BH's tab switcher and the extension's preview settings, and a reviewer install link for BH. Test with previews both enabled and disabled.
6. After the listing is available, put its exact 32-character ID and official HTTPS listing URL in `plugins/distribution.json`. `npm run plugins:check-release` validates the pair and builds the payloads. The public-package workflow refuses publication while the listing is absent. Build-only jobs remain available.

## Release acceptance

On a clean, ordinary Windows account and on macOS: install BH, install Edge, click the BH installation button, confirm Edge's prompt, and verify that the Edge card changes to Connected without copying any IDs. Press the configured tab shortcut in Edge and activate a tab, then repeat in a second browser window. Repeat with another Edge profile, with the plugin disabled in BH, after a BH update/move, and after disconnect/reconnect. A Chrome connection must not make the Edge card report Connected. Store review and clean Windows acceptance are separate from packaging or macOS tests.

Edge installation intentionally uses the store confirmation flow. Microsoft documents alternative external distribution, but that still needs a valid distribution identity and is not a substitute for publication: [distribution options](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/alternate-distribution-options).
