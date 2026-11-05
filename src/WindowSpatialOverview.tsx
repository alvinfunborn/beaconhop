import type { Destination } from "./types";
import type { Tile } from "./layout";

export function intersects(a: Destination["bounds"], b: Destination["bounds"]) {
  return a.width > 0 && a.height > 0 && a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

// Original desktop footprint stays behind the expanded card as a spatial anchor.
export function WindowSpatialOverview({windows, highlighted, width, height, tile, zh}: {
  windows: Destination[]; highlighted: string | null;
  width:number; height:number; tile?:Tile; zh:boolean;
}) {
  const target=windows.find(w=>w.id===highlighted),origin=tile?.origin;
  if(!target||target.minimized||target.hidden||!tile||!origin||width<=0||height<=0)return null;
  const {x,y,width:originalWidth,height:originalHeight}=origin;
  return <div className="spatial-origin" aria-hidden="true">
    <svg width={width} height={height}><line x1={x+originalWidth/2} y1={y+originalHeight/2} x2={tile.x+tile.width/2} y2={tile.y+tile.height/2}/></svg>
    <div className="spatial-footprint" style={{left:x,top:y,width:originalWidth,height:originalHeight}}>
      <span>{target.appName}</span>
    </div>
  </div>;
}
