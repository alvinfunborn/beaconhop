import type { Destination, OverviewPanel, NativeDesktop } from "./types";

type Area = {x:number;y:number;width:number;height:number};
type SpatialGuide = {x:number;y:number;group:string;rank:number;home:Area;origin:Area};

export type Tile = { x: number; y: number; width: number; height: number; preview: number; meta: number; origin?: {x:number;y:number;width:number;height:number} };

// Use native centers as spatial cues and keep relative size while packing cards.
// Layout uses the complete inventory: selection and filtering never repack it.
export function overviewTiles(panel: OverviewPanel, windows: Destination[], width: number, height: number, stacked = false, spatialIds: string[] = [], guides: SpatialGuide[] = []) {
  if (!windows.length || width <= 0 || height <= 0) return {columns: 1, tiles: [] as Tile[]};
  const screen = panel.display.bounds;
  const scale = Math.min(width / screen.width, height / screen.height);
  const ox = (width - screen.width * scale) / 2, oy = (height - screen.height * scale) / 2;
  const caption = guides.length ? Math.min(32,height*.12) : 0;
  const anchors = windows.map((w, i) => {
    const visible = spatialIds.includes(w.id);
    const x = guides[i]?.x ?? (visible ? ox + (w.bounds.x - screen.x + w.bounds.width / 2) * scale : width * (i + 1) / (windows.length + 1));
    const y = guides[i]?.y ?? (visible ? oy + (w.bounds.y - screen.y + w.bounds.height / 2) * scale : height * .9);
    const aspect = Math.max(.5, Math.min(2.5, w.bounds.width / Math.max(1, w.bounds.height)));
    // One common scale preserves both native dimensions across every desktop
    // on this display. Captions sit outside the proportionate preview.
    if(guides.length)return {x,y,width:Math.max(1,w.bounds.width)*scale,height:Math.max(1,w.bounds.height)*scale};
    const w0 = Math.min(width * .8, Math.max(220, w.bounds.width * scale));
    return {x, y, width: w0, height: w0 / aspect + 32};
  });
  const tile = (x: number, y: number, w: number, h: number, meta=Math.min(32,h*.23)): Tile => ({x,y,width:w,height:h,meta,preview:h-meta});
  const originals = windows.map((w,i) => guides[i]
    ? tile(guides[i].origin.x,guides[i].origin.y,guides[i].origin.width,guides[i].origin.height)
    : spatialIds.includes(w.id) ? tile(ox+(w.bounds.x-screen.x)*scale,oy+(w.bounds.y-screen.y)*scale,w.bounds.width*scale,w.bounds.height*scale)
    : tile(Math.max(0,Math.min(width-Math.min(120,width),anchors[i].x-60)),Math.max(0,height-80),Math.min(120,width),Math.min(76,height)));
  if (stacked) return {columns: 1, tiles: originals};
  let order:number[]=[];
  function pack(shrink:number,strategy:string) {
    const placed: {x:number;y:number;width:number;height:number;index:number}[]=[];
    let free:Area[]=[{x:0,y:0,width,height}];
    for(const index of order) {
      const a=anchors[index],w=a.width*shrink,h=a.height*shrink+caption,gap=guides.length ? 8 : 12;
      if(w>width||h>height)return null;
      const clamp=(x:number,y:number)=>({x:Math.max(0,Math.min(width-w,x)),y:Math.max(0,Math.min(height-h,y))});
      const guide=guides[index],flow=strategy.startsWith("flow");
      const compact=strategy.startsWith("compact"),fitStrategy=strategy.startsWith("fit"),short=strategy.startsWith("short"),contact=strategy.startsWith("contact"),edgeStrategy=strategy.startsWith("edge");
      const own=guide ? placed.filter(p=>guides[p.index].group===guide.group) : [];
      const lastInGroup=guide && !order.slice(order.indexOf(index)+1).some(i=>guides[i].group===guide.group);
      const previousRank=guide ? Math.max(-1,...placed.map(p=>guides[p.index].rank).filter(rank=>rank<guide.rank)) : -1;
      const previous=guide ? placed.filter(p=>guides[p.index].rank===previousRank) : [];
      const origin=clamp(a.x-w/2,a.y-h/2);
      const candidates=[origin,clamp(0,0),clamp(width-w,0),clamp(0,height-h),clamp(width-w,height-h)];
      // Guided layouts already enumerate maximal free rectangles below. Their
      // corners cover neighbour edges without twelve extra candidates per card.
      for(const p of guide ? [] : placed) {
        for(const x of [p.x-w-gap,p.x+p.width+gap])for(const y of [origin.y,p.y,p.y+p.height-h])candidates.push(clamp(x,y));
        for(const y of [p.y-h-gap,p.y+p.height+gap])for(const x of [origin.x,p.x,p.x+p.width-w])candidates.push(clamp(x,y));
      }
      // The last card completes the desktop's collective center. Constrain that
      // center rather than every edge, keeping desktop order without columns.
      const minCenterX=lastInGroup && previous.length
        ? previous.reduce((sum,p)=>sum+p.x+p.width/2,0)/previous.length*(own.length+1)
          -own.reduce((sum,p)=>sum+p.x+p.width/2,0) : -Infinity;
      // Flow fills across the whole canvas. The collective center still orders
      // desktops, but individual windows may fill gaps across guide boundaries.
      if(guide){
        let left=Math.max(0,minCenterX-w/2),right=width-w,top=0,bottom=height-h;
        for(const p of flow ? [] : placed){
          const other=guides[p.index];if(other.group===guide.group)continue;
          const home=guide.home,b=other.home,px=p.x+p.width/2,py=p.y+p.height/2;
          if(home.x+home.width<=b.x+.1)right=Math.min(right,px-w/2-.6);
          if(b.x+b.width<=home.x+.1)left=Math.max(left,px-w/2+.6);
          if(home.y+home.height<=b.y+.1)bottom=Math.min(bottom,py-h/2-.6);
          if(b.y+b.height<=home.y+.1)top=Math.max(top,py-h/2+.6);
        }
        // Free rectangles find holes whose x and y edges come from different
        // windows; neighbor-only candidates miss these and shrink too early.
        for(const f of free){
          const x1=Math.max(left,f.x),x2=Math.min(right,f.x+f.width-w);
          const y1=Math.max(top,f.y),y2=Math.min(bottom,f.y+f.height-h);
          if(x1>x2||y1>y2)continue;
          candidates.push({x:Math.max(x1,Math.min(x2,origin.x)),y:Math.max(y1,Math.min(y2,origin.y))},
            {x:x1,y:y1},{x:x1,y:y2},{x:x2,y:y1},{x:x2,y:y2});
        }
      }
      let best: {x:number;y:number}|null=null,score=Infinity;
      const extent=compact && placed.length ? {
        left:Math.min(...placed.map(p=>p.x)),top:Math.min(...placed.map(p=>p.y)),
        right:Math.max(...placed.map(p=>p.x+p.width)),bottom:Math.max(...placed.map(p=>p.y+p.height)),
      } : undefined;
      const seen=new Map<number,Set<number>>();
      for(const c of candidates) {
        let ys=seen.get(c.x);
        if(ys?.has(c.y))continue;
        if(!ys)seen.set(c.x,ys=new Set());
        ys.add(c.y);
        if(placed.some(p=>c.x < p.x+p.width+gap-.1 && c.x+w+gap-.1 > p.x && c.y < p.y+p.height+gap-.1 && c.y+h+gap-.1 > p.y))continue;
        const home=guides[index]?.home,cx=c.x+w/2,cy=c.y+h/2;
        // Desktops constrain relative center order, never a fixed rectangle.
        // Edges freely interleave; all windows use this same collision pass.
        if(home && !flow && placed.some(p=>{
          const other=guides[p.index];
          if(!other || other.group===guides[index].group)return false;
          const b=other.home,px=p.x+p.width/2,py=p.y+p.height/2;
          return home.x+home.width<=b.x+.1 && cx>=px-.5
            || b.x+b.width<=home.x+.1 && px>=cx-.5
            || home.y+home.height<=b.y+.1 && cy>=py-.5
            || b.y+b.height<=home.y+.1 && py>=cy-.5;
        }))continue;
        if(cx<minCenterX-.1)continue;
        const distance=((cx-a.x)/width)**2+((cy-a.y)/height)**2;
        const footprint=extent ? (Math.max(extent.right,c.x+w)-Math.min(extent.left,c.x))
          *(Math.max(extent.bottom,c.y+h)-Math.min(extent.top,c.y))/(width*height) : 0;
        // Prefer tight free rectangles and their corners, rather than leaving
        // unusable strips around a card centered inside a large empty region.
        let fit=0,shortSide=0;
        if(fitStrategy||short){
          fit=Infinity;shortSide=Infinity;
          for(const f of free){
            if(c.x<f.x-.1 || c.y<f.y-.1 || c.x+w>f.x+f.width+.1 || c.y+h>f.y+f.height+.1)continue;
            const corner=(Math.min(c.x-f.x,f.x+f.width-c.x-w)+Math.min(c.y-f.y,f.y+f.height-c.y-h))/Math.max(width,height);
            if(fitStrategy)fit=Math.min(fit,(f.width*f.height-w*h)/(width*height)+corner);
            else shortSide=Math.min(shortSide,Math.min(f.width-w,f.height-h)/Math.max(width,height)+corner);
          }
        }
        const edge = (c.y+h)/height + c.x/width*.05;
        const touch=contact ? placed.reduce((sum,p)=>sum
          +(Math.abs(c.x-p.x-p.width-gap)<.2||Math.abs(c.x+w+gap-p.x)<.2 ? Math.max(0,Math.min(c.y+h,p.y+p.height)-Math.max(c.y,p.y)):0)
          +(Math.abs(c.y-p.y-p.height-gap)<.2||Math.abs(c.y+h+gap-p.y)<.2 ? Math.max(0,Math.min(c.x+w,p.x+p.width)-Math.max(c.x,p.x)):0),
          (c.x<.1||c.x+w>width-.1?h:0)+(c.y<.1||c.y+h>height-.1?w:0))/(width+height) : 0;
        const cost=flow ? (c.x+w)/width + c.y/height*0.5 + distance*.005 : contact ? -touch+distance*.01 : short ? shortSide+distance*.01 : edgeStrategy ? edge+distance*.005 : fitStrategy ? fit+distance*.02 : compact ? footprint+distance*.25 : distance;
        if(cost<score){best=c;score=cost;}
      }
      if(!best)return null;
      placed.push({...best,width:w,height:h,index});
      if(guide){
        const cut={x:best.x-gap,y:best.y-gap,right:best.x+w+gap,bottom:best.y+h+gap};
        free=free.flatMap(f=>{
          const right=f.x+f.width,bottom=f.y+f.height;
          if(cut.x>=right||cut.right<=f.x||cut.y>=bottom||cut.bottom<=f.y)return [f];
          const pieces:Area[]=[];
          if(cut.x>f.x)pieces.push({...f,width:cut.x-f.x});
          if(cut.right<right)pieces.push({...f,x:cut.right,width:right-cut.right});
          if(cut.y>f.y)pieces.push({...f,height:cut.y-f.y});
          if(cut.bottom<bottom)pieces.push({...f,y:cut.bottom,height:bottom-cut.bottom});
          return pieces;
        }).filter((f,i,all)=>!all.some((b,j)=>j!==i && b.x<=f.x && b.y<=f.y
          && b.x+b.width>=f.x+f.width && b.y+b.height>=f.y+f.height
          && (j<i||b.width*b.height>f.width*f.height)));
      }
    }
    return placed.sort((a,b)=>a.index-b.index).map(n=>tile(n.x,n.y,n.width,n.height,guides.length ? caption : undefined));
  }
  let best:Tile[]=[],largest=0;
  const strategies=guides.length ? ['area','x','y','small','compact','compact-small','fit','fit-small','edge','edge-small','short','short-small','contact','contact-small',...(new Set(guides.map(g=>g.group)).size>1 ? ['flow','flow-small','flow-x','flow-y','flow-height','flow-width'] : [])] : ['area'];
  for(const strategy of strategies){
    order=anchors.map((_,i)=>i).sort((a,b)=>(guides[a]?.rank ?? 0)-(guides[b]?.rank ?? 0)
      || (strategy.endsWith('x') ? anchors[a].x-anchors[b].x : strategy.endsWith('y') ? anchors[a].y-anchors[b].y
        : strategy.endsWith('height') ? anchors[b].height-anchors[a].height : strategy.endsWith('width') ? anchors[b].width-anchors[a].width : (strategy.endsWith('small') ? -1 : 1)*(anchors[b].width*anchors[b].height-anchors[a].width*anchors[a].height)) || a-b);
    let low=0,high=guides.length ? Math.min(...anchors.map(a=>Math.min(width/a.width,(height-caption)/a.height))) : 1,candidate:Tile[]=[];
    // Ten steps resolve scale to about one screen pixel; extra subpixel probes
    // repeat the expensive collision pass without a visible size improvement.
    for(let i=0;i<10;i++) {
      const middle=(low+high)/2,result=pack(middle,strategy);
      if(result){low=middle;candidate=result;}else high=middle;
    }
    if(guides.length && candidate.length){
      // Axis compaction removes interior gutters without crossing neighbours.
      // Flow candidates preserve collective desktop order instead of quadrants.
      const normalize=(cards:Tile[])=>{
        const left=Math.min(...cards.map(t=>t.x)),top=Math.min(...cards.map(t=>t.y));
        const spanX=Math.max(...cards.map(t=>t.x+t.width))-left,spanY=Math.max(...cards.map(t=>t.y+t.height))-top;
        const zoom=Math.min(width/spanX,height/spanY);
        return cards.map(t=>tile((width-spanX*zoom)/2+(t.x-left)*zoom,(height-spanY*zoom)/2+(t.y-top)*zoom,
          t.width*zoom,t.preview*zoom+caption,caption));
      };
      const ordered=(cards:Tile[])=>{
        const ranks=[...new Set(guides.map(g=>g.rank))].sort((a,b)=>a-b);
        const centers=ranks.map(rank=>{const own=cards.filter((_,i)=>guides[i].rank===rank);return own.reduce((s,t)=>s+t.x+t.width/2,0)/own.length;});
        return centers.every((x,i)=>!i||x>=centers[i-1]-.1);
      };
      const variants=[candidate];
      for(const first of ['x','y'] as const){
        const cards=candidate.map(t=>({...t}));
        for(let pass=0;pass<4;pass++)for(const axis of [first,first==='x'?'y':'x'] as const){
          const size=axis==='x'?'width':'height',cross=axis==='x'?'y':'x',crossSize=axis==='x'?'height':'width';
          const indices=cards.map((_,i)=>i).sort((a,b)=>cards[a][axis]+cards[a][size]/2-cards[b][axis]-cards[b][size]/2||a-b);
          const done:number[]=[];
          for(const i of indices){
            const t=cards[i];let start=0;
            for(const j of done){
              const p=cards[j];
              if(t[cross]<p[cross]+p[crossSize]+7.9 && t[cross]+t[crossSize]+7.9>p[cross])
                start=Math.max(start,p[axis]+p[size]+8);
              const home=guides[i].home,b=guides[j].home;
              if(!strategy.startsWith('flow') && guides[i].group!==guides[j].group && b[axis]+b[size]<=home[axis]+.1)
                start=Math.max(start,p[axis]+p[size]/2-t[size]/2+.6);
            }
            t[axis]=Math.min(t[axis],start);done.push(i);
          }
        }
        if(ordered(cards))variants.push(cards);
      }
      for(const cards of variants){
        const normalized=normalize(cards),score=normalized[0].width/anchors[0].width;
        if(score>largest){largest=score;best=normalized;}
      }
    }else if(low>largest){largest=low;best=candidate;}
  }
  return {columns:1,tiles:best.map((t,i)=>({...t,origin:originals[i]}))};
}

export type DesktopAnchor = Area & {desktop:NativeDesktop; ids:string[]; centerX:number};

// Preserve native desktop order in a map weighted by total native window area.
// Desktops with larger scenes get more room; sparse successors can stack.
// These are layout guides and soft background washes, not visible containers.
function desktopAreas(weights:number[], area:Area, aspect:number): Area[] {
  if(weights.length<=1)return weights.map(()=>area);
  const total=weights.reduce((a,b)=>a+b,0);
  let split=1,sum=weights[0],best=Math.abs(total/2-sum);
  for(let i=1,partial=sum;i<weights.length-1;i++){
    partial+=weights[i];
    const distance=Math.abs(total/2-partial);
    if(distance<best){best=distance;split=i+1;sum=partial;}
  }
  const horizontal=area.width/Math.max(1,area.height)>=aspect;
  const fraction=sum/total;
  const first=horizontal ? {...area,width:area.width*fraction} : {...area,height:area.height*fraction};
  const second=horizontal ? {...area,x:area.x+first.width,width:area.width-first.width}
    : {...area,y:area.y+first.height,height:area.height-first.height};
  return [...desktopAreas(weights.slice(0,split),first,aspect),...desktopAreas(weights.slice(split),second,aspect)];
}

export function desktopOverviewTiles(panel:OverviewPanel, windows:Destination[], width:number, height:number, stacked:boolean, spatialIds:string[], desktops:NativeDesktop[] = []) {
  const relevant=desktops.filter(d=>d.displayIds?.length ? d.displayIds.includes(panel.display.id) : !d.displayId || d.displayId===panel.display.id);
  if(!relevant.length) return {...overviewTiles(panel,windows,width,height,stacked,spatialIds),regions:[] as DesktopAnchor[]};
  const groups=relevant.map(desktop=>({desktop,items:windows.filter(w=>w.desktopId===desktop.id)}))
    .filter(g=>g.items.length || g.desktop.current);
  const unknown=windows.filter(w=>!relevant.some(d=>d.id===w.desktopId));
  if(unknown.length)groups.push({desktop:{id:"__unknown",name:"",displayId:panel.display.id,displayIds:[],current:false},items:unknown});
  if(!groups.length) return {...overviewTiles(panel,windows,width,height,stacked,spatialIds),regions:[] as DesktopAnchor[]};
  const screen=panel.display.bounds;
  const top=Math.min(24,height*.1),canvasHeight=Math.max(1,height-top);
  const nativeArea=(w:Destination)=>Math.max(1,w.bounds.width)*Math.max(1,w.bounds.height);
  const typicalArea=windows.length ? windows.reduce((sum,w)=>sum+nativeArea(w),0)/windows.length : 1;
  const areas=desktopAreas(groups.map(g=>g.items.reduce((sum,w)=>sum+nativeArea(w),0) || typicalArea*.25),{x:0,y:0,width:Math.max(0,width),height:canvasHeight},screen.width/Math.max(1,screen.height));
  const byId=new Map<string,SpatialGuide>();
  groups.forEach((g,i)=>{
    const home=areas[i],scale=Math.min(home.width/screen.width,home.height/screen.height);
    const ox=home.x+(home.width-screen.width*scale)/2,oy=home.y+(home.height-screen.height*scale)/2;
    const shelf=g.items.filter(w=>w.minimized||w.hidden||w.bounds.width<=0||w.bounds.height<=0);
    g.items.forEach(w=>{
      const parked=shelf.includes(w);
      const origin=parked
        ? {x:home.x+home.width*(shelf.indexOf(w)+1)/(shelf.length+1)-Math.min(60,home.width/4),y:home.y+home.height*.85,
          width:Math.min(120,home.width/2),height:Math.min(76,home.height*.15)}
        : {x:ox+(w.bounds.x-screen.x)*scale,y:oy+(w.bounds.y-screen.y)*scale,width:w.bounds.width*scale,height:w.bounds.height*scale};
      // Draw the whole scene toward its center; desktop areas are only hints
      // for placement. Shared packing fills the space between those hints.
      byId.set(w.id,{group:g.desktop.id,rank:i,home,origin,
        x:width/2+(origin.x+origin.width/2-width/2)*.55,
        y:canvasHeight/2+(origin.y+origin.height/2-canvasHeight/2)*.55});
    });
  });
  const positioned=windows.filter(w=>!w.minimized&&!w.hidden&&w.bounds.width>0&&w.bounds.height>0).map(w=>w.id);
  const layout=overviewTiles(panel,windows,width,canvasHeight,stacked,[...new Set([...spatialIds,...positioned])],windows.map(w=>byId.get(w.id)!));
  const tiles=layout.tiles.map(t=>({...t,y:t.y+top,origin:t.origin ? {...t.origin,y:t.origin.y+top} : undefined}));
  return {...layout,tiles,regions:groups.map((g,i)=>{
    const cards=tiles.filter((_,index)=>windows[index].desktopId===g.desktop.id || g.desktop.id==='__unknown'&&unknown.includes(windows[index]));
    const x=cards.length ? Math.min(...cards.map(t=>t.x)) : areas[i].x;
    const y=cards.length ? Math.min(...cards.map(t=>t.y)) : areas[i].y+top;
    const right=cards.length ? Math.max(...cards.map(t=>t.x+t.width)) : x+areas[i].width;
    const bottom=cards.length ? Math.max(...cards.map(t=>t.y+t.height)) : y+areas[i].height;
    return {desktop:g.desktop,ids:g.items.map(w=>w.id),centerX:cards.length ? cards.reduce((sum,t)=>sum+t.x+t.width/2,0)/cards.length : x+(right-x)/2,x,y:y-top,width:right-x,height:bottom-y+top};
  })};
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
