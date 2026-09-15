import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { IMAGE_LIBRARY_PAGE_SIZE, searchImages } from "@/services/api/image-library";

/**
 * 图库列表。形状照搬 use-prompt-list：关键词防抖 + 无限滚动。
 *
 * 和提示词不同的是这里是**实时搜索**——光芝加哥艺术就 13 万件、Met 40 万件，
 * 不可能像提示词那样全量拉下来缓存。react-query 按 queryKey 缓存已翻过的页，
 * 回退关键词时不会重复打上游（Openverse 匿名额度每天只有 200 次，省着点用）。
 */
export function useLibraryList({ keyword, sourceIds, enabled = true }: { keyword: string; sourceIds: string[]; enabled?: boolean }) {
    const [debouncedKeyword, setDebouncedKeyword] = useState(keyword);
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedKeyword(keyword), 400);
        return () => clearTimeout(timer);
    }, [keyword]);

    const query = useInfiniteQuery({
        queryKey: ["image-library", debouncedKeyword, [...sourceIds].sort().join(",")],
        queryFn: ({ pageParam, signal }) => searchImages({ keyword: debouncedKeyword, sourceIds, page: pageParam, pageSize: IMAGE_LIBRARY_PAGE_SIZE, signal }),
        initialPageParam: 1,
        getNextPageParam: (lastPage, pages) => (lastPage.hasMore && lastPage.items.length ? pages.length + 1 : undefined),
        enabled: enabled && sourceIds.length > 0,
        staleTime: 5 * 60 * 1000,
    });

    return {
        query,
        items: useMemo(() => query.data?.pages.flatMap((page) => page.items) || [], [query.data?.pages]),
        // 只看最后一页的失败情况，避免翻了几页之后还在提示很早以前的一次失败
        failedSources: useMemo(() => query.data?.pages.at(-1)?.failed || [], [query.data?.pages]),
    };
}
