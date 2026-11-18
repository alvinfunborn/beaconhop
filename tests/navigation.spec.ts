import {test,expect} from '@playwright/test';
test('four layers and continuation keys can be edited and saved',async({page})=>{
  await page.goto('/?preview=1');
  await page.getByRole('button',{name:'Navigation layers',exact:true}).click();
  await expect(page.getByRole('group',{name:'Continue to windows',exact:true}).getByRole('button',{name:'Remove Super'})).toBeVisible();
  await expect(page.getByRole('group',{name:'Continue to application windows',exact:true}).getByRole('button',{name:'Remove Alt'})).toBeVisible();
  const tabs=page.getByRole('group',{name:'Continue to tabs',exact:true});
  await expect(tabs.getByRole('button',{name:'Remove Control'})).toBeVisible();
  await tabs.getByRole('button',{name:'Add key',exact:true}).click();
  await expect(tabs.getByRole('button',{name:'Add key',exact:true})).toBeDisabled();
  await tabs.getByRole('combobox').selectOption('Backspace');
  await tabs.getByRole('button',{name:'Add key',exact:true}).click();
  await tabs.getByRole('button',{name:'Remove Backspace'}).click();
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByText('Settings saved',{exact:true})).toBeVisible();
  const config=await page.evaluate(async()=>(await import('/src/api.ts' as string)).call('get_settings'));
  expect(config.tabsHintKeys).toEqual(['Control','Enter']);
  await page.getByRole('button',{name:'Shortcuts',exact:true}).click();
  await page.getByRole('button',{name:'Navigation layers',exact:true}).click();
  await expect(tabs.getByRole('button',{name:'Remove Control'})).toBeVisible();
  await expect(tabs.getByRole('button',{name:'Remove Enter'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Set up application plugins',exact:true})).toBeVisible();
  await page.setViewportSize({width:760,height:580});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await tabs.scrollIntoViewIfNeeded();
  await page.screenshot({path:'logs/navigation-keys.png'});
});
test('tab search renders URLs and preserves IME and selection behavior',async({page})=>{
  await page.goto('/?preview=1&view=switcher&layer=tabs');
  await expect(page.getByRole('heading',{name:'Tabs & sessions',exact:true})).toBeVisible();
  await page.evaluate(async()=>{const api=await import('/src/api.ts');await api.call('open_search');});
  const input=page.getByRole('textbox',{name:'Search targets'});await input.fill('工作');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('https://example.test/3');
  await input.fill('example.test/4');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('Inbox');
  await page.screenshot({path:'logs/navigation-tabs.png'});
});
test('large tab inventories remain readable and keyboard navigation scrolls to the target',async({page})=>{
  await page.route('**/src/api.ts',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text())+'\nsession.windows=Array.from({length:150},(_,i)=>({...session.windows[0],id:String(i),title:"Tab "+i,hint:""}));session.resultIds=session.windows.map(w=>w.id);session.selected="0";'});
  });
  await page.setViewportSize({width:760,height:580});
  await page.goto('/?preview=1&view=switcher&layer=tabs');
  await expect(page.getByRole('option')).toHaveCount(150);
  await page.evaluate(async()=>{const api=await import('/src/api.ts');await api.call('navigate',{delta:149});});
  const selected=page.getByRole('option',{selected:true});
  await expect(selected).toContainText('Tab 149');
  await expect(selected).toBeInViewport();
  expect(await selected.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(72);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('desktop hints and search translate labels and show desktop window overviews',async({page})=>{
  await page.route('**/src/api.ts',async route=>{
    const response=await route.fetch();
    const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="720"><rect width="1100" height="720" fill="#3e5874"/><rect x="30" y="45" width="250" height="630" fill="#253445"/><rect x="310" y="45" width="760" height="630" fill="#d2dae7"/></svg>');
    const body=(await response.text()).replace('case "get_thumbnails":',`case "get_thumbnails": window.__previewIds=args.ids; value=Object.fromEntries(args.ids.map(id=>[id,${JSON.stringify(image)}])); break;`);
    await route.fulfill({response,body:body+'\nsession.windows[1].desktopLabel.fullScreen=true;session.windows[1].title="Full screen 2";session.windows[2].desktopLabel=null;session.windows[2].title="Writing";'});
  });
  await page.goto('/?preview=1&view=switcher&layer=desktops');
  await expect(page.getByRole('heading',{name:'Desktops',exact:true})).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(3);
  await expect(page.locator('.native-preview-area')).toHaveCount(0);
  await expect(page.getByRole('img',{name:'Desktop window overview'})).toHaveCount(3);
  await expect(page.locator('.desktop-window img')).toHaveCount(5);
  expect(await page.evaluate(()=>(window as any).__previewIds)).toEqual(['0','1','3','5','2']);
  await expect(page.getByText('No visible windows',{exact:true})).toBeVisible();
  await page.evaluate(async()=>{const api=await import('/src/api.ts');const config=await api.call('get_settings');config.language='zh';await api.call('save_settings',{config});});
  await expect(page.getByRole('heading',{name:'桌面',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'桌面 1',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'全屏空间 2',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Writing',exact:true})).toBeVisible();
  await page.evaluate(async()=>{const api=await import('/src/api.ts');await api.call('open_search');});
  await expect(page.getByRole('textbox',{name:'搜索目标'})).toBeVisible();
  await expect(page.getByRole('img',{name:'桌面窗口总览'})).toHaveCount(3);
  await expect(page.locator('.desktop-window img')).toHaveCount(5);
  await page.screenshot({path:'logs/navigation-desktops.png'});
});

test('tab cards share window styling and keep hints above the favicon and title',async({page})=>{
  await page.route('**/src/api.ts',async route=>{
    const response=await route.fetch();
    const icon='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO9sAAAAASUVORK5CYII=';
    await route.fulfill({response,body:(await response.text())+`\nsession.windows.forEach(w=>{w.icon=${JSON.stringify(icon)};w.hint="WW";});config.hintStyle.fontSize=36;`});
  });
  await page.setViewportSize({width:760,height:580});
  await page.goto('/?preview=1&view=switcher&layer=tabs');
  const row=page.getByRole('option').first();
  await expect(row.locator('.window-meta > img')).toBeVisible();
  const hint=await row.locator('.window-hint').boundingBox();
  const icon=await row.locator('.window-meta > img').boundingBox();
  expect(hint!.y+hint!.height+4).toBeLessThanOrEqual(icon!.y);
  await expect(row.locator('.window-meta h2')).toHaveCSS('font-size','11px');
  await expect(row.locator('.window-placeholder')).toBeVisible();
  await expect(page.locator('.switcher')).not.toHaveClass(/list-layout/);
});

test('cached tab previews load after asynchronous inventory without covering hints or icons',async({page})=>{
  await page.route('**/src/api.ts',async route=>{
    const response=await route.fetch();
    const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#284466"/><rect x="12" y="12" width="72" height="156" fill="#5179a0"/><rect x="96" y="12" width="212" height="40" fill="#eee"/><path d="M96 72h200M96 92h180M96 112h190" stroke="#aabbd0" stroke-width="8"/></svg>');
    const body=(await response.text()).replace('case "get_tab_thumbnails":',`case "get_tab_thumbnails": window.__tabBatches=(window.__tabBatches??[]).concat([args.ids]);value=Object.fromEntries(args.ids.map(id=>[id,${JSON.stringify(image)}]));break;`);
    await route.fulfill({response,body:body+'\nconst pending=session.windows;pending.forEach(w=>{w.content.preview=true;w.hint="WW";});config.hintStyle.fontSize=36;session.windows=[];session.loading=true;setTimeout(()=>{session.windows=pending;session.loading=false;session.revision++;emit("session",session);},500);'});
  });
  await page.setViewportSize({width:760,height:580});
  await page.goto('/?preview=1&view=switcher&layer=tabs');
  await expect(page.locator('.preview-frame .window-preview')).toHaveCount(6);
  expect(await page.evaluate(()=>(window as any).__tabBatches)).toEqual([['0','1','2','3','4','5']]);
  const row=page.getByRole('option').first();
  const hint=await row.locator('.window-hint').boundingBox();
  const preview=await row.locator('.preview-frame').boundingBox();
  const icon=await row.locator('.app-initial').boundingBox();
  expect(preview!.height).toBeGreaterThanOrEqual(140);
  expect(hint!.y).toBeGreaterThanOrEqual(preview!.y);
  expect(hint!.y+hint!.height).toBeLessThanOrEqual(preview!.y+preview!.height);
  expect(preview!.y+preview!.height).toBeLessThanOrEqual(icon!.y);
  const next=await page.getByRole('option').nth(1).boundingBox();
  expect(next!.y).toBeCloseTo((await row.boundingBox())!.y);
  expect(next!.x).toBeGreaterThan(preview!.x+preview!.width);
  await page.screenshot({path:'logs/tab-grid-20261102/layout.png'});
  await page.evaluate(async()=>{const api=await import('/src/api.ts');const config=await api.call('get_settings');config.thumbnails=false;await api.call('save_settings',{config});});
  await expect(page.locator('.window-preview')).toHaveCount(0);
  await expect(row.locator('.window-placeholder')).toBeVisible();
});

test('tab grid arrows follow rows and columns, including after filtering and resizing',async({page})=>{
  await page.route('**/src/api.ts',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text())+'\nsession.windows.forEach(w=>{w.bounds={x:0,y:0,width:1440,height:900};});'});
  });
  await page.goto('/?preview=1&view=switcher&layer=tabs');
  await page.evaluate(async()=>{await (await import('/src/api.ts')).call('open_search');});
  const input=page.getByRole('textbox',{name:'Search targets'});
  for (const width of [1020,760,580]) {
    await page.setViewportSize({width,height:760});
    await input.fill('example.test');
    const cards=page.getByRole('option');
    await expect(cards).toHaveCount(6);
    await expect(cards.first()).toHaveAttribute('aria-selected','true');
    // ResizeObserver can repack after setViewportSize resolves. Wait for the
    // cards to fit the new canvas before recording its column count.
    await expect.poll(()=>cards.evaluateAll(nodes=>nodes.every(node=>{
      const canvas=node.parentElement!.getBoundingClientRect();
      const card=node.getBoundingClientRect();
      return card.width>0 && card.right<=canvas.right+1;
    }))).toBe(true);
    const boxes=await cards.evaluateAll(nodes=>nodes.map(n=>({x:(n as HTMLElement).offsetLeft,y:(n as HTMLElement).offsetTop})));
    const columns=boxes.filter(b=>b.y===boxes[0].y).length;
    expect(columns).toBeGreaterThan(1);
      await input.press('ArrowRight');
      await expect(cards.nth(1)).toHaveAttribute('aria-selected','true');
      await input.press('ArrowDown');
      await expect(cards.nth(columns+1)).toHaveAttribute('aria-selected','true');
      await input.press('ArrowLeft');
      await expect(cards.nth(columns)).toHaveAttribute('aria-selected','true');
      await input.press('ArrowUp');
      await expect(cards.first()).toHaveAttribute('aria-selected','true');
    await input.fill('example.test/4');
    await expect(cards).toHaveCount(1);
    await input.press('ArrowDown');
    await expect(cards.first()).toHaveAttribute('aria-selected','true');
  }
  await input.fill('example.test');
  await input.press('Tab');
  await expect(page.getByRole('option').nth(1)).toHaveAttribute('aria-selected','true');
  await input.press('Shift+Tab');
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected','true');
  await input.press('Enter');
  expect(await page.evaluate(async()=>(await (await import('/src/api.ts')).call('get_session')).mode)).toBe('inactive');
});
