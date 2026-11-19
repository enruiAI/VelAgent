/**
 * embed 构建专用的 @tauri-apps/api 空实现（vite.embed.config.ts 的 alias 目标）。
 *
 * Harness dock 里没有 Tauri 运行时，但工作台 UI（品牌头/活动栏/状态栏/AI 面板的
 * import 链）会引用桌面桥接模块做能力探测。如果把这些模块打进 IIFE，浏览器
 * bundle 会白白带上整个桌面桥接层（并污染校验）。embed 构建统一替换成这里的
 * no-op：真正的调用点都有 isDesktop() 守卫，浏览器里不会执行到这里；真被调用
 * 时打一条 warn 便于排查，而不是抛错打断演示。
 */

/** @returns 永远 resolve（浏览器 embed 里没有可执行的桌面命令）。 */
export async function invoke(command: string, _args?: Record<string, unknown>): Promise<void> {
  console.warn('[velagent] 嵌入模式下忽略桌面桥接命令：' + command);
}

/** @returns 永远 resolve 一个空的取消订阅函数。 */
export async function listen(
  _event: string,
  _handler: (event: { payload: unknown }) => void,
  _options?: unknown,
): Promise<() => void> {
  return () => {};
}
