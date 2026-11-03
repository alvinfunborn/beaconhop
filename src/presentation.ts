import type { Config, ContentPresentation, Session } from "./types";

// Rendering depends on content semantics, never on a particular provider name.
// The user's explicit list preference also applies to thumbnail-capable content.
export function presentation(session: Session | undefined, layout: Config["layout"]): ContentPresentation {
  if (layout === "list") return "text";
  if (session?.layer === "tabs") return session.windows[0]?.content?.presentation ?? "text";
  return "thumbnails";
}
