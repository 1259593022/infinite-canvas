import { mkdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import { config } from "./config";

/**
 * 用户文件的落盘层。
 *
 * 路径结构刻意和前端 WebDAV 同步保持一致（app-sync.ts 的 domainPath()），
 * 这样前端换传输层时相对路径可以原样复用，不必改同步逻辑。
 *
 *   <dataDir>/users/<userId>/canvas/manifest.json
 *   <dataDir>/users/<userId>/canvas/files/<name>.png
 */

/** 与前端 AppSyncDomainKey 一一对应。白名单之外的前缀一律拒绝。 */
const DOMAINS = new Set(["canvas", "assets", "image-workbench", "video-workbench"]);

export type PathError = "invalid" | "domain";

/**
 * 把客户端给的相对路径解析成绝对路径，非法则返回错误码。
 *
 * 这是整个服务最需要小心的地方：path 直接来自请求，漏一个 .. 就等于把整台机器的文件
 * 交出去。除了字符串层面的拒绝，最后还用 relative() 复核结果确实落在用户目录内。
 */
export function resolveUserPath(userId: string, rawPath: string): { path: string } | { error: PathError } {
    const cleaned = (rawPath || "").trim().replace(/\\/g, "/");
    if (!cleaned || cleaned.startsWith("/") || cleaned.includes("\0")) return { error: "invalid" };

    const segments = cleaned.split("/");
    // 逐段校验，挡住 ".." 以及 "a/../../b" 这类绕过写法
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) return { error: "invalid" };
    if (!DOMAINS.has(segments[0])) return { error: "domain" };

    const root = userRoot(userId);
    const full = resolve(root, cleaned);
    // 复核：解析结果必须真的在用户目录内，且不是目录本身
    const rel = relative(root, full);
    if (!rel || rel.startsWith("..") || rel.startsWith(sep) || resolve(root, rel) !== full) return { error: "invalid" };

    return { path: full };
}

export function userRoot(userId: string) {
    return resolve(join(config.dataDir, "users", userId));
}

export async function readUserFile(absolutePath: string) {
    const file = Bun.file(absolutePath);
    return (await file.exists()) ? file : null;
}

export async function writeUserFile(absolutePath: string, data: ArrayBuffer | Uint8Array) {
    await mkdir(dirname(absolutePath), { recursive: true });
    await Bun.write(absolutePath, data);
}

/** 重算某个用户的实际占用，用于修正配额漂移（手工删文件之后）。 */
export async function measureUserUsage(userId: string) {
    const root = userRoot(userId);
    try {
        await stat(root);
    } catch {
        return 0;
    }
    const glob = new Bun.Glob("**/*");
    let total = 0;
    for await (const entry of glob.scan({ cwd: root, onlyFiles: true, absolute: true })) {
        total += Bun.file(entry).size;
    }
    return total;
}
