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
  await expect(page.locator('[aria-selected="true"]')).toContainText("Visual Studio Code");
  await page.getByRole("textbox").press("Tab");
  await expect(page.locator('[aria-selected="true"]')).toContainText("Safari");
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

test("shortcut recording accepts Win+backquote, repeats the current value and restores default", async ({ page }) => {
  await page.goto("/?preview=1");
  const search = page.getByRole("button", { name: "Search shortcut", exact: true });
  await search.click();
  await expect(search).toHaveAttribute("aria-pressed", "true");
  await search.press("Meta+Backquote");
  await expect(search).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Shortcut unchanged", { exact: true })).toBeVisible();
  await search.click();
  await search.press("Meta+Digit7");
  await expect(search).toContainText("7");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Restore default Search shortcut", exact: true }).click();
  await expect(search).toContainText("`");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();
  await search.click();
  await search.press("Escape");
  await expect(search).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Recording cancelled", { exact: true })).toBeVisible();
});

for (const count of [6, 24, 80]) {
  test(`all ${count} windows fit without scrolling and preserve portrait/landscape aspect`, async ({ page }) => {
    await page.route("**/src/api.ts", async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      body += `\nsession.windows = Array.from({length:${count}}, (_, i) => ({...session.windows[i % 6], id:String(i), hint:String(i), bounds:{x:0,y:0,width:i%3===0?600:1440,height:i%3===0?1000:900}})); session.resultIds=session.windows.map(w=>w.id);`;
      await route.fulfill({ response, body });
    });
    await page.setViewportSize({ width: 1000, height: 680 });
    await page.goto("/?preview=1&view=switcher");
    const cards = page.getByRole("option");
    await expect(cards).toHaveCount(count);
    await expect(async () => {
      const geometry = await page.evaluate(() => {
        const list = document.querySelector(".window-list")!;
        const area = list.getBoundingClientRect();
        return { scroll: list.scrollHeight > list.clientHeight || list.scrollWidth > list.clientWidth,
          cards: [...document.querySelectorAll(".window-card")].map((el) => {
            const r = el.getBoundingClientRect(), p = el.querySelector(".preview-frame")!.getBoundingClientRect();
            return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height, ratio:p.width/p.height };
          }), area: { x:area.x, y:area.y, right:area.right, bottom:area.bottom } };
      });
      expect(geometry.scroll).toBe(false);
      geometry.cards.forEach((r, i) => {
        expect(r.width).toBeGreaterThan(0);
        expect(r.height).toBeGreaterThan(0);
        expect(r.x).toBeGreaterThanOrEqual(geometry.area.x);
        expect(r.y).toBeGreaterThanOrEqual(geometry.area.y);
        expect(r.right).toBeLessThanOrEqual(geometry.area.right);
        expect(r.bottom).toBeLessThanOrEqual(geometry.area.bottom);
        expect(Math.abs(r.ratio - (i%3===0 ? .6 : 1.6))).toBeLessThan(.07);
        for (const other of geometry.cards.slice(i+1))
          expect(r.right <= other.x+.5 || other.right <= r.x+.5 || r.bottom <= other.y+.5 || other.bottom <= r.y+.5).toBe(true);
      });
    }).toPass();
    await page.screenshot({ path: `logs/tiles-${count}.png` });
    await page.setViewportSize({ width: 760, height: 580 });
    await expect(async () => {
      expect(await page.locator(".window-list").evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true);
      for (let i = 0; i < count; i++) await expect(cards.nth(i)).toBeInViewport({ ratio: 1 });
    }).toPass();
    await page.evaluate(async () => {
      const api = await import("/src/api.ts" as string);
      const config = await api.call("get_settings");
      await api.call("save_settings", { config: { ...config, layout: "list" } });
    });
    await expect(async () => {
      expect(await page.locator(".window-list").evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true);
      for (let i = 0; i < count; i++) await expect(cards.nth(i)).toBeInViewport({ ratio: 1 });
    }).toPass();
  });
}

test("both shortcut editors record punctuation, allow manual input and restore independently", async ({ page }) => {
  await page.goto("/?preview=1");
  const hold = page.getByRole("button", { name: "Hold shortcut", exact: true });
  const search = page.getByRole("button", { name: "Search shortcut", exact: true });
  await expect(page.getByRole("button", { name: /^Restore default / })).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Enter .* manually$/ })).toHaveCount(2);
  await search.click();
  await search.press("Meta+Backslash");
  await expect(search).toHaveText(/\\/);
  await expect(search).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Save changes" }).click();
  let settings = await page.evaluate(async () => (await import("/src/api.ts" as string)).call("get_settings"));
  expect(settings.searchShortcut).toBe("Super+Backslash");
  await page.getByRole("button", { name: "Enter Search shortcut manually", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Search shortcut text", exact: true });
  await text.fill("Win + `");
  await text.press("Enter");
  await expect(search).toContainText("`");
  await page.getByRole("button", { name: "Save changes" }).click();
  settings = await page.evaluate(async () => (await import("/src/api.ts" as string)).call("get_settings"));
  expect(settings.searchShortcut).toBe("Super+Backquote");
  await page.getByRole("button", { name: "Enter Hold shortcut manually", exact: true }).click();
  await page.getByRole("textbox", { name: "Hold shortcut text", exact: true }).fill("Ctrl + \\");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(hold).toHaveText(/Ctrl.*\\/);
  await page.getByRole("button", { name: "Restore default Hold shortcut", exact: true }).click();
  await expect(hold).toContainText("Tab");
  await expect(search).toContainText("`");
  await page.getByRole("button", { name: "Enter Search shortcut manually", exact: true }).click();
  await text.fill("Win + Unsupported");
  await text.press("Enter");
  await expect(text).toBeVisible();
  await expect(page.getByText(/Use a modifier and key/)).toBeVisible();
  await text.press("Escape");
  await expect(text).toHaveCount(0);
  await expect(search).toContainText("`");
});

test("missing access opens setup, stays visible on other pages and refreshes after granting", async ({ page }) => {
  await page.route("**/src/api.ts", async route => {
    const response = await route.fetch();
    const body = (await response.text())
      .replace(/accessibility:\s*true/, "accessibility: globalThis.__granted ?? false")
      .replace(/keyboardHook:\s*true/, "keyboardHook: globalThis.__granted ?? false")
      .replace(/ready:\s*true/, "ready: globalThis.__granted ?? false")
      .replace(/screenRecording:\s*true/, "screenRecording: globalThis.__granted ?? false");
    await route.fulfill({ response, body });
  });
  await page.goto("/?preview=1");
  const setup = page.getByRole("region", { name: "Finish setting up BeaconHop" });
  await expect(setup).toBeVisible();
  await expect(page.getByRole("button", { name: "System & access", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(setup.getByRole("button", { name: "Open Accessibility settings", exact: true })).toBeInViewport();
  await page.screenshot({ path: "logs/permission-startup.png" });
  await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Allow access to start switching windows");
  await page.getByRole("button", { name: "Enter Search shortcut manually", exact: true }).click();
  await page.getByRole("textbox", { name: "Search shortcut text", exact: true }).fill("Win + \\");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();
  await page.screenshot({ path: "logs/shortcut-manual-no-access.png" });
  await page.evaluate(() => { (window as any).__granted = true; window.dispatchEvent(new Event("focus")); });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".sidebar-bottom")).toContainText("Ready to hop");
  await expect(page.getByRole("button", { name: "Shortcuts", exact: true })).toHaveAttribute("aria-current", "page");
});

test("hints stay centered with strong contrast on light and dark thumbnail content", async ({ page }) => {
  await page.goto("/?preview=1&view=switcher");
  for (const background of ["#ffffff", "#111111"]) {
    await page.locator(".preview-frame").evaluateAll((nodes, background) => nodes.forEach(node => (node as HTMLElement).style.background = background), background);
    const hints = await page.locator(".window-hint").evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect(), p = node.parentElement!.getBoundingClientRect(), style = getComputedStyle(node);
      return { dx: Math.abs(r.x+r.width/2-p.x-p.width/2),dy:Math.abs(r.y+r.height/2-p.y-p.height/2),bg:style.backgroundColor,fg:style.color };
    }));
    expect(hints.length).toBe(6);
    for (const hint of hints) {
      expect(hint.dx).toBeLessThan(1);expect(hint.dy).toBeLessThan(1);
      expect(hint.bg).toBe("rgb(255, 207, 72)");expect(hint.fg).toBe("rgb(25, 19, 10)");
    }
  }
  await page.screenshot({path:"logs/hints-centered-contrast.png"});
});

test("a cached thumbnail batch appears while refresh waits and stale sessions cannot publish", async ({ page }) => {
  await page.route("**/src/api.ts", async route => {
    const response = await route.fetch();
    const extra = `
const pixel = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" fill="gold"/></svg>');
const originalCall = call;
call = async function(name, args = {}) {
 if (name === 'get_thumbnail') throw new Error('Per-card requests are forbidden');
 if (name === 'get_cached_thumbnails') return Object.fromEntries(args.ids.map(id => [id,pixel]));
 if (name === 'get_thumbnails') { globalThis.__batchCount = (globalThis.__batchCount || 0)+1;
  await new Promise(resolve => globalThis.__finishPreviews = resolve);
  return Object.fromEntries(args.ids.map(id => [id,pixel+'#fresh']));
 }
 return originalCall(name,args);
};`;
    await route.fulfill({response,body:(await response.text())+extra});
  });
  await page.goto("/?preview=1&view=switcher");
  await expect(page.locator(".window-preview")).toHaveCount(6);
  expect(await page.evaluate(() => (window as any).__batchCount)).toBe(1);
  await page.evaluate(async () => {
    const api = await import("/src/api.ts" as string);
    await api.call("open_search");
  });
  await expect(page.getByRole("textbox",{name:"Search windows",exact:true})).toBeVisible();
  await page.evaluate(async () => {
    const api = await import("/src/api.ts" as string);
    await api.call("cancel");
  });
  await expect(page.getByRole("textbox",{name:"Search windows",exact:true})).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__finishPreviews();
  });
  await page.waitForTimeout(100);
  expect(await page.locator(".window-preview").first().getAttribute("src")).not.toContain("#fresh");
});

test("settings restart stays visible and protects unsaved changes", async ({ page }) => {
  await page.goto("/?preview=1");
  const restart=page.getByRole("button",{name:"Restart BeaconHop",exact:true});
  await expect(restart).toBeInViewport();await expect(restart).toBeEnabled();
  await page.getByRole("button",{name:"Restore default Search shortcut",exact:true}).click();
  await page.getByRole("button",{name:"Enter Search shortcut manually",exact:true}).click();
  await page.getByRole("textbox",{name:"Search shortcut text",exact:true}).fill("Ctrl+Q");
  await page.getByRole("button",{name:"Apply",exact:true}).click();
  await expect(restart).toBeDisabled();
  await page.getByRole("button",{name:"Discard",exact:true}).click();
  await expect(restart).toBeEnabled();
  await restart.click();await expect(page.getByRole("status").filter({hasText:"Restarting"})).toBeVisible();
});

test("small adaptive panels keep cards and controls visible", async ({ page }) => {
  await page.route("**/src/api.ts", async route => {
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text())+`\nsession.windows=session.windows.slice(0,1);session.resultIds=['0'];`});
  });
  await page.setViewportSize({width:460,height:396});
  await page.goto("/?preview=1&view=switcher");
  await expect(page.getByRole("option")).toBeInViewport({ratio:1});
  await expect(page.getByRole("button",{name:"Close",exact:true})).toBeInViewport({ratio:1});
  expect(await page.locator(".switcher-footer").evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:"logs/small-adaptive-panel.png"});
});


test("all four arrows navigate the visual grid from the search field",async ({page})=>{
  await page.goto("/?preview=1&view=switcher");
  await page.evaluate(async ()=>{const api=await import("/src/api.ts" as string);await api.call("open_search");await api.call("search",{query:""});});
  const input=page.getByRole("textbox",{name:"Search windows"});
  for (const [key,app] of [["ArrowRight","Visual Studio Code"],["ArrowDown","Notes"],["ArrowLeft","Terminal"],["ArrowUp","Figma"]]) {
    await input.press(key);await expect(page.locator('[aria-selected="true"]')).toContainText(app);
  }
  expect(await page.locator(".switcher").evaluate(el=>getComputedStyle(el).backdropFilter)).toContain("blur");
});
