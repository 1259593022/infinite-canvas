import { Alert, Button, Input, Modal, Progress, Segmented } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useUserStore } from "@/stores/use-user-store";

type Mode = "login" | "register";

export function AccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const [mode, setMode] = useState<Mode>("login");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [email, setEmail] = useState("");

    const user = useUserStore((state) => state.user);
    const channel = useUserStore((state) => state.channel);
    const quota = useUserStore((state) => state.quota);
    const pending = useUserStore((state) => state.pending);
    const error = useUserStore((state) => state.error);
    const login = useUserStore((state) => state.login);
    const register = useUserStore((state) => state.register);
    const logout = useUserStore((state) => state.logout);

    // 关闭后清掉口令，避免留在内存和受控输入里
    useEffect(() => {
        if (!open) setPassword("");
    }, [open]);

    const submit = async () => {
        const ok = mode === "login" ? await login(username.trim(), password) : await register(username.trim(), password, email.trim());
        if (!ok) return;
        setPassword("");
        onClose();
    };

    return (
        <Modal open={open} onCancel={onClose} footer={null} title={t("account.title")} width={420} destroyOnClose>
            {user ? (
                <SignedIn onLogout={() => void logout().then(onClose)} username={user.username} activated={Boolean(channel)} quota={quota} />
            ) : (
                <div className="mt-4 space-y-3">
                    {/* HTTP 下提交口令等于把密码交出去，这个提示必须常驻而不是只写在文档里 */}
                    {window.location.protocol !== "https:" ? <Alert type="warning" showIcon message={t("account.insecureWarning")} /> : null}

                    <Segmented
                        block
                        value={mode}
                        onChange={(value) => setMode(value as Mode)}
                        options={[
                            { label: t("account.login"), value: "login" },
                            { label: t("account.register"), value: "register" },
                        ]}
                    />

                    <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder={t("account.usernamePlaceholder")} autoComplete="username" onPressEnter={() => void submit()} />
                    <Input.Password
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder={t("account.passwordPlaceholder")}
                        autoComplete={mode === "login" ? "current-password" : "new-password"}
                        onPressEnter={() => void submit()}
                    />
                    {mode === "register" ? <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("account.email")} autoComplete="email" /> : null}

                    {error ? <Alert type="error" showIcon message={error} /> : null}

                    <Button type="primary" block loading={pending} disabled={!username.trim() || !password} onClick={() => void submit()}>
                        {t(mode === "login" ? "account.login" : "account.register")}
                    </Button>
                </div>
            )}
        </Modal>
    );
}

function SignedIn({ username, activated, quota, onLogout }: { username: string; activated: boolean; quota: { usedBytes: number; limitBytes: number } | null; onLogout: () => void }) {
    const { t } = useTranslation();
    const percent = quota && quota.limitBytes > 0 ? Math.min(100, Math.round((quota.usedBytes / quota.limitBytes) * 100)) : 0;

    return (
        <div className="mt-4 space-y-4">
            <div>
                <div className="text-xs text-stone-500">{t("account.signedInAs")}</div>
                <div className="text-base font-medium">{username}</div>
            </div>

            {/* 未开通的账号能登录、能用画布，但没有渠道，生成一定失败——必须说清为什么 */}
            <Alert type={activated ? "success" : "warning"} showIcon message={t(activated ? "account.activated" : "account.notActivated")} />

            {quota ? (
                <div>
                    <div className="flex items-center justify-between text-xs text-stone-500">
                        <span>{t("account.storage")}</span>
                        <span className="tabular-nums">
                            {formatBytes(quota.usedBytes)} / {formatBytes(quota.limitBytes)}
                        </span>
                    </div>
                    <Progress percent={percent} size="small" showInfo={false} status={percent >= 100 ? "exception" : "normal"} />
                    <div className="mt-1 text-xs text-stone-500">{t("account.autoSyncHint")}</div>
                </div>
            ) : null}

            <Button block danger onClick={onLogout}>
                {t("account.logout")}
            </Button>
        </div>
    );
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}
