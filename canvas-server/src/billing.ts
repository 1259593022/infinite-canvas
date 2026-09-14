import { config } from "./config";
import { getChannel } from "./db";

/**
 * 代客户查上游账户余额。
 *
 * 客户手上的 sk- 令牌只能走 /v1/dashboard/billing/*，而那个接口受上游全局开关
 * 「显示令牌额度」控制：开着时报的是令牌维度，且对无限额度令牌直接返回占位的 1 亿
 * （上游 131 个启用中的令牌里有 126 个是这种）。
 *
 * 所以这里改用用户级的访问令牌（PAT）走 /api/user/self，直接拿账户的 quota / used_quota。
 * 这条路不经过那个开关，也就不需要为了画布去改上游的全局设置、影响其他客户。
 */

export type BillingView = {
    totalUsd: number;
    usedUsd: number;
    remainingUsd: number;
};

type SelfResponse = {
    success?: boolean;
    data?: { quota?: number; used_quota?: number };
};

// 每次开画布都问一次上游没必要，也容易被上游的关键接口限流挡住
const cache = new Map<string, { at: number; value: BillingView | null }>();

export async function fetchUpstreamBilling(userId: string): Promise<BillingView | null> {
    const cached = cache.get(userId);
    if (cached && Date.now() - cached.at < config.billingCacheMs) return cached.value;

    const value = await queryUpstream(userId);
    cache.set(userId, { at: Date.now(), value });
    return value;
}

export function invalidateBilling(userId: string) {
    cache.delete(userId);
}

async function queryUpstream(userId: string): Promise<BillingView | null> {
    const channel = getChannel(userId);
    // 没开通、或开通时没留 PAT，都只是查不到余额，不是错误
    if (!channel?.upstream_pat || !channel.base_url) return null;

    try {
        const base = channel.base_url.replace(/\/+$/, "");
        const response = await fetch(`${base}/api/user/self`, {
            headers: { Authorization: channel.upstream_pat },
            signal: AbortSignal.timeout(config.upstreamTimeoutMs),
        });
        if (!response.ok) return null;

        const payload = (await response.json()) as SelfResponse;
        const quota = Number(payload.data?.quota);
        const usedQuota = Number(payload.data?.used_quota);
        if (!Number.isFinite(quota) || !Number.isFinite(usedQuota)) return null;

        // 上游以 QuotaPerUnit 个单位折合 1 美元记账
        const remainingUsd = quota / config.quotaPerUnit;
        const usedUsd = usedQuota / config.quotaPerUnit;
        return { remainingUsd, usedUsd, totalUsd: remainingUsd + usedUsd };
    } catch {
        // 上游不可达时宁可不显示，也不要显示 0 —— 那会被当成余额真的用完了
        return null;
    }
}
