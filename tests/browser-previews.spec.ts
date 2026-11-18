import {test, expect} from '@playwright/test';

test('tab previews survive reopening and invalidate on navigation or lost availability', async ({page}) => {
  await page.route('**/src/api.ts', async route => {
    const response = await route.fetch();
    await route.fulfill({response, body: await response.text() + `
      const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO9sAAAAASUVORK5CYII=';
      session.windows.forEach(w=>{w.content.preview=true;});
      window.__reads=0;window.__blockReads=false;
      const originalCall=call;
      call=async function(name,args){
        if(name==='get_tab_thumbnails'){
          window.__reads++;
          if(window.__blockReads)return new Promise(()=>{});
          return Object.fromEntries(args.ids.map(id=>[id,pixel]));
        }
        return originalCall(name,args);
      };
      window.__reopen=function(change){
        window.__blockReads=true;
        if(change==='url')session.windows[0].content.subtitle='https://changed.test';
        if(change==='unavailable')session.windows[1].content.preview=false;
        session.sessionId++;emit('session',session);
      };
    `});
  });
  await page.goto('/?preview=1&view=switcher&layer=tabs');
  await expect(page.locator('img.window-preview')).toHaveCount(6);
  const reads = await page.evaluate(() => (window as any).__reads);
  await page.evaluate(() => (window as any).__reopen());
  await expect.poll(() => page.evaluate(() => (window as any).__reads)).toBeGreaterThan(reads);
  // The second read never resolves: warm images must already be visible.
  await expect(page.locator('img.window-preview')).toHaveCount(6);
  await page.evaluate(() => (window as any).__reopen('url'));
  await expect(page.locator('img.window-preview')).toHaveCount(5);
  await page.evaluate(() => (window as any).__reopen('unavailable'));
  await expect(page.locator('img.window-preview')).toHaveCount(4);
});
