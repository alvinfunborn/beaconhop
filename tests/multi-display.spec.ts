import {test, expect, type Page} from '@playwright/test';
test.use({reducedMotion:'reduce'});

async function fixture(page: Page) {
  await page.route('**/src/api.ts', async route => {
    const response = await route.fetch();
    const colors=['#315d83','#4f406d','#526a52','#69503b','#705267','#4b6566'];
    const images=colors.map((color,i) => 'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="${color}"/><rect x="0" y="0" width="1200" height="42" fill="#20242e"/><circle cx="20" cy="21" r="6" fill="#e8827b"/><circle cx="40" cy="21" r="6" fill="#dbc171"/><circle cx="60" cy="21" r="6" fill="#87bb92"/><rect x="16" y="60" width="210" height="720" rx="5" fill="#171f2c"/><rect x="246" y="60" width="930" height="80" rx="6" fill="#ffffff22"/><text x="275" y="111" font-family="sans-serif" font-size="30" fill="#fff">${['Product design','engine.rs — BeaconHop','Project reference','Terminal · development','Weekend notes','Design assets'][i]}</text><path d="M280 190h600M280 230h750M280 270h660M280 310h720M280 350h560" stroke="#ffffff77" stroke-width="12"/><rect x="280" y="410" width="400" height="250" rx="8" fill="#ffffff22"/><rect x="710" y="410" width="400" height="250" rx="8" fill="#ffffff11"/></svg>`));
    await route.fulfill({response,body:(await response.text())+`
      const fixtureImages=${JSON.stringify(images)};
      const originalCall=call;
      call=async function(name,args={}) {
        if(name.includes('thumbnail')) { window.__previewIds=args.ids;return Object.fromEntries(args.ids.map(id=>[id,fixtureImages[Number(id)%6]])); }
        return originalCall(name,args);
      };
      window.__changeOverview=(mutate)=>{mutate(session);session.revision++;emit('session',session);};
      window.__overviewEvent=(name)=>emit(name,null);
    `});
  });
}
const left='/?preview=1&view=switcher&displays=2';
const right=left+'&panel=switcher-display-32';
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
  expect(await page.locator('.desktop-anchor').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).dataset.desktopId))).toEqual(['9','2','17']);
  // Native desktop order reads left to right, with successors stacked when
  // the remaining width is better used vertically.
  const centers=await page.locator('.desktop-anchor').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y};}));
  expect(centers[0].x).toBeLessThan(centers[1].x);
  expect(centers[1].x).toBeLessThan(centers[2].x);
  await expect(page.locator('.desktop-region')).toHaveCount(0);
  const before=await page.locator('#window-2').boundingBox();
  await page.getByRole('button',{name:'Original stack',exact:true}).click();
  const stacked=(await page.locator('#window-2').boundingBox())!;
  expect(stacked.width).toBeGreaterThan(0);
  const originalCenters=await Promise.all(['1','2','0'].map(async id=>{const r=(await page.locator('#window-'+id).boundingBox())!;return {x:r.x+r.width/2,y:r.y+r.height/2};}));
  expect(originalCenters[0].x).toBeLessThan(originalCenters[1].x);
  expect(originalCenters[1].x).toBeLessThan(originalCenters[2].x);
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
  await expect(page.locator('.desktop-anchor-title')).toContainText(['桌面 1','全屏空间 2','桌面 3']);
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
  for(const b of boxes.slice(1))expect((b.left+b.right)/2).toBeGreaterThan(sparseCenter);
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
      await expect(page.locator('#window-4 .spatial-depth')).toHaveText('Minimized');
      await expect(page.locator('#window-5 .spatial-depth')).toHaveText('Hidden');
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
    for(const a of cards)for(const b of cards){
      // On a wide display the crowded desktop stays relatively left, and the
      // sparse successors read top to bottom. A portrait canvas reads vertically.
      if(group(a.id)===0 && group(b.id)>0)
        expect(center(a,viewport.width===1376?'x':'y')).toBeLessThan(center(b,viewport.width===1376?'x':'y'));
      if(group(a.id)===1 && group(b.id)===2)
        expect(center(a,viewport.width===1376?'y':'x')).toBeLessThan(center(b,viewport.width===1376?'y':'x'));
    }
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

test('large monitors use the canvas and keep small native windows readable',async({page})=>{
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
  expect(coverage).toBeGreaterThan(.55);
  expect(Math.min(...boxes.map(r=>r.w))).toBeGreaterThan(300);
  expect(Math.max(...boxes.map(r=>r.w))/Math.min(...boxes.map(r=>r.w))).toBeLessThan(1.6);
  await page.screenshot({path:'logs/preview-density-20261104/large-monitor.png'});
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
  expect(await page.locator('.desktop-anchor').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).dataset.desktopId))).toEqual(['shared','empty','last','__unknown']);
  await expect(page.locator('.desktop-anchor[data-desktop-id="empty"]')).toContainText('Current · 0');
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
  expect(rows).toEqual(['0','1','2','3','5','4']);
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
  for(const id of ['2','3','5','4','0','1']) {
    await api(page,'navigate',{delta:1});
    await expect(page.getByRole('option',{selected:true})).toHaveAttribute('id','window-'+id);
    await expect(page.locator('.departure')).toHaveAttribute('id','window-0');
  }
  for(const id of ['0','4','5','3','2','1']) {
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
