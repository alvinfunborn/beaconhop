import type {Destination} from "./types";

// Mirrors native navigation::reading_order for the browser preview.
export function readingOrder(rectangles: (Destination["bounds"] & {id:string})[]): string[] {
  let pending = [...rectangles].sort((a,b)=>a.y-b.y || a.id.localeCompare(b.id));
  const ordered: string[] = [];
  while (pending.length) {
    const anchor = pending[0];
    const sameRow = (b: typeof anchor) => b.y-anchor.y <= Math.min(anchor.height,b.height)*.35;
    const row = pending.filter(sameRow).sort((a,b)=>a.x-b.x || a.y-b.y || a.id.localeCompare(b.id));
    ordered.push(...row.map(b=>b.id));
    pending = pending.filter(b=>!sameRow(b));
  }
  return ordered;
}
