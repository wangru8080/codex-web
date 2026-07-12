# Phase 6U CollaborationMode 类型兼容收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Phase 6U 的 `collaborationMode` 请求字段从隐式泛型绕行收口为显式 Web 兼容类型。

**Architecture:** 不修改 generated schema，不伪造协议生成结果。新增一个 app-server request override 类型文件，只在 Web 接线层声明当前真实 app-server 已支持但 generated schema 尚未包含的 `collaborationMode` 字段，并让 helper、provider 和测试都依赖这个边界。

**Tech Stack:** TypeScript、React、Vitest、Codex app-server generated schema。

## Global Constraints

- 默认开发、测试、smoke 必须设置 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不直接修改 `/home/rrssnas/code/CodexWeb`。
- 不修改 `src/codex/protocol/generated/**`。
- 不使用本地真实 `CODEX_HOME`。

---

### Task 1: 显式兼容类型和 helper 收口

**Files:**
- Create: `src/codex-web/app-server-request-overrides.ts`
- Modify: `src/codex-web/app-server-collaboration-mode.ts`
- Modify: `src/codex-web/AppServerProvider.tsx`
- Test: `src/codex-web/app-server-collaboration-mode.test.ts`

**Interfaces:**
- Consumes: generated `ThreadStartParams`、`TurnStartParams`、`CollaborationMode`。
- Produces: `ThreadStartParamsWithCollaborationMode`、`TurnStartParamsWithCollaborationMode`、`withPlanCollaborationMode()` 的显式 overload。

- [x] 新增 request override 类型。
- [x] 改 helper 签名，不再暴露 `Record<string, unknown>` 泛型。
- [x] 改 provider 请求变量类型。
- [x] 补测试覆盖 `thread/start` 与 `turn/start` 请求 shape。
- [x] 跑 targeted test 和 full test。
