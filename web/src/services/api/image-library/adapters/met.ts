import type { ImageSourceAdapter, LibraryImage, SearchResult } from "../types";

/**
 * 大都会艺术博物馆 —— 40 万+ 藏品，公有领域部分开放使用。
 *
 * 这个源是两步的：搜索只返回一个 objectID 数组（一次可能上万个），拿不到标题和图，
 * 必须再逐个请求详情。所以：
 *   1. 按关键词缓存 ID 列表，翻页时不重复搜索
 *   2. 只对当前页那 20 个发详情请求，并发限制在 4
 * 不这么做的话一次搜索会打出上万个请求，直接把对方和浏览器都打爆。
 */

const SEARCH_ENDPOINT = "https://collectionapi.metmuseum.org/public/collection/v1/search";
const OBJECT_ENDPOINT = "https://collectionapi.metmuseum.org/public/collection/v1/objects";
const DETAIL_CONCURRENCY = 4;
const CACHE_TTL_MS = 10 * 60 * 1000;

type MetObject = {
    objectID?: number;
    title?: string;
    primaryImage?: string;
    primaryImageSmall?: string;
    artistDisplayName?: string;
    objectURL?: string;
    isPublicDomain?: boolean;
    tags?: Array<{ term?: string }>;
};

const idCache = new Map<string, { at: number; ids: number[] }>();

async function searchIds(keyword: string, signal?: AbortSignal): Promise<number[]> {
    const cached = idCache.get(keyword);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.ids;

    const query = new URLSearchParams({ q: keyword || "art", isPublicDomain: "true", hasImages: "true" });
    const response = await fetch(`${SEARCH_ENDPOINT}?${query}`, { signal });
    if (!response.ok) throw new Error(`Met ${response.status}`);

    const payload = (await response.json()) as { objectIDs?: number[] | null };
    const ids = payload.objectIDs || [];
    idCache.set(keyword, { at: Date.now(), ids });
    return ids;
}

/** 限并发地取详情。单个失败只丢那一条，不影响整页。 */
async function loadDetails(ids: number[], signal?: AbortSignal): Promise<LibraryImage[]> {
    const results: Array<LibraryImage | null> = new Array(ids.length).fill(null);
    let next = 0;

    await Promise.all(
        Array.from({ length: Math.min(DETAIL_CONCURRENCY, ids.length) }, async () => {
            while (next < ids.length) {
                const index = next++;
                try {
                    const response = await fetch(`${OBJECT_ENDPOINT}/${ids[index]}`, { signal });
                    if (!response.ok) continue;
                    const item = (await response.json()) as MetObject;
                    const full = item.primaryImageSmall || item.primaryImage;
                    if (!item.objectID || !full || !item.isPublicDomain) continue;
                    results[index] = {
                        id: `met:${item.objectID}`,
                        sourceId: "met",
                        title: item.title?.trim() || String(item.objectID),
                        thumbUrl: full,
                        fullUrl: item.primaryImage || full,
                        tags: (item.tags || []).map((tag) => tag.term || "").filter(Boolean).slice(0, 8),
                        author: item.artistDisplayName || undefined,
                        license: "Public Domain",
                        sourceUrl: item.objectURL,
                    };
                } catch (error) {
                    // 中断要往上传，单条失败则跳过
                    if (signal?.aborted) throw error;
                }
            }
        }),
    );

    return results.filter((item): item is LibraryImage => item !== null);
}

export const metAdapter: ImageSourceAdapter = {
    id: "met",
    name: "The Met",
    homepage: "https://www.metmuseum.org/art/collection",

    async search({ keyword, page, pageSize, signal }): Promise<SearchResult> {
        const ids = await searchIds(keyword.trim(), signal);
        const start = (page - 1) * pageSize;
        const pageIds = ids.slice(start, start + pageSize);
        if (!pageIds.length) return { items: [], total: ids.length };
        return { items: await loadDetails(pageIds, signal), total: ids.length };
    },
};
