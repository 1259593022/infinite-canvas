import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { Hono } from "hono";

import { clientIp, hashPassword, issueSession, passwordProblem, rateLimited, requireAdmin, requireAuth, revokeSession, usernameProblem, verifyPassword, type AuthVars } from "./auth";
import { fetchUpstreamBilling, invalidateBilling } from "./billing";
import { config } from "./config";
import {
    bindChannel,
    createUser,
    db,
    deleteLibraryImage,
    findUserById,
    findUserByUsername,
    getChannel,
    getLibraryImage,
    getQuota,
    getSyncObject,
    insertLibraryImage,
    listUsers,
    purgeExpiredSessions,
    recordSyncObject,
    searchLibraryImages,
    unbindChannel,
} from "./db";
import { libraryFilePath, measureUserUsage, readUserFile, resolveUserPath, writeUserFile } from "./storage";

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

/* ============ 余额 ============ */

/**
 * 代查上游账户余额。未开通、没留 PAT、或上游不可达时返回 balance: null，
 * 前端据此隐藏这块 UI —— 显示 0 会被当成余额真的用完了。
 */
app.get("/api/billing", requireAuth, async (c) => {
    return c.json({ balance: await fetchUpstreamBilling(c.get("user").id) });
});

/* ============ 自建图库 ============ */

/** 上传只放行这几种，避免有人把 svg（可内嵌脚本）或任意文件塞进来当图发给所有客户。 */
const LIBRARY_MIME: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
};

/**
 * 图库列表。**故意不要求登录**——画布本身支持未登录使用，
 * 素材库要登录才能看会让这个功能失去大半意义。
 */
app.get("/api/library/images", (c) => {
    const page = Math.max(1, Number(c.req.query("page")) || 1);
    const pageSize = Math.min(60, Math.max(1, Number(c.req.query("pageSize")) || 24));
    const { items, total } = searchLibraryImages(c.req.query("q") || "", pageSize, (page - 1) * pageSize);
    return c.json({
        total,
        items: items.map((item) => ({
            id: item.id,
            title: item.title,
            tags: item.tags ? item.tags.split(",").filter(Boolean) : [],
            width: item.width,
            height: item.height,
            bytes: item.bytes,
        })),
    });
});

app.get("/api/library/file/:id", async (c) => {
    const row = getLibraryImage(c.req.param("id"));
    if (!row) return c.json({ error: "不存在" }, 404);

    const file = await readUserFile(libraryFilePath(row.id, row.ext));
    // 库里有记录但文件没了：手工删过盘上的文件，或上传中途失败
    if (!file) return c.json({ error: "文件缺失" }, 404);

    return new Response(file, {
        headers: {
            "Content-Type": row.mime,
            // 内容按 id 寻址，改了就是新 id，可以放心长缓存
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    });
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

    const body = await c.req.json<{ baseUrl?: string; apiKey?: string; accessToken?: string; limitBytes?: number }>().catch(() => null);
    const baseUrl = (body?.baseUrl || "").trim();
    const apiKey = (body?.apiKey || "").trim();
    if (!baseUrl || !apiKey) return c.json({ error: "baseUrl 和 apiKey 都不能为空" }, 400);

    // accessToken 是上游的用户级访问令牌（PAT），只用来查余额，可以不给
    bindChannel(id, baseUrl, apiKey, (body?.accessToken || "").trim(), body?.limitBytes && body.limitBytes > 0 ? body.limitBytes : config.quotaBytes);
    invalidateBilling(id);
    return c.json({ ok: true, quota: quotaView(id), balance: await fetchUpstreamBilling(id) });
});

app.delete("/api/admin/users/:id/channel", requireAdmin, (c) => {
    unbindChannel(c.req.param("id"));
    invalidateBilling(c.req.param("id"));
    return c.json({ ok: true });
});

app.post("/api/admin/library", requireAdmin, async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "缺少 file 字段" }, 400);

    const ext = LIBRARY_MIME[file.type];
    if (!ext) return c.json({ error: `不支持的格式 ${file.type || "(未知)"}，仅接受 png / jpeg / webp / gif` }, 415);
    if (file.size > config.libraryMaxFileBytes) return c.json({ error: `图片过大，上限 ${Math.round(config.libraryMaxFileBytes / 1024 / 1024)}MB` }, 413);

    const id = randomBytes(12).toString("hex");
    const title = String(body.title || file.name || id).trim().slice(0, 200);
    // 标签统一小写去重，避免「材质」和「材质 」被当成两个
    const tags = Array.from(new Set(String(body.tags || "").split(/[,，\s]+/).map((tag) => tag.trim().toLowerCase()).filter(Boolean))).slice(0, 12);

    // 先落盘再写库：反过来的话进程在两步之间挂掉，库里会留下一条指向不存在文件的记录
    await writeUserFile(libraryFilePath(id, ext), new Uint8Array(await file.arrayBuffer()));
    insertLibraryImage({
        id,
        title,
        tags: tags.join(","),
        ext,
        mime: file.type,
        bytes: file.size,
        width: Number(body.width) || null,
        height: Number(body.height) || null,
    });

    return c.json({ ok: true, id, title, tags }, 201);
});

app.delete("/api/admin/library/:id", requireAdmin, async (c) => {
    const row = getLibraryImage(c.req.param("id"));
    if (!row) return c.json({ error: "不存在" }, 404);
    // 先删记录再删文件：顺序反了的话删文件成功、删记录失败会留下坏链接
    deleteLibraryImage(row.id);
    await unlink(libraryFilePath(row.id, row.ext)).catch(() => undefined);
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
