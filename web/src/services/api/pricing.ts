import type { ModelCapability } from "@/stores/use-config-store";

/**
 * 模型目录与定价，来自 llmway 的 /api/pricing。
 *
 * 该接口是 new-api 的管理路由，不在其 CORS 中间件覆盖范围内（只有 /v1/* 带 CORS 头），
 * 浏览器直连会被拦。所以走部署侧的同源反代 /llmway/pricing —— 同源请求根本不涉及 CORS，
 * 上游也不用改任何配置。
 */

/** 同源反代路径，由画布站点的 nginx 转发到 https://llmway.ai/api/pricing */
const PRICING_ENDPOINT = "/llmway/pricing";

/** 该目录只描述 llmway 的模型。渠道指向别家时必须整体跳过，否则会显示错误的价格。 */
const PRICING_HOSTS = ["llmway.ai", "www.llmway.ai"];

const CACHE_TTL_MS = 5 * 60 * 1000;

export type PricingEntry = {
    modelName: string;
    /** 1 = 按次计费（图片/视频/音频这类），0 = 按 token 计费（文本） */
    quotaType: 0 | 1;
    /** 按次计费时的单价，美元 */
    modelPrice: number;
    modelRatio: number;
    groups: string[];
};

type PricingPayload = {
    data?: Array<{
        model_name?: string;
        quota_type?: number;
        model_price?: number;
        model_ratio?: number;
        enable_groups?: string[];
    }>;
};

let cache: { at: number; entries: Map<string, PricingEntry> } | null = null;
let inflight: Promise<Map<string, PricingEntry>> | null = null;

/**
 * 渠道是否由 llmway 提供。
 *
 * 用户选择了「pricing 只用同源路径」，意味着拿到的永远是 llmway 的目录。
 * 不加这道守卫的话，把渠道指向别家供应商时会套用 llmway 的价格和计费方式——
 * 显示的数字全是错的，比不显示更糟。
 */
export function isPricingChannel(baseUrl: string): boolean {
    const trimmed = (baseUrl || "").trim();
    if (!trimmed) return false;
    try {
        const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
        return PRICING_HOSTS.includes(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

/** 拉取模型目录。失败时返回空表而不是抛错——定价是增强信息，不该阻塞模型列表主流程。 */
export async function fetchPricingCatalog(force = false): Promise<Map<string, PricingEntry>> {
    if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.entries;
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            const response = await fetch(PRICING_ENDPOINT, { cache: "no-store" });
            if (!response.ok) return new Map<string, PricingEntry>();
            const payload = (await response.json()) as PricingPayload;
            const entries = new Map<string, PricingEntry>();
            for (const item of payload.data || []) {
                const modelName = (item.model_name || "").trim();
                if (!modelName) continue;
                entries.set(modelName, {
                    modelName,
                    quotaType: item.quota_type === 1 ? 1 : 0,
                    modelPrice: Number(item.model_price) || 0,
                    modelRatio: Number(item.model_ratio) || 0,
                    groups: Array.isArray(item.enable_groups) ? item.enable_groups : [],
                });
            }
            cache = { at: Date.now(), entries };
            return entries;
        } catch {
            return new Map<string, PricingEntry>();
        } finally {
            inflight = null;
        }
    })();

    return inflight;
}

const VIDEO_HINTS = ["video", "veo", "sora", "seedance", "kling", "runway", "luma", "minimax_h3", "i2v", "t2v"];
const AUDIO_HINTS = ["tts", "audio", "speech", "voice", "suno", "music", "lyrics"];

/**
 * 用定价信息修正模型的能力分类。
 *
 * 注意 /api/pricing 的 supported_endpoint_types 是 API 调用格式（openai / gemini），
 * 不是模态，区分不了图片/视频/音频。真正可用的判据只有 quota_type：
 *   quota_type=0 → 按 token 计费 → 文本
 *   quota_type=1 → 按次计费     → 非文本
 * 所以这里只用它来定「是不是文本」，非文本内部仍靠模型名关键词细分。
 */
export function refineCapability(name: string, entry: PricingEntry | undefined, fallback: ModelCapability): ModelCapability {
    if (!entry) return fallback;
    if (entry.quotaType === 0) return "text";
    // 按次计费一定不是文本；关键词命中不了就归到图片（按次计费里图片占绝大多数）
    if (fallback !== "text") return fallback;
    const value = name.toLowerCase();
    if (VIDEO_HINTS.some((hint) => value.includes(hint))) return "video";
    if (AUDIO_HINTS.some((hint) => value.includes(hint))) return "audio";
    return "image";
}

/** 单次调用的价格展示文本；按 token 计费或无价格时返回空串。 */
export function formatUnitPrice(price?: number, quotaType?: 0 | 1): string {
    if (quotaType !== 1 || !price || price <= 0) return "";
    return `$${price < 0.01 ? price.toFixed(4) : price.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
}
