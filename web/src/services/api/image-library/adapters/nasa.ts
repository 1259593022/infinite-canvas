import type { ImageSourceAdapter, LibraryImage, SearchResult } from "../types";

/**
 * NASA 图片库 —— 天文与航天影像，绝大多数是公有领域。
 *
 * 每条的 links 数组里有 ~thumb / ~small / ~medium / ~orig 四档，顺序不保证，
 * 所以按后缀挑而不是按下标取。
 */

const ENDPOINT = "https://images-api.nasa.gov/search";

type NasaItem = {
    href?: string;
    links?: Array<{ href?: string; render?: string }>;
    data?: Array<{
        nasa_id?: string;
        title?: string;
        description?: string;
        keywords?: string[];
        secondary_creator?: string;
        center?: string;
    }>;
};

function pickLink(links: NasaItem["links"], ...suffixes: string[]) {
    for (const suffix of suffixes) {
        const hit = links?.find((link) => link.href?.includes(suffix));
        if (hit?.href) return hit.href;
    }
    return links?.[0]?.href || "";
}

export const nasaAdapter: ImageSourceAdapter = {
    id: "nasa",
    name: "NASA",
    homepage: "https://images.nasa.gov",

    async search({ keyword, page, pageSize, signal }): Promise<SearchResult> {
        // NASA 的分页是固定 100/页的，没有 page_size 参数，所以本地再切一次
        const nasaPage = Math.floor(((page - 1) * pageSize) / 100) + 1;
        const offset = ((page - 1) * pageSize) % 100;

        const query = new URLSearchParams({ q: keyword || "space", media_type: "image", page: String(nasaPage) });
        const response = await fetch(`${ENDPOINT}?${query}`, { signal });
        if (!response.ok) throw new Error(`NASA ${response.status}`);

        const payload = (await response.json()) as { collection?: { items?: NasaItem[]; metadata?: { total_hits?: number } } };
        const all = payload.collection?.items || [];

        const items = all
            .slice(offset, offset + pageSize)
            .map((item): LibraryImage | null => {
                const data = item.data?.[0];
                const thumb = pickLink(item.links, "~thumb", "~small");
                const full = pickLink(item.links, "~medium", "~orig", "~small");
                if (!data?.nasa_id || !thumb || !full) return null;
                return {
                    id: `nasa:${data.nasa_id}`,
                    sourceId: "nasa",
                    title: data.title?.trim() || data.nasa_id,
                    thumbUrl: thumb,
                    fullUrl: full,
                    tags: (data.keywords || []).slice(0, 8),
                    author: data.secondary_creator || data.center || undefined,
                    license: "Public Domain",
                    sourceUrl: `https://images.nasa.gov/details/${data.nasa_id}`,
                };
            })
            .filter((item): item is LibraryImage => item !== null);

        return { items, total: payload.collection?.metadata?.total_hits || 0 };
    },
};
