# BeaconHop Tabs store submissions

Submission copy for VS Code Marketplace, Microsoft Edge Add-ons and Chrome Web Store.
Creating a publisher or uploading a draft does not mean the extension is submitted,
approved or publicly available. Record those states separately for each store.

## Packages

- VS Code: `src-tauri/resources/plugins/beaconhop-tabs.vsix`, version 1.0.0.
- Edge and Chrome: `src-tauri/resources/plugins/beaconhop-edge.zip`, version 1.0.0.
  Both browsers use the same Chromium extension package. Store-assigned IDs differ;
  register each browser's native host with its own published extension ID.
- Build: `npm run plugins:bundle`.
- Check: `npm run test:plugins` and `node --test scripts/test-plugin-payloads.mjs`.
- Logo: `plugins/vscode/icon.png` (256 x 256) and `plugins/browser/icons/128.png`.

## Browser listing

Name: **BeaconHop Tabs**

Short description: **Switch tabs in the focused browser window with BeaconHop.**

Category: Productivity. Price: Free. Visibility: Public.

Description:

> Find and switch browser tabs from BeaconHop's keyboard navigation panel.
>
> BeaconHop Tabs connects your browser to the BeaconHop desktop application.
> Keep BeaconHop running, focus a browser window, then use the tab shortcut
> configured in BeaconHop to choose an open tab by its title or website address.
> Website icons help you recognize tabs quickly.
>
> Optional previews show small cached images of pages you have visited. Enable
> previews in the extension popup if you want them. Previews stay in local memory;
> private browsing tabs are excluded. Turn previews off to clear the extension's
> cache and revoke its optional website permission.
>
> Tab information, website icons and previews are sent only to the locally
> installed BeaconHop application. This extension contains no advertising,
> analytics or remotely hosted executable code.
>
> Requires the BeaconHop desktop application on macOS or Windows. Installing this
> extension alone does not install the desktop application. Basic tab switching
> works without enabling previews.

Search terms: tab switcher, keyboard navigation, productivity, BeaconHop.

### Privacy form

Single purpose:

> Connect the current browser to BeaconHop's local keyboard navigation panel so
> the user can find and activate an open tab, with optional local page previews.

Permission justifications:

- `tabs`: enumerate open tab titles, URLs and window/tab IDs; activate the exact
  tab selected by the user in BeaconHop.
- `nativeMessaging`: exchange tab inventories, activation commands and optional
  cached previews with the locally installed BeaconHop native host.
- `alarms`: retry the local native-host connection after interruption.
- `favicon`: obtain browser-cached website icons for recognizing tab targets.
- Optional `<all_urls>`: requested only when the user enables previews; Chromium
  requires this permission to capture a visible page without a toolbar click on
  each capture. Capture follows visits to visible HTTP(S) pages; it never
  activates a background tab to take a screenshot. Private tabs are excluded.

Remote code: **No**. Data sales: **No**. Advertising: **No**. Analytics: **No**.
The extension processes URLs/titles and optional page images locally. Answer each
store's current data-handling questions according to that processing and the
wording of its form; local processing is not a claim that no sensitive data is
accessed. Privacy policy content: [`browser/PRIVACY.md`](browser/PRIVACY.md).

### Reviewer instructions

1. Download and install BeaconHop from the public download URL supplied in the
   submission. Grant the desktop permissions requested for keyboard navigation.
2. Install this extension and start BeaconHop. In BeaconHop's Application plugins
   settings, enable the browser plugin and connect the store extension. The
   desktop app's native-host registration must include this store's extension ID.
3. Open two ordinary browser tabs in the same window. Focus that window, invoke
   BeaconHop's configured tab shortcut, and select the other tab. Confirm the
   correct tab is activated. Repeat in another browser window.
4. Open the extension popup. Confirm the local connection is reported. Basic
   switching must work with previews disabled.
5. Enable previews, grant the optional website permission, and visit an ordinary
   HTTP(S) page. Reopen the tab panel and check its cached preview. Disable previews
   and verify the extension cache is cleared.
6. No account or login is required inside the extension or desktop integration.

## VS Code listing

Publisher ID: `beaconhop` (must be created in the owner's Marketplace account).
Extension ID: `beaconhop.beaconhop-tabs`. Category: Other. Price: Free.

The packaged [`vscode/README.md`](vscode/README.md) is the Marketplace description.
It documents open-tab switching and the desktop application requirement. Version
1.0.0 adds workspace file search, the shared icon and public download/support/privacy links. Extension code executes in the local UI extension host;
workspace enumeration uses VS Code's API and may reach remote workspace folders.
It does not search or read file contents.

## Verified status on 2026-11-18

- Repository is public: https://github.com/alvinfunborn/beaconhop .
- GitHub Pages download/privacy/setup pages are live: https://alvinfunborn.github.io/beaconhop/ .
- VS Code 1.0.0 is public: https://marketplace.visualstudio.com/items?itemName=beaconhop.beaconhop-tabs .
- Chrome 1.0.0 submitted; dashboard status is Pending review; automatic publication after approval is enabled. Extension ID: `ibfbnolmkggfokdaohfdobfjklcccjma`.
- Edge 1.0.0 submitted; dashboard status is In review. CRX ID: `acidkhplkenimagnendhehianijedgdf`; Store ID: `0RDCKGFLH5K7`. The public listing URL remains unavailable until approval. Its listing includes the shared icon, a real product screenshot, public privacy/support links and native-host reviewer instructions.
- Chrome listing includes a real connected extension popup screenshot, public privacy URL, support URL and reviewer setup instructions. Browsing history and website content are disclosed as local processing.

## Submission requirements

- A publicly accessible BeaconHop desktop download, usable by reviewers and users.
  Public release downloads are now available from the repository.
- A public privacy-policy URL and a public support contact supplied by the owner.
  The public Pages privacy policy and repository issues are supplied.
- Chrome requires at least one genuine product screenshot (1280 x 800 or
  640 x 400). Do not substitute a simulated connection or generated UI for real
  product evidence. See the store's current image requirements when uploading.
- Complete publisher registration/security checks in each owner's store account.
- After approval, record the exact public listing URLs and extension IDs. Fill
  `plugins/distribution.json` with the real Edge listing, then run
  `npm run plugins:check-release`. Chrome's ID needs its own native-host
  registration; an Edge listing does not prove Chrome installation is connected.

## Official references

- [VS Code publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Edge submission](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
- [Chrome submission](https://developer.chrome.com/docs/webstore/publish)
- [Chrome images](https://developer.chrome.com/docs/webstore/images)
