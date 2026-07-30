# 分叉任务标题序号 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一项目内从同名任务分叉时，把新任务持久化命名为 `标题 (2)`、`标题 (3)`、`标题 (4)`。

**Architecture:** 复用 app-server Thread 的 `name || preview` 标题规则，在前端纯函数中按 `cwd` 扫描同项目任务并计算下一序号。`thread/fork` 成功后通过已有 `thread/name/set` 写回新任务标题，app-server 继续作为标题事实源。

**Tech Stack:** React、TypeScript、Codex app-server、Vitest、Playwright MCP。

## Global Constraints

- 不新增第三方依赖或数据库字段。
- 不修改 generated schema 或官方 `~/code/codex`。
- 标题通过 app-server `thread/name/set` 持久化。
- 不同 `cwd` 的同名任务互不影响。

---

### Task 1: 标题序号计算

**Files:**
- Modify: `src/codex-web/thread-history-adapter.ts`
- Test: `src/codex-web/tests/thread-history-adapter.test.ts`

**Interfaces:**
- Consumes: `Thread.name`、`Thread.preview`、`Thread.cwd`。
- Produces: `nextForkedThreadName(sourceThread: Thread, threads: readonly Thread[]): string`。

- [x] 增加基础标题、已有序号、从已编号任务继续分叉、不同项目同名的失败测试。
- [x] 实现最小标题序号计算逻辑。
- [x] 运行 targeted test。

### Task 2: 分叉后持久化标题

**Files:**
- Modify: `src/app/chat/[id]/page.tsx`

**Interfaces:**
- Consumes: `nextForkedThreadName`、`setThreadName`、app-server Thread 列表。
- Produces: 新子任务持久化的 `标题 (N)`。

- [x] 在 `thread/fork` 成功后调用 `thread/name/set`。
- [x] 运行完整测试和生产构建。
- [x] 使用 Playwright MCP + CDP 连续分叉并验证侧栏标题序号。

## 自查

- 覆盖同名序号、子任务再分叉和跨项目反例。
- 不包含占位步骤，不引入新存储层。

## Smoke Ledger

- 普通路径：从未编号父任务连续分叉，得到 `标题 (2)`、`标题 (3)`。
- 触发路径：从 `标题 (2)` 子任务继续分叉，得到 `标题 (4)`，没有生成 `标题 (2) (2)`。
- 反例：单元测试确认其他 `cwd` 的同名任务不参与序号计算，自然标题 `版本 (2026)` 得到 `版本 (2026) (2)`。
- 数据来源：顶部标题和侧栏任务项均来自 app-server `thread/name/set` 后的 Thread 列表。
- 浏览器控制台：功能请求无新增错误；保留既有 `/api/settings/workspace` 404。
