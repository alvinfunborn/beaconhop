# BeaconHop 1.0.0

Desktop, browser extension, VS Code extension and plugin SDK use version 1.0.0.

- Include all local navigation, presentation, preview and workspace file search changes.
- Wait for committed web layouts before showing native panels; preserve overview positions during filtering and two-key hints.
- Keep browser inventory and preview requests separate; retain bounded local preview caches across reopenings and invalidate changed pages.
- Search unopened VS Code workspace files by name or path through the local SDK, with exact activation and stale-response rejection.
- Add shared plugin icons and public download, privacy, support and setup pages.

Local verification: 120 Rust tests passed (2 ignored); 95 Playwright UI tests; 10 SDK/file matching tests; 10 browser/native-host/plugin-manager tests; 3 payload/update-manifest checks. TypeScript/Vite and native macOS debug builds passed. A real isolated VS Code host passed tab enumeration, exact activation, workspace search across 2100 files, exclusions, cache invalidation and image editor checks. macOS and Windows native builds, Rust/UI checks and browser/native-host tests passed in CI. Native Windows interaction and a real cross-version updater installation remain separate acceptance.

Chrome and Edge 1.0.0 are submitted and awaiting store review; VS Code 1.0.0 is publicly available. While its public listing is unavailable, the Edge store-install button remains disabled; existing developer-mode native connections can continue to work. Chrome and VS Code store versions are verified separately from the desktop package.
