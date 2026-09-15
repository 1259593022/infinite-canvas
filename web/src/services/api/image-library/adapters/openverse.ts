import type { ImageSourceAdapter, LibraryImage, SearchResult } from "../types";

/**
 * Openverse（WordPress 基金会）—— 聚合 60+ 站点的 CC 图片。
 *
 * 匿名额度实测 20 次/分钟 + 200 次/天，且是**按 IP** 算的。因为是浏览器直连，
 * 每个客户各用自己的额度；一旦改成走服务器代理，所有客户就会共享这 200 次，
 * 那才是真的不够用。所以这个源必须保持前端直连。
 */

const ENDPOINT = "https://api.openverse.org/v1/images/";

type OpenverseItem = {
    id?: string;
    title?: string;
    url?: string;
    thumbnail?: string;
    tags?: Array<{ name?: string }>;
    creator?: string;
    license?: string;
    foreign_landing_url?: string;
    width?: number;
    height?: number;
};

export const openverseAdapter: ImageSourceAdapter = {
    id: "openverse",
    name: "Openverse",
    homepage: "https://openverse.org",

    async search({ keyword, page, pageSize, signal }): Promise<SearchResult> {
        const query = new URLSearchParams({
            q: keyword,
            // 固定只要 CC0：署名类许可不碰
            license: "cc0",
            // 这个源聚合的是 UGC 站点，必须显式排除成人内容
            mature: "false",
            page: String(page),
            page_size: String(pageSize),
        });

        const response = await fetch(`${ENDPOINT}?${query}`, { signal });
        if (!response.ok) throw new Error(`Openverse ${response.status}`);
        const payload = (await response.json()) as { result_count?: number; results?: OpenverseItem[] };

        const items = (payload.results || [])
            .filter((item): item is OpenverseItem & { id: string; url: string } => Boolean(item.id && item.url))
            .map(
                (item): LibraryImage => ({
                    id: `openverse:${item.id}`,
                    sourceId: "openverse",
                    title: item.title?.trim() || item.id,
                    // thumbnail 是 Openverse 自己的缩图服务，原图可能在 wikimedia 等站
                    thumbUrl: item.thumbnail || item.url,
                    fullUrl: item.url,
                    tags: (item.tags || []).map((tag) => tag.name || "").filter(Boolean).slice(0, 8),
                    author: item.creator || undefined,
                    license: (item.license || "cc0").toUpperCase(),
                    sourceUrl: item.foreign_landing_url,
                    width: item.width,
                    height: item.height,
                }),
            );

        return { items, total: payload.result_count || 0 };
    },
};
