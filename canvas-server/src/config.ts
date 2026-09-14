/** 运行期配置。全部走环境变量，容器里改完重启即可。 */

function int(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function bool(name: string, fallback: boolean) {
    const value = process.env[name];
    if (value === undefined || value === "") return fallback;
    return value === "1" || value.toLowerCase() === "true";
}

export const config = {
    port: int("PORT", 8080),
    dataDir: process.env.DATA_DIR || "/data",

    /**
     * session cookie 是否带 Secure。
     *
     * 默认 true——账号密码走明文 HTTP 等于把密码和会话直接交出去。只有本地联调才该关，
     * 关掉时启动日志会持续告警，避免不小心带着这个配置上生产。
     */
    cookieSecure: bool("COOKIE_SECURE", true),
    sessionDays: int("SESSION_DAYS", 30),

    /** 已开通账号的存储配额。整机 86G 可用，1G/人约可支撑 80 个账号。 */
    quotaBytes: int("QUOTA_BYTES", 1024 * 1024 * 1024),
    /**
     * 未开通账号的配额。开放注册 + 全量上云，不给未开通账号设小额度的话，
     * 陌生人注册就能占满磁盘。
     */
    pendingQuotaBytes: int("PENDING_QUOTA_BYTES", 50 * 1024 * 1024),

    /** 单文件上限，挡住明显异常的请求。 */
    maxFileBytes: int("MAX_FILE_BYTES", 100 * 1024 * 1024),

    /** 运营后台接口的口令，用于建号、绑定 llmway 令牌。为空则后台接口整体关闭。 */
    adminToken: process.env.ADMIN_TOKEN || "",

    /** 上游以多少个单位折合 1 美元记账。new-api 的 QuotaPerUnit，默认 500000。 */
    quotaPerUnit: int("QUOTA_PER_UNIT", 500000),
    /** 余额缓存时长。每次开画布都问一次上游没必要，也容易被上游限流挡住。 */
    billingCacheMs: int("BILLING_CACHE_MS", 60 * 1000),
    upstreamTimeoutMs: int("UPSTREAM_TIMEOUT_MS", 8000),

    /** 注册限流：同一 IP 在窗口内最多注册几次。 */
    registerWindowMs: int("REGISTER_WINDOW_MS", 60 * 60 * 1000),
    registerMaxPerWindow: int("REGISTER_MAX_PER_WINDOW", 5),
    /** 登录限流：同一 IP 在窗口内最多尝试几次，挡撞库。 */
    loginWindowMs: int("LOGIN_WINDOW_MS", 15 * 60 * 1000),
    loginMaxPerWindow: int("LOGIN_MAX_PER_WINDOW", 20),
};

export type AppConfig = typeof config;
