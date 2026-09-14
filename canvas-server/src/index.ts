import { randomBytes } from "node:crypto";
import { Hono } from "hono";

import { clientIp, hashPassword, issueSession, passwordProblem, rateLimited, requireAdmin, requireAuth, revokeSession, usernameProblem, verifyPassword, type AuthVars } from "./auth";
import { config } from "./config";
import { bindChannel, createUser, db, findUserById, findUserByUsername, getChannel, getQuota, getSyncObject, listUsers, purgeExpiredSessions, recordSyncObject, unbindChannel } from "./db";
import { measureUserUsage, readUserFile, resolveUserPath, writeUserFile } from "./storage";

const app = new Hono<{ Variables: AuthVars }>();

// 登录失败时也要跑一次口令校验，让「账号不存在」和「密码错误」的耗时接近，
// 否则响应时间本身就能被用来枚举账号。
const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));

/* ============ 健康检查 ============ */

app.get("/api/health", (c) => c.json({ ok: true }));

/* ============ 账号 ============ */

app.post("/api/auth/register", async (c) => {
    if (rateLimited(`register:${clientIp(c)}`, config.registerWindowMs, config.registerMaxPerWindow)) {
        return c.json({ error: "注册过于频繁，请稍后再试" }, 429);
    }

    const body = await c.req.json<{ username?: string; password?: string; email?: string }>().catch(() => null);
    if (!body) return c.json({ error: "请求格式错误" }, 400);

    const username = (body.username || "").trim();
    const nameProblem = usernameProblem(username);
    if (nameProblem) return c.json({ error: nameProblem }, 400);
    const pwdProblem = passwordProblem(body.password || "");
    if (pwdProblem) return c.json({ error: pwdProblem }, 400);

    if (findUserByUsername(username)) return c.json({ error: "用户名已被占用" }, 409);

    const id = randomBytes(16).toString("hex");
    createUser(id, username, (body.email || "").trim() || null, await hashPassword(body.password || ""));
    issueSession(c, id);

    // 新账号没有绑定令牌，前端据此提示「尚未开通」
    return c.json({ user: publicUser(id, username), channel: null, quota: quotaView(id) }, 201);
});

app.post("/api/auth/login", async (c) => {
    if (rateLimited(`login:${clientIp(c)}`, config.loginWindowMs, config.loginMaxPerWindow)) {
        return c.json({ error: "尝试过于频繁，请稍后再试" }, 429);
    }

    const body = await c.req.json<{ username?: string; password?: string }>().catch(() => null);
    if (!body) return c.json({ error: "请求格式错误" }, 400);

    const user = findUserByUsername((body.username || "").trim());
    // 用户不存在时也走一次校验，避免用响应时间区分「账号不存在」和「密码错误」
    const ok = user ? await verifyPassword(body.password || "", user.password_hash) : await verifyPassword(body.password || "", DUMMY_HASH);
    if (!user || !ok) return c.json({ error: "用户名或密码错误" }, 401);
    if (user.status !== "active") return c.json({ error: "账号已被停用" }, 403);

    issueSession(c, user.id);
    return c.json(sessionView(user.id, user.username));
});

app.post("/api/auth/logout", (c) => {
    revokeSession(c);
    return c.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (c) => {
    const user = c.get("user");
    return c.json(sessionView(user.id, user.username));
});

/* ============ 同步 ============ */

app.get("/api/sync/file", requireAuth, async (c) => {
    const user = c.get("user");
    const resolved = resolveUserPath(user.id, c.req.query("path") || "");
    if ("error" in resolved) return c.json({ error: "路径非法" }, 400);

    const file = await readUserFile(resolved.path);
    // 404 是正常分支：前端据此判断「远端还没有这个域的数据」，走首次上传
    if (!file) return c.json({ error: "不存在" }, 404);

    const record = getSyncObject(user.id, normalizedPath(c.req.query("path") || ""));
    return new Response(file, {
        headers: {
            "Content-Type": record?.mime || file.type || "application/octet-stream",
            "Cache-Control": "no-store",
        },
    });
});

app.put("/api/sync/file", requireAuth, async (c) => {
    const user = c.get("user");
    const rawPath = c.req.query("path") || "";
    const resolved = resolveUserPath(user.id, rawPath);
    if ("error" in resolved) return c.json({ error: "路径非法" }, 400);

    const body = await c.req.arrayBuffer();
    if (body.byteLength > config.maxFileBytes) return c.json({ error: "单个文件过大" }, 413);

    const path = normalizedPath(rawPath);
    const quota = getQuota(user.id);
    const previous = getSyncObject(user.id, path)?.bytes || 0;
    // 覆盖写只算增量，否则反复同步同一份数据会把配额虚耗光
    if (quota.used_bytes - previous + body.byteLength > quota.limit_bytes) {
        return c.json({ error: getChannel(user.id) ? "云端空间已满" : "账号尚未开通，云端空间有限", quota: quotaView(user.id) }, 413);
    }

    await writeUserFile(resolved.path, new Uint8Array(body));
    recordSyncObject(user.id, path, c.req.header("Content-Type") || "application/octet-stream", body.byteLength);

    return c.json({ ok: true, quota: quotaView(user.id) });
});

/* ============ 运营后台 ============ */

app.get("/api/admin/users", requireAdmin, (c) => c.json({ users: listUsers().map(({ password_hash: _ignored, ...rest }) => rest) }));

app.post("/api/admin/users/:id/channel", requireAdmin, async (c) => {
    const id = c.req.param("id");
    if (!findUserById(id)) return c.json({ error: "账号不存在" }, 404);

    const body = await c.req.json<{ baseUrl?: string; apiKey?: string; limitBytes?: number }>().catch(() => null);
    const baseUrl = (body?.baseUrl || "").trim();
    const apiKey = (body?.apiKey || "").trim();
    if (!baseUrl || !apiKey) return c.json({ error: "baseUrl 和 apiKey 都不能为空" }, 400);

    bindChannel(id, baseUrl, apiKey, body?.limitBytes && body.limitBytes > 0 ? body.limitBytes : config.quotaBytes);
    return c.json({ ok: true, quota: quotaView(id) });
});

app.delete("/api/admin/users/:id/channel", requireAdmin, (c) => {
    unbindChannel(c.req.param("id"));
    return c.json({ ok: true });
});

/** 手工删过文件之后用它把已用容量拉回真实值。 */
app.post("/api/admin/users/:id/recount", requireAdmin, async (c) => {
    const id = c.req.param("id");
    if (!findUserById(id)) return c.json({ error: "账号不存在" }, 404);
    const used = await measureUserUsage(id);
    db.query("UPDATE storage_quota SET used_bytes = ? WHERE user_id = ?").run(used, id);
    return c.json({ ok: true, usedBytes: used });
});

/* ============ 辅助 ============ */

function normalizedPath(rawPath: string) {
    return rawPath.trim().replace(/\\/g, "/");
}

function publicUser(id: string, username: string) {
    return { id, username, displayName: username, avatarUrl: "" };
}

function quotaView(userId: string) {
    const quota = getQuota(userId);
    return { usedBytes: quota.used_bytes, limitBytes: quota.limit_bytes };
}

function sessionView(userId: string, username: string) {
    const channel = getChannel(userId);
    return {
        user: publicUser(userId, username),
        // 未绑定令牌 = 尚未开通，前端据此提示联系管理员，而不是显示一个空渠道
        channel: channel ? { baseUrl: channel.base_url, apiKey: channel.api_key } : null,
        quota: quotaView(userId),
    };
}

/* ============ 启动 ============ */

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 6 * 60 * 60 * 1000).unref?.();

if (!config.cookieSecure) {
    console.warn("[canvas-server] COOKIE_SECURE=false —— 会话 cookie 不带 Secure，仅限本地联调，切勿用于生产");
}
if (!config.adminToken) {
    console.warn("[canvas-server] 未设置 ADMIN_TOKEN，运营后台接口已关闭（无法绑定令牌）");
}

console.log(`[canvas-server] listening on :${config.port}, data dir ${config.dataDir}`);

export default { port: config.port, fetch: app.fetch, maxRequestBodySize: config.maxFileBytes + 1024 * 1024 };
