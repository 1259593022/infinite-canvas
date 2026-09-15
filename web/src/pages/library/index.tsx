import { type UIEvent, useState } from "react";
import { Alert, Button, Empty, Input, Spin, Tag } from "antd";
import { FolderPlus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { LibraryCard } from "@/components/library/library-card";
import { useLibraryActions } from "@/components/library/use-library-actions";
import { useLibraryList } from "@/components/library/use-library-list";
import { IMAGE_SOURCES } from "@/services/api/image-library";
import { cn } from "@/lib/utils";

const ALL_SOURCE_IDS = IMAGE_SOURCES.map((source) => source.id);

export default function LibraryPage() {
    const { t } = useTranslation();
    const [keyword, setKeyword] = useState("");
    const [sourceIds, setSourceIds] = useState<string[]>(ALL_SOURCE_IDS);
    const { query, items, failedSources } = useLibraryList({ keyword, sourceIds });
    const { busyId, saveToAssets } = useLibraryActions();

    const toggleSource = (id: string) => {
        // 不允许全部取消——空选等于空列表，用户多半是想「只看这一个」，
        // 所以取消到最后一个时改为反选成只保留它
        setSourceIds((current) => {
            if (!current.includes(id)) return [...current, id];
            const next = current.filter((item) => item !== id);
            return next.length ? next : ALL_SOURCE_IDS.filter((item) => item !== id);
        });
    };

    const handleScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 200) void query.fetchNextPage();
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:py-8" onScroll={handleScroll}>
                <div className="mx-auto max-w-7xl">
                    <div className="text-center">
                        <h1 className="text-2xl font-semibold tracking-tight">{t("library.title")}</h1>
                        <p className="mt-1.5 text-sm text-stone-500 dark:text-stone-400">{t("library.subtitle")}</p>
                    </div>

                    <div className="mx-auto mt-6 max-w-2xl">
                        <Input size="large" allowClear prefix={<Search className="size-4 text-stone-400" />} placeholder={t("library.searchPlaceholder")} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
                        {IMAGE_SOURCES.map((source) => (
                            <Tag.CheckableTag key={source.id} checked={sourceIds.includes(source.id)} className={cn("prompt-filter-tag", sourceIds.includes(source.id) && "is-active")} onChange={() => toggleSource(source.id)}>
                                {source.name}
                            </Tag.CheckableTag>
                        ))}
                    </div>

                    {/* 某个源挂了只提示，不挡住其余结果 */}
                    {failedSources.length ? <Alert className="mx-auto mt-4 max-w-2xl" type="warning" showIcon message={t("library.sourceFailed", { names: failedSources.join("、") })} /> : null}

                    {query.isLoading ? (
                        <div className="mt-16 text-center">
                            <Spin />
                        </div>
                    ) : items.length ? (
                        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                            {items.map((image) => (
                                <LibraryCard
                                    key={image.id}
                                    image={image}
                                    actions={
                                        <Button size="small" type="text" loading={busyId === image.id} icon={<FolderPlus className="size-3.5" />} className="!text-white hover:!bg-white/20" onClick={() => void saveToAssets(image)}>
                                            {t("common.addToAssets")}
                                        </Button>
                                    }
                                />
                            ))}
                        </div>
                    ) : (
                        <Empty className="mt-16" description={t("library.empty")} />
                    )}

                    <div className="mt-6 text-center text-xs text-stone-500 dark:text-stone-400">
                        {query.isFetchingNextPage ? t("library.loading") : query.hasNextPage ? t("library.loadMore") : items.length ? t("library.end") : null}
                    </div>
                </div>
            </main>
        </div>
    );
}
