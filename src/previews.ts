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
  const targets = useRef(session?.windows ?? []);
  targets.current = session?.windows ?? [];
  useEffect(() => {
    if (!enabled) { setImages({}); return; }
    if (!session || !active) return;
    let alive = true;
    const args = { ids: targets.current.map(w => w.id), sessionId: session.sessionId };
    // Native cache can be warm even on the first invocation of this WebView.
    // This read remains independent of a slow refresh already in progress.
    const cached = call<Record<string,string>>("get_cached_thumbnails", args).then(decoded);
    const fresh = call<Record<string,string>>("get_thumbnails", args).then(decoded);
    let refreshed = false;
    cached.then(data => { if (alive && !refreshed) setImages(data); }).catch(() => {});
    fresh.then(data => { if (alive) { refreshed = true; setImages(data); } }).catch(() => {});
    return () => {alive = false;};
  }, [session?.sessionId, active, enabled]);
  return images;
}
