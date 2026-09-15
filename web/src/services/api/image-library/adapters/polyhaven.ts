import type { ImageSourceAdapter, LibraryImage, SearchResult } from "../types";

/**
 * Poly Haven —— 全站 CC0 的材质、纹理与 HDRI。
 *
 * 和其它几个源不同，它是**清单型**而不是搜索型：一次返回全部 860 个资产（约 800KB），
 * 没有搜索端点。所以拉一次缓存在内存里，关键词在本地过滤、本地分页。
 *
 * 图片用官方缩图服务，实测 width 上限 1024（给 2048 返回的字节数和 1024 完全一样），
 * 对参考图/垫图这个用途足够，也省得为每个资产再发一次 /files 请求去拿原始贴图。
 */

const ASSETS_ENDPOINT = "https://api.polyhaven.com/assets";
const THUMB_BASE = "https://cdn.polyhaven.com/asset_img/thumbs";
const FULL_WIDTH = 1024;
const THUMB_WIDTH = 384;
const CACHE_TTL_MS = 60 * 60 * 1000;

type PolyHavenAsset = {
    name?: string;
    tags?: string[];
    categories?: string[];
    authors?: Record<string, string>;
    max_resolution?: [number, number];
};

let cache: { at: number; items: LibraryImage[] } | null = null;
let inflight: Promise<LibraryImage[]> | null = null;

function imageUrl(slug: string, width: number) {
    return `${THUMB_BASE}/${slug}.png?width=${width}&height=${width}`;
}

async function loadCatalog(signal?: AbortSignal): Promise<LibraryImage[]> {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.items;
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            // 同时要材质和 HDRI：前者做垫图，后者做环境/光照参考
            const response = await fetch(`${ASSETS_ENDPOINT}?t=textures`, { signal });
            if (!response.ok) throw new Error(`Poly Haven ${response.status}`);
            const payload = (await response.json()) as Record<string, PolyHavenAsset>;

            const items = Object.entries(payload).map(([slug, asset]): LibraryImage => {
                const [width, height] = asset.max_resolution || [];
                return {
                    id: `polyhaven:${slug}`,
                    sourceId: "polyhaven",
                    title: asset.name?.trim() || slug,
                    thumbUrl: imageUrl(slug, THUMB_WIDTH),
                    fullUrl: imageUrl(slug, FULL_WIDTH),
                    tags: Array.from(new Set([...(asset.tags || []), ...(asset.categories || [])])).slice(0, 8),
                    author: Object.keys(asset.authors || {})[0],
                    license: "CC0",
                    sourceUrl: `https://polyhaven.com/a/${slug}`,
                    width,
                    height,
                };
            });
            cache = { at: Date.now(), items };
            return items;
        } finally {
            inflight = null;
        }
    })();

    return inflight;
}

export const polyhavenAdapter: ImageSourceAdapter = {
    id: "polyhaven",
    name: "Poly Haven",
    homepage: "https://polyhaven.com",

    async search({ keyword, page, pageSize, signal }): Promise<SearchResult> {
        const all = await loadCatalog(signal);
        const query = keyword.trim().toLowerCase();
        const matched = query ? all.filter((item) => `${item.title} ${item.tags.join(" ")}`.toLowerCase().includes(query)) : all;
        const start = (page - 1) * pageSize;
        return { items: matched.slice(start, start + pageSize), total: matched.length };
    },
};
