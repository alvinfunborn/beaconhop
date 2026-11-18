import {test, expect, type Page} from '@playwright/test';

test.use({reducedMotion:'reduce'});

async function geometry(page:Page) {
  return page.getByRole('option').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>{
    const {x,y,width,height}=node.getBoundingClientRect();
    return [node.id,{x,y,width,height}];
  })));
}

for (const layer of ['windows', 'application', 'tabs', 'desktops']) {
 for (const layout of ['grid','list']) {
  test(`${layer} ${layout}: hint input and Backspace keep preview geometry`, async ({page}) => {
    await page.route('**/src/api.ts', async route => {
      const response = await route.fetch();
      await route.fulfill({response, body: await response.text() + `
        session.windows=session.windows.slice(0,3).map((w,i)=>({...w,hint:['AS','AD','SA'][i]}));
        session.resultIds=session.windows.map(w=>w.id);
        config.layout=${JSON.stringify(layout)};
        window.addEventListener('keydown',event=>{
          if(event.key==='Backspace')session.prefix=session.prefix.slice(0,-1);
          else if(event.key.toUpperCase()==='A')session.prefix+='A';
          else return;
          event.preventDefault();
          session.resultIds=session.windows.filter(w=>w.hint.startsWith(session.prefix)).map(w=>w.id);
          session.revision++;emit('session',session);
        });
      `});
    });
    await page.goto(`/?preview=1&view=switcher&layer=${layer}`);
    const hints=page.locator('.window-hint:visible');
    await expect(hints).toHaveText(['AS','AD','SA']);
    const original=await geometry(page);
    await page.keyboard.press('a');
    await expect(hints).toHaveText(['S','D']);
    expect(await geometry(page)).toEqual(Object.fromEntries(Object.entries(original).slice(0,2)));
    await expect(page.locator('#window-2')).toBeHidden();
    // Hidden cards retain the canvas extent and their existing DOM/previews.
    await expect(page.locator('.window-card')).toHaveCount(3);
    await page.keyboard.press('Backspace');
    await expect(hints).toHaveText(['AS','AD','SA']);
    expect(await geometry(page)).toEqual(original);
    await page.keyboard.press('a');
    await expect(hints).toHaveText(['S','D']);
    expect(await geometry(page)).toEqual(Object.fromEntries(Object.entries(original).slice(0,2)));
  });
 }
}

test('hint filtering preserves the scroll position and full text canvas',async({page})=>{
  await page.route('**/src/api.ts',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:await response.text()+`
      session.windows=Array.from({length:60},(_,i)=>({...session.windows[0],id:String(i),hint:i<2?'A'+['S','D'][i]:'SA',
        content:{...session.windows[0].content,presentation:'text',provider:'vscode'}}));
      session.resultIds=session.windows.map(w=>w.id);session.selected='30';
      window.addEventListener('keydown',event=>{
        if(event.key==='Backspace')session.prefix='';else if(event.key==='a')session.prefix='A';else return;
        event.preventDefault();session.resultIds=session.windows.filter(w=>w.hint.startsWith(session.prefix)).map(w=>w.id);
        if(session.prefix)session.selected='0';session.revision++;emit('session',session);
      });
    `});
  });
  await page.goto('/?preview=1&view=switcher&layer=tabs');
  await expect(page.getByRole('option')).toHaveCount(60);
  const canvas=page.locator('.window-list');
  await expect.poll(()=>canvas.evaluate(n=>n.scrollTop)).toBeGreaterThan(0);
  const before=await canvas.evaluate(n=>({top:n.scrollTop,height:n.scrollHeight}));
  const original=await geometry(page);
  await page.keyboard.press('a');await expect(page.getByRole('option')).toHaveCount(2);
  expect(await canvas.evaluate(n=>({top:n.scrollTop,height:n.scrollHeight}))).toEqual(before);
  expect(await geometry(page)).toEqual(Object.fromEntries(Object.entries(original).slice(0,2)));
  await page.keyboard.press('Backspace');await expect(page.getByRole('option')).toHaveCount(60);
  expect(await canvas.evaluate(n=>({top:n.scrollTop,height:n.scrollHeight}))).toEqual(before);
  expect(await geometry(page)).toEqual(original);
});

test('unhinted targets keep the warning and canvas height stable while filtering',async({page})=>{
  await page.route('**/src/api.ts',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:await response.text()+`
      session.windows=session.windows.slice(0,4).map((w,i)=>({...w,hint:['AS','AD','SA',''][i]}));
      session.resultIds=session.windows.map(w=>w.id);
      window.addEventListener('keydown',event=>{
        if(event.key==='a')session.prefix='A';else if(event.key==='Backspace')session.prefix='';else return;
        event.preventDefault();session.resultIds=session.windows.filter(w=>w.hint.startsWith(session.prefix)).map(w=>w.id);
        session.revision++;emit('session',session);
      });
    `});
  });
  await page.goto('/?preview=1&view=switcher');
  await expect(page.getByRole('option')).toHaveCount(4);
  const original=await geometry(page);
  await page.keyboard.press('a');await expect(page.getByRole('option')).toHaveCount(2);
  await expect(page.locator('.switcher-warning')).toBeVisible();
  expect(await geometry(page)).toEqual(Object.fromEntries(Object.entries(original).slice(0,2)));
  await page.keyboard.press('Backspace');await expect(page.getByRole('option')).toHaveCount(4);
  expect(await geometry(page)).toEqual(original);
});
