# Phase 6C Approval 队列硬化设计

关联计划：`docs/superpowers/plans/2026-07-10-phase-6c-approval-queue.md`

## 背景

当前 Web 只保存单个 `pendingApproval`。如果 app-server 连续发送多个 approval server request，后来的 request 会覆盖前一个；已有 `approval-response-guard` 只能防重复响应当前 request，不能处理多个待处理 request、已 resolved request 或跨 thread 可见性。

官方 TUI 对照：

- `/home/rrssnas/code/codex/codex-rs/tui/src/chatwidget/interrupts.rs` 使用 `VecDeque<QueuedInterrupt>` 排队 approval、permission、elicitation 和其它 interrupt。
- TUI 的 `remove_resolved_prompt()` 按 app-server resolved request id 从队列移除已解决 prompt。
- TUI 只展示当前 interrupt，后续 prompt 等当前项处理后再显示。

Phase 6C 在 Web 里实现同等核心语义：approval 请求排队、按 requestId 去重、resolved 时移除、用户响应时精确响应目标 requestId。

## 目标

- 支持多个 app-server approval request 不互相覆盖。
- `serverRequest/resolved` 到来时按 requestId 移除队列中的 approval。
- 用户响应 stale、duplicate 或已 resolved approval 时快速失败并写 diagnostics，不误发 response。
- 历史页只显示当前 route thread 或 resumed thread 的 approval，避免跨 thread 串线。
- 保持 `pendingApproval` 兼容字段，减少 UI 改动面。

## 非目标

- 不新增 approval 列表 UI。
- 不支持 MCP elicitation 或 requestUserInput 队列。
- 不改变官方 app-server response schema。
- 不改变 CodexWeb 整体布局。

## 方案

新增 `src/codex-web/approval-queue-adapter.ts`：

- `enqueueApproval(queue, approval)`：按 JSON-RPC requestId 去重，追加新 approval。
- `removeApproval(queue, requestId)`：按 requestId 移除 resolved 或已响应 approval。
- `firstApproval(queue, predicate?)`：返回队首或满足 thread 过滤条件的第一个 approval。
- `approvalRequestMatchesThread(approval, threadIds)`：给历史页按 route/resumed thread 过滤。

`CodexWebAppServerState` 新增 `pendingApprovals`，`pendingApproval` 继续代表全局队首。Provider 在收到 approval server request 时入队；收到 `serverRequest/resolved` 时从队列移除；响应成功后也移除对应 request。`respondToApproval(decision, requestId?)` 默认响应全局队首，也允许页面传入当前可见 approval 的 requestId。

## 成功标准

- 多个 approval 入队后不会覆盖。
- duplicate requestId 不重复入队。
- resolved notification 会移除对应 request 并推进队首。
- 历史页能显示队列中属于当前 thread 的 approval，而不是被其它 thread 队首遮住。
- stale / duplicate response 不会调用 `client.respond()`。
- `npm run test -- src/codex-web`、`npm run test`、`npm run build`、`npm run test:smoke` 在隔离 `CODEX_HOME` 下通过。

## 自审

- 方案聚焦 approval 队列，不扩展到 elicitation。
- 与官方 TUI 的队列和 resolved 移除语义一致。
- 保留兼容字段，避免大范围 UI 重构。
