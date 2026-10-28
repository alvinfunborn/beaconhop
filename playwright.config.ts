import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  outputDir: "logs/playwright",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:1437",
    viewport: { width: 1020, height: 760 },
    locale: "en-US",
    colorScheme: "dark",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1437",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
