import { test, expect } from "@playwright/test";

test("missing SB has installation guidance and never treats an old public release as compatible", async ({ page }) => {
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "Screen Buoy", exact: true }).click();
  await expect(page.getByText("Screen Buoy was not found.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Screen Buoy settings", exact: true })).toBeDisabled();
  const toggle = page.getByRole("switch", { name: "Enable Screen Buoy integration" });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(page.getByText("Connected to SB", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Download Screen Buoy for macOS" }).click();
  await expect(page.getByText(/latest public release .* does not support this integration yet/)).toBeVisible();
  await expect(page.getByText(/Unzip the download and move/)).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(toggle).toBeChecked();
});

test("old installation offers update without starting it, with an explicit path override", async ({ page }) => {
  await page.goto("/?preview=1&sb=old");
  await page.getByRole("button", { name: "Screen Buoy", exact: true }).click();
  await expect(page.getByText(/this version needs an integration update/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Check connection and permissions" })).toBeDisabled();
  await page.getByText("Installed somewhere else?", { exact: true }).click();
  await page.getByLabel("Screen Buoy application path", { exact: true }).fill("/Custom/ScreenBuoy.app");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByLabel("Screen Buoy application path", { exact: true }).fill("/Missing.app");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByLabel("Screen Buoy application path", { exact: true })).toHaveValue("/Custom/ScreenBuoy.app");
});

test("SB owns its permissions and connection check does not claim successful window hints", async ({ page }) => {
  await page.goto("/?preview=1&sb=permissions");
  await page.getByRole("button", { name: "Screen Buoy", exact: true }).click();
  await page.getByRole("button", { name: "Check connection and permissions" }).click();
  await expect(page.getByText(/Connected, but setup is incomplete/)).toBeVisible();
  await expect(page.getByText("Accessibility: Not granted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open Screen Buoy settings", exact: true }).click();
  await expect(page.getByText(/Screen Buoy settings opened/)).toBeVisible();
});

test("left right and fixed keys round trip without removing hint characters", async ({ page }) => {
  await page.goto("/?preview=1&sb=ready");
  await page.evaluate(async () => {
    const api = await import("/src/api.ts" as string);
    const config = await api.call("get_settings");
    config.hintAlphabet = "AJ?/ ";
    await api.call("save_settings", { config });
  });
  await page.getByRole("button", { name: "Screen Buoy", exact: true }).click();
  await page.getByRole("switch", { name: "Enable Screen Buoy integration" }).click();
  await page.getByLabel("HintLeftKey · Left neighbour").check();
  await page.getByRole("button", { name: "Add key", exact: true }).click();
  await page.getByText("Left / right mapping for the current hint alphabet", { exact: true }).click();
  await expect(page.getByLabel("/ left", { exact: true })).toHaveValue(".");
  await page.getByLabel("Space right", { exact: true }).selectOption("ArrowRight");
  await page.getByRole("button", { name: "Save changes" }).click();
  const config = await page.evaluate(async () => (await import("/src/api.ts" as string)).call("get_settings"));
  expect(config.hintAlphabet).toBe("AJ?/ ");
  expect(config.screenBuoy.keys).toEqual(["HintLeftKey", "HintRightKey", "Enter"]);
  expect(config.screenBuoy.neighbours.Space.right).toBe("ArrowRight");
  await page.getByRole("button", { name: "Check connection and permissions" }).click();
  await expect(page.getByText("Permissions and keyboard input are ready.")).toBeVisible();
  await page.setViewportSize({ width: 820, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("switch", { name: "Enable Screen Buoy integration" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "logs/screen-buoy-setup.png" });
});

test("failed release lookup stays retryable and shows an error", async ({ page }) => {
  await page.route("**/src/api.ts", async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('case "get_screen_buoy_download":', 'case "get_screen_buoy_download": throw new Error("Download unavailable: network offline");');
    await route.fulfill({ response, body });
  });
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "Screen Buoy", exact: true }).click();
  const button = page.getByRole("button", { name: "Download Screen Buoy for macOS" });
  await button.click();
  await expect(page.getByRole("alert")).toHaveText(/network offline/);
  await expect(button).toBeEnabled();
  await expect(page.getByRole("button", { name: "Official releases" })).toBeEnabled();
});

test("Windows offers its installer and opening a download never counts as installation", async ({ page }) => {
  await page.route("**/src/api.ts", async route => {
    const response = await route.fetch();
    const body = (await response.text())
      .replace('platform: "macos"', 'platform: "windows"')
      .replace('case "get_screen_buoy_download":', 'case "get_screen_buoy_download": value = { version: "v1.5.0", compatible: true }; break;');
    await route.fulfill({ response, body });
  });
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "Screen Buoy", exact: true }).click();
  await page.getByRole("button", { name: "Download Screen Buoy for Windows" }).click();
  await expect(page.getByText(/Download opened in your browser/)).toBeVisible();
  await expect(page.getByText(/Run the downloaded Windows installer/)).toBeVisible();
  await expect(page.getByText("Screen Buoy was not found.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check connection and permissions" })).toBeDisabled();
});
