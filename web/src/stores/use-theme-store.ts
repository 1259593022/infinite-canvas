import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_CANVAS_HUE } from "@/lib/canvas-theme";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    theme: ThemeName;
    /** 画布配色的色相 0-360 */
    canvasHue: number;
    /** 染色浓度 0-1。**默认 0**：不染色时界面和加这个功能之前逐字一致 */
    canvasTint: number;
    /** 亮度 -1~1，0 为内置主题原样。负=更暗，正=更亮 */
    canvasBrightness: number;
    setTheme: (theme: ThemeName) => void;
    setCanvasHue: (hue: number) => void;
    setCanvasTint: (tint: number) => void;
    setCanvasBrightness: (brightness: number) => void;
    resetCanvasColor: () => void;
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: "dark",
            canvasHue: DEFAULT_CANVAS_HUE,
            canvasTint: 0,
            canvasBrightness: 0,
            setTheme: (theme) => set({ theme }),
            setCanvasHue: (canvasHue) => set({ canvasHue }),
            setCanvasTint: (canvasTint) => set({ canvasTint }),
            setCanvasBrightness: (canvasBrightness) => set({ canvasBrightness }),
            resetCanvasColor: () => set({ canvasHue: DEFAULT_CANVAS_HUE, canvasTint: 0, canvasBrightness: 0 }),
        }),
        {
            name: "infinite-canvas:theme_store",
            // 老用户的本地数据里没有这两个字段，补上默认值 —— 不补的话是 undefined，
            // 滑块会变成不受控组件
            merge: (persisted, current) => {
                const saved = (persisted || {}) as Partial<ThemeStore>;
                return {
                    ...current,
                    ...saved,
                    canvasHue: typeof saved.canvasHue === "number" ? saved.canvasHue : DEFAULT_CANVAS_HUE,
                    canvasTint: typeof saved.canvasTint === "number" ? saved.canvasTint : 0,
                    canvasBrightness: typeof saved.canvasBrightness === "number" ? saved.canvasBrightness : 0,
                };
            },
        },
    ),
);
