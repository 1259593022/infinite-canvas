import { isPricingChannel } from "./pricing";

/**
 * 账户余额与用量，来自 llmway 的 OpenAI 兼容计费接口。
 *
 * 和 pricing 一样走部署侧同源反代，但这两个接口是用户维度的，必须带上渠道的 API Key，
 * 所以代理那边会转发 Authorization（pricing 那条是显式清空的）。
 */

const SUBSCRIPTION_ENDPOINT = "/llmway/billing/subscription";
const USAGE_ENDPOINT = "/llmway/billing/usage";

/**
 * new-api 对「无限额度」令牌不返回真实余额，而是回一个占位的 1 亿。
 * 上游 143 个令牌里 137 个是这种，所以这个分支才是常态，不是边角情况。
 */
const UNLIMITED_SENTINEL = 100_000_000;

export type BillingSummary = {
    /**
     * 令牌不设上限时为 true。此时额度挂在上游账户身上，接口给不出这个令牌的剩余量，
     * 只能显示「已用」——显示 1 亿或者拿它减出来的「剩余」都是假数字。
     */
    unlimited: boolean;
    /** 账户总额度，美元。unlimited 时无意义，不返回 */
    totalUsd?: number;
    /** 已使用，美元。这个值在两种情况下都是真实的 */
    usedUsd: number;
    /** 剩余，美元。unlimited 时无意义，不返回 */
    remainingUsd?: number;
};

async function getJson<T>(url: string, apiKey: string): Promise<T | null> {
    try {
        const response = await fetch(url, {
            cache: "no-store",
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!response.ok) return null;
        return (await response.json()) as T;
    } catch {
        return null;
    }
}

/**
 * 查询余额。渠道不是 llmway、没填 Key、或接口不可达时返回 null —— 调用方据此隐藏这块 UI，
 * 不要显示 0 或报错，那会让人误以为余额真的是 0。
 */
export async function fetchBillingSummary(baseUrl: string, apiKey: string): Promise<BillingSummary | null> {
    if (!isPricingChannel(baseUrl) || !apiKey.trim()) return null;

    const [subscription, usage] = await Promise.all([
        getJson<{ hard_limit_usd?: number }>(SUBSCRIPTION_ENDPOINT, apiKey),
        getJson<{ total_usage?: number }>(USAGE_ENDPOINT, apiKey),
    ]);
    if (!subscription || typeof subscription.hard_limit_usd !== "number") return null;

    // OpenAI 的计费接口里 total_usage 的单位是美分，new-api 沿用了这个约定。
    // 实测过：令牌 used_quota=1278083（$2.5562）时接口返回 255.6166，除以 100 正确。
    const usedUsd = (Number(usage?.total_usage) || 0) / 100;

    const totalUsd = subscription.hard_limit_usd;
    if (totalUsd >= UNLIMITED_SENTINEL) return { unlimited: true, usedUsd };

    return { unlimited: false, totalUsd, usedUsd, remainingUsd: Math.max(0, totalUsd - usedUsd) };
}

export function formatUsd(value: number): string {
    return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}
