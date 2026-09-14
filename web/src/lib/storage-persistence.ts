/**
 * 申请持久化存储。
 *
 * 不申请的话，IndexedDB 里的画布和媒体属于「尽力而为」级别，浏览器可以主动回收：
 * Chrome 在磁盘紧张时按 LRU 清理，Safari 的 ITP 更狠——超过 7 天没以第一方身份
 * 访问过就整站清空。对一个创作工具来说，那等于用户的作品凭空消失。
 *
 * 申请成功后浏览器只会在用户主动清除时才删。
 */

/**
 * 只在用户确实有内容时才申请。
 *
 * Firefox 会为此弹权限框，对刚打开首页、还什么都没做的访客弹一个「允许永久存储数据」
 * 既突兀又容易被拒（拒了之后不好再要）。等他真的画了东西再问，通过率和合理性都更高。
 * Chrome 不弹框，按站点参与度自行决定，早问晚问没差别。
 */
export async function ensurePersistentStorage(hasContent: boolean): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.storage?.persist || !navigator.storage.persisted) return;
    try {
        if (await navigator.storage.persisted()) return;
        if (!hasContent) return;
        await navigator.storage.persist();
    } catch {
        // 浏览器不支持或用户拒绝都不影响使用，数据仍在，只是少了这层保护
    }
}
