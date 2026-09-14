import type { SyncTransport } from "@/services/app-sync";

/**
 * 自建账号服务的同步传输层。
 *
 * 与 WebDAV 版的区别只有两点：同源相对路径（不涉及 CORS），以及靠 httpOnly cookie 鉴权
 * （所以每个请求都要带 credentials）。合并逻辑全部在 app-sync.ts，这里不做任何数据处理。
 */

const SYNC_ENDPOINT = "/api/sync/file";

function fileUrl(path: string) {
    return `${SYNC_ENDPOINT}?path=${encodeURIComponent(path)}`;
}

export class SyncQuotaError extends Error {}

export const serverTransport: SyncTransport = {
    async download(path) {
        const response = await fetch(fileUrl(path), { cache: "no-store", credentials: "include" });
        // 404 是正常分支：远端还没有这个域的数据，调用方会走首次上传
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(await readError(response, "读取云端数据失败"));
        return response.blob();
    },

    async upload(path, file, contentType) {
        const response = await fetch(fileUrl(path), {
            method: "PUT",
            cache: "no-store",
            credentials: "include",
            headers: { "Content-Type": contentType },
            body: file,
        });
        if (response.ok) return;
        const message = await readError(response, "上传云端数据失败");
        // 配额超限单独成类型：调用方要提示「清理或联系管理员」，而不是当成网络错误重试
        if (response.status === 413) throw new SyncQuotaError(message);
        throw new Error(message);
    },
};

async function readError(response: Response, fallback: string) {
    try {
        const payload = (await response.json()) as { error?: string };
        return payload.error || `${fallback}（${response.status}）`;
    } catch {
        return `${fallback}（${response.status}）`;
    }
}
