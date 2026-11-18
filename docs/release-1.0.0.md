# BeaconHop 1.0.0

Desktop, browser extension, VS Code extension and plugin SDK use version 1.0.0.

- Include all local navigation, presentation, preview and workspace file search changes.
- Wait for committed web layouts before showing native panels; preserve overview positions during filtering and two-key hints.
- Keep browser inventory and preview requests separate; retain bounded local preview caches across reopenings and invalidate changed pages.
- Search unopened VS Code workspace files by name or path through the local SDK, with exact activation and stale-response rejection.
- Add shared plugin icons and public download, privacy, support and setup pages.

Local verification: 119 Rust tests passed (2 ignored); 92 Playwright UI tests; 10 SDK/file matching tests; 10 browser/native-host/plugin-manager tests; 3 payload/update-manifest checks. TypeScript/Vite and native macOS debug builds passed. Windows build and checks run in CI. Native Windows interaction and a real cross-version updater installation remain separate acceptance.

Edge submission and account verification are separate from this desktop release. While its public listing is unavailable, the Edge store-install button remains disabled; existing developer-mode native connections can continue to work. Chrome and VS Code store versions are verified separately from the desktop package.
