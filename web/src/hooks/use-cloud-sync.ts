import { useEffect, useRef } from "react";

import { syncAppData } from "@/services/app-sync";
import { serverTransport } from "@/services/server-sync";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";

/**
 * 登录后把画布数据自动同步到云端。
 *
 * 复用 app-sync 的整套合并逻辑（双向按 id + 时间戳合并、删除墓碑、媒体秒传判断），
 * 这里只负责决定「什么时候跑」，不碰任何数据。
 */

/** 改动后等这么久再推。太短会在连续拖拽节点时反复全量扫描，太长则丢数据的窗口变大。 */
const DEBOUNCE_MS = 10_000;

export function useCloudSync() {
    const userId = useUserStore((state) => state.user?.id || "");
    const fetchMe = useUserStore((state) => state.fetchMe);
    const running = useRef(false);
    const pendingChange = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!userId) return;

        const run = async () => {
            // 同步是全量扫描，重入会让两次合并互相覆盖。跑着的时候只记账，结束后补一次。
            if (running.current) {
                pendingChange.current = true;
                return;
            }
            running.current = true;
            pendingChange.current = false;
            try {
                await syncAppData(serverTransport);
                // 同步会改变已用容量，顺带刷新一次配额，让账号弹窗里的数字是新的
                await fetchMe();
            } catch (error) {
                // 自动同步失败不该弹窗打断创作；手动同步入口会把错误显示出来
                console.warn("[cloud-sync] 同步失败", error);
            } finally {
                running.current = false;
                if (pendingChange.current) schedule();
            }
        };

        const schedule = () => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => void run(), DEBOUNCE_MS);
        };

        // 登录后先跑一次：把云端已有的数据拉下来，同时把本地的推上去
        void run();

        const unsubscribeCanvas = useCanvasStore.subscribe(schedule);
        const unsubscribeAssets = useAssetStore.subscribe(schedule);

        // 关标签页/切走之前抢救一次，否则防抖窗口里的改动会丢
        const onHidden = () => {
            if (document.visibilityState !== "hidden") return;
            if (timer.current) clearTimeout(timer.current);
            void run();
        };
        document.addEventListener("visibilitychange", onHidden);

        return () => {
            if (timer.current) clearTimeout(timer.current);
            document.removeEventListener("visibilitychange", onHidden);
            unsubscribeCanvas();
            unsubscribeAssets();
        };
    }, [userId, fetchMe]);
}
