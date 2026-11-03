import {test, expect, type Page} from '@playwright/test';

async function textFixture(page: Page, provider: string, count = 6) {
  await page.route('**/src/api.ts', async route => {
    const response = await route.fetch();
    const fixture = `
      window.__imageReads=0;
      const originalCall=call;
      call=async function(name,args){if(name.includes('thumbnail'))window.__imageReads++;return originalCall(name,args);};
      session.windows=Array.from({length:${count}},(_,i)=>({...session.windows[0],id:String(i),
        appName:${JSON.stringify(provider)},title:i<2?'same.ts':'Target '+i,hint:'WW',
        icon:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO9sAAAAASUVORK5CYII=',
        content:{...session.windows[0].content,provider:${JSON.stringify(provider)},presentation:'text',preview:true,
          subtitle:'Group '+(i+1)+' · /projects/workspace-'+i+'/src/same.ts',
          description:${provider === 'codex' ? "i===3?'排查目录索引':'会话摘要：检查切换行为与焦点恢复。'" : "''"}}
      }));
      session.resultIds=session.windows.map(w=>w.id);session.selected='0';config.hintStyle.fontSize=36;
    `;
    await route.fulfill({response, body: await response.text() + fixture});
  });
  await page.goto('/?preview=1&view=switcher&layer=tabs');
}

for (const provider of ['codex','vscode','example.notes']) {
  test(`${provider} uses readable text rows without preview work`, async ({page}) => {
    await page.setViewportSize({width:760,height:580});
    await textFixture(page,provider);
    await expect(page.locator('.switcher')).toHaveClass(/text-content/);
    const cards=page.getByRole('option');
    await expect(cards).toHaveCount(6);
    await expect(page.locator('.window-placeholder,.window-preview,.native-preview-area')).toHaveCount(0);
    await expect(cards.first()).toContainText('/projects/workspace-0/src/same.ts');
    await expect(cards.nth(1)).toContainText('/projects/workspace-1/src/same.ts');
    expect(await cards.first().evaluate(el=>{
      const hint=el.querySelector('.window-hint')!.getBoundingClientRect();
      const icon=el.querySelector('.window-meta>img')!.getBoundingClientRect();
      const next=el.nextElementSibling!.getBoundingClientRect();
      return hint.right<icon.left && el.getBoundingClientRect().bottom<=next.top && next.left===el.getBoundingClientRect().left;
    })).toBe(true);
    expect(await page.evaluate(()=>(window as any).__imageReads)).toBe(0);
    if(provider!=='example.notes')await page.screenshot({path:`logs/content-presentation-20261103/${provider}.png`});
    await page.evaluate(async()=>{await(await import('/src/api.ts')).call('open_search');});
    const search=page.getByRole('textbox',{name:'Search targets'});
    await search.fill(provider==='codex'?'排查目录索引':'workspace-4');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText(provider==='codex'?'Target 3':'Target 4');
    await search.fill('workspace');
    await search.press('ArrowDown');
    await expect(cards.nth(1)).toHaveAttribute('aria-selected','true');
    await search.press('ArrowUp');
    await expect(cards.first()).toHaveAttribute('aria-selected','true');
    await search.press('Enter');
    expect(await page.evaluate(async()=>(await(await import('/src/api.ts')).call('get_session')).mode)).toBe('inactive');
  });
}

test('text inventory remains readable while filtering and scrolling 150 targets',async({page})=>{
  await page.setViewportSize({width:620,height:480});
  await textFixture(page,'codex',150);
  const cards=page.getByRole('option');await expect(cards).toHaveCount(150);
  await page.evaluate(async()=>{await(await import('/src/api.ts')).call('navigate',{delta:149});});
  const selected=page.getByRole('option',{selected:true});
  await expect(selected).toContainText('Target 149');await expect(selected).toBeInViewport();
  expect(await selected.evaluate(el=>el.getBoundingClientRect().height)).toBe(88);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.evaluate(()=>(window as any).__imageReads)).toBe(0);
});

test('browser keeps a grid without cached images and honors explicit list preference',async({page})=>{
  await page.goto('/?preview=1&view=switcher&layer=tabs');
  await expect(page.locator('.switcher')).not.toHaveClass(/list-layout/);
  await expect(page.getByText('No preview',{exact:true})).toHaveCount(6);
  await page.evaluate(async()=>{const api=await import('/src/api.ts');const config=await api.call('get_settings');config.layout='list';await api.call('save_settings',{config});});
  await expect(page.locator('.switcher')).toHaveClass(/text-content/);
  await expect(page.locator('.window-placeholder')).toHaveCount(0);
});
