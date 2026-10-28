import type { Destination } from "./types";

export type Tile = { x: number; y: number; width: number; height: number; preview: number; meta: number };

// Keep MRU order, use a shared preview height, and fit every row in the viewport.
// Different window aspect ratios therefore remain visible without letterboxing.
export function tileWindows(windows: Destination[], width: number, height: number, compact: boolean) {
  const n = windows.length;
  if (!n || width <= 0 || height <= 0) return { columns: 1, tiles: [] as Tile[] };
  const aspects = windows.map((w) => w.bounds?.width > 0 && w.bounds?.height > 0
    ? w.bounds.width / w.bounds.height : 16 / 10);
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
