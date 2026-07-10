# Phase 6C Approval Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Codex Web 支持多个 app-server approval request 排队、resolved 移除和精确响应，避免覆盖、串线或重复响应。

**Architecture:** 新增纯函数 approval queue adapter，`AppServerProvider` 维护 `pendingApprovals` 队列并继续派生兼容字段 `pendingApproval`。页面从队列中过滤当前 thread 的 approval，并把 requestId 传回 `respondToApproval(decision, requestId)`。

**Tech Stack:** TypeScript, React, Vitest, Codex app-server JSON-RPC server request, CodexWeb PermissionPrompt.

## Global Constraints

- 默认开发、测试和 smoke 必须显式设置 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- Node 命令必须使用 `NODE_HOME=/volume2/SSD/node-v24.14.0` 并把 `$NODE_HOME/bin` 放入 `PATH`。
- 不修改 `/home/rrssnas/code/CodexWeb`。
- 不改 app-server protocol，不重新生成 schema。
- Commit message 使用中文。

---

### Task 1: Approval Queue Adapter

**Files:**
- Create: `src/codex-web/approval-queue-adapter.ts`
- Create: `src/codex-web/approval-queue-adapter.test.ts`

**Interfaces:**
- Produces: `enqueueApproval(queue, approval): AppServerApprovalRequest[]`
- Produces: `removeApproval(queue, requestId): AppServerApprovalRequest[]`
- Produces: `firstApproval(queue, predicate?)`
- Produces: `approvalRequestMatchesThread(approval, threadIds)`

- [x] **Step 1: 写测试**

测试覆盖入队顺序、重复 requestId 去重、resolved 移除、thread 过滤和按 requestId 查找。

- [x] **Step 2: 实现 adapter**

使用既有 `approvalRequestKey()` 做 requestId 归一化，避免 string/number 串扰。

- [x] **Step 3: 运行 targeted test**

Run: `NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test -- src/codex-web/approval-queue-adapter.test.ts`

Expected: PASS.

### Task 2: Provider Queue 接线

**Files:**
- Modify: `src/codex-web/app-server-state.ts`
- Modify: `src/codex-web/AppServerProvider.tsx`
- Test: existing `src/codex-web` tests plus new adapter tests.

**Interfaces:**
- Consumes: `enqueueApproval`, `removeApproval`, `firstApproval`, `approvalRequestKey`.
- Changes: `respondToApproval(decision, requestId?)`.

- [x] **Step 1: 状态新增 `pendingApprovals`**

`pendingApproval` 保留为兼容字段，始终由 `firstApproval(pendingApprovals)` 派生。

- [x] **Step 2: server request 入队**

收到 approval server request 时追加到队列，重复 requestId 不重复入队，diagnostics 仍记录原始 request。

- [x] **Step 3: resolved 和响应成功后移除**

`serverRequest/resolved` 和 `client.respond()` 成功后都按 requestId 移除队列，并重新派生 `pendingApproval`。

- [x] **Step 4: stale/duplicate 写 diagnostics**

guard 拒绝时写入 `approval response skipped: <reason>`，不调用 `client.respond()`。

### Task 3: 页面按 thread 过滤

**Files:**
- Modify: `src/app/chat/[id]/page.tsx`
- Modify: `src/app/chat/page.tsx`

**Interfaces:**
- Consumes: `approvalRequestMatchesThread`, `firstApproval`.

- [x] **Step 1: 历史页选择当前 thread 的 approval**

从 `appServerState.pendingApprovals` 中选择第一个属于 route thread 或 resumed thread 的 approval。

- [x] **Step 2: 响应当前可见 requestId**

`onAppServerApprovalDecision` 包装为 `respondToApproval(decision, appServerApproval.requestId)`。

- [x] **Step 3: 新 chat 保持全局队首**

新 chat 继续显示 `pendingApproval`，响应时传入当前可见 requestId。

### Task 4: 文档和验证

**Files:**
- Modify: `docs/exec-plans/active/web-mvp-phase-0-4.md`
- Inspect: `next-env.d.ts`

**Interfaces:**
- Produces: Phase 6C 记录和验证结果。

- [x] **Step 1: 更新 active plan**

把 Backlog 中“多个 approval 或过期 approval”标为 `Code complete`，追加 Phase 6C 记录。

- [x] **Step 2: 运行验证**

Run:

```bash
NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test -- src/codex-web/approval-queue-adapter.test.ts
NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test -- src/codex-web
NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test
NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run build
NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test:smoke
```

Expected: all PASS.

- [x] **Step 3: 检查 `next-env.d.ts`**

若 build 自动改写，按用户要求还原，不纳入提交。
