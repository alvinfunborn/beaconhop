import {test, expect, type Page} from '@playwright/test';
test.use({reducedMotion:'reduce'});

async function fixture(page: Page, windowsPreview = false) {
  if(windowsPreview)await page.addInitScript(()=>Object.defineProperty(navigator,'platform',{get:()=> 'Win32'}));
  await page.route('**/src/api.ts', async route => {
    const response = await route.fetch();
    const colors=['#315d83','#4f406d','#526a52','#69503b','#705267','#4b6566'];
    const images=colors.map((color,i) => 'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="${color}"/><rect x="0" y="0" width="1200" height="42" fill="#20242e"/><circle cx="20" cy="21" r="6" fill="#e8827b"/><circle cx="40" cy="21" r="6" fill="#dbc171"/><circle cx="60" cy="21" r="6" fill="#87bb92"/><rect x="16" y="60" width="210" height="720" rx="5" fill="#171f2c"/><rect x="246" y="60" width="930" height="80" rx="6" fill="#ffffff22"/><text x="275" y="111" font-family="sans-serif" font-size="30" fill="#fff">${['Product design','engine.rs — BeaconHop','Project reference','Terminal · development','Weekend notes','Design assets'][i]}</text><path d="M280 190h600M280 230h750M280 270h660M280 310h720M280 350h560" stroke="#ffffff77" stroke-width="12"/><rect x="280" y="410" width="400" height="250" rx="8" fill="#ffffff22"/><rect x="710" y="410" width="400" height="250" rx="8" fill="#ffffff11"/></svg>`));
    const source=await response.text();
    await route.fulfill({response,body:(windowsPreview ? source.replace('export const native = isTauri();',
      'const native = false; const windowsPreview = true; export {windowsPreview as native};') : source)+`
      const fixtureImages=${JSON.stringify(images)};
      const originalCall=call;
      call=async function(name,args={}) {
        if(name==='get_panel_presentation') return null;
        if(name==='panel_ready') { (window.__readyFrames ??= []).push({generation:args.generation, width:innerWidth,height:innerHeight, cards:[...document.querySelectorAll('.window-card')].map(n=>n.getBoundingClientRect().toJSON())});return; }
        if(name==='set_live_preview') { (window.__livePreviews ??= {})[args.id]=args;return; }
        if(name.includes('thumbnail')) { window.__previewIds=args.ids;return Object.fromEntries(args.ids.map(id=>[id,fixtureImages[Number(id)%6]])); }
        return originalCall(name,args);
      };
      window.__changeOverview=(mutate)=>{mutate(session);session.revision++;emit('session',session);};
      window.__overviewEvent=(name,payload=null)=>emit(name,payload);
    `});
  });
}
const left='/?preview=1&view=switcher&displays=2';
const right=left+'&panel=switcher-display-32';

for (const windowsPreview of [false,true]) {
  test(`spatial Hint filtering keeps card geometry${windowsPreview ? ' and hides unmatched native previews' : ''}`,async({page})=>{
    await fixture(page,windowsPreview);await page.goto(left);
    await page.evaluate(()=>(window as any).__changeOverview((s:any)=>{
      s.windows.forEach((w:any,i:number)=>w.hint=['AS','AD','SA','BS','BD','BA'][i]);
    }));
    await expect(page.getByRole('option')).toHaveCount(3);
    const boxes=()=>page.getByRole('option').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.id,n.getBoundingClientRect().toJSON()])));
    const initial=await boxes();
    await page.evaluate(()=>(window as any).__changeOverview((s:any)=>{
      s.prefix='A';s.resultIds=s.windows.filter((w:any)=>w.hint.startsWith('A')).map((w:any)=>w.id);
    }));
    await expect(page.locator('.window-hint:visible')).toHaveText(['S','D']);
    expect(await boxes()).toEqual(Object.fromEntries(Object.entries(initial).slice(0,2)));
    if(windowsPreview)await expect.poll(()=>page.evaluate(()=>(window as any).__livePreviews?.['2']?.bounds)).toBeNull();
    await page.evaluate(()=>(window as any).__changeOverview((s:any)=>{
      s.prefix='';s.resultIds=s.windows.map((w:any)=>w.id);
    }));
    await expect(page.getByRole('option')).toHaveCount(3);
    expect(await boxes()).toEqual(initial);
  });
}

async function api(page: Page, name: string, args = {}) {
  return page.evaluate(async({name,args}) => (await import('/src/api.ts' as string)).call(name,args),{name,args});
}

async function assertFits(page:Page, count:number) {
  // ResizeObserver publishes the new canvas after the viewport resize returns.
  await expect.poll(()=>page.getByRole('option').evaluateAll(nodes=>nodes.length>0 && nodes.every(n=>{
    const b=n.getBoundingClientRect();return b.x>=0 && b.y>=0 && b.right<=innerWidth && b.bottom<=innerHeight;
  }))).toBe(true);
  const boxes=await page.getByRole('option').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height};}));
  expect(boxes).toHaveLength(count);
  const viewport=page.viewportSize()!;
  for(const b of boxes){expect(b.x).toBeGreaterThanOrEqual(0);expect(b.y).toBeGreaterThanOrEqual(0);expect(b.x+b.w).toBeLessThanOrEqual(viewport.width);expect(b.y+b.h).toBeLessThanOrEqual(viewport.height);}
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j];
    const overlap=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1 && Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>1;
    expect(overlap,`cards ${i} and ${j} overlap`).toBe(false);
  }
}

test('full-screen spatial layout owns each monitor and keeps all complete previews visible',async({page,context})=>{
  const second=await context.newPage();await fixture(page);await fixture(second);
  await page.setViewportSize({width:1376,height:804});await second.setViewportSize({width:1550,height:984});
  await page.goto(left);await second.goto(right);
  await assertFits(page,3);await assertFits(second,3);
  expect(await page.locator('.window-hint').allTextContents()).toEqual(['A','S','D']);
  expect(await second.locator('.window-hint').allTextContents()).toEqual(['F','G','H']);
  expect((await page.locator('.window-list').boundingBox())!.width).toBeGreaterThan(1300);
  expect((await page.locator('#window-0').boundingBox())!.width).toBeGreaterThan(300);
  await api(page,'navigate',{delta:2});await api(second,'navigate',{delta:2});
  await expect(second.getByRole('option',{selected:true})).toContainText('Terminal');
  await expect(page.getByRole('status')).toHaveText('Selected on Right display');
  const config=await api(page,'get_settings');await api(page,'save_settings',{config:{...config as any,language:'zh',layout:'list'}});
  await api(page,'navigate',{delta:-2});
  expect((await page.locator('#window-0 .preview-frame').boundingBox())!.width).toBeGreaterThan(300);
  await page.screenshot({path:'logs/multi-display-overview/expanded-zh.png'});
  await second.screenshot({path:'logs/multi-display-overview/expanded-right.png'});
});

test('original stacking uses native geometry and depth, selection and search keep expanded positions',async({page})=>{
  await fixture(page);await page.setViewportSize({width:1376,height:804});await page.goto(left);
  const original=await page.locator('#window-2').boundingBox();
  await page.locator('#window-2').hover();await expect(page.locator('.spatial-footprint')).toContainText('Safari');
  await page.getByRole('button',{name:'Original stack'}).click();
  const front=await page.locator('#window-0').boundingBox(),back=await page.locator('#window-2').boundingBox();
  expect(back!.x).toBeGreaterThan(front!.x);expect(back!.y).toBeGreaterThan(front!.y);
  expect(back!.x+back!.width).toBeLessThan(front!.x+front!.width);
  expect(Number(await page.locator('#window-0').evaluate(n=>getComputedStyle(n).zIndex))).toBeGreaterThan(Number(await page.locator('#window-2').evaluate(n=>getComputedStyle(n).zIndex)));
  await page.screenshot({path:'logs/multi-display-overview/original-stack.png'});
  await page.getByRole('button',{name:'Original stack'}).click();
  await api(page,'open_search');await page.getByRole('textbox',{name:'Search windows'}).fill('Safari');
  await expect(page.getByRole('option')).toHaveCount(1);
  expect(await page.locator('#window-2').boundingBox()).toEqual(original);
  await page.getByRole('textbox').press('Enter');expect((await api(page,'get_session') as any).mode).toBe('inactive');
});

test('search drafts mirror between monitors during IME and after focus moves',async({page,context})=>{
  const second=await context.newPage();await fixture(page);await fixture(second);
  await page.goto(left);await second.goto(right);await api(page,'open_search');await api(second,'open_search');
  const firstInput=page.getByRole('textbox',{name:'Search windows'}),secondInput=second.getByRole('textbox',{name:'Search windows'});
  await firstInput.fill('Safari');await expect(secondInput).toHaveValue('Safari');
  await firstInput.dispatchEvent('compositionstart');
  await firstInput.fill('窗');await expect(secondInput).toHaveValue('窗');
  expect((await api(page,'get_session') as any).query).toBe('Safari'); // No filtering on incomplete composition.
  await firstInput.dispatchEvent('compositionend',{data:'窗'});
  await secondInput.fill('Terminal');await expect(firstInput).toHaveValue('Terminal');
  await secondInput.fill('');await expect(firstInput).toHaveValue('');
});

test('search takes keyboard focus after loading, native activation and repeated shortcuts',async({page})=>{
  await fixture(page);await page.goto(left);
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{s.mode='search';s.loading=true;}));
  const input=page.getByRole('textbox',{name:'Search windows'});
  await expect(input).toBeDisabled();
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{s.loading=false;}));
  await expect(input).toBeFocused();
  await page.getByRole('button',{name:'Original stack'}).click();
  await expect(input).not.toBeFocused();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(input).toBeFocused();
  await page.getByRole('button',{name:'Original stack'}).click();
  await page.evaluate(()=> (window as any).__overviewEvent('search-focus'));
  await expect(input).toBeFocused();
  await page.keyboard.type('Safari');
  await expect(input).toHaveValue('Safari');
  await expect(page.getByRole('option')).toHaveCount(1);
  // Ordinary search publications must preserve focus on a control the user chose.
  await page.getByRole('button',{name:'Original stack'}).click();
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{s.query='Terminal';}));
  await expect(input).not.toBeFocused();
});

test('secondary search fields focus only when their own panel becomes active',async({page})=>{
  await fixture(page);await page.goto(right);await api(page,'open_search');
  const input=page.getByRole('textbox',{name:'Search windows'});
  await expect(input).not.toBeFocused();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(input).toBeFocused();
  await page.keyboard.type('Terminal');
  await expect(input).toHaveValue('Terminal');
});

test('dense and portrait inventories fit all previews without a scrolling rail',async({page})=>{
  await fixture(page);await page.setViewportSize({width:1376,height:804});await page.goto(left);
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{
    const original=s.windows[0];
    s.windows=Array.from({length:40},(_,i)=>({...original,id:String(i),title:'Window '+i,hint:'',bounds:{x:-1340+i*10,y:100+i*5,width:1000,height:650}}));
    s.overview[0].slots=s.windows.map((w:any)=>w.id);s.overview[1].slots=[];
    s.resultIds=s.windows.map((w:any)=>w.id);s.spatialIds=s.resultIds;s.selected='0';
  }));
  await expect(page.getByRole('option')).toHaveCount(40);await assertFits(page,40);
  expect((await page.locator('#window-0').boundingBox())!.width).toBeGreaterThan(120);
  await page.screenshot({path:'logs/multi-display-overview/expanded-dense.png'});
  await page.setViewportSize({width:760,height:1000});await assertFits(page,40);
  await api(page,'navigate',{delta:39});await expect(page.locator('#window-39')).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'logs/multi-display-overview/expanded-portrait.png'});
});


test('spatial hints stay centered and arrows follow final positions even during unfolding',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await fixture(page);await page.setViewportSize({width:1376,height:804});await page.goto(left);
  await page.waitForTimeout(400);
  const card=page.locator('#window-0'),hint=card.locator('.window-hint'),preview=card.locator('.preview-frame');
  const h=await hint.boundingBox(),p=await preview.boundingBox();
  expect(h!.x+h!.width/2).toBeCloseTo(p!.x+p!.width/2,0);
  expect(h!.y+h!.height/2).toBeCloseTo(p!.y+p!.height/2,0);
  await api(page,'open_search');const input=page.getByRole('textbox');
  // Fixture: expanded order is D, S, A across the screen, with small y offsets.
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{s.selected='2';}));
  await input.press('ArrowRight');await expect(page.locator('#window-1')).toHaveAttribute('aria-selected','true');
  await input.press('ArrowRight');await expect(page.locator('#window-0')).toHaveAttribute('aria-selected','true');
  await input.press('ArrowRight');await expect(page.locator('#window-0')).toHaveAttribute('aria-selected','true');
  await input.press('ArrowDown');await expect(page.locator('#window-0')).toHaveAttribute('aria-selected','true');
  await input.press('ArrowLeft');await expect(page.locator('#window-1')).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:'Original stack',exact:true}).click();
  // Immediately reverse while transforms are moving: geometry is already final.
  await page.getByRole('button',{name:'Original stack',exact:true}).click();
  await input.press('ArrowLeft');await expect(page.locator('#window-2')).toHaveAttribute('aria-selected','true');
});

test('native desktop order anchors one continuous canvas and survives search and stacking',async({page})=>{
  await fixture(page);await page.setViewportSize({width:1376,height:804});await page.goto(left);
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{
    s.desktops=[
      {id:'9',name:'Desktop 1',displayId:'1',displayIds:['1'],current:false,label:{number:1,fullScreen:false}},
      {id:'2',name:'Full screen 2',displayId:'1',displayIds:['1'],current:true,label:{number:2,fullScreen:true}},
      {id:'17',name:'Desktop 3',displayId:'1',displayIds:['1'],current:false,label:{number:3,fullScreen:false}},
      {id:'1',name:'Other screen',displayId:'2',displayIds:['2'],current:true},
    ];
    const assignment=['17','9','2','17','9','2'];
    s.windows.forEach((w:any,i:number)=>{
      w.desktopId=assignment[i];w.displayId='1';w.currentDesktop=w.desktopId==='2';w.minimized=false;
      w.bounds={x:-1380+(i%2)*300,y:60+(i%2)*180,width:1000-(i%2)*200,height:650};
    });
    s.overview[0].slots=s.windows.map((w:any)=>w.id);s.overview[1].slots=[];s.spatialIds=['2','5'];s.selected='0';
  }));
  await expect(page.locator('.desktop-anchor')).toHaveCount(3);await assertFits(page,6);
  expect(await page.locator('.desktop-wash').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).dataset.desktopId))).toEqual(['9','2','17']);
  // Native desktop order reads left to right, with successors stacked when
  // the remaining width is better used vertically.
  const centers=await Promise.all([['1','4'],['2','5'],['0','3']].map(async ids=>{
    const boxes=await Promise.all(ids.map(id=>page.locator('#window-'+id).boundingBox()));
    return {x:boxes.reduce((sum,r)=>sum+r!.x+r!.width/2,0)/boxes.length};
  }));
  expect(centers[0].x).toBeLessThan(centers[1].x);
  expect(centers[1].x).toBeLessThan(centers[2].x);
  await expect(page.locator('.desktop-region')).toHaveCount(0);
  const before=await page.locator('#window-2').boundingBox();
  await page.getByRole('button',{name:'Original stack',exact:true}).click();
  const stacked=(await page.locator('#window-2').boundingBox())!;
  expect(stacked.width).toBeGreaterThan(0);
  const originalCenters=await Promise.all(['1','2','0'].map(async id=>{const r=(await page.locator('#window-'+id).boundingBox())!;return {x:r.x+r.width/2,y:r.y+r.height/2};}));
  expect(originalCenters[0].x).toBeLessThan(originalCenters[1].x);
  expect(originalCenters[1].x).toBeLessThanOrEqual(originalCenters[2].x);
  await page.getByRole('button',{name:'Original stack',exact:true}).click();
  await api(page,'open_search');await page.getByRole('textbox').fill('Safari');
  await expect(page.getByRole('option')).toHaveCount(1);expect(await page.locator('#window-2').boundingBox()).toEqual(before);
  await expect(page.locator('.desktop-anchor')).toHaveCount(3);
  await page.getByRole('textbox').fill('');
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{s.selected='1';}));
  const start=(await page.locator('#window-1').boundingBox())!;
  await page.getByRole('textbox').press('ArrowRight');
  const target=(await page.getByRole('option',{selected:true}).boundingBox())!;
  expect(target.x+target.width/2).toBeGreaterThan(start.x+start.width/2);
  const config=await api(page,'get_settings');await api(page,'save_settings',{config:{...config as any,language:'zh'}});
  for(const [id,name] of [['9','桌面 1'],['2','全屏空间 2'],['17','桌面 3']])
    await expect(page.locator('.desktop-anchor[data-desktop-id="'+id+'"]')).toContainText(name);
  await page.screenshot({path:'logs/multi-display-overview/desktops-spatial-zh.png'});
  await page.setViewportSize({width:760,height:1000});await assertFits(page,6);
});

test('uneven desktops preserve ownership without desktop containers',async({page})=>{
  await fixture(page);await page.setViewportSize({width:1376,height:804});await page.goto(left);
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{
    s.desktops=[{id:'left',name:'Left desktop',displayId:'1',current:true},{id:'right',name:'Right desktop',displayId:'1',current:false}];
    s.windows.forEach((w:any,i:number)=>{
      w.desktopId=i===0?'left':'right';w.displayId='1';w.currentDesktop=i===0;w.minimized=false;w.hidden=false;
      w.bounds={x:-1340+(i%2)*100,y:70+(i%3)*90,width:1100,height:700};
    });
    s.overview[0].slots=s.windows.map((w:any)=>w.id);s.overview[1].slots=[];s.spatialIds=['0'];
  }));
  await expect(page.locator('.desktop-anchor')).toHaveCount(2);await assertFits(page,6);
  const sparse=(await page.locator('.desktop-wash[data-desktop-id="left"]').boundingBox())!;
  const dense=(await page.locator('.desktop-wash[data-desktop-id="right"]').boundingBox())!;
  expect(dense.width*dense.height).toBeGreaterThan(sparse.width*sparse.height);
  const boxes=await page.getByRole('option').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.x,right:r.right};}));
  const sparseCenter=(boxes[0].left+boxes[0].right)/2;
  const denseCenter=boxes.slice(1).reduce((sum,b)=>sum+(b.left+b.right)/2,0)/(boxes.length-1);
  expect(denseCenter).toBeGreaterThan(sparseCenter);
  await expect(page.locator('.desktop-region')).toHaveCount(0);
  await page.screenshot({path:'logs/multi-display-overview/desktops-continuous-uneven.png'});
  await page.setViewportSize({width:760,height:1000});await assertFits(page,6);
});

test('desktops share compact packing with relative ownership, including hidden and minimized windows',async({page})=>{
  await fixture(page);await page.goto(left);
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{
    s.desktops=['one','two','three'].map((id,i)=>({id,name:'Desktop '+(i+1),displayId:'1',current:i===0}));
    const template=s.windows[0];
    s.windows=Array.from({length:10},(_,i)=>({...template,id:String(i),title:'Window '+i,
      desktopId:i<6?'one':i<8?'two':'three',displayId:'1',currentDesktop:i<6,
      minimized:false,hidden:false,bounds:{x:-1350+(i%2)*80,y:90+(i%3)*50,width:1100,height:700}}));
    s.resultIds=s.windows.map((w:any)=>w.id);s.overview[0].slots=s.resultIds;s.overview[1].slots=[];
    s.spatialIds=['0','1','2','3'];
  }));
  for(const viewport of [{width:1376,height:804},{width:760,height:1000}]){
    if(viewport.width===760){
      await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{s.windows[4].minimized=true;s.windows[5].hidden=true;}));
      await expect(page.locator('#window-4 .spatial-depth')).toHaveCount(0);
      await expect(page.locator('#window-5 .spatial-depth')).toHaveCount(0);
    }
    await page.setViewportSize(viewport);await assertFits(page,10);
    const regions=await page.locator('.desktop-wash').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>{
      const r=n.getBoundingClientRect();return [(n as HTMLElement).dataset.desktopId,{x:r.x,y:r.y,width:r.width,height:r.height}];
    })));
    if(viewport.width===1376){
      // Background bounds follow the packed cards, never reserve columns.
      expect(regions.one.width*regions.one.height).toBeGreaterThan(regions.two.width*regions.two.height);
      expect(regions.two.y).toBeLessThan(regions.three.y);
      await expect(page.locator('.desktop-wash').first()).toHaveCSS('border-width','0px');
      expect(await page.locator('.desktop-wash').first().evaluate(n=>getComputedStyle(n).backgroundImage)).toContain('radial-gradient');
      await page.screenshot({path:'logs/fused-desktops-20261104/fused-desktops-wide.png'});
    }
    const cards=await page.getByRole('option').evaluateAll(nodes=>nodes.map(n=>{
      const r=n.getBoundingClientRect();return {id:Number(n.id.slice(7)),x:r.x,y:r.y,w:r.width,h:r.height};
    }));
    const group=(id:number)=>id<6?0:id<8?1:2;
    const center=(c:typeof cards[number],axis:'x'|'y')=>c[axis]+(axis==='x'?c.w:c.h)/2;
    // Desktop order belongs to each group's center. Individual cards can share
    // rows or fill neighbours' gaps instead of enforcing invisible quadrants.
    const groupCenters=[0,1,2].map(g=>{
      const own=cards.filter(c=>group(c.id)===g);return own.reduce((sum,c)=>sum+center(c,'x'),0)/own.length;
    });
    expect(groupCenters[1]).toBeGreaterThanOrEqual(groupCenters[0]-.2);
    expect(groupCenters[2]).toBeGreaterThanOrEqual(groupCenters[1]-.2);
    for(const desktop of [1,2]){
      const gaps=cards.filter(c=>group(c.id)===desktop).flatMap(a=>cards.filter(c=>group(c.id)<desktop).map(b=>
        Math.hypot(Math.max(0,a.x-b.x-b.w,b.x-a.x-a.w),Math.max(0,a.y-b.y-b.h,b.y-a.y-a.h))));
      // Desktop seams stay proportional to the ordinary card gap as the
      // shared scene expands to fill the canvas. No isolated islands remain.
      expect(Math.min(...gaps)).toBeLessThanOrEqual(Math.max(13,Math.min(...cards.map(c=>c.w))*.07));
    }
  }
  await page.screenshot({path:'logs/multi-display-overview/desktop-center-ownership.png'});
});

test('later desktop groups never drift to the left when stacked or inventory arrives in MRU order',async({page})=>{
  await fixture(page);await page.setViewportSize({width:1376,height:804});await page.goto(left);
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{
    s.desktops=['one','two','three','four'].map((id,i)=>({id,name:'Desktop '+(i+1),displayId:'1',current:i===0}));
    const template=s.windows[0],assignment=[2,0,1,0,3,0,2,0,1,0];
    s.windows=assignment.map((desktop,i)=>({...template,id:String(i),desktopId:s.desktops[desktop].id,
      displayId:'1',currentDesktop:desktop===0,minimized:false,hidden:false,
      bounds:{x:-1400+(i%3)*340,y:30+(i%4)*90,width:900+(i%2)*200,height:700}}));
    s.resultIds=s.windows.map((w:any)=>w.id);s.overview[0].slots=s.resultIds;s.overview[1].slots=[];
  }));
  await assertFits(page,10);
  const groups=await page.getByRole('option').evaluateAll(nodes=>{
    const assignment=[2,0,1,0,3,0,2,0,1,0];
    return [0,1,2,3].map(g=>{
      const own=nodes.filter(n=>assignment[Number(n.id.slice(7))]===g);
      return own.reduce((sum,n)=>{const r=n.getBoundingClientRect();return sum+r.x+r.width/2;},0)/own.length;
    });
  });
  for(let i=1;i<groups.length;i++)expect(groups[i]).toBeGreaterThanOrEqual(groups[i-1]-.2);
  // Reordering MRU inventory cannot reverse the native desktop sequence.
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{s.windows.reverse();}));
  await assertFits(page,10);
  const centers=await Promise.all(['one','two','three','four'].map(async desktop=>{
    const ids=await page.evaluate(async desktop=>{
      const s:any=await (await import('/src/api.ts' as string)).call('get_session');
      return s.windows.filter((w:any)=>w.desktopId===desktop).map((w:any)=>w.id);
    },desktop);
    const xs=await Promise.all(ids.map(async(id:string)=>{const r=(await page.locator('#window-'+id).boundingBox())!;return r.x+r.width/2;}));
    return xs.reduce((a,b)=>a+b,0)/xs.length;
  }));
  for(let i=1;i<centers.length;i++)expect(centers[i]).toBeGreaterThanOrEqual(centers[i-1]-.2);
});

test('large monitors fill the canvas while preserving relative native preview sizes across desktops',async({page})=>{
  await fixture(page);await page.setViewportSize({width:2496,height:1344});await page.goto(left);
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{
    s.desktops=['one','two','three','four'].map((id,i)=>({id,name:'Desktop '+(i+1),displayId:'1',current:i===0}));
    const scene=[
      [0,0,400,1680,1020],[0,0,0,2560,1370],[0,1060,0,1500,1000],[0,1750,820,810,620],
      [1,480,280,1910,1150],[2,0,0,2560,1300],[1,0,0,2560,1290],[0,970,0,1590,900],
      [3,0,0,2560,1440],[2,380,190,2120,1250],
    ];
    const template=s.windows[0];
    s.windows=scene.map(([desktop,x,y,width,height],i)=>({...template,id:String(i),displayId:'1',
      desktopId:s.desktops[desktop].id,currentDesktop:desktop===0,minimized:false,hidden:false,bounds:{x,y,width,height}}));
    s.resultIds=s.windows.map((w:any)=>w.id);s.overview[0].slots=s.resultIds;s.overview[1].slots=[];
    s.overview[0].display.bounds={x:0,y:0,width:2560,height:1440};
    s.spatialIds=['0','1','2','3','7'];
  }));
  await assertFits(page,10);
  const boxes=await page.getByRole('option').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
  const canvas=(await page.locator('.window-list').boundingBox())!;
  const coverage=boxes.reduce((sum,r)=>sum+r.w*r.h,0)/((canvas.width-28)*(canvas.height-28));
  expect(coverage).toBeGreaterThan(.7);
  const sizes=await page.getByRole('option').evaluateAll(async nodes=>{
    const s:any=await (await import('/src/api.ts' as string)).call('get_session');
    return nodes.map(n=>{
      const original=s.windows.find((w:any)=>w.id===n.id.slice(7)).bounds;
      return {width:n.getBoundingClientRect().width/original.width,
        height:n.querySelector('.preview-frame')!.getBoundingClientRect().height/original.height};
    });
  });
  const scale=sizes[0].width;
  for(const size of sizes){
    expect(Math.abs(size.width-scale)).toBeLessThan(.001);
    expect(Math.abs(size.height-scale)).toBeLessThan(.001);
  }
  expect(Math.max(...boxes.map(r=>r.w))/Math.min(...boxes.map(r=>r.w))).toBeCloseTo(2560/810,2);
  const compact=await page.evaluate(async()=>{
    const s:any=await (await import('/src/api.ts' as string)).call('get_session');
    const {desktopOverviewTiles}=await import('/src/layout.ts' as string);
    return desktopOverviewTiles(s.overview[0],s.windows,2468,1195,false,s.spatialIds,s.desktops);
  });
  expect(compact.tiles.reduce((sum:number,t:any)=>sum+t.width*t.height,0)/(2468*1195)).toBeGreaterThan(.75);

  await page.screenshot({path:'logs/native-size-20261105/large-monitor.png'});
});

test('wide, portrait, hidden and minimized previews share one native size scale after resize',async({page})=>{
  await fixture(page);await page.setViewportSize({width:1376,height:900});await page.goto(left);
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{
    s.desktops=['one','two','three'].map((id,i)=>({id,name:'Desktop '+(i+1),displayId:'1',current:i===0}));
    const sizes=[[1600,400],[400,1600],[800,800],[1280,720],[640,360],[400,400]];
    s.windows.forEach((w:any,i:number)=>{
      w.displayId='1';w.desktopId=s.desktops[Math.floor(i/2)].id;w.currentDesktop=i<2;
      w.minimized=i===4;w.hidden=i===5;
      w.bounds={x:i*80,y:i*60,width:sizes[i][0],height:sizes[i][1]};
    });
    s.overview[0].slots=s.windows.map((w:any)=>w.id);s.overview[1].slots=[];
  }));
  for(const viewport of [{width:1376,height:900},{width:760,height:1000}]){
    await page.setViewportSize(viewport);await assertFits(page,6);
    await expect.poll(async()=>page.getByRole('option').evaluateAll(async nodes=>{
      const s:any=await (await import('/src/api.ts' as string)).call('get_session');
      const scales=nodes.flatMap(n=>{
        const w=s.windows.find((w:any)=>w.id===n.id.slice(7));
        return [n.getBoundingClientRect().width/w.bounds.width,n.querySelector('.preview-frame')!.getBoundingClientRect().height/w.bounds.height];
      });
      return Math.max(...scales)-Math.min(...scales);
    })).toBeLessThan(.001);
  }
});

test('desktop membership supports shared displays, an empty current desktop and unknown ownership',async({page})=>{
  await fixture(page);await page.setViewportSize({width:1550,height:984});await page.goto(right);
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{
    s.desktops=[
      {id:'other',name:'Other display',displayId:'1',displayIds:['1'],current:true},
      {id:'shared',name:'Shared',displayId:'1',displayIds:['1','2'],current:false},
      {id:'empty',name:'Current empty',displayId:'2',displayIds:['2'],current:true},
      {id:'skipped',name:'Empty inactive',displayId:'2',displayIds:['2'],current:false},
      {id:'last',name:'Last',displayId:'2',displayIds:['2'],current:false},
    ];
    s.windows[3].desktopId='last';s.windows[4].desktopId='shared';s.windows[5].desktopId='missing';
  }));
  await expect(page.locator('.desktop-anchor')).toHaveCount(4);await assertFits(page,3);
  expect(await page.locator('.desktop-wash').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).dataset.desktopId))).toEqual(['shared','empty','last','__unknown']);
  await expect(page.locator('.desktop-anchor[data-desktop-id="empty"]')).toHaveClass(/current-desktop/);
  await expect(page.locator('.desktop-anchor[data-desktop-id="__unknown"]')).toContainText('Unknown desktop');
});

test('Tab follows final thumbnail rows and Shift+Tab reverses while the origin stays marked',async({page})=>{
  await fixture(page);await page.setViewportSize({width:1376,height:900});await page.goto(left);
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{
    s.overview=s.overview.slice(0,1);s.overview[0].slots=s.windows.map((w:any)=>w.id);
    s.windows.forEach((w:any,i:number)=>{
      w.displayId='1';w.desktopId='1';w.desktopName='Desktop 1';w.currentDesktop=true;w.minimized=false;
      w.bounds={x:-1400+(i%3)*440,y:50+Math.floor(i/3)*400,width:380,height:280};
    });
  }));
  await expect(page.getByRole('option')).toHaveCount(6);
  await assertFits(page,6);
  // Read aligned previews left to right before the lower cards.
  const rows=await page.getByRole('option').evaluateAll(nodes=>nodes.map(n=>{
    const b=n.getBoundingClientRect();return {id:n.id.slice(7),x:b.x,y:b.y};
  }).sort((a,b)=>Math.abs(a.y-b.y)<30?a.x-b.x:a.y-b.y).map(n=>n.id));
  expect(new Set(rows).size).toBe(6);
  await expect(page.locator('#window-0')).toHaveAttribute('data-origin','true');
  await expect(page.locator('#window-0 .departure-badge')).toHaveText('Origin');
  await expect(page.locator('#window-1 .selection-badge')).toHaveText('Selected');
  await expect(page.locator('#window-1')).toHaveCSS('outline-style','solid');
  await expect(page.locator('#window-0')).toHaveCSS('outline-style','dashed');
  // Deliberately change the stored slots: keyboard traversal must use geometry.
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{
    s.windows=[s.windows[0],s.windows[4],s.windows[2],s.windows[5],s.windows[1],s.windows[3]];
    s.resultIds=s.windows.map((w:any)=>w.id);
  }));
  for(const id of [...rows.slice(rows.indexOf('1')+1),...rows.slice(0,rows.indexOf('1')+1)]) {
    await api(page,'navigate',{delta:1});
    await expect(page.getByRole('option',{selected:true})).toHaveAttribute('id','window-'+id);
    await expect(page.locator('.departure')).toHaveAttribute('id','window-0');
  }
  for(const id of [...rows.slice(0,rows.indexOf('1')).reverse(),...rows.slice(rows.indexOf('1')).reverse()]) {
    await api(page,'navigate',{delta:-1});
    await expect(page.getByRole('option',{selected:true})).toHaveAttribute('id','window-'+id);
  }
  await api(page,'navigate',{delta:-1});
  await expect(page.locator('#window-0 .departure-badge')).toBeVisible();
  await expect(page.locator('#window-0 .selection-badge')).toBeVisible();
  const badges=await page.locator('#window-0 .card-state').boundingBox();
  const card=await page.locator('#window-0').boundingBox();
  expect(badges!.y).toBeGreaterThan(card!.y);
  expect(badges!.y+badges!.height).toBeLessThan(card!.y+card!.height);
  await page.screenshot({path:'logs/tab-order-20261104/selected-origin.png'});
});

test('central hints distinguish origin, selection and combined state and remain visible in search',async({page})=>{
  await fixture(page);await page.setViewportSize({width:1376,height:900});await page.goto(left);
  const origin=page.locator('#window-0 .window-hint'),selected=page.locator('#window-1 .window-hint');
  await expect(origin).not.toHaveAttribute('data-state-label');
  await expect(selected).not.toHaveAttribute('data-state-label');
  await expect(origin).toHaveCSS('border-radius','999px');
  await expect(selected).toHaveCSS('border-radius','8px');
  await expect(origin).toHaveCSS('background-color','rgb(0, 105, 92)');
  await expect(selected).toHaveCSS('background-color','rgb(255, 254, 245)');
  await expect(selected).toHaveCSS('color','rgb(17, 21, 28)');
  await expect(origin).toHaveCSS('font-size','28px');
  await expect(selected).toHaveCSS('font-size','42px');
  const positions=await page.getByRole('option').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
  for(const marker of [origin,selected]){
    const b=(await marker.boundingBox())!,p=(await marker.locator('..').boundingBox())!;
    expect(b.x+b.width/2).toBeCloseTo(p.x+p.width/2,0);
    expect(b.y+b.height/2).toBeCloseTo(p.y+p.height/2,0);
  }
  expect(await selected.evaluate(n=>parseFloat(getComputedStyle(n,'::after').borderTopWidth))).toBeGreaterThan(8);
  await page.screenshot({path:'logs/focus-sign-20261105/hint-states.png'});
  await api(page,'navigate',{delta:-1});
  await expect(origin).not.toHaveAttribute('data-state-label');
  await expect(origin).toHaveCSS('background-color','rgb(255, 254, 245)');
  await expect(origin).toHaveCSS('border-color','rgb(17, 21, 28)');
  expect(await origin.evaluate(n=>getComputedStyle(n,'::before').backgroundColor)).toBe('rgb(120, 255, 226)');
  expect(await page.getByRole('option').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()))).toEqual(positions);
  await page.screenshot({path:'logs/focus-sign-20261105/combined-state.png'});
  await api(page,'open_search');
  await expect(page.locator('.window-hint')).toHaveCount(0);
  await expect(page.locator('#window-0 .window-focus-marker')).toHaveText('↵');
  await expect(page.locator('#window-0 .window-focus-marker')).toHaveCSS('background-color','rgb(255, 254, 245)');
  await page.screenshot({path:'logs/focus-sign-20261105/search-state.png'});
});

test('selection pops once, settles during rapid cross-display cycling and respects reduced motion',async({page})=>{
  await fixture(page);await page.emulateMedia({reducedMotion:'no-preference'});
  await page.addInitScript(()=>{
    const animate=Element.prototype.animate;
    (window as any).__markerPops=[];
    Element.prototype.animate=function(frames,options){
      if(this.matches('.window-hint,.window-focus-marker'))(window as any).__markerPops.push(this.closest('.window-card')!.id);
      return animate.call(this,frames,options);
    };
  });
  await page.clock.install();await page.goto(left);
  await expect(page.locator('#window-1')).toHaveAttribute('aria-selected','true');
  await page.clock.pauseAt(new Date(Date.now()+1000));
  const pops=()=>page.evaluate(()=>(window as any).__markerPops);
  const select=async(id:string)=>{
    await page.evaluate(id=>(window as any).__changeOverview((s:any)=>{s.selected=id;}),id);
    await expect(page.locator('#window-'+id)).toHaveAttribute('aria-selected','true');
  };
  await page.clock.runFor(200);await select('2');
  const after=await pops();expect(after.at(-1)).toBe('window-2');
  await page.evaluate(()=>(window as any).__changeOverview((s:any)=>{s.revision++;}));
  expect(await pops()).toEqual(after); // Inventory publications do not replay the cue.
  await page.clock.runFor(40);
  await page.evaluate(()=>(window as any).__changeOverview((s:any)=>{s.selected='3';}));
  await expect(page.getByRole('option',{selected:true})).toHaveCount(0);
  await page.clock.runFor(40);await select('0');
  expect(await pops()).toEqual(after);
  expect(await page.locator('.window-hint').evaluateAll(nodes=>nodes.flatMap(n=>n.getAnimations()).length)).toBe(0);
  await page.clock.runFor(200);await select('1');
  expect((await pops()).length).toBe(after.length+1);
  await page.clock.runFor(200);
  // The mocked timer clock and the browser's Web Animations timeline can settle
  // on different frames. Wait for the real animation to finish before inspecting it.
  await expect.poll(()=>page.locator('#window-1 .window-hint').evaluate(n=>n.getAnimations().length)).toBe(0);
  await page.emulateMedia({reducedMotion:'reduce'});await select('2');
  expect((await pops()).length).toBe(after.length+1);
});

test('large two-character state hints fit dense previews without changing their geometry',async({page})=>{
  await fixture(page);await page.setViewportSize({width:800,height:600});await page.goto(left);
  const config=await api(page,'get_settings') as any;
  await api(page,'save_settings',{config:{...config,hintStyle:{...config.hintStyle,fontSize:64}}});
  await page.evaluate(()=>(window as any).__changeOverview((s:any)=>{
    const template=s.windows[0];
    s.windows=Array.from({length:30},(_,i)=>({...template,id:String(i),hint:'AA',bounds:{x:i%6*180,y:Math.floor(i/6)*120,width:800,height:600}}));
    s.resultIds=s.windows.map((w:any)=>w.id);s.spatialIds=s.resultIds;
    s.overview[0].slots=s.resultIds;s.overview[1].slots=[];s.selected='0';
  }));
  await assertFits(page,30);
  const positions=await page.getByRole('option').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
  for(const id of ['0','1','29']){
    await page.evaluate(id=>(window as any).__changeOverview((s:any)=>{s.selected=id;}),id);
    await expect(page.locator('#window-'+id)).toHaveAttribute('aria-selected','true');
    expect(await page.locator('#window-'+id+' .window-hint').evaluate(n=>{
      const b=n.getBoundingClientRect(),p=n.parentElement!.getBoundingClientRect(),font=parseFloat(getComputedStyle(n).fontSize);
      return b.left-4>=p.left && b.right+4<=p.right && b.top-4>=p.top && b.bottom+font*.22+4<=p.bottom;
    })).toBe(true);
  }
  expect(await page.getByRole('option').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()))).toEqual(positions);
  await page.screenshot({path:'logs/focus-sign-20261105/dense-hints.png'});
});

test('native preview cutouts include the enlarged sign and search marker',async({page})=>{
  await fixture(page,true);await page.goto(left);
  await expect(page.locator('.native-preview-area')).toHaveCount(3);
  async function check(id:string,marker:string){
    await expect.poll(()=>page.evaluate(({id,marker})=>{
      const sent=(window as any).__livePreviews?.[id],badge=document.querySelector('#window-'+id+' '+marker);
      if(!sent?.hintBounds||!badge)return false;
      const h=sent.hintBounds,b=badge.getBoundingClientRect(),f=parseFloat(getComputedStyle(badge).fontSize),s=devicePixelRatio;
      return h.x/s<=b.left-3 && (h.x+h.width)/s>=b.right+3 && h.y/s<=b.top-3 && (h.y+h.height)/s>=b.bottom+f*.22+3;
    },{id,marker})).toBe(true);
  }
  await check('1','.window-hint');
  await api(page,'navigate',{delta:-1});await check('0','.window-hint');
  await api(page,'open_search');
  await expect(page.locator('.window-hint')).toHaveCount(0);
  await check('0','.window-focus-marker');
});

test('mixed native rectangles fill holes rather than fragment the canvas',async({page})=>{
  await fixture(page);await page.setViewportSize({width:1736,height:1073});await page.goto(left);
  await page.evaluate(()=> (window as any).__changeOverview((s:any)=>{
    const scene=[[22,39,1677,985],[828,352,800,685],[204,252,1010,717],[283,288,740,625],
      [0,118,1677,985],[277,209,1270,720],[470,96,960,946],[305,262,921,726],
      [213,192,1587,898],[232,39,1372,978],[501,221,890,566],[153,155,1587,898]];
    const template=s.windows[0];s.desktops=[{id:'one',name:'Desktop 1',displayId:'1',current:true}];
    s.windows=scene.map(([x,y,width,height],i)=>({...template,id:String(i),displayId:'1',desktopId:'one',
      hidden:false,minimized:false,currentDesktop:true,bounds:{x,y,width,height}}));
    s.resultIds=s.windows.map((w:any)=>w.id);s.overview[0].slots=s.resultIds;s.overview[1].slots=[];
    s.overview[0].display.bounds={x:0,y:0,width:1800,height:1169};s.spatialIds=s.resultIds;
  }));
  await assertFits(page,12);
  const boxes=await page.getByRole('option').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {w:r.width,h:r.height};}));
  const canvas=(await page.locator('.window-list').boundingBox())!;
  expect(boxes.reduce((sum,r)=>sum+r.w*r.h,0)/((canvas.width-28)*(canvas.height-28))).toBeGreaterThan(.73);
  await page.screenshot({path:'logs/packing-cleanup-20261105/compact-mixed.png'});
});


test('contact packing compacts the native X-shaped scene while keeping window proportions',async({page})=>{
  await fixture(page);await page.setViewportSize({width:1736,height:1073});await page.goto(left);
  const bounds=[{"height": 985, "width": 1677, "x": 22, "y": 39}, {"height": 685, "width": 800, "x": 828, "y": 352}, {"height": 717, "width": 1010, "x": 204, "y": 252}, {"height": 680, "width": 1000, "x": 398, "y": 286}, {"height": 428, "width": 837, "x": 407, "y": 190}, {"height": 625, "width": 740, "x": 283, "y": 288}, {"height": 985, "width": 1677, "x": 0, "y": 118}, {"height": 720, "width": 1270, "x": 277, "y": 209}, {"height": 946, "width": 960, "x": 470, "y": 96}, {"height": 726, "width": 921, "x": 305, "y": 262}, {"height": 898, "width": 1587, "x": 213, "y": 192}, {"height": 978, "width": 1372, "x": 232, "y": 39}, {"height": 566, "width": 890, "x": 501, "y": 221}, {"height": 898, "width": 1587, "x": 153, "y": 155}];
  await page.evaluate(bounds=>(window as any).__changeOverview((s:any)=>{
    const template=s.windows[0];s.desktops=[{id:'one',name:'Desktop 1',displayId:'1',current:true}];
    s.windows=bounds.map((bounds,i)=>({...template,id:String(i),hint:'ASDFGHJKLQWERTY'[i],displayId:'1',desktopId:'one',
      hidden:false,minimized:false,currentDesktop:true,bounds}));
    s.resultIds=s.windows.map((w:any)=>w.id);s.overview[0].slots=s.resultIds;s.overview[1].slots=[];
    s.overview[0].display.bounds={x:0,y:0,width:1800,height:1169};s.spatialIds=s.resultIds;
  }),bounds);
  await assertFits(page,14);
  const result=await page.evaluate(async()=>{
    const s:any=await (await import('/src/api.ts' as string)).call('get_session');
    const {desktopOverviewTiles}=await import('/src/layout.ts' as string);
    return desktopOverviewTiles(s.overview[0],s.windows,1708,850,false,s.spatialIds,s.desktops);
  });
  expect(result.tiles.reduce((sum:number,t:any)=>sum+t.width*t.height,0)/(1708*850)).toBeGreaterThan(.82);
  await page.screenshot({path:'logs/packing-cleanup-20261105/native-scene.png'});
});


test('opening commits final rectangles without replaying the original-stack animation',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.addInitScript(()=>{
    const animate=Element.prototype.animate;
    (window as any).__cardAnimations=[];
    Element.prototype.animate=function(...args:Parameters<Element['animate']>){
      if(this.classList.contains('window-card')) (window as any).__cardAnimations.push(this.id);
      return animate.apply(this,args);
    };
  });
  await fixture(page);await page.goto(left);await assertFits(page,3);
  expect(await page.evaluate(()=>(window as any).__cardAnimations)).toEqual([]);
  await page.getByRole('button',{name:'Original stack',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).__cardAnimations.length)).toBeGreaterThan(0);
  await page.evaluate(()=>{
    (window as any).__cardAnimations=[];
    (window as any).__changeOverview((s:any)=>{s.sessionId++;s.mode='held';});
  });
  await expect(page.getByRole('button',{name:'Original stack',exact:true})).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(()=>(window as any).__cardAnimations)).toEqual([]);
});

test('geometry cache survives reopen and Z-order changes but invalidates moves and resize',async({page})=>{
  await fixture(page);await page.goto(left);
  const result=await page.evaluate(async()=>{
    const {createOverviewCache}=await import('/src/overviewCache.ts' as string);
    const cache=createOverviewCache();
    const s:any=await (await import('/src/api.ts' as string)).call('get_session');
    const panel=s.overview[0],windows=s.windows.filter((w:any)=>panel.slots.includes(w.id));
    const first=cache(panel,windows,1200,700,false,s.spatialIds,s.desktops);
    // JSON round trips mirror new Tauri events; references are never reused.
    const again=JSON.parse(JSON.stringify({panel,windows,desktops:s.desktops}));
    again.windows.forEach((w:any)=>{w.title='New title';w.hint='Z';});
    const start=performance.now();
    const reopened=cache(again.panel,again.windows,1200,700,false,[...s.spatialIds].reverse(),again.desktops);
    const elapsed=performance.now()-start;
    again.windows[0].bounds.width+=100;
    const moved=cache(again.panel,again.windows,1200,700,false,s.spatialIds,again.desktops);
    const resized=cache(panel,windows,800,700,false,s.spatialIds,s.desktops);
    return {reused:first===reopened,moved:first!==moved,resized:first!==resized,elapsed};
  });
  expect(result.reused).toBe(true);expect(result.moved).toBe(true);expect(result.resized).toBe(true);
  expect(result.elapsed).toBeLessThan(10);
});

test('native presentation acknowledges only the requested session at the final viewport',async({page})=>{
  await fixture(page,true);await page.goto(left);await assertFits(page,3);
  const send=async(generation:number,width:number,sessionOffset=0)=>page.evaluate(async({generation,width,sessionOffset})=>{
    const session:any=await (await import('/src/api.ts' as string)).call('get_session');
    session.sessionId+=sessionOffset;
    (window as any).__overviewEvent('panel-presentation',{label:'switcher',generation,width,height:innerHeight,session});
  },{generation,width,sessionOffset});
  await send(1,1020);
  await expect.poll(()=>page.evaluate(()=>(window as any).__readyFrames?.map((f:any)=>f.generation))).toEqual([1]);
  await page.evaluate(async()=>{
    const session:any=await (await import('/src/api.ts' as string)).call('get_session');
    (window as any).__overviewEvent('panel-presentation',{label:'another-display',generation:99,width:innerWidth,height:innerHeight,session});
  });
  await send(2,1100);
  await page.waitForTimeout(50);
  expect(await page.evaluate(()=>(window as any).__readyFrames.map((f:any)=>f.generation))).toEqual([1]);
  await page.setViewportSize({width:1100,height:760});
  await expect.poll(()=>page.evaluate(()=>(window as any).__readyFrames.map((f:any)=>f.generation))).toContain(2);
  await send(3,1100,-1);
  await page.waitForTimeout(50);
  expect(await page.evaluate(()=>(window as any).__readyFrames.map((f:any)=>f.generation))).not.toContain(3);
});
