import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

import { config } from "./config";
import { createSession, deleteSession, findSession, findUserById, type UserRow } from "./db";

export const SESSION_COOKIE = "canvas_session";

export type AuthVars = { user: UserRow };

/* ---------- 口令 ---------- */

export function hashPassword(password: string) {
    // Bun.password 默认 argon2id，不需要自己选参数
    return Bun.password.hash(password);
}

export function verifyPassword(password: string, hash: string) {
    return Bun.password.verify(password, hash);
}

/** 注册时的口令强度。太短的口令配上开放注册，等于没有门槛。 */
export function passwordProblem(password: string): string | null {
    if (typeof password !== "string" || password.length < 8) return "密码至少 8 位";
    if (password.length > 200) return "密码过长";
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "密码需同时包含字母和数字";
    return null;
}

export function usernameProblem(username: string): string | null {
    if (typeof username !== "string") return "用户名无效";
    const value = username.trim();
    if (value.length < 3 || value.length > 32) return "用户名需 3-32 位";
    if (!/^[a-zA-Z0-9_.-]+$/.test(value)) return "用户名只能包含字母、数字、下划线、点和短横线";
    return null;
}

/* ---------- 会话 ---------- */

export function issueSession(c: Context, userId: string) {
    const id = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000);
    createSession(id, userId, expiresAt);
    setCookie(c, SESSION_COOKIE, id, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: "Lax",
        path: "/",
        expires: expiresAt,
    });
}

export function revokeSession(c: Context) {
    const id = getCookie(c, SESSION_COOKIE);
    if (id) deleteSession(id);
    setCookie(c, SESSION_COOKIE, "", { httpOnly: true, secure: config.cookieSecure, sameSite: "Lax", path: "/", maxAge: 0 });
}

export function currentUser(c: Context): UserRow | null {
    const id = getCookie(c, SESSION_COOKIE);
    if (!id) return null;
    const session = findSession(id);
    if (!session) return null;
    if (Date.parse(session.expires_at) <= Date.now()) {
        deleteSession(id);
        return null;
    }
    const user = findUserById(session.user_id);
    return user && user.status === "active" ? user : null;
}

export const requireAuth: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
    const user = currentUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    c.set("user", user);
    await next();
};

export const requireAdmin: MiddlewareHandler = async (c, next) => {
    if (!config.adminToken) return c.json({ error: "后台接口未启用" }, 404);
    const provided = c.req.header("X-Admin-Token") || "";
    // 定长比较，避免用返回时间试出口令
    const expected = config.adminToken;
    const same = provided.length === expected.length && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!same) return c.json({ error: "口令错误" }, 403);
    await next();
};

/* ---------- 限流 ---------- */

const buckets = new Map<string, number[]>();

/** 朴素的滑动窗口限流。单实例部署，放内存足够；重启即清空是可以接受的。 */
export function rateLimited(key: string, windowMs: number, max: number) {
    const now = Date.now();
    const hits = (buckets.get(key) || []).filter((at) => now - at < windowMs);
    if (hits.length >= max) {
        buckets.set(key, hits);
        return true;
    }
    hits.push(now);
    buckets.set(key, hits);
    return false;
}

export function clientIp(c: Context) {
    // 只信任反代加的这两个头；服务本身只监听回环，不会被外部直连伪造
    const forwarded = c.req.header("X-Forwarded-For") || "";
    return forwarded.split(",")[0]?.trim() || c.req.header("X-Real-IP") || "unknown";
}

// 限流桶会随着 IP 数量增长，定期清掉空桶
setInterval(
    () => {
        const now = Date.now();
        const longest = Math.max(config.registerWindowMs, config.loginWindowMs);
        for (const [key, hits] of buckets) {
            if (hits.every((at) => now - at >= longest)) buckets.delete(key);
        }
    },
    10 * 60 * 1000,
).unref?.();
