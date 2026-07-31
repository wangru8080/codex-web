# 可恢复渲染错误修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 降低聊天页因瞬时子树渲染异常进入全屏错误页的概率，并保留可诊断信息。

**Architecture:** 先复用现有 `ErrorBoundary` 和 React 错误生命周期，不改 app-server 协议。仅针对已知可恢复的 DOM 操作错误延迟自动重试，并为重复失败保留错误详情；通过单元测试验证错误边界分类逻辑。

**Tech Stack:** React、TypeScript、Vitest。

## Global Constraints

- 使用现有依赖，不新增库。
- 修改和注释使用中文。
- 不改变 app-server 数据来源或 approval 流程。

---

### Task 1: 明确并测试可恢复错误分类

**Files:**
- Modify: `src/components/layout/ErrorBoundary.tsx`
- Create: `src/components/layout/tests/error-boundary.test.ts`

- [x] **Step 1: 写失败测试**：覆盖 DOM 操作错误可恢复、普通错误不可自动恢复。
- [x] **Step 2: 运行定向测试**：`npm exec vitest run src/components/layout/tests/error-boundary.test.ts`。
- [x] **Step 3: 提取最小纯函数并复用**：让分类逻辑可测试，保持现有两次自动恢复上限，并清理卸载时的延迟任务。
- [x] **Step 4: 运行定向测试确认通过**。

### Task 2: 回归验证

**Files:**
- No additional files.

- [x] **Step 1:** 运行 `npm run typecheck`。
- [x] **Step 2:** 运行 `npm run test`。
- [x] **Step 3:** 运行 `npm run test:smoke`。
