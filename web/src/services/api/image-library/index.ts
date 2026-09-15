import { articAdapter } from "./adapters/artic";
import { metAdapter } from "./adapters/met";
import { nasaAdapter } from "./adapters/nasa";
import { openverseAdapter } from "./adapters/openverse";
import { polyhavenAdapter } from "./adapters/polyhaven";
import type { ImageSourceAdapter, LibraryImage } from "./types";

export type { ImageSourceAdapter, LibraryImage } from "./types";

/**
 * 顺序就是界面上的展示顺序，按对「AI 生图参考」的实用度排：
 * 材质纹理最常拿来垫图，其次是题材最广的聚合源，再是艺术风格参考，最后是题材较窄的天文。
 */
export const IMAGE_SOURCES: ImageSourceAdapter[] = [polyhavenAdapter, openverseAdapter, articAdapter, metAdapter, nasaAdapter];

export const IMAGE_LIBRARY_PAGE_SIZE = 24;

export type LibrarySearchResult = {
    items: LibraryImage[];
    /** 各源是否还有下一页，只要有一个有就继续滚 */
    hasMore: boolean;
    /** 本次失败的源，界面上提示一下，但不阻塞其余结果 */
    failed: string[];
};

export function findSource(sourceId: string) {
    return IMAGE_SOURCES.find((source) => source.id === sourceId);
}

/**
 * 跨源搜索。
 *
 * 某个源挂掉（限流、对方故障、网络不通）只会让它自己缺席，其余照常出结果 ——
 * 五个源里任何一个不可用就整页空白，是不能接受的。
 */
export async function searchImages({
    keyword,
    sourceIds,
    page,
    pageSize = IMAGE_LIBRARY_PAGE_SIZE,
    signal,
}: {
    keyword: string;
    sourceIds: string[];
    page: number;
    pageSize?: number;
    signal?: AbortSignal;
}): Promise<LibrarySearchResult> {
    const sources = IMAGE_SOURCES.filter((source) => sourceIds.includes(source.id));
    if (!sources.length) return { items: [], hasMore: false, failed: [] };

    // 多源并排时每源少取一些，避免一页里某一个源刷屏
    const perSource = Math.max(4, Math.ceil(pageSize / sources.length));

    const settled = await Promise.all(
        sources.map(async (source) => {
            try {
                const result = await source.search({ keyword, page, pageSize: perSource, signal });
                return { source, result, ok: true as const };
            } catch (error) {
                if (signal?.aborted) throw error;
                return { source, error, ok: false as const };
            }
        }),
    );

    const items: LibraryImage[] = [];
    const failed: string[] = [];
    let hasMore = false;

    // 交错排列：各源轮流出一张，而不是第一个源的全部排在最前面
    const buckets: LibraryImage[][] = [];
    for (const entry of settled) {
        if (!entry.ok) {
            failed.push(entry.source.id);
            continue;
        }
        buckets.push(entry.result.items);
        if (page * perSource < entry.result.total) hasMore = true;
    }
    for (let index = 0; index < Math.max(0, ...buckets.map((bucket) => bucket.length)); index += 1) {
        for (const bucket of buckets) {
            if (bucket[index]) items.push(bucket[index]);
        }
    }

    return { items, hasMore, failed };
}
