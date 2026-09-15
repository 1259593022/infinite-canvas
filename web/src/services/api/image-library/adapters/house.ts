import type { ImageSourceAdapter, LibraryImage, SearchResult } from "../types";

/**
 * 自建图库 —— 运营方自己上传维护的素材，由画布服务器托管。
 *
 * 同源接口，天然没有 CORS 问题，也不用担心哪天对方站点关停或加人机验证
 * （芝加哥艺术就是这么被迫下掉的）。内容完全可控，是这个功能长期该走的方向，
 * 借来的那几个开放源是起步期的填充。
 *
 * 后端没部署时接口会失败，聚合层会把它记进 failed 并照常返回其余源的结果。
 */

const LIST_ENDPOINT = "/api/library/images";

/** 图片按 id 寻址，服务端给了不可变的长缓存。 */
export function houseImageUrl(id: string) {
    return `/api/library/file/${id}`;
}

type HouseItem = {
    id?: string;
    title?: string;
    tags?: string[];
    width?: number | null;
    height?: number | null;
};

export const houseAdapter: ImageSourceAdapter = {
    id: "house",
    name: "素材库",
    homepage: "",

    async search({ keyword, page, pageSize, signal }): Promise<SearchResult> {
        const query = new URLSearchParams({ q: keyword, page: String(page), pageSize: String(pageSize) });
        const response = await fetch(`${LIST_ENDPOINT}?${query}`, { signal });
        // 404 说明这个部署压根没有图库接口（后端没装或版本旧），当成空库而不是报错，
        // 免得每次搜索都给用户弹一条「素材库不可用」
        if (response.status === 404) return { items: [], total: 0 };
        if (!response.ok) throw new Error(`自建图库 ${response.status}`);

        const payload = (await response.json()) as { items?: HouseItem[]; total?: number };
        const items = (payload.items || [])
            .filter((item): item is HouseItem & { id: string } => Boolean(item.id))
            .map(
                (item): LibraryImage => ({
                    id: `house:${item.id}`,
                    sourceId: "house",
                    title: item.title?.trim() || item.id,
                    // 没做缩略图：素材图上传时就限制在 10MB 内，列表直接用原图
                    thumbUrl: houseImageUrl(item.id),
                    fullUrl: houseImageUrl(item.id),
                    tags: item.tags || [],
                    license: "自有",
                    width: item.width || undefined,
                    height: item.height || undefined,
                }),
            );

        return { items, total: payload.total || 0 };
    },
};
