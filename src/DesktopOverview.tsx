import { translate } from "./copy";
import type { CSSProperties } from "react";
import type { DesktopPreview, Destination } from "./types";

type Bounds = Destination["bounds"];
const valid = (b: Bounds) => b.width > 0 && b.height > 0;
const overlaps = (a: Bounds, b: Bounds) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;
function position(b: Bounds, parent: Bounds): CSSProperties {
  return {left: `${(b.x - parent.x) / parent.width * 100}%`, top: `${(b.y - parent.y) / parent.height * 100}%`,
    width: `${b.width / parent.width * 100}%`, height: `${b.height / parent.height * 100}%`};
}

// A window overview, not a wallpaper capture. Each display clips its own windows.
export function DesktopOverview({preview, images, zh}: {
  preview: DesktopPreview; images: Record<string, string>; zh: boolean;
}) {
  const displays = preview.displays.filter(d => valid(d.bounds));
  const x = Math.min(...displays.map(d => d.bounds.x)), y = Math.min(...displays.map(d => d.bounds.y));
  const bounds = {x, y, width: Math.max(...displays.map(d => d.bounds.x + d.bounds.width)) - x,
    height: Math.max(...displays.map(d => d.bounds.y + d.bounds.height)) - y};
  const windows = preview.windows.filter(w => valid(w.bounds) && displays.some(d => overlaps(w.bounds, d.bounds)));
  return <div className="desktop-overview" role="img" aria-label={translate(zh, "Desktop window overview")}>
    {displays.length > 0 && <div className="desktop-canvas" style={{aspectRatio: `${bounds.width} / ${bounds.height}`, width: `min(100cqw, calc(100cqh * ${bounds.width / bounds.height}))`}}>
      {displays.map(display => <div className="desktop-display" key={display.id} style={position(display.bounds, bounds)}>
        {[...windows].reverse().filter(w => overlaps(w.bounds, display.bounds)).map(w =>
          <div className="desktop-window" key={w.id} style={position(w.bounds, display.bounds)} title={`${w.appName} — ${w.title}`}>
            {images[w.id] ? <img src={images[w.id]} alt="" /> : <span>{w.appName}<small>{w.title}</small></span>}
          </div>)}
      </div>)}
    </div>}
    {!windows.length && <span className="desktop-empty">{displays.length ? (translate(zh, "No visible windows")) : (translate(zh, "Overview unavailable"))}</span>}
  </div>;
}
