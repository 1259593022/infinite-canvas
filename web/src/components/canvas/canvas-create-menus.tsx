import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, ImageIcon, List, Music2, Puzzle, Settings2, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CanvasTheme } from "@/lib/canvas-theme";
import { canvasThemes } from "@/lib/canvas-theme";
import { getNodePluginId, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeTypeId, type ConnectionHandle, type Position } from "@/types/canvas";
import { useCanvasTheme } from "@/hooks/use-canvas-theme";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

export function ConnectionCreateMenu({
    pending,
    onCreate,
    onClose,
}: {
    pending: PendingConnectionCreate;
    onCreate: (type: CanvasNodeTypeId) => void;
    onClose: () => void;
}) {
    const theme = useCanvasTheme();
    const { t } = useTranslation();
    useNodeRegistryVersion();
    // 内置五项之外，把插件节点也列进来——扩展能力都在插件里，
    // 从节点拉线时同样该能直接接上，不必先双击空白建好再连。
    const pluginDefs = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false && getNodePluginId(def.type) !== "builtin");
    return (
        <div
            className="absolute z-[120] max-h-[70vh] w-[300px] overflow-y-auto rounded-[18px] border p-3 shadow-2xl backdrop-blur thin-scrollbar"
            data-connection-create-menu
            style={{ left: pending.position.x, top: pending.position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {t("canvas.createMenu.fromNode")}
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={onClose} aria-label={t("canvas.createMenu.close")}>
                    ×
                </button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title={t("canvas.createMenu.text")} description={t("canvas.createMenu.textDescription")} onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title={t("canvas.createMenu.image")} onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title={t("canvas.createMenu.video")} onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-5" />} title={t("canvas.createMenu.audio")} onClick={() => onCreate(CanvasNodeType.Audio)} />
                <ConnectionCreateOption theme={theme} icon={<Settings2 className="size-5" />} title={t("canvas.createMenu.config")} description={t("canvas.createMenu.configDescription")} onClick={() => onCreate(CanvasNodeType.Config)} />
            </div>

            {/* 没装插件时整段不渲染，免得留一条空标题 */}
            {pluginDefs.length ? (
                <>
                    <div className="my-2 h-px" style={{ background: theme.node.stroke }} />
                    <PluginSubmenu theme={theme} definitions={pluginDefs} onCreate={onCreate} />
                </>
            ) : null}
        </div>
    );
}

/** 悬停后弹出的二级菜单展开延迟，避免鼠标扫过就弹。 */
const SUBMENU_OPEN_DELAY = 120;
/** 收起延迟：鼠标要斜着穿过触发项和二级菜单之间的空隙，不给缓冲会半路闪退。 */
const SUBMENU_CLOSE_DELAY = 220;
const SUBMENU_WIDTH = 300;
const SUBMENU_GAP = 8;
/** 单项高度 h-16 + gap-1，容器上下 p-3；用来预估内容高度好把菜单摆正 */
const SUBMENU_ITEM_HEIGHT = 64;
const SUBMENU_ITEM_GAP = 4;
const SUBMENU_PADDING = 24;
/** 距离屏幕边缘的最小留白 */
const SUBMENU_MARGIN = 8;

function PluginSubmenu({ theme, definitions, onCreate }: { theme: CanvasTheme; definitions: ReturnType<typeof listNodeDefinitions>; onCreate: (type: CanvasNodeTypeId) => void }) {
    const { t } = useTranslation();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [box, setBox] = useState<{ left: number; top: number; maxHeight: number; scale: number } | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimer = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
    };

    const open = () => {
        clearTimer();
        timerRef.current = setTimeout(() => {
            const trigger = triggerRef.current;
            const rect = trigger?.getBoundingClientRect();
            if (!trigger || !rect) return;

            // 主菜单在画布的 transform 层里，跟着 viewport.k 缩放；二级菜单 portal 到 body
            // 之后是屏幕坐标、永远 100%，两者尺寸会对不上。用触发项的实际渲染宽度反推
            // 缩放比例，让二级菜单跟主菜单一样大——比把 viewport.k 一路传进来更稳。
            const scale = trigger.offsetWidth > 0 ? rect.width / trigger.offsetWidth : 1;

            const viewportW = window.innerWidth;
            const viewportH = window.innerHeight;
            const width = SUBMENU_WIDTH * scale;

            // 先估内容高度，再决定摆哪——之前是直接塞进触发项下方的剩余空间，
            // 触发项越靠近底部能显示的条目越少，贴底时几乎弹不出来。
            const contentHeight = (definitions.length * SUBMENU_ITEM_HEIGHT + Math.max(0, definitions.length - 1) * SUBMENU_ITEM_GAP + SUBMENU_PADDING) * scale;
            const height = Math.min(contentHeight, viewportH - SUBMENU_MARGIN * 2);

            // 右边放不下就翻到左边——菜单出现在连线落点，可能贴着屏幕右缘
            const fitsRight = rect.right + SUBMENU_GAP + width <= viewportW - SUBMENU_MARGIN;
            const left = fitsRight ? rect.right + SUBMENU_GAP : Math.max(SUBMENU_MARGIN, rect.left - SUBMENU_GAP - width);
            // 顶端对齐触发项，装不下就整体上移，而不是压缩高度
            const top = Math.min(Math.max(SUBMENU_MARGIN, rect.top - SUBMENU_PADDING / 2), Math.max(SUBMENU_MARGIN, viewportH - SUBMENU_MARGIN - height));

            // maxHeight 作用在缩放前的元素上，所以要除回去
            setBox({ left, top, scale, maxHeight: height / scale });
        }, SUBMENU_OPEN_DELAY);
    };

    const close = () => {
        clearTimer();
        timerRef.current = setTimeout(() => setBox(null), SUBMENU_CLOSE_DELAY);
    };

    useEffect(() => () => clearTimer(), []);

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className="flex h-16 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left transition"
                style={{ color: theme.node.text, background: box ? theme.node.fill : "transparent" }}
                onMouseEnter={open}
                onMouseLeave={close}
                onClick={() => (box ? close() : open())}
            >
                <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: theme.node.fill, color: theme.node.muted }}>
                    <Puzzle className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-base font-semibold leading-5">{t("canvas.createMenu.plugins")}</span>
                    <span className="mt-1 block truncate text-sm" style={{ color: theme.node.muted }}>
                        {t("canvas.createMenu.pluginsDescription", { count: definitions.length })}
                    </span>
                </span>
                <ChevronRight className="size-4 shrink-0 opacity-60" />
            </button>

            {box
                ? createPortal(
                      <div
                          className="fixed z-[130] overflow-y-auto rounded-[18px] border p-3 shadow-2xl backdrop-blur thin-scrollbar"
                          // 这两个属性必须带：画布的 pointerdown 靠 data-connection-create-menu 放行，
                          // portal 到 body 之后不在主菜单的子树里，不标上就会被当成点击空白，菜单直接关掉。
                          data-connection-create-menu
                          data-canvas-no-zoom
                          style={{
                              left: box.left,
                              top: box.top,
                              width: SUBMENU_WIDTH,
                              maxHeight: box.maxHeight,
                              // 和主菜单同比例缩放，两级菜单看起来才是一套
                              transform: `scale(${box.scale})`,
                              transformOrigin: "top left",
                              background: theme.node.panel,
                              borderColor: theme.node.stroke,
                              color: theme.node.text,
                          }}
                          onMouseEnter={clearTimer}
                          onMouseLeave={close}
                          onMouseDown={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                      >
                          <div className="grid gap-1">
                              {definitions.map((def) => (
                                  <ConnectionCreateOption key={def.type} theme={theme} icon={def.icon} title={def.title} description={def.description} onClick={() => onCreate(def.type)} />
                              ))}
                          </div>
                      </div>,
                      document.body,
                  )
                : null}
        </>
    );
}

export function ConnectionCreateOption({ theme, icon, title, description, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; title: string; description?: string; onClick?: () => void }) {
    return (
        <button
            type="button"
            className="flex h-16 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left transition"
            style={{ color: theme.node.text }}
            onClick={onClick}
            onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
        >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: theme.node.fill, color: theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-base font-semibold leading-5">{title}</span>
                {description ? (
                    <span className="mt-1 block truncate text-sm" style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </button>
    );
}

export function NodeCreateMenu({ position, onCreate, onClose }: { position: Position; onCreate: (type: string) => void; onClose: () => void }) {
    const theme = useCanvasTheme();
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const menuRef = useRef<HTMLDivElement>(null);
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false);
    // Close automatically when clicking outside the menu.
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [onClose]);
    return (
        <div
            ref={menuRef}
            className="absolute z-[120] max-h-[70vh] w-[300px] overflow-y-auto rounded-[18px] border p-3 shadow-2xl backdrop-blur thin-scrollbar"
            data-canvas-no-zoom
            style={{ left: position.x, top: position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {t("canvas.createMenu.select")}
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:opacity-100" onClick={onClose} aria-label={t("canvas.createMenu.close")}>
                    <X className="size-4" />
                </button>
            </div>
            <div className="grid gap-1">
                {definitions.map((def) => (
                    <ConnectionCreateOption key={def.type} theme={theme} icon={def.icon} title={def.title} description={def.description} onClick={() => onCreate(def.type)} />
                ))}
            </div>
        </div>
    );
}
