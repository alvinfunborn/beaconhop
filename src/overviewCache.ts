import { desktopOverviewTiles } from "./layout";
import type { Destination, NativeDesktop, OverviewPanel } from "./types";

// Keep geometry across close/reopen and layer changes. Titles, selection, hints,
// session serials and native Z-order do not change packed positions.
export function createOverviewCache(limit = 8) {
  const entries = new Map<string, ReturnType<typeof desktopOverviewTiles>>();
  return (panel: OverviewPanel, windows: Destination[], width: number, height: number,
    stacked: boolean, spatialIds: string[], desktops: NativeDesktop[] = []) => {
    const key = JSON.stringify([panel.display.bounds, panel.display.id, width, height, stacked,
      windows.map(w => [w.id, w.bounds, w.desktopId, w.hidden, w.minimized]),
      [...spatialIds].sort(), desktops]);
    let layout = entries.get(key);
    if (layout) entries.delete(key);
    else layout = desktopOverviewTiles(panel, windows, width, height, stacked, spatialIds, desktops);
    entries.set(key, layout);
    if (entries.size > limit) entries.delete(entries.keys().next().value!);
    return layout;
  };
}
