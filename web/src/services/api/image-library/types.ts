/**
 * 在线图片资源库的统一模型。
 *
 * 各家开放接口的返回结构差异很大（有的是搜索型、有的是全量清单，字段名也各不相同），
 * adapter 负责把它们归一化成下面这一种形状，上层的页面和画布侧栏只认这个。
 *
 * 只接 CC0 / 公有领域的源。CC-BY 之类需要署名的许可不碰——这些图会被客户用在
 * 商业创作里，署名义务会变成长期负担。
 */

export type LibraryImage = {
    /** 全局唯一，格式 `<sourceId>:<原始 id>`，避免跨源撞 id */
    id: string;
    sourceId: string;
    title: string;
    /** 列表用小图 */
    thumbUrl: string;
    /** 插入画布用的大图 */
    fullUrl: string;
    tags: string[];
    author?: string;
    /** 展示用的许可证名，如 "CC0" */
    license: string;
    /** 原始页面，客户可点回去看出处 */
    sourceUrl?: string;
    width?: number;
    height?: number;
};

export type SearchParams = {
    keyword: string;
    page: number;
    pageSize: number;
    signal?: AbortSignal;
};

export type SearchResult = {
    items: LibraryImage[];
    /** 该源的结果总数，用于判断还有没有下一页 */
    total: number;
};

export type ImageSourceAdapter = {
    id: string;
    /** i18n key 后缀，实际显示名走 t(`library.sources.${id}`) */
    name: string;
    /** 该源主要提供什么，用于让用户快速理解，同样走 i18n */
    homepage: string;
    search(params: SearchParams): Promise<SearchResult>;
};

/** 空关键词时各源的默认词，避免一进页面就是空列表。 */
export const DEFAULT_KEYWORD = "texture";
