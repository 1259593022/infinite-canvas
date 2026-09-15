import { type UIEvent, useState } from "react";
import { Empty, Input, Spin, Tag } from "antd";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { LibraryCard } from "@/components/library/library-card";
import { useLibraryActions } from "@/components/library/use-library-actions";
import { useLibraryList } from "@/components/library/use-library-list";
import { IMAGE_SOURCES, type LibraryImage } from "@/services/api/image-library";
import { cn } from "@/lib/utils";

const ALL_SOURCE_IDS = IMAGE_SOURCES.map((source) => source.id);

/**
 * 画布侧栏里的图库页签。
 *
 * 和独立的图库页面共用 hook 和卡片，差别只在这里点一下是**直接插进画布**，
 * 而不是存进「我的资产」——在画布里创作时多绕一步资产库很打断节奏。
 */
export function CanvasLibraryTab({ onInsert }: { onInsert: (payload: InsertAssetPayload) => void }) {
    const { t } = useTranslation();
    const [keyword, setKeyword] = useState("");
    const [sourceIds, setSourceIds] = useState<string[]>(ALL_SOURCE_IDS);
    const { query, items } = useLibraryList({ keyword, sourceIds });
    const { busyId, download } = useLibraryActions();

    const toggleSource = (id: string) => {
        setSourceIds((current) => {
            if (!current.includes(id)) return [...current, id];
            const next = current.filter((item) => item !== id);
            return next.length ? next : ALL_SOURCE_IDS.filter((item) => item !== id);
        });
    };

    const insert = async (image: LibraryImage) => {
        const stored = await download(image);
        if (!stored) return;
        onInsert({ kind: "image", dataUrl: stored.url, storageKey: stored.storageKey, title: image.title });
    };

    const handleScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    return (
        <div className="flex h-full flex-col">
            <div className="px-3 pb-2 pt-1">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder={t("library.searchPlaceholder")} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                <div className="mt-2 flex flex-wrap gap-1">
                    {IMAGE_SOURCES.map((source) => (
                        <Tag.CheckableTag key={source.id} checked={sourceIds.includes(source.id)} className={cn("prompt-filter-tag !text-[11px]", sourceIds.includes(source.id) && "is-active")} onChange={() => toggleSource(source.id)}>
                            {source.name}
                        </Tag.CheckableTag>
                    ))}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" onScroll={handleScroll}>
                {query.isLoading ? (
                    <div className="pt-12 text-center">
                        <Spin size="small" />
                    </div>
                ) : items.length ? (
                    <div className="grid grid-cols-2 gap-1.5">
                        {items.map((image) => (
                            <button key={image.id} type="button" className="block text-left disabled:opacity-60" disabled={Boolean(busyId)} onClick={() => void insert(image)} title={t("library.insert")}>
                                <LibraryCard image={image} className={cn(busyId === image.id && "animate-pulse")} />
                            </button>
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("library.empty")} className="pt-12" />
                )}

                {items.length ? <div className="pt-3 text-center text-[11px] text-stone-500">{query.isFetchingNextPage ? t("library.loading") : query.hasNextPage ? t("library.loadMore") : t("library.end")}</div> : null}
            </div>
        </div>
    );
}
