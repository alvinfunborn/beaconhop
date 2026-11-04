import type { Destination, OverviewPanel, NativeDesktop } from "./types";

type DesktopHome = {minX:number; maxX:number; shelfX:number};

export type Tile = { x: number; y: number; width: number; height: number; preview: number; meta: number; origin?: {x:number;y:number;width:number;height:number} };

// Preserve native centers and relative size, then separate only overlapping cards.
// Layout uses the complete inventory: selection and filtering never repack it.
export function overviewTiles(panel: OverviewPanel, windows: Destination[], width: number, height: number, stacked = false, spatialIds: string[] = [], previewScale = 1, homes: DesktopHome[] = []) {
  if (!windows.length || width <= 0 || height <= 0) return {columns: 1, tiles: [] as Tile[]};
  const screen = panel.display.bounds;
  const scale = Math.min(width / screen.width, height / screen.height);
  const ox = (width - screen.width * scale) / 2, oy = (height - screen.height * scale) / 2;
  const anchors = windows.map((w, i) => {
    const visible = spatialIds.includes(w.id);
    const rawX = visible ? ox + (w.bounds.x - screen.x + w.bounds.width / 2) * scale : homes[i]?.shelfX ?? width * (i + 1) / (windows.length + 1);
    const home = homes[i];
    const x = home ? Math.max(home.minX,Math.min(home.maxX,rawX)) : rawX;
    const y = visible ? oy + (w.bounds.y - screen.y + w.bounds.height / 2) * scale : height * .9;
    const aspect = Math.max(.5, Math.min(2.5, w.bounds.width / Math.max(1, w.bounds.height)));
    const w0 = Math.min(width * .8, Math.max(220, w.bounds.width * scale) * previewScale);
    return {x, y, width: w0, height: w0 / aspect + 32};
  });
  const tile = (x: number, y: number, w: number, h: number): Tile => ({x,y,width:w,height:h,meta:Math.min(32,h*.23),preview:h-Math.min(32,h*.23)});
  const originals = windows.map((w,i) => spatialIds.includes(w.id)
    ? tile(ox+(w.bounds.x-screen.x)*scale,oy+(w.bounds.y-screen.y)*scale,w.bounds.width*scale,w.bounds.height*scale)
    : tile(Math.max(0,Math.min(width-Math.min(120,width),anchors[i].x-60)),Math.max(0,height-80),Math.min(120,width),Math.min(76,height)));
  if (stacked) return {columns: 1, tiles: originals};
  const order=anchors.map((_,i)=>i).sort((a,b)=>anchors[b].width*anchors[b].height-anchors[a].width*anchors[a].height || a-b);
  function pack(shrink:number) {
    const placed: {x:number;y:number;width:number;height:number;index:number}[]=[];
    for(const index of order) {
      const a=anchors[index],w=a.width*shrink,h=a.height*shrink,gap=12;
      if(w>width||h>height)return null;
      const home=homes[index];
      const minX=Math.max(0,home ? home.minX-w/2 : 0);
      const maxX=Math.min(width-w,home ? home.maxX-w/2 : width-w);
      if(minX>maxX)return null;
      const clamp=(x:number,y:number)=>({x:Math.max(minX,Math.min(maxX,x)),y:Math.max(0,Math.min(height-h,y))});
      const origin=clamp(a.x-w/2,a.y-h/2);
      const candidates=[origin,clamp(0,0),clamp(width-w,0),clamp(0,height-h),clamp(width-w,height-h)];
      for(const p of placed) {
        for(const x of [p.x-w-gap,p.x+p.width+gap])for(const y of [origin.y,p.y,p.y+p.height-h])candidates.push(clamp(x,y));
        for(const y of [p.y-h-gap,p.y+p.height+gap])for(const x of [origin.x,p.x,p.x+p.width-w])candidates.push(clamp(x,y));
      }
      let best: {x:number;y:number}|null=null,score=Infinity;
      for(const c of candidates) {
        if(placed.some(p=>c.x < p.x+p.width+gap-.1 && c.x+w+gap-.1 > p.x && c.y < p.y+p.height+gap-.1 && c.y+h+gap-.1 > p.y))continue;
        const distance=((c.x+w/2-a.x)/width)**2+((c.y+h/2-a.y)/height)**2;
        if(distance<score){best=c;score=distance;}
      }
      if(!best)return null;
      placed.push({...best,width:w,height:h,index});
    }
    return placed.sort((a,b)=>a.index-b.index).map(n=>tile(n.x,n.y,n.width,n.height));
  }
  let low=0,high=1,best:Tile[]=[];
  for(let i=0;i<14;i++) {
    const middle=(low+high)/2,result=pack(middle);
    if(result){low=middle;best=result;}else high=middle;
  }
  return {columns:1,tiles:best.map((t,i)=>({...t,origin:originals[i]}))};
}

export type DesktopAnchor = {desktop:NativeDesktop; ids:string[]; x:number};

export function desktopOverviewTiles(panel:OverviewPanel, windows:Destination[], width:number, height:number, stacked:boolean, spatialIds:string[], desktops:NativeDesktop[] = []) {
  const relevant=desktops.filter(d=>d.displayIds?.length ? d.displayIds.includes(panel.display.id) : !d.displayId || d.displayId===panel.display.id);
  if(!relevant.length) return {...overviewTiles(panel,windows,width,height,stacked,spatialIds),regions:[] as DesktopAnchor[]};
  // Native Space order supplies horizontal anchors, never clipping containers.
  const groups=relevant.map(desktop=>({desktop,items:windows.filter(w=>w.desktopId===desktop.id)}))
    .filter(g=>g.items.length || g.desktop.current);
  const unknown=windows.filter(w=>!relevant.some(d=>d.id===w.desktopId));
  if(unknown.length)groups.push({desktop:{id:"__unknown",name:"",displayId:panel.display.id,displayIds:[],current:false},items:unknown});
  if(!groups.length) return {...overviewTiles(panel,windows,width,height,stacked,spatialIds),regions:[] as DesktopAnchor[]};
  const screen=panel.display.bounds;
  const step=screen.width;
  const scene={...screen,width:screen.width+step*(groups.length-1)};
  const top=Math.min(28,height*.1),canvasHeight=Math.max(1,height-top);
  const scale=Math.min(width/scene.width,canvasHeight/scene.height);
  const ox=(width-scene.width*scale)/2;
  const offsets=new Map(groups.flatMap((g,i)=>g.items.map(w=>[w.id,i*step] as const)));
  const projected=windows.map(w=>({...w,bounds:{...w.bounds,x:w.bounds.x+(offsets.get(w.id) ?? 0)}}));
  const centers=groups.map((_,i)=>ox+(i*step+screen.width/2)*scale);
  const homesById=new Map(groups.flatMap((g,i)=>{
    // Edges can borrow adjacent space; centers must still identify the right
    // desktop. A full local area should shrink previews, never relocate them.
    const minX=i ? (centers[i-1]+centers[i])/2 : 0;
    const maxX=i+1<groups.length ? (centers[i]+centers[i+1])/2 : width;
    const margin=Math.min(12,(maxX-minX)*.1);
    const shelf=g.items.filter(w=>w.minimized||w.hidden||w.bounds.width<=0||w.bounds.height<=0);
    return g.items.map(w=>[w.id,{minX:minX+margin,maxX:maxX-margin,
      shelfX:minX+(maxX-minX)*(shelf.indexOf(w)+1)/(shelf.length+1)}] as const);
  }));
  // All desktops share one collision pass, with desktop-aware center limits.
  const positioned=windows.filter(w=>!w.minimized&&!w.hidden&&w.bounds.width>0&&w.bounds.height>0).map(w=>w.id);
  const layout=overviewTiles({...panel,display:{...panel.display,bounds:scene}},projected,width,canvasHeight,stacked,[...new Set([...spatialIds,...positioned])],Math.min(3,groups.length),windows.map(w=>homesById.get(w.id)!));
  return {...layout,tiles:layout.tiles.map(t=>({...t,y:t.y+top,origin:t.origin ? {...t.origin,y:t.origin.y+top} : undefined})),
    regions:groups.map((g,i)=>({desktop:g.desktop,ids:g.items.map(w=>w.id),x:ox+(i*step+screen.width/2)*scale}))};
}

export function textRows(windows: Destination[], width: number) {
  let y = 0;
  return {columns: 1, tiles: windows.map(w => {
    const height = w.content?.description ? 88 : 72;
    const tile = {x: 0, y, width, height, preview: 0, meta: height};
    y += height + 8;
    return tile;
  })};
}

// Keep MRU order, use a shared preview height, and fit every row in the viewport.
// Different window aspect ratios therefore remain visible without letterboxing.
export function tileWindows(windows: Destination[], width: number, height: number, compact: boolean, scrollable = false) {
  const n = windows.length;
  if (!n || width <= 0 || height <= 0) return { columns: 1, tiles: [] as Tile[] };
  const aspects = windows.map((w) => w.bounds?.width > 0 && w.bounds?.height > 0
    ? w.bounds.width / w.bounds.height : 16 / 10);
  if (scrollable && !compact) {
    // Content inventories can contain hundreds of tabs. Keep the same window
    // tiling, but grow the canvas rather than shrinking previews below 140px.
    const columns = Math.max(1, Math.floor((width + 14) / (Math.max(...aspects) * 140 + 14)));
    height = Math.max(height, Math.ceil(n / columns) * (140 + 48 + 14) - 14);
  }
  let best = { columns: 1, preview: -1, meta: 0, gap: 0, rows: n };
  for (let columns = 1; columns <= n; columns++) {
    const rows = Math.ceil(n / columns);
    const gap = Math.min(14, width / (columns * 16), height / (rows * 16));
    const meta = Math.min(compact ? 68 : 48, height / (rows * (compact ? 1.1 : 4)));
    let widest = 0;
    for (let i = 0; i < n; i += columns)
      widest = Math.max(widest, aspects.slice(i, i + columns).reduce((a, b) => a + b, 0));
    const preview = compact
      ? Math.min((width - gap * (columns - 1)) / columns / 4, (height - gap * (rows - 1)) / rows)
      : Math.min((width - gap * (columns - 1)) / widest, (height - gap * (rows - 1)) / rows - meta);
    if (preview > best.preview) best = { columns, preview, meta, gap, rows };
  }
  const { columns, gap, rows } = best;
  const preview = Math.max(0, best.preview);
  const meta = compact ? preview : best.meta;
  const cardHeight = compact ? meta : preview + meta;
  const top = Math.max(0, (height - rows * cardHeight - (rows - 1) * gap) / 2);
  const tiles: Tile[] = [];
  for (let i = 0; i < n; i += columns) {
    const row = aspects.slice(i, i + columns);
    const widths = row.map((a) => compact ? (width - gap * (columns - 1)) / columns : a * preview);
    let x = Math.max(0, (width - widths.reduce((a, b) => a + b, 0) - gap * (row.length - 1)) / 2);
    widths.forEach((w) => {
      tiles.push({ x, y: top + Math.floor(i / columns) * (cardHeight + gap), width: w, height: cardHeight, preview: compact ? 0 : preview, meta });
      x += w + gap;
    });
  }
  return { columns, tiles };
}
