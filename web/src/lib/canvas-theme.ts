export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

/**
 * 显式写成 string 而不是从 as const 推字面量。
 * 主题色值会按用户选的色相实时派生，字面量类型赋不回去。
 */
export type CanvasTheme = {
    canvas: { background: string; dot: string; line: string; selectionStroke: string; selectionFill: string };
    node: { label: string; fill: string; panel: string; stroke: string; activeStroke: string; placeholder: string; text: string; muted: string; faint: string };
    toolbar: { panel: string; border: string; item: string; itemHover: string; activeBg: string; activeText: string };
};

export const canvasThemes: Record<CanvasColorTheme, CanvasTheme> = {
    light: {
        canvas: {
            background: "#f4f2ed",
            dot: "rgba(68,64,60,.28)",
            line: "rgba(68,64,60,.12)",
            selectionStroke: "#1c1917",
            selectionFill: "rgba(28,25,23,.06)",
        },
        node: {
            label: "#57534e",
            fill: "#e7e5df",
            panel: "#fbfaf7",
            stroke: "#d6d3ca",
            activeStroke: "#1c1917",
            placeholder: "#8a8479",
            text: "#292524",
            muted: "#78716c",
            faint: "#a8a29e",
        },
        toolbar: {
            panel: "rgba(251,250,247,.96)",
            border: "#d6d3ca",
            item: "#57534e",
            itemHover: "#e7e5df",
            activeBg: "#e7e5df",
            activeText: "#292524",
        },
    },
    dark: {
        canvas: {
            background: "#181715",
            dot: "rgba(245,245,244,.24)",
            line: "rgba(245,245,244,.10)",
            selectionStroke: "#fafaf9",
            selectionFill: "rgba(250,250,249,.10)",
        },
        node: {
            label: "#d6d3d1",
            fill: "#292524",
            panel: "#1f1d1a",
            stroke: "#44403c",
            activeStroke: "#fafaf9",
            placeholder: "#a8a29e",
            text: "#f5f5f4",
            muted: "#d6d3d1",
            faint: "#78716c",
        },
        toolbar: {
            panel: "rgba(31,29,26,.96)",
            border: "#44403c",
            item: "#d6d3d1",
            itemHover: "#292524",
            activeBg: "#3a3631",
            activeText: "#f5f5f4",
        },
    },
};

/* ==================== 色相派生 ==================== */

/** 内置主题的色相，也是「恢复默认」的落点（暖灰 stone 系）。 */
export const DEFAULT_CANVAS_HUE = 40;

/** 浓度拉满时给饱和度加多少。再高文字就开始显脏了。 */
const MAX_SATURATION_ADD = 0.18;

/**
 * 亮度滑块拉满时，背景最多移动多少。
 *
 * 这个值是对比度的安全边界：深色模式底色 L≈0.09、正文 L≈0.96，抬高 0.10 之后
 * 两者仍有 0.77 的亮度差，远在可读范围内。再大就开始吃掉对比度了。
 */
const MAX_LIGHTNESS_SHIFT = 0.1;

/** 预设色相，外观面板上那排色块。 */
export const CANVAS_HUE_PRESETS = [0, 40, 80, 150, 190, 220, 265, 320];

type Rgba = { r: number; g: number; b: number; a: number | null };

/** 主题里只用到 #rrggbb 和 rgba() 两种写法。 */
function parseColor(value: string): Rgba | null {
    const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: null };
    }
    const rgba = value.trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]*)\s*)?\)$/i);
    if (!rgba) return null;
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] === undefined || rgba[4] === "" ? null : Number(rgba[4]) };
}

function rgbToHsl(r: number, g: number, b: number) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
    return { h: h * 60, s, l };
}

function hslToRgb(h: number, s: number, l: number) {
    if (s === 0) {
        const v = Math.round(l * 255);
        return { r: v, g: v, b: v };
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hk = (((h % 360) + 360) % 360) / 360;
    const channel = (t: number) => {
        let value = t;
        if (value < 0) value += 1;
        if (value > 1) value -= 1;
        if (value < 1 / 6) return p + (q - p) * 6 * value;
        if (value < 1 / 2) return q;
        if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
        return p;
    };
    return { r: Math.round(channel(hk + 1 / 3) * 255), g: Math.round(channel(hk) * 255), b: Math.round(channel(hk - 1 / 3) * 255) };
}

/**
 * 换色相、调饱和度，**亮度一律不动**。
 *
 * 亮度承载了全部对比度，只要不碰它，文字和背景的明暗关系就恒定，
 * 无论色相怎么拖都不会配出看不清的组合。
 *
 * 饱和度用加法而不是乘法：内置主题里像 #fafaf9 这种饱和度几乎为 0，
 * 乘法永远染不上色。
 */
function shiftColor(value: string, hue: number, tint: number, brightness: number, backgroundL: number, span: number): string {
    const rgba = parseColor(value);
    if (!rgba) return value;

    const { h, s, l } = rgbToHsl(rgba.r, rgba.g, rgba.b);
    // 浓度为 0 时保留原色相，只让亮度生效——不然「不染色」也会被强行改成滑块的色相
    const nextH = tint > 0 ? hue : h;
    const nextS = tint > 0 ? Math.min(1, Math.max(0, s + tint * MAX_SATURATION_ADD)) : s;
    const nextL = Math.min(1, Math.max(0, l + brightness * MAX_LIGHTNESS_SHIFT * proximityToBackground(l, backgroundL, span)));
    const { r, g, b } = hslToRgb(nextH, nextS, nextL);

    if (rgba.a === null) return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
    // 保留原来的 alpha 写法（.28 这种简写照原样输出，避免无谓的视觉差异）
    const alpha = String(rgba.a).replace(/^0(?=\.)/, "");
    return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 亮度位移的权重：越接近背景色的色值移动越多，越接近正文的越不动。
 *
 * 这样拉「亮度」时改变的主要是底色和面板这类大面积表面，文字几乎待在原地，
 * 于是明暗差不会被一起推平——否则背景和文字同向移动，对比度会直接塌掉。
 */
function proximityToBackground(l: number, backgroundL: number, span: number) {
    if (span <= 0) return 1;
    return Math.max(0, 1 - Math.abs(l - backgroundL) / span);
}

/**
 * 按色相、浓度、亮度派生整套主题。
 * 三个参数都是默认值时原样返回内置主题，保证默认观感零变化。
 */
export function buildCanvasTheme(mode: CanvasColorTheme, hue: number = DEFAULT_CANVAS_HUE, tint: number = 0, brightness: number = 0): CanvasTheme {
    const base = canvasThemes[mode];
    if (tint <= 0 && brightness === 0) return base;

    // 以背景为基准算每个色值的「离背景多远」，span 取全主题最大距离
    const backgroundL = rgbToHsl(...rgbOf(base.canvas.background)).l;
    const allL = [base.canvas, base.node, base.toolbar].flatMap((group) => Object.values(group).map((value) => rgbToHsl(...rgbOf(value)).l));
    const span = Math.max(...allL.map((l) => Math.abs(l - backgroundL)));

    const map = (group: Record<string, string>) => Object.fromEntries(Object.entries(group).map(([key, value]) => [key, shiftColor(value, hue, tint, brightness, backgroundL, span)]));
    return {
        canvas: map(base.canvas) as CanvasTheme["canvas"],
        node: map(base.node) as CanvasTheme["node"],
        toolbar: map(base.toolbar) as CanvasTheme["toolbar"],
    };
}

function rgbOf(value: string): [number, number, number] {
    const parsed = parseColor(value);
    return parsed ? [parsed.r, parsed.g, parsed.b] : [0, 0, 0];
}
