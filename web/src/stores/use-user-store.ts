import { create } from "zustand";

import { useConfigStore } from "@/stores/use-config-store";

export type LocalUser = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
};

/** 服务端下发的渠道。为 null 表示账号尚未开通（没绑令牌）。 */
export type AccountChannel = {
    baseUrl: string;
    apiKey: string;
};

export type AccountQuota = {
    usedBytes: number;
    limitBytes: number;
};

type SessionView = {
    user: LocalUser;
    channel: AccountChannel | null;
    quota: AccountQuota;
};

type UserStore = {
    user: LocalUser | null;
    channel: AccountChannel | null;
    quota: AccountQuota | null;
    /** fetchMe 是否已经跑完。UI 靠它区分「未登录」和「还没问过服务端」。 */
    ready: boolean;
    pending: boolean;
    error: string;
    fetchMe: () => Promise<void>;
    login: (username: string, password: string) => Promise<boolean>;
    register: (username: string, password: string, email?: string) => Promise<boolean>;
    logout: () => Promise<void>;
    setQuota: (quota: AccountQuota) => void;
    clearSession: () => void;
};

const emptySession = { user: null, channel: null, quota: null };

export const useUserStore = create<UserStore>()((set) => ({
    ...emptySession,
    ready: false,
    pending: false,
    error: "",

    /** 启动时问一次服务端「我是谁」。未登录是正常情况，不当作错误。 */
    fetchMe: async () => {
        try {
            const response = await fetch("/api/auth/me", { cache: "no-store", credentials: "include" });
            if (!response.ok) return set({ ...emptySession, ready: true });
            applySession(set, (await response.json()) as SessionView);
        } catch {
            // 后端没部署或不可达时，画布应当照常当本地工具用，而不是卡在登录上
            set({ ...emptySession, ready: true });
        }
    },

    login: (username, password) => submit(set, "/api/auth/login", { username, password }),
    register: (username, password, email) => submit(set, "/api/auth/register", { username, password, email }),

    logout: async () => {
        try {
            await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
        } catch {
            // 网络失败也要清掉本地会话，否则界面会停在「已登录」但实际用不了
        }
        set({ ...emptySession, ready: true, error: "" });
    },

    setQuota: (quota) => set({ quota }),
    clearSession: () => set({ ...emptySession, ready: true }),
}));

type SetState = (partial: Partial<UserStore>) => void;

async function submit(set: SetState, url: string, body: Record<string, unknown>): Promise<boolean> {
    set({ pending: true, error: "" });
    try {
        const response = await fetch(url, {
            method: "POST",
            cache: "no-store",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => null)) as (SessionView & { error?: string }) | null;
        if (!response.ok || !payload?.user) {
            set({ pending: false, error: payload?.error || `请求失败（${response.status}）` });
            return false;
        }
        applySession(set, payload);
        return true;
    } catch {
        set({ pending: false, error: "无法连接服务器" });
        return false;
    }
}

function applySession(set: SetState, view: SessionView) {
    set({ user: view.user, channel: view.channel, quota: view.quota, ready: true, pending: false, error: "" });
    if (view.channel) void applyChannel(view.channel);
}

/**
 * 把服务端下发的渠道写进配置。
 *
 * 这样客户从头到尾看不到也不用填 API Key——key 的真相只在服务端，随时可以换绑或停用。
 * upsertChannelCredentials 按 baseUrl 匹配后原地更新，重复登录不会堆出多个渠道。
 */
async function applyChannel(channel: AccountChannel) {
    const { importChannelCredentials } = useConfigStore.getState();
    importChannelCredentials({ baseUrl: channel.baseUrl, apiKey: channel.apiKey });

    // 新建出来的渠道模型列表是空的，顺手拉一次，让「登录即可用」成立
    const target = useConfigStore.getState().config.channels.find((item) => item.apiKey === channel.apiKey && item.models.length === 0);
    if (!target) return;
    try {
        const { fetchChannelModelsDetailed } = await import("@/services/api/image");
        const models = await fetchChannelModelsDetailed(target);
        if (!models.length) return;
        const { config } = useConfigStore.getState();
        useConfigStore.getState().updateConfig(
            "channels",
            config.channels.map((item) => (item.id === target.id ? { ...item, models } : item)),
        );
    } catch {
        // 拉不到就算了，用户仍可手动「拉取模型」
    }
}
