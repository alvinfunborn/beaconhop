import { test, expect, type Page } from "@playwright/test";

async function permissionsFixture(page: Page, keyboardHook: boolean) {
  await page.route("**/src/api.ts", async (route) => {
    const response = await route.fetch();
    let body = (await response.text())
      .replace(/inputMonitoring:\s*true/, "inputMonitoring: false")
      .replace(/screenRecording:\s*true/, "screenRecording: false");
    if (!keyboardHook) {
      body = body.replace(/keyboardHook:\s*true/, "keyboardHook: false")
        .replace(/ready:\s*true/, "ready: false");
    }
    await route.fulfill({ response, body });
  });
}

test("a working listener needs no Input Monitoring grant and screen settings gives feedback", async ({ page }) => {
  await permissionsFixture(page, true);
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "System & access", exact: true }).click();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await expect(page.getByText("Input monitoring", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Keyboard troubleshooting", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open Screen recording settings", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("System Settings opened. Enable BeaconHop, then return here.");
});

test("Input Monitoring is available as collapsed recovery when the listener is unavailable", async ({ page }) => {
  await permissionsFixture(page, false);
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "System & access", exact: true }).click();
  await expect(page.getByText("Not ready", { exact: true })).toBeVisible();
  const inputSettings = page.getByRole("button", { name: "Open Input monitoring settings", exact: true });
  await expect(inputSettings).not.toBeVisible();
  await page.getByText("Keyboard troubleshooting", { exact: true }).click();
  await expect(inputSettings).toBeVisible();
  await expect(page.getByText("Optional keyboard-listener recovery.", { exact: true })).toBeVisible();
});
test("settings save preserves independent scopes and supports discard", async ({
  page,
}) => {
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "Window scope", exact: true }).click();
  await page.getByLabel("Virtual desktops").selectOption("current");
  await expect(page.getByLabel("Displays", { exact: true })).toHaveValue("all");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Settings saved");
  await page.getByLabel("Displays", { exact: true }).selectOption("current");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByLabel("Virtual desktops")).toHaveValue("current");
  await expect(page.getByLabel("Displays", { exact: true })).toHaveValue("all");
});
test("Chinese IME composition cannot activate a window", async ({ page }) => {
  await page.goto("/?preview=1&view=switcher");
  await page.evaluate(async () => {
    const api = await import("/src/api.ts" as string);
    await api.call("open_search");
  });
  const input = page.getByRole("textbox", { name: "Search windows" });
  await expect(input).toBeFocused();
  await input.dispatchEvent("compositionstart");
  await input.fill("周末");
  await input.press("Enter");
  await expect(page.getByRole("option")).toHaveCount(6);
  await input.dispatchEvent("compositionend", { data: "周末" });
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toContainText("周末计划");
});
test("search navigation and empty results are accessible", async ({ page }) => {
  await page.goto("/?preview=1&view=switcher");
  await expect(page.getByRole("option")).toHaveCount(6);
  await page.screenshot({ path: "logs/switcher-dark.png" });
  await page.evaluate(async () => {
    const api = await import("/src/api.ts" as string);
    await api.call("open_search");
  });
  await page.getByRole("textbox").fill("zzzznothing");
  await expect(page.getByText("No matching windows")).toBeVisible();
  await page.getByRole("textbox").fill("");
  await page.getByRole("textbox").press("ArrowRight");
  await expect(page.locator('[aria-selected="true"]')).toContainText("Figma");
  await page.getByRole("textbox").press("Tab");
  await expect(page.locator('[aria-selected="true"]')).toContainText(
    "Visual Studio Code",
  );
});
test("settings and light theme fit the minimum window without horizontal scrolling", async ({
  page,
}) => {
  await page.goto("/?preview=1");
  await page.screenshot({ path: "logs/settings-dark.png" });
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByLabel("Theme", { exact: true }).selectOption("light");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.setViewportSize({ width: 760, height: 580 });
  await page.screenshot({ path: "logs/settings-light-small.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeInViewport();
});
