# 终端进程生命周期加固 Implementation Plan

**状态：** Code complete；Tests pass；Smoke passed；Review passed

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 确保右侧终端在启动竞态、标签关闭和浏览器连接断开时不泄漏进程，并在 spawn 完成前安全处理输入。

**Architecture:** bridge 按 Web peer 记录其 `process/spawn` handle，在 peer 断开时通过现有 app-server RPC 发送 `process/kill`。TerminalPanel 使用可测试的会话控制器串行处理 spawn、输入缓冲和 dispose，避免 React effect 中的异步布尔竞态。

**Tech Stack:** TypeScript、React、Codex app-server `process/*`、Vitest。

## Global Constraints

- 默认测试环境使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不修改 `/home/rrssnas/code/codex`，不绕过 Web bridge。
- 不增加依赖，不改变终端 UI 和正常交互语义。
- 所有进程状态继续来自 app-server request/notification。

---

### Task 1: 浏览器终端会话控制器

**Files:**
- Modify: `src/codex-web/process-terminal.ts`
- Modify: `src/components/layout/WorkspaceSidebar/TerminalPanel.tsx`
- Test: `src/codex-web/tests/process-terminal.test.ts`

**Interfaces:**
- Consumes: `spawnProcess`、`writeProcessStdin`、`resizeProcessPty`、`killProcess` actions。
- Produces: `createTerminalProcessSession()`，提供 `start`、`write`、`resize`、`exit`、`dispose`。

- [x] **Step 1: 编写失败测试**

覆盖 spawn 前输入缓冲、dispose 后迟到 spawn 自动 kill、正常运行 dispose kill。

- [x] **Step 2: 运行定向测试确认失败**

Run: `npx vitest run src/codex-web/tests/process-terminal.test.ts`

- [x] **Step 3: 实现最小会话状态机并接入 TerminalPanel**

会话状态只区分 starting/running/exited/disposed；启动前输入按字符串拼接，启动成功后一次写入。

- [x] **Step 4: 运行定向测试确认通过**

Run: `npx vitest run src/codex-web/tests/process-terminal.test.ts`

---

### Task 2: bridge 按 peer 清理进程

**Files:**
- Modify: `server/persistent-app-server.ts`
- Test: `server/tests/websocket-bridge.test.ts`

**Interfaces:**
- Consumes: `process/spawn`、`process/kill` JSON-RPC request 和 `process/exited` notification。
- Produces: peer 到 process handle 的所有权记录；peer detach 后的补偿 kill。

- [x] **Step 1: 编写失败测试**

覆盖 spawn 成功后断开、spawn 请求未完成时断开两条路径，并断言 app-server 收到 `process/kill`。

- [x] **Step 2: 运行定向测试确认失败**

Run: `npx vitest run server/tests/websocket-bridge.test.ts`

- [x] **Step 3: 实现 handle 所有权和断开清理**

spawn 请求发送前登记 handle；spawn 失败或 exited 后释放；peer 断开立即 kill，未决 spawn 成功后再次补偿 kill。

- [x] **Step 4: 运行定向测试确认通过**

Run: `npx vitest run server/tests/websocket-bridge.test.ts`

---

### Task 3: 回归验证与归档

**Files:**
- Modify: `docs/exec-plans/active/2026-08-17-terminal-process-lifecycle-hardening.md`
- Move after pass: `docs/exec-plans/completed/2026-08-17-terminal-process-lifecycle-hardening.md`

- [x] **Step 1: 运行完整验证**

Run: `npm run test`

Run: `npm run build`

- [x] **Step 2: 检查差异和生成物**

Run: `git diff --check && git status --short`

- [x] **Step 3: 更新状态并归档计划**

全部验证通过后将状态标记为 `Tests pass`，记录测试数量，并移动到 completed。

## 验证记录

- 定向回归：`process-terminal.test.ts` 与 `websocket-bridge.test.ts`，共 15 项通过。
- 完整测试：193 个测试文件、941 项测试通过。
- 生产构建：通过，生成 30 条路由，包括 `/chat`、`/workspace/preview`、`/workspace/terminal`。
- bridge smoke：通过，完成 initialize、模型列表与账号状态验证。
- 多用户真实 Chrome smoke：通过，覆盖账号隔离、WebSocket 隔离、runtime 复用与回收、容量限制及配置热加载；使用隔离 `CODEX_HOME`，未使用真实 Codex Home。
- 反例验证：spawn 完成前输入会被缓冲；spawn 未完成时关闭标签会在迟到响应后补偿终止；浏览器断开后所属终端进程会被终止。
