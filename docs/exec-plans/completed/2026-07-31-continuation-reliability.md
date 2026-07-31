# 续接任务可靠性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“接续自任务”在长历史中准确定位父任务输出点，并保证分叉后的重命名或本地存储失败不会阻止进入新任务。

**Architecture:** 继续复用 app-server `thread/read`、现有消息适配器和 Virtuoso。普通进入仍只加载最近 30 个 turn；仅深链目标不在首屏时读取完整历史，并由虚拟列表主动滚动。`thread/fork` 是唯一决定创建成功与否的步骤，命名和本地引用保存降级为不会阻止导航的后处理。

**Tech Stack:** React、TypeScript、Codex app-server、React Virtuoso、Vitest、Playwright。

## Global Constraints

- 不新增依赖。
- 普通任务加载路径保持最近 30 个 turn。
- 只修复长历史定位和分叉后处理失败，不处理无 `turn_id` 按钮及标题列表上限问题。
- 使用隔离环境 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 验证。

---

### Task 1: 长历史父任务定位

**Files:**
- Modify: `src/codex-web/continuation-reference.ts`
- Modify: `src/app/chat/[id]/page.tsx`
- Modify: `src/components/chat/ChatView.tsx`
- Modify: `src/components/chat/MessageList.tsx`
- Modify: `src/components/chat/message-list-virtualization.ts`
- Test: `src/codex-web/tests/continuation-reference.test.ts`
- Test: `src/components/chat/tests/message-list-virtualization.test.ts`
- Test: `src/codex-web/tests/message-list-virtualization-wiring.test.ts`

**Interfaces:**
- Produces: 带 `continuationMessage` 查询参数的父任务链接。
- Consumes: `thread/read(includeTurns: true)` 返回的完整父任务历史。
- Produces: `targetMessageId?: string`，由页面传到 Virtuoso 定位。

- [x] 增加父任务深链和目标虚拟索引的失败测试。
- [x] 目标不在最近 30 个 turn 时加载完整历史。
- [x] 禁用目标深链的初始底部锁定，并滚动到目标消息。
- [x] 运行目标测试。

### Task 2: 分叉后处理降级

**Files:**
- Modify: `src/app/chat/[id]/page.tsx`
- Modify: `src/components/chat/MessageItem.tsx`
- Test: `src/codex-web/tests/continuation-reference.test.ts`
- Test: `src/codex-web/tests/chat-message-copy-wiring.test.ts`

**Interfaces:**
- Consumes: `thread/fork` 成功响应。
- Produces: 无论命名或本地引用保存是否失败，都调用 `router.push`。
- Produces: `thread/fork` 失败时显示 `error.sessionCreateFailed`。

- [x] 增加命名失败、存储失败和 fork 失败的反例测试。
- [x] 将命名和本地引用保存改为尽力执行。
- [x] fork 失败时显示错误提示。
- [x] 运行目标测试。

### Task 3: 回归验证与归档

**Files:**
- Move: `docs/exec-plans/active/2026-07-31-continuation-reliability.md` -> `docs/exec-plans/completed/2026-07-31-continuation-reliability.md`

- [x] 运行 `npm run test`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run test:smoke`。
- [x] 记录普通任务不触发完整历史读取的反例结果。
- [x] 将本计划归档到 completed。

## Smoke Ledger

- Targeted：4 个文件、21 项测试通过；Virtuoso 索引调整后 2 个文件、11 项测试通过。
- `npm run test`：151 个测试文件、706 项测试通过。
- `npm run build`：生产构建通过。
- `npm run test:smoke`：隔离 `CODEX_HOME` 的 bridge、模型列表和账号来源验证通过。
- 长历史触发路径：120 个 turn 的任务通过 CDP 深链到首轮助手消息，加载 240 条消息；目标位于视口 140–287px，底部锁定为 inactive。
- 普通路径反例：同一任务无目标参数时只加载 60 条消息，首轮消息不在 DOM，底部锁定为 `active-pinned`。
- 存储失败反例：续接引用写入抛出 `QuotaExceededError` 后，仍从父任务跳转到已创建的新任务。
- 命名失败反例：单元测试确认继续保存引用并执行导航；fork 失败接线显示 `error.sessionCreateFailed`。
