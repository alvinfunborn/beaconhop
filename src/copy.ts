import chinese from "./locales/zh.json";

// English is the source key. Keep translations together instead of repeating
// bilingual prose in components. Dynamic messages can supply a fallback.
export function translate(zh: boolean, message: string, fallback?: string): string {
  return zh ? fallback ?? (chinese as Record<string, string>)[message] ?? message : message;
}
