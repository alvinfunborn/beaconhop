import {test, expect, type Page} from '@playwright/test';
test.use({reducedMotion:'reduce'});

const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#315d83"/></svg>');
async function fixture(page: Page, delayCache = false) {
  // Count real production layouts, excluding React's development-only double render.
  await page.route('**/src/main.tsx', async route => {
    const response = await route.fetch();
    await route.fulfill({response,body:(await response.text()).replaceAll('React.StrictMode','React.Fragment')});
  });
  await page.route('**/src/performance.ts', async route => {
    const response = await route.fetch();
    await route.fulfill({response, body: (await response.text()).replace(/const enabled = .*?;/, 'const enabled = Promise.resolve(true);')});
  });
  await page.route('**/src/api.ts', async route => {
    const response = await route.fetch();
    await route.fulfill({response, body: await response.text() + `
      const initial=structuredClone(session);
      session.mode='inactive';session.overview=[];
      window.__open=()=>{Object.assign(session,initial);session.revision++;emit('session',session);};
      window.__cancel=()=>{session.mode='inactive';session.revision++;emit('session',session);};
      window.__timings=[];window.__fresh=[];
      const cacheReady=${delayCache ? 'new Promise(resolve=>{window.__releaseCache=resolve;})' : 'Promise.resolve()'};
      const originalCall=call;
      call=async function(name,args={}) {
        if(name==='record_performance'){window.__timings.push(args);return;}
        if(name==='get_cached_thumbnails'){
          await cacheReady;
          return Object.fromEntries(args.ids.map(id=>[id,${JSON.stringify(image)}]));
        }
        if(name==='get_thumbnails'){
          window.__fresh.push([...document.querySelectorAll('.window-preview')].filter(n=>n.complete&&n.naturalWidth>0).length);
          await new Promise(resolve=>{window.__releaseFresh=resolve;});
          return Object.fromEntries(args.ids.map(id=>[id,${JSON.stringify(image)}]));
        }
        return originalCall(name,args);
      };
    `});
  });
  await page.goto('/?preview=1&view=switcher&displays=2');
  await expect(page.locator('.window-list')).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>(window as any).__open());
}

test('entering overview packs the measured canvas once, and selection reuses it', async ({page}) => {
  await fixture(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).__timings.filter((t:any)=>t.stage==='overview_frame').length)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>(window as any).__timings.filter((t:any)=>t.stage==='layout').length)).toBe(1);
  const before=await page.getByRole('option').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}));
  await page.evaluate(async()=>{await (await import('/src/api.ts' as string)).call('navigate',{delta:1});});
  await expect(page.getByRole('option',{selected:true})).toHaveCount(1);
  expect(await page.getByRole('option').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}))).toEqual(before);
  expect(await page.evaluate(()=>(window as any).__timings.filter((t:any)=>t.stage==='layout').length)).toBe(1);
});

test('cached thumbnails are decoded and displayed before fresh capture starts', async ({page}) => {
  await fixture(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).__fresh)).toEqual([3]);
  await expect(page.locator('.window-preview')).toHaveCount(3);
  await page.evaluate(()=>(window as any).__releaseFresh());
  await expect.poll(()=>page.evaluate(()=>(window as any).__timings.some((t:any)=>t.stage==='preview_fresh'))).toBe(true);
});

test('canceling while cache loads prevents a deferred capture', async ({page}) => {
  await fixture(page,true);
  await page.evaluate(()=>(window as any).__cancel());
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>(window as any).__releaseCache());
  await expect.poll(()=>page.evaluate(()=>(window as any).__timings.some((t:any)=>t.stage==='preview_cache'))).toBe(true);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await page.evaluate(()=>(window as any).__fresh)).toEqual([]);
});
