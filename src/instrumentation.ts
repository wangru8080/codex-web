/**
 * 前端 1:1 展示版不启动 Sentry、runtime log 或任务调度器。
 * 真实 UI 仍由 AppShell 和各页面组件渲染，后端副作用统一由 mock API 替代。
 */
export async function register() {
  return;
}
