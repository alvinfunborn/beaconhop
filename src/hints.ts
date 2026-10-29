import type { CSSProperties } from "react";
import type { HintStyle } from "./types";

export function hintVariables(style: HintStyle): CSSProperties {
  const alpha = Math.round(style.opacity * 255 / 100).toString(16).padStart(2, "0");
  return {
    "--hint-font-size": `${style.fontSize}px`,
    "--hint-weight": style.fontWeight,
    "--hint-color": style.color,
    "--hint-background": style.background + alpha,
    "--hint-radius": `${style.radius}px`,
    "--hint-border-color": style.borderColor,
    "--hint-border-width": `${style.borderWidth}px`,
    "--hint-shadow": style.shadow ? "0 0 0 2px #fff9, 0 3px 12px #0009" : "none",
  } as CSSProperties;
}
