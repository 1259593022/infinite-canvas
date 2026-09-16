import { useMemo } from "react";

import { buildCanvasTheme, type CanvasTheme } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

/**
 * 当前生效的画布配色。
 *
 * 放在 hooks 而不是 lib/canvas-theme.ts：那边被 use-theme-store 依赖（取默认色相），
 * 反向再依赖 store 就成环了。
 */
export function useCanvasTheme(): CanvasTheme {
    const mode = useThemeStore((state) => state.theme);
    const hue = useThemeStore((state) => state.canvasHue);
    const tint = useThemeStore((state) => state.canvasTint);
    const brightness = useThemeStore((state) => state.canvasBrightness);
    return useMemo(() => buildCanvasTheme(mode, hue, tint, brightness), [mode, hue, tint, brightness]);
}
