import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { ensurePersistentStorage } from "@/lib/storage-persistence";
import { useCloudSync } from "@/hooks/use-cloud-sync";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const importChannelCredentials = useConfigStore((state) => state.importChannelCredentials);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const hydrateModelPricing = useConfigStore((state) => state.hydrateModelPricing);
    const fetchMe = useUserStore((state) => state.fetchMe);

    usePromptSourceScheduler();
    useCloudSync();

    // 启动时补一次定价，让老配置也能显示单价，不必让用户手动重拉模型。
    useEffect(() => {
        void hydrateModelPricing();
    }, [hydrateModelPricing]);

    // 问一次服务端「我是谁」。已登录就顺带把渠道写进配置，客户不用碰 API Key。
    // 后端没部署或不可达时静默失败，画布照常当本地工具用。
    useEffect(() => {
        void fetchMe();
    }, [fetchMe]);

    // 有作品之后就把站点标记为持久化存储，否则浏览器可能在磁盘紧张时
    // 或（Safari）超过 7 天没访问时把整站数据清掉。
    useEffect(() => {
        let requested = false;
        const check = () => {
            // 只申请一次，且必须等本地数据加载完 —— 否则会把「还没读出来」当成「没有作品」
            if (requested) return;
            const canvas = useCanvasStore.getState();
            const assets = useAssetStore.getState();
            if (!canvas.hydrated || !assets.hydrated) return;
            if (!canvas.projects.length && !assets.assets.length) return;
            requested = true;
            void ensurePersistentStorage(true);
        };
        check();
        // 首次访问时还没有作品，等他真的画了东西再申请，别对空白页面弹权限框
        const unsubscribeCanvas = useCanvasStore.subscribe(check);
        const unsubscribeAssets = useAssetStore.subscribe(check);
        return () => {
            unsubscribeCanvas();
            unsubscribeAssets();
        };
    }, []);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const result = importChannelCredentials({ baseUrl, apiKey });
        openConfigDialog(false, "channels");
        if (result.status === "created") message.success(t("config.importedChannelCreated", { name: result.channelName }));
        else if (result.status === "updated") message.success(t("config.importedChannelUpdated", { name: result.channelName }));
        else if (result.status === "missing-base-url") message.error(t("config.importedChannelBaseUrlRequired"));
        else message.error(t("config.importedChannelBaseUrlInvalid"));
    }, [importChannelCredentials, message, openConfigDialog, t]);

    return <>{children}</>;
}
