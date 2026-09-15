import { useState } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { uploadImage } from "@/services/image-storage";
import type { LibraryImage } from "@/services/api/image-library";
import { useAssetStore } from "@/stores/use-asset-store";

/**
 * 把图库里的图取下来存进本地。
 *
 * uploadImage 直接吃远程 URL：内部 fetch 成 blob 存进 IndexedDB，返回带 storageKey 的结果。
 * 五个源的图片本体实测都带 CORS 头，所以正常路径能拿到真正的 blob；万一某张取不到，
 * uploadImage 会退回用 <img> 读尺寸并保留远程地址，此时 storageKey 为空 ——
 * 图还能显示，但断网就没了，也不一定能作为参考图上传给模型。
 */
export function useLibraryActions() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const addAsset = useAssetStore((state) => state.addAsset);
    const [busyId, setBusyId] = useState("");

    const download = async (image: LibraryImage) => {
        setBusyId(image.id);
        const hide = message.loading(t("library.fetching"), 0);
        try {
            const stored = await uploadImage(image.fullUrl);
            return stored;
        } catch (error) {
            message.error(t("library.fetchFailed", { error: error instanceof Error ? error.message : String(error) }));
            return null;
        } finally {
            hide();
            setBusyId("");
        }
    };

    const saveToAssets = async (image: LibraryImage) => {
        const stored = await download(image);
        if (!stored) return;
        addAsset({
            kind: "image",
            title: image.title,
            coverUrl: stored.url,
            tags: image.tags,
            source: image.sourceId,
            // 出处和许可留在元数据里，客户日后要追溯用途或署名时有据可查
            metadata: { source: "image-library", sourceId: image.sourceId, sourceUrl: image.sourceUrl, license: image.license, author: image.author },
            data: {
                dataUrl: stored.url,
                storageKey: stored.storageKey,
                width: stored.width,
                height: stored.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
            },
        });
        message.success(t("common.addedToAssets"));
    };

    return { busyId, download, saveToAssets };
}
