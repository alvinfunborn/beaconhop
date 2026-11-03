import type { Destination, OverviewPanel } from "./types";
import type { Tile, DesktopRegion } from "./layout";

export function intersects(a: Destination["bounds"], b: Destination["bounds"]) {
  return a.width > 0 && a.height > 0 && a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

// Original desktop footprint stays behind the expanded card as a spatial anchor.
export function WindowSpatialOverview({panel, windows, highlighted, width, height, tile, region, zh}: {
  panel: OverviewPanel; windows: Destination[]; highlighted: string | null;
  width:number; height:number; tile?:Tile; region?:DesktopRegion; zh:boolean;
}) {
  const target=windows.find(w=>w.id===highlighted);
  if(!target||!tile||width<=0||height<=0)return null;
  const b=panel.display.bounds,w=target.bounds;
  const rw=region ? region.width-2*region.inset : width,rh=region?.height ?? height;
  const scale=Math.min(rw/b.width,rh/b.height);
  const x=(region ? region.x+region.inset : 0)+(rw-b.width*scale)/2+(w.x-b.x)*scale;
  const y=(region?.y ?? 0)+(rh-b.height*scale)/2+(w.y-b.y)*scale;
  return <div className="spatial-origin" aria-hidden="true">
    <svg width={width} height={height}><line x1={x+w.width*scale/2} y1={y+w.height*scale/2} x2={tile.x+tile.width/2} y2={tile.y+tile.height/2}/></svg>
    <div className="spatial-footprint" style={{left:x,top:y,width:w.width*scale,height:w.height*scale}}>
      <span>{zh ? "原位置" : "Original position"} · {target.appName}</span>
    </div>
  </div>;
}
