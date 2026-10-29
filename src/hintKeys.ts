import type { ScreenBuoyConfig } from "./types";

export function physicalHintKey(value: string): string {
  if (value === " ") return "Space";
  if (value === "`" || value === "~") return "Backquote";
  if (value === "\\" || value === "|") return "Backslash";
  const index = '!@#$%^&*()_+{}:"<>?'.indexOf(value);
  return index >= 0 ? "1234567890-=[];',./"[index] : value.toUpperCase();
}
export function defaultScreenBuoy(): ScreenBuoyConfig {
  const neighbours: ScreenBuoyConfig["neighbours"] = {};
  for (const row of ["`1234567890-=", "QWERTYUIOP[]\\", "ASDFGHJKL;'", "ZXCVBNM,./", " "]) {
    const keys = [...row].map(physicalHintKey);
    keys.forEach((key, i) => { neighbours[key] = { left: keys[i - 1] ?? null, right: keys[i + 1] ?? null }; });
  }
  return { enabled: false, applicationPath: "", keys: ["HintLeftKey", "HintRightKey"], neighbours };
}
export const physicalKeys = [...Object.keys(defaultScreenBuoy().neighbours), "Enter", "Tab", "Backspace", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
export function keyLabel(key: string) {
  return ({ Backquote: "`", Backslash: "\\", Space: "Space", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" } as Record<string, string>)[key] ?? key;
}
