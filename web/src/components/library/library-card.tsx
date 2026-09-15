import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import type { LibraryImage } from "@/services/api/image-library";
import { cn } from "@/lib/utils";

/**
 * 图库卡片。图用原生 <img loading="lazy">，一页 24 张、滚动加载，
 * 交给浏览器按需取比自己写可见性判断更稳。
 */
export function LibraryCard({ image, actions, className }: { image: LibraryImage; actions?: ReactNode; className?: string }) {
    return (
        <div className={cn("group relative overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900", className)}>
            <div className="aspect-square w-full overflow-hidden bg-stone-100 dark:bg-stone-800">
                <img
                    src={image.thumbUrl}
                    alt={image.title}
                    loading="lazy"
                    draggable={false}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    // 单张图挂掉不该在网格里留一个破图图标
                    onError={(event) => {
                        event.currentTarget.style.visibility = "hidden";
                    }}
                />
            </div>

            <div className="p-2">
                <div className="truncate text-xs font-medium" title={image.title}>
                    {image.title}
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] text-stone-500" title={image.author}>
                        {image.author || image.sourceId}
                    </span>
                    <span className="shrink-0 rounded bg-emerald-50 px-1 py-px text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">{image.license}</span>
                </div>
            </div>

            {/* 操作条平时不占位，悬停才浮出来，免得把图盖住 */}
            {actions ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-6 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
                    <div className="flex items-center gap-1">{actions}</div>
                    {image.sourceUrl ? (
                        <a href={image.sourceUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded p-1 text-white/80 transition hover:text-white" title={image.sourceUrl}>
                            <ExternalLink className="size-3.5" />
                        </a>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
