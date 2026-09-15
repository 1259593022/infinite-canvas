import type { ImageSourceAdapter, LibraryImage, SearchResult } from "../types";

/**
 * 芝加哥艺术博物馆 —— 13 万余件藏品，公有领域部分以 CC0 开放。
 *
 * 图片走 IIIF。基址由接口自己在 config.iiif_url 给出（实测是 www.artic.edu/iiif/2，
 * 不是想当然的 iiif.artic.edu），所以直接用返回值而不是写死，免得对方调整时全站失效。
 */

const ENDPOINT = "https://api.artic.edu/api/v1/artworks/search";
const FALLBACK_IIIF = "https://www.artic.edu/iiif/2";
const FIELDS = "id,title,image_id,artist_title,term_titles,is_public_domain";

type ArticItem = {
    id?: number;
    title?: string;
    image_id?: string;
    artist_title?: string;
    term_titles?: string[];
    is_public_domain?: boolean;
};

function iiifUrl(base: string, imageId: string, width: number) {
    return `${base}/${imageId}/full/${width},/0/default.jpg`;
}

export const articAdapter: ImageSourceAdapter = {
    id: "artic",
    name: "Art Institute of Chicago",
    homepage: "https://www.artic.edu/open-access",

    async search({ keyword, page, pageSize, signal }): Promise<SearchResult> {
        const query = new URLSearchParams({ q: keyword, limit: String(pageSize), page: String(page), fields: FIELDS });
        const response = await fetch(`${ENDPOINT}?${query}`, { signal });
        if (!response.ok) throw new Error(`Art Institute ${response.status}`);

        const payload = (await response.json()) as {
            data?: ArticItem[];
            pagination?: { total?: number };
            config?: { iiif_url?: string };
        };
        const base = payload.config?.iiif_url || FALLBACK_IIIF;

        const items = (payload.data || [])
            // 没有 image_id 的条目拿不到图；非公有领域的一律跳过
            .filter((item): item is ArticItem & { id: number; image_id: string } => Boolean(item.id && item.image_id && item.is_public_domain))
            .map(
                (item): LibraryImage => ({
                    id: `artic:${item.id}`,
                    sourceId: "artic",
                    title: item.title?.trim() || String(item.id),
                    thumbUrl: iiifUrl(base, item.image_id, 400),
                    fullUrl: iiifUrl(base, item.image_id, 1686),
                    tags: (item.term_titles || []).slice(0, 8),
                    author: item.artist_title || undefined,
                    license: "CC0",
                    sourceUrl: `https://www.artic.edu/artworks/${item.id}`,
                }),
            );

        return { items, total: payload.pagination?.total || 0 };
    },
};
