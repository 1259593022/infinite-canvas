import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { config } from "./config";

/**
 * SQLite 而不是 Postgres：规模是几十到几百个账号，SQLite（WAL）完全够用，
 * 还省掉一个数据库容器及其备份运维——备份就是打包 DATA_DIR 一个目录。
 */

export type UserRow = {
    id: string;
    username: string;
    email: string | null;
    password_hash: string;
    status: string;
    created_at: string;
};

export type ChannelRow = {
    user_id: string;
    base_url: string;
    api_key: string;
    /**
     * 上游的「访问令牌」（new-api 的 users.access_token，PAT）。
     *
     * 和 api_key 是两套凭据：api_key（sk-）只能调 /v1/* 生成，查余额要走 billing 接口，
     * 而那个接口受上游全局开关「显示令牌额度」控制，对无限额度令牌只会返回占位的 1 亿。
     * PAT 走 /api/user/self，直接拿到账户的 quota / used_quota，绕开该开关。
     *
     * 权限上 PAT 只能读该用户自己的数据，不是管理员凭据。留空表示不查余额。
     */
    upstream_pat: string;
    updated_at: string;
};

export type QuotaRow = {
    user_id: string;
    used_bytes: number;
    limit_bytes: number;
};

export type SyncObjectRow = {
    user_id: string;
    path: string;
    mime: string;
    bytes: number;
    updated_at: string;
};

const dbPath = join(config.dataDir, "canvas-server.db");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath, { create: true });

// WAL 让读写不互相阻塞；busy_timeout 避免并发同步时直接抛 SQLITE_BUSY。
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT,
    password_hash TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_channels (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    base_url   TEXT NOT NULL,
    api_key    TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS storage_quota (
    user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    used_bytes  INTEGER NOT NULL DEFAULT 0,
    limit_bytes INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_objects (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path       TEXT NOT NULL,
    mime       TEXT NOT NULL,
    bytes      INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, path)
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS library_images (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    tags       TEXT NOT NULL DEFAULT '',
    ext        TEXT NOT NULL,
    mime       TEXT NOT NULL,
    bytes      INTEGER NOT NULL,
    width      INTEGER,
    height     INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_library_created ON library_images(created_at DESC);
`);

// SQLite 没有 ADD COLUMN IF NOT EXISTS，先查表结构再决定加不加，让重复启动是安全的。
function addColumnIfMissing(table: string, column: string, definition: string) {
    const columns = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
    if (columns.some((item) => item.name === column)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing("user_channels", "upstream_pat", "TEXT NOT NULL DEFAULT ''");

export const nowIso = () => new Date().toISOString();

/* ---------- users ---------- */

const insertUserStmt = db.query<never, [string, string, string | null, string, string]>(
    "INSERT INTO users (id, username, email, password_hash, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)",
);
const findUserByNameStmt = db.query<UserRow, [string]>("SELECT * FROM users WHERE username = ?");
const findUserByIdStmt = db.query<UserRow, [string]>("SELECT * FROM users WHERE id = ?");
const listUsersStmt = db.query<UserRow & { base_url: string | null; used_bytes: number | null; limit_bytes: number | null }, []>(`
    SELECT u.*, c.base_url, q.used_bytes, q.limit_bytes
    FROM users u
    LEFT JOIN user_channels c ON c.user_id = u.id
    LEFT JOIN storage_quota q ON q.user_id = u.id
    ORDER BY u.created_at DESC
`);

export function createUser(id: string, username: string, email: string | null, passwordHash: string) {
    // 建号和配额必须一起成功，否则会出现没有配额记录的账号，写文件时全部报错。
    db.transaction(() => {
        insertUserStmt.run(id, username, email, passwordHash, nowIso());
        setQuotaLimitStmt.run(config.pendingQuotaBytes, id);
    })();
}

export function findUserByUsername(username: string) {
    return findUserByNameStmt.get(username);
}

export function findUserById(id: string) {
    return findUserByIdStmt.get(id);
}

export function listUsers() {
    return listUsersStmt.all();
}

/* ---------- channels ---------- */

const getChannelStmt = db.query<ChannelRow, [string]>("SELECT * FROM user_channels WHERE user_id = ?");
const upsertChannelStmt = db.query<never, [string, string, string, string, string]>(`
    INSERT INTO user_channels (user_id, base_url, api_key, upstream_pat, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET base_url = excluded.base_url, api_key = excluded.api_key,
        upstream_pat = excluded.upstream_pat, updated_at = excluded.updated_at
`);
const deleteChannelStmt = db.query<never, [string]>("DELETE FROM user_channels WHERE user_id = ?");

export function getChannel(userId: string) {
    return getChannelStmt.get(userId);
}

/** 绑定令牌即「开通」，同时把配额从未开通额度提到正式额度。upstreamPat 可留空，只是查不了余额。 */
export function bindChannel(userId: string, baseUrl: string, apiKey: string, upstreamPat = "", limitBytes = config.quotaBytes) {
    db.transaction(() => {
        upsertChannelStmt.run(userId, baseUrl, apiKey, upstreamPat, nowIso());
        setQuotaLimitStmt.run(limitBytes, userId);
    })();
}

export function unbindChannel(userId: string) {
    db.transaction(() => {
        deleteChannelStmt.run(userId);
        setQuotaLimitStmt.run(config.pendingQuotaBytes, userId);
    })();
}

/* ---------- sessions ---------- */

const insertSessionStmt = db.query<never, [string, string, string, string]>("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)");
const findSessionStmt = db.query<{ id: string; user_id: string; expires_at: string }, [string]>("SELECT id, user_id, expires_at FROM sessions WHERE id = ?");
const deleteSessionStmt = db.query<never, [string]>("DELETE FROM sessions WHERE id = ?");
const deleteExpiredSessionsStmt = db.query<never, [string]>("DELETE FROM sessions WHERE expires_at < ?");

export function createSession(id: string, userId: string, expiresAt: Date) {
    insertSessionStmt.run(id, userId, expiresAt.toISOString(), nowIso());
}

export function findSession(id: string) {
    return findSessionStmt.get(id);
}

export function deleteSession(id: string) {
    deleteSessionStmt.run(id);
}

export function purgeExpiredSessions() {
    deleteExpiredSessionsStmt.run(nowIso());
}

/* ---------- quota ---------- */

const getQuotaStmt = db.query<QuotaRow, [string]>("SELECT * FROM storage_quota WHERE user_id = ?");
const setQuotaLimitStmt = db.query<never, [number, string]>(`
    INSERT INTO storage_quota (user_id, used_bytes, limit_bytes) VALUES (?2, 0, ?1)
    ON CONFLICT(user_id) DO UPDATE SET limit_bytes = ?1
`);

export function getQuota(userId: string): QuotaRow {
    return getQuotaStmt.get(userId) || { user_id: userId, used_bytes: 0, limit_bytes: config.pendingQuotaBytes };
}

/* ---------- sync objects ---------- */

const getObjectStmt = db.query<SyncObjectRow, [string, string]>("SELECT * FROM sync_objects WHERE user_id = ? AND path = ?");
const upsertObjectStmt = db.query<never, [string, string, string, number, string]>(`
    INSERT INTO sync_objects (user_id, path, mime, bytes, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, path) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes, updated_at = excluded.updated_at
`);
const addUsedBytesStmt = db.query<never, [number, string]>("UPDATE storage_quota SET used_bytes = MAX(0, used_bytes + ?1) WHERE user_id = ?2");

export function getSyncObject(userId: string, path: string) {
    return getObjectStmt.get(userId, path);
}

/**
 * 记录对象并按差量更新已用容量。
 *
 * 覆盖写时只计增量，否则反复同步同一份数据会把配额虚耗光。
 */
export function recordSyncObject(userId: string, path: string, mime: string, bytes: number) {
    db.transaction(() => {
        const previous = getObjectStmt.get(userId, path);
        upsertObjectStmt.run(userId, path, mime, bytes, nowIso());
        addUsedBytesStmt.run(bytes - (previous?.bytes || 0), userId);
    })();
}

/* ---------- 自建图库 ---------- */

export type LibraryImageRow = {
    id: string;
    title: string;
    /** 逗号分隔。规模只有几千张，用 LIKE 过滤足够，不值得上全文索引 */
    tags: string;
    ext: string;
    mime: string;
    bytes: number;
    width: number | null;
    height: number | null;
    created_at: string;
};

const insertLibraryStmt = db.query<never, [string, string, string, string, string, number, number | null, number | null, string]>(
    "INSERT INTO library_images (id, title, tags, ext, mime, bytes, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
);
const getLibraryStmt = db.query<LibraryImageRow, [string]>("SELECT * FROM library_images WHERE id = ?");
const deleteLibraryStmt = db.query<never, [string]>("DELETE FROM library_images WHERE id = ?");

export function insertLibraryImage(row: Omit<LibraryImageRow, "created_at">) {
    insertLibraryStmt.run(row.id, row.title, row.tags, row.ext, row.mime, row.bytes, row.width, row.height, nowIso());
}

export function getLibraryImage(id: string) {
    return getLibraryStmt.get(id);
}

export function deleteLibraryImage(id: string) {
    deleteLibraryStmt.run(id);
}

/** 关键词同时匹配标题和标签；空关键词返回最新的一批。 */
export function searchLibraryImages(keyword: string, limit: number, offset: number) {
    const trimmed = keyword.trim();
    if (!trimmed) {
        const items = db.query<LibraryImageRow, [number, number]>("SELECT * FROM library_images ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
        const total = db.query<{ c: number }, []>("SELECT COUNT(*) c FROM library_images").get()?.c || 0;
        return { items, total };
    }
    // LIKE 的通配符要转义，否则客户搜 "100%" 会变成匹配一切
    const pattern = `%${trimmed.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const where = "WHERE (title LIKE ?1 ESCAPE '\\' OR tags LIKE ?1 ESCAPE '\\')";
    const items = db.query<LibraryImageRow, [string, number, number]>(`SELECT * FROM library_images ${where} ORDER BY created_at DESC LIMIT ?2 OFFSET ?3`).all(pattern, limit, offset);
    const total = db.query<{ c: number }, [string]>(`SELECT COUNT(*) c FROM library_images ${where}`).get(pattern)?.c || 0;
    return { items, total };
}
