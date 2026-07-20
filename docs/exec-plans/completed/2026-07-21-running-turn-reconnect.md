# 运行中任务断线重连实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 按任务逐项实现并在每项后执行对应验证。步骤使用 checkbox 跟踪。

**目标：** 浏览器刷新、关闭或短暂断网后，只要 Web bridge 及其 `codex app-server` 进程仍存活，重新连接即可恢复同一运行中 Turn 的真实状态并继续接收后续事件。

**架构：** Web bridge 持有单个长期运行的 stdio app-server，不再为每个 WebSocket 创建子进程。bridge 将浏览器 JSON-RPC request id 映射为全局唯一 upstream id，并把 response 路由回原连接；notification 广播，未决 server request 保留并向新连接重放。前端采用有限指数退避重连，重连 bootstrap 后通过 `thread/resume` 返回的 active Turn 快照水合 reducer。

**技术栈：** Node.js、TypeScript、`ws`、React 19、Vitest、Codex app-server JSON-RPC v2。

## 全局约束

- 官方 `codex-rs/tui` 和 generated app-server schema 是行为事实源。
- 开发和测试必须显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不修改 `/home/rrssnas/code/CodexWeb`，不复制 `CodexBrowser` 或 `CodePilot` 代码。
- 不持久化凭据，不从历史文本伪造实时状态。
- 保留工作区已有未提交改动，不做无关重构。

---

### Task 1：持久 app-server 与 JSON-RPC 多客户端路由

**文件：**
- 新建：`server/persistent-app-server.ts`
- 新建：`server/persistent-app-server.test.ts`
- 修改：`server/websocket-bridge.ts`
- 修改：`server/websocket-bridge.test.ts`
- 修改：`server/bridge-message-routing.ts`
- 修改：`server/bridge-message-routing.test.ts`

**接口：**
- 产出 `PersistentAppServer`，提供 `attach(socket)`、`detach(socket)`、`close()`。
- 浏览器 request 使用 bridge upstream id；response 恢复浏览器原 id并只发给 owner。
- `initialize` 在同一 stdio connection 上只执行一次，后续客户端复用缓存 response；`initialized` 只上游发送一次。
- app-server notification 广播；server request 使用公共 id，未解决请求向新连接重放。

- [x] 先写失败测试：两个 WebSocket 只创建一个 app-server，关闭客户端不调用 `stop()`。
- [x] 写失败测试：两个客户端使用相同 request id 时 response 不串线。
- [x] 写失败测试：第二个客户端 initialize 复用首个响应，不重复初始化上游。
- [x] 写失败测试：无客户端时收到的 server request 在新客户端连接后重放。
- [x] 实现最小持久会话和路由逻辑。
- [x] 运行 targeted Vitest，bridge 与 routing 测试全部通过。

### Task 2：浏览器自动重连

**文件：**
- 新建：`src/codex-web/reconnect-policy.ts`
- 新建：`src/codex-web/reconnect-policy.test.ts`
- 修改：`src/codex-web/app-server-browser-client.ts`
- 修改：`src/codex-web/app-server-browser-client.test.ts`
- 修改：`src/codex-web/AppServerProvider.tsx`

**接口：**
- `AppServerBrowserClient.connect()` 支持断线后的重新连接。
- `onConnectionState(listener)` 发布 `connecting | connected | reconnecting | closed`。
- 非主动关闭采用 250ms、500ms、1000ms、2000ms、5000ms 上限退避；成功连接后重置。
- Provider 每次建立新 socket 后重新执行 bootstrap，并保持已有运行态直到 app-server 事实源纠正。

- [x] 写退避序列和主动关闭反例测试。
- [x] 写连接断开后创建新 WebSocket 并重新连接的测试。
- [x] 实现重连 policy 和 client 状态机。
- [x] 修改 Provider，使每次重连完成后执行 initialize/bootstrap，断线期间显示 reconnecting 而非立即伪造 Turn failed。
- [x] 运行 targeted Vitest，预期全部通过。

### Task 3：从 thread/resume 水合 active Turn

**文件：**
- 新建：`src/codex-web/resumed-turn-hydration.ts`
- 新建：`src/codex-web/resumed-turn-hydration.test.ts`
- 修改：`src/codex-web/AppServerProvider.tsx`
- 修改：`src/codex-web/active-turns-adapter.ts`
- 修改：`src/codex-web/active-turns-adapter.test.ts`

**接口：**
- `activeTurnFromResume(response)` 只在最新 Turn 为 `inProgress` 时返回真实 `AppServerTurnState`。
- 状态来源为 `app-server.thread/resume`；Turn item 通过现有 app-server item adapter 转为 UI 工具状态。
- completed、failed、interrupted 历史不得生成运行态。

- [x] 写 inProgress、completed、无 Turn 三类测试，并补较早陈旧 inProgress 反例。
- [x] 实现 active Turn 快照映射，复用现有 reducer/item adapter。
- [x] 在 `resumeThread()` response 落状态时同步更新 `activeTurn`、`activeTurnsByThreadId` 和 `turnSnapshots`。
- [x] 运行 targeted Vitest，预期全部通过。

### Task 4：断线恢复 Smoke 与文档

**文件：**
- 新建：`scripts/reconnect-smoke.ts`
- 修改：`package.json`
- 新建：`docs/handover/2026-07-21-running-turn-reconnect.md`
- 移动：本计划到 `docs/exec-plans/completed/2026-07-21-running-turn-reconnect.md`

**验收场景：**
- 长任务开始后关闭唯一 WebSocket，app-server 进程不退出。
- 新连接执行 bootstrap 和 `thread/resume` 后，返回同一 `threadId`、`turnId`、`inProgress`。
- 新连接继续收到最终 `turn/completed`。
- 断线期间 server request 在重连后可见并可响应。
- 已完成 Turn 重连后不会显示运行态。
- bridge 主动关闭时 app-server 才停止，前端最终显示失败。

- [x] 新增 `npm run test:smoke:reconnect`。
- [x] 使用隔离 `CODEX_HOME` 运行 targeted tests。
- [x] 运行 `npm run test`、`npm run build`、`npm run test:smoke` 和 reconnect smoke。
- [x] 启动应用做一次刷新页面验证，检查 UI 状态与 console。
- [x] 在 handover 和 Smoke Ledger 记录正例、反例、命令及真实结果。
- [x] 自检 i18n、共享类型、临时文件、日志和 source breadcrumb。
- [x] 将执行计划移动到 completed。

## 状态总览

- 当前状态：Code complete、Tests pass、Smoke passed。
- 已确认协议：同一 app-server 进程中的 `thread/resume` 会重加入运行中 Thread、返回 active Turn snapshot 并登记后续 notification 订阅。
- 明确边界：bridge/app-server 进程退出或机器重启后，内存中的 Turn 无法继续；只能恢复落盘历史。

## 决策日志

- 2026-07-21：选择 bridge 级单一长期 stdio app-server，避免 WebSocket 关闭终止 Turn。
- 2026-07-21：不依赖浏览器本地缓存伪造运行态；重连状态来自 `thread/resume` active Turn snapshot。
- 2026-07-21：未决 approval 必须由 bridge 保持并重放，否则离线期间任务可能永久不可操作。

## Smoke Ledger

| 日期 | 环境 | 场景 | 结果 | 说明 |
|---|---|---|---|---|
| 2026-07-21 | 隔离 CODEX_HOME，Vitest | 共享进程、request id 隔离、initialize 缓存、离线 approval 重放 | 通过 | Targeted 25 项加 Provider 接线 3 项通过 |
| 2026-07-21 | 隔离 CODEX_HOME，真实 app-server | 长命令运行中关闭唯一 WebSocket并重连 | 通过 | resume 同一 Turn 为 inProgress，随后 completed；completed 反例通过 |
| 2026-07-21 | Next dev + Chrome CDP | `/chat` 刷新和 console 检查 | 通过 | readyState complete，标题 CodexWeb，console warning/error 0 |
