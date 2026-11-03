import { useEffect, useRef, useState } from "react";
import { call } from "./api";
import type { Session } from "./types";

// Decode a whole batch before publishing it, so one invocation doesn't fill card by card.
async function decoded(images: Record<string, string>) {
  await Promise.all(Object.values(images).map(async src => {
    const image = new Image(); image.src = src;
    await image.decode().catch(() => {});
  }));
  return images;
}
export function usePreviews(session: Session | undefined, enabled: boolean) {
  const [images, setImages] = useState<Record<string, string>>({});
  const active = session?.mode !== "inactive";
  const targets = useRef<string[]>([]);
  targets.current = session?.layer === "desktops"
    ? [...new Set(Object.values(session.desktopPreviews ?? {}).flatMap(p => p.windows.map(w => w.id)))]
    : session?.windows.map(w => w.id) ?? [];
  useEffect(() => {
    if (!enabled) { setImages({}); return; }
    if (!session || !active || session.loading) return;
    let alive = true;
    if (session.layer === "tabs") {
      setImages({});
      // Inventory contains only availability flags. Fetch bounded cached batches
      // after the async tab list arrives; no capture is on the shortcut path.
      const ids = session.windows.filter(w => w.content?.preview).slice(0, 100).map(w => w.id);
      void (async () => {
        for (let i = 0; alive && i < ids.length; i += 8) {
          const data = await call<Record<string, string>>("get_tab_thumbnails", {ids: ids.slice(i, i + 8), sessionId: session.sessionId}).then(decoded);
          if (alive) setImages(old => ({...old, ...data}));
        }
      })().catch(() => {});
      return () => { alive = false; };
    }
    const args = { ids: targets.current, sessionId: session.sessionId };
    // Native cache can be warm even on the first invocation of this WebView.
    // This read remains independent of a slow refresh already in progress.
    const cached = call<Record<string,string>>("get_cached_thumbnails", args).then(decoded);
    const fresh = call<Record<string,string>>("get_thumbnails", args).then(decoded);
    let refreshed = false;
    cached.then(data => { if (alive && !refreshed) setImages(data); }).catch(() => {});
    fresh.then(data => { if (alive) { refreshed = true; setImages(data); } }).catch(() => {});
    return () => {alive = false;};
  }, [session?.sessionId, session?.loading, session?.layer, active, enabled]);
  return images;
}
