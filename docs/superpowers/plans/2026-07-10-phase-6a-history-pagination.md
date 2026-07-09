# Phase 6A 历史分页加载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 app-server 历史会话接入 experimental `thread/turns/list` 分页加载，并避免重复消息。

**Architecture:** 新增本地 experimental turns list adapter，`AppServerProvider` 暴露分页 request，`/chat/[id]` 保存 cursor 并复用 `ChatView`/`MessageList` 的加载更早入口。历史消息转换继续复用 `threadToMessages()`，只在分页边界做顺序和去重处理。

**Tech Stack:** Next.js 16、React 19、TypeScript、Vitest、Codex app-server JSON-RPC。

## Global Constraints

- 默认语言和文档说明使用中文。
- 开发、测试和 smoke 必须使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不重新生成整套 experimental schema；本阶段只新增最小本地类型。
- 不伪造没有 app-server 来源的历史消息或状态。
- 删除和清理操作必须按 Trash 规则另行确认。

---

### Task 1: Turns Page Adapter

**Files:**
- Create: `src/codex-web/thread-turns-page-adapter.ts`
- Create: `src/codex-web/thread-turns-page-adapter.test.ts`

**Interfaces:**
- Produces: `ThreadTurnsListParams`、`ThreadTurnsListResponse`、`mergeThreadTurnMessages(existing, incoming)`、`threadTurnsPageToMessages(thread, turns)`。

- [ ] 编写单元测试：分页 turn 按时间顺序转换为消息，重复 id 不会重复插入。
- [ ] 实现最小本地类型和转换/合并函数。
- [ ] 运行 `npm run test -- src/codex-web/thread-turns-page-adapter.test.ts`。

### Task 2: Provider Request

**Files:**
- Modify: `src/codex-web/AppServerProvider.tsx`

**Interfaces:**
- Consumes: `ThreadTurnsListParams`、`ThreadTurnsListResponse`。
- Produces: `listThreadTurns(params)`。

- [ ] 在 `AppServerActions` 中增加 `listThreadTurns(params)`。
- [ ] 调用 `client.request("thread/turns/list", params)` 并返回 typed response。
- [ ] 不把分页结果写入全局 selectedThread，避免跨页污染。
- [ ] 运行 `npm run test -- src/codex-web`。

### Task 3: History Page Wiring

**Files:**
- Modify: `src/app/chat/[id]/page.tsx`
- Modify: `src/components/chat/ChatView.tsx`

**Interfaces:**
- Consumes: `listThreadTurns()`、`mergeThreadTurnMessages()`。
- Produces: app-server 历史页的 `onLoadMore` 行为和 degraded notice。

- [ ] `/chat/[id]` 保存 `nextCursor/backwardsCursor` 与 loading 状态。
- [ ] 初始历史页在可用时使用 `thread/turns/list` 的 cursor 判断是否可加载更早。
- [ ] `ChatView` 接受可选 app-server load earlier override，复用现有 `MessageList` 加载入口。
- [ ] unsupported 或 request failed 时显示可见 app-server notice，不追加伪消息。

### Task 4: Plan And Verification

**Files:**
- Modify: `docs/exec-plans/active/web-mvp-phase-0-4.md`

**Interfaces:**
- Produces: Phase 6A 记录、验证结果和剩余风险。

- [ ] 更新 Backlog 中历史分页加载状态为 `Code complete`。
- [ ] 记录 experimental `thread/turns/list` 决策。
- [ ] 运行 `npm run test -- src/codex-web`、`npm run test`、`npm run build`、`npm run test:smoke`。
- [ ] 若 `next-env.d.ts` 被 build 自动改动，按既有要求还原。
