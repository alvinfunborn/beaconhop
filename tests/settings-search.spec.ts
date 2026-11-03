import { test, expect } from "@playwright/test";

test("settings search navigates by keyboard and preserves an unsaved draft", async ({ page }) => {
  await page.goto("/?preview=1");
  await page.getByRole("switch", { name: "Hold to switch", exact: true }).click();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search settings" });
  const search = dialog.getByRole("combobox");
  await expect(search).toBeFocused();
  await search.fill("hint style");
  await search.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("#hint-appearance")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Hint style", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
  await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Hold to switch", exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Hold to switch", exact: true })).toBeChecked();
});

test("search supports empty results, IME, Escape and focus restoration", async ({ page }) => {
  await page.goto("/?preview=1");
  const trigger = page.getByRole("button", { name: "Search settings", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("combobox");
  await input.fill("unmatched-setting");
  await expect(dialog.getByText("No matching settings", { exact: true })).toBeVisible();
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(dialog).toBeVisible();
  await input.fill("hint");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(dialog).toBeVisible();
  await input.press("ArrowDown");
  await expect(input).toHaveAttribute("aria-activedescendant", "settings-result-1");
  await input.press("Escape");
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Hold shortcut", exact: true }).click();
  await page.keyboard.press("Control+k");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Hold shortcut", exact: true })).toContainText("Ctrl + K");
});

test("localized search reaches permissions at the minimum window size", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 580 });
  await page.goto("/?preview=1");
  await page.evaluate(async () => {
    const api = await import("/src/api.ts" as string);
    await api.call("save_settings", { config: { ...await api.call("get_settings"), language: "zh" } });
  });
  await page.getByRole("button", { name: "搜索设置", exact: true }).click();
  const input = page.getByRole("combobox");
  await input.fill("辅助功能");
  await expect(page.getByRole("option")).toHaveCount(1);
  await input.press("Enter");
  await expect(page.locator("#permissions-settings")).toBeFocused();
  await expect(page.getByRole("heading", { name: "权限与运行状态", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "保存设置", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
