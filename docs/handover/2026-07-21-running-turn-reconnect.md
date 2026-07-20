# 运行中任务断线重连技术交接

关联计划：[运行中任务断线重连实施计划](../exec-plans/completed/2026-07-21-running-turn-reconnect.md)

## 结论

浏览器刷新、关闭或短暂断网后，只要 Codex Web bridge 进程仍在运行，当前 Turn 会继续由同一个 `codex app-server` 执行。浏览器重新连接后会自动 bootstrap，并通过 `thread/resume` 返回的 active Turn snapshot 恢复同一 `threadId`、`turnId`、运行状态、已知 item 和命令聚合输出，随后继续消费实时 notification。

bridge 或 app-server 进程退出、机器重启后，内存中的 Turn 仍不能继续；此时只能恢复 app-server 已落盘的历史。这一边界没有用浏览器缓存伪装。

## 架构变化

此前每个 WebSocket 都会创建一个 app-server，WebSocket 关闭时调用 `process.stop()`。现在 `createWebSocketBridge()` 创建一个 bridge 级 `PersistentAppServer`：

- app-server 在 bridge 生命周期内只启动一次。
- WebSocket 关闭只解除客户端绑定，不停止 app-server。
- bridge 关闭时才关闭 JSON-RPC transport 并停止 app-server。
- 浏览器 JSON-RPC id 映射为唯一 `bridge-client-request:*` upstream id；response 恢复原 id 并只发送给发起客户端。
- app-server notification 广播给全部在线客户端。
- app-server server request 映射为 `bridge-server-request:*`，在未响应前保留；新客户端连接时重放，首个 response 后广播 `serverRequest/resolved`。
- 同一 stdio connection 只向 app-server 发送一次 `initialize/initialized`；重连客户端复用缓存的 initialize response。

## 前端恢复

`AppServerBrowserClient` 现在允许断线后创建新 WebSocket，主动关闭不会触发重连。`AppServerProvider` 使用 250ms、500ms、1000ms、2000ms、5000ms 封顶的退避持续尝试；断线期间连接状态为 `reconnecting`，不会把仍运行的 Turn 本地改成 failed。

连接恢复并完成 bootstrap 后，历史页面既有依赖会重新执行 `thread/read`、`thread/resume` 和 `thread/turns/list`。`activeTurnFromResume()` 只接受最新 Turn 的真实 `inProgress` 状态；completed、failed、interrupted、空历史和“较早陈旧 inProgress + 最新 completed”均不会生成运行态。

source breadcrumb：

- 断线/重连状态：`web-bridge`
- 恢复的 active Turn：`app-server.thread/resume`
- 后续增量及终态：原始 `app-server.notification`

## 主要文件

- `server/persistent-app-server.ts`：长期 app-server、请求路由、initialize 缓存、server request 重放。
- `server/websocket-bridge.ts`：WebSocket 鉴权、客户端 attach/detach、bridge 生命周期。
- `src/codex-web/app-server-browser-client.ts`：可重复连接的浏览器 JSON-RPC client。
- `src/codex-web/reconnect-policy.ts`：重连退避序列。
- `src/codex-web/resumed-turn-hydration.ts`：`thread/resume` active Turn 到现有 reducer state 的映射。
- `src/codex-web/AppServerProvider.tsx`：重连调度、bootstrap 和恢复态落库。
- `scripts/reconnect-smoke.ts`：真实 app-server 断线恢复正例与 completed 反例。

## 验证记录

- Targeted Vitest：6 个文件、25 项测试通过；另有 Provider 重连接线 3 项测试通过。
- `npm run test`：通过，包含 TypeScript typecheck 和完整 Vitest。
- `npm run build`：沙箱外通过；沙箱内首次因 Turbopack 子进程绑定端口被 EPERM 拒绝，不是代码错误。
- `npm run test:smoke`：通过，隔离 `CODEX_HOME`，models=7，account source 为 `app-server.account/read`。
- `npm run test:smoke:interrupt`：通过，真实 Turn 终态为 `interrupted`。
- `npm run test:smoke:reconnect`：通过；唯一 WebSocket 在长命令运行中关闭，新连接 resume 同一 Turn 为 `inProgress`，随后收到 `completed`；再次 resume 不再返回 `inProgress`。
- 实际应用：`http://localhost:3001/chat` 返回 200。CDP 刷新后 `readyState=complete`、标题 `CodexWeb`、主体正常，新增 console warning/error 为 0。

## 反例与限制

- completed、failed、interrupted Turn 不会被水合为运行态。
- 较早 Turn 的陈旧 `inProgress` 不会覆盖最新 completed Turn。
- 主动卸载 React Provider 不触发后台重连。
- app-server fatal exit 当前不会在 bridge 内自动拉起新进程；运行中 Turn 无法跨 app-server 进程恢复。
- `thread/resume` 的运行态重加入依赖持久 rollout；产品 Thread 默认持久化，smoke 也使用 `ephemeral: false`。
- bridge 只重放未决 server request，不提供通用 notification 日志；断线区间的状态由官方 `thread/resume` snapshot 和历史 API 恢复。
