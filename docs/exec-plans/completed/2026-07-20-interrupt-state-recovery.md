# 中断状态恢复实施计划

> **执行要求：** 按任务逐项完成并同步勾选；坚持 TDD、YAGNI，并以 app-server/TUI 语义为准。

**目标：** 修复 `turn/interrupt` 竞态和 Web bridge 断连后 Turn 长期停留在运行态的问题，使中断操作可靠且发送入口能够恢复。

**架构：** 中断请求仍由 app-server 拥有最终状态；仅在服务端明确返回 active Turn ID 不匹配时，按官方 TUI 行为使用服务端报告的 ID 重试一次。WebSocket 关闭由浏览器客户端上报给 Provider，Provider 将尚未结束的 Turn 标记为来源为 `web-bridge` 的失败终态，并保留已有输出和诊断信息。

**技术栈：** TypeScript、React 19、WebSocket、Vitest、Codex app-server JSON-RPC。

## 全局约束

- 开发和测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不伪造 `interrupted`；正常中断终态只接受 `turn/completed` notification。
- transport close 可作为 `web-bridge` 来源的失败终态和 diagnostics。
- 不改变 CodexWeb 现有布局、视觉和聊天结构。

---

### Task 1: 中断 Turn ID 竞态重试

**Files:**
- Modify: `src/codex-web/interrupt-adapter.ts`
- Test: `src/codex-web/interrupt-adapter.test.ts`
- Modify: `src/codex-web/AppServerProvider.tsx`

**Interfaces:**
- Consumes: `TurnInterruptParams` 与 `AppServerBrowserClient.request(method, params)`。
- Produces: `readActiveTurnIdMismatch(error): string | null` 和 `requestTurnInterrupt(request, params): Promise<void>`。

- [x] **Step 1: 写入服务端 mismatch、普通失败和无效 mismatch 的失败测试**
- [x] **Step 2: 运行 `npx vitest run src/codex-web/interrupt-adapter.test.ts`，确认新增测试失败**
- [x] **Step 3: 实现严格的 mismatch 解析与至多一次重试**
- [x] **Step 4: Provider 改用经过重试的中断请求函数**
- [x] **Step 5: 重跑 targeted test，确认全部通过**

### Task 2: transport close 释放运行态

**Files:**
- Modify: `src/codex-web/app-server-browser-client.ts`
- Create: `src/codex-web/app-server-browser-client.test.ts`
- Modify: `src/codex-web/active-turns-adapter.ts`
- Test: `src/codex-web/active-turns-adapter.test.ts`
- Modify: `src/codex-web/AppServerProvider.tsx`

**Interfaces:**
- Consumes: WebSocket `close` / `error` 事件、`CodexWebAppServerState` 中的 active Turn 与 snapshots。
- Produces: `onClose(listener): () => void` 和 `failRunningTurnsOnTransportClose(...)` 纯状态转换。

- [x] **Step 1: 写入断连事件只上报一次、仅 running/starting 变 failed、terminal 保持不变的失败测试**
- [x] **Step 2: 运行 targeted tests，确认新增测试失败**
- [x] **Step 3: 实现客户端关闭事件订阅和断连 Turn 状态转换**
- [x] **Step 4: Provider 接线 connection、diagnostics、active Turn、snapshots，并清除失效 approval**
- [x] **Step 5: 重跑 targeted tests，确认全部通过**

### Task 3: 回归验证

**Files:**
- Modify: `docs/exec-plans/active/2026-07-20-interrupt-state-recovery.md`
- Create: `scripts/interrupt-smoke.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: 修复后的浏览器 UI 与隔离 app-server。
- Produces: 更新后的 checklist 和 Smoke Ledger。
- Produces: 可重复执行的 `npm run test:smoke:interrupt` 真实 app-server 验收入口。

- [x] **Step 1: 运行 `npm run test`，预期 typecheck 和全部 unit tests 通过**
- [x] **Step 2: 运行 `npm run build`，预期生产构建通过**
- [x] **Step 3: 运行 `npm run test:smoke`，预期普通消息路径通过**
- [x] **Step 4: 实际验证运行中中断后收到 `interrupted` 且发送入口恢复**
- [x] **Step 5: 反例验证普通完成不变、断连显示失败而非伪造中断**
- [x] **Step 6: 更新状态总览、决策日志和 Smoke Ledger**

## 状态总览

- 当前状态：Code complete、Tests pass、Smoke passed。
- 已确认根因：中断未处理 Turn ID 竞态；WebSocket 关闭未进入 Provider 状态机。
- 验证结果：98 个测试文件、474 项测试通过；生产构建通过；普通 smoke、真实中断 smoke 与断线重连 smoke 通过。

## 后续演进

- 2026-07-21：运行中任务断线重连方案取代了“transport close 立即标记 failed”的临时收口。浏览器断线后现在保留运行态、自动重连，并通过 `thread/resume` 恢复 app-server 真实状态；详见 [运行中任务断线重连实施计划](./2026-07-21-running-turn-reconnect.md)。

## 决策日志

- 2026-07-20：正常中断只由 `turn/completed` 决定 `interrupted`，请求成功本身不修改 Turn 状态。
- 2026-07-20：连接关闭将运行中 Turn 标为 `failed`，来源记录为 `web-bridge`，以便恢复 UI 且不伪造 app-server notification。
- 2026-07-20：真实中断 smoke 等待 `item/started(type=commandExecution)` 后再发起中断，避免用固定延迟猜测运行态。

## Smoke Ledger

- 普通路径：`npm run test:smoke` 通过，initialize、model/list、account/read 保持正常。
- 中断成功：`npm run test:smoke:interrupt` 通过，thread `019f801e-cd71-7902-aecb-8cd71c3a2a1e` 的 turn `019f801e-ce0c-7ff0-be75-824bd304a53d` 收到 `turn/completed.status=interrupted`。
- Turn ID mismatch：单元测试确认首次错误后只使用服务端报告的实际 ID 重试一次；普通错误和相同 ID 均不重试。
- transport close：单元测试确认 `starting/running` 转为来源为 `web-bridge` 的 `failed`，已有 `completed` 保持不变，不伪造 `interrupted`。
- 反例：首次真实 smoke 因 Turn 已自然结束而返回 `no active turn to interrupt`；修正验收触发点后通过，证明测试没有把无 active Turn 当成中断成功。
