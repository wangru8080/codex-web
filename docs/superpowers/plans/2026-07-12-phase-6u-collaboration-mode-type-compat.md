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
- [x] 复查当前安装的 `codex-cli 0.144.1` 生成 schema，确认 `ThreadStartParams` / `TurnStartParams` 仍未包含 `collaborationMode`。
- [x] 新增 guardrail test：未来 generated schema 一旦包含 `collaborationMode`，测试失败并提示删除 `app-server-request-overrides.ts`。

## 验证记录

- 2026-07-12：`npm run test -- src/codex-web/app-server-collaboration-mode.test.ts` 通过，1 个测试文件、5 条测试。
- 2026-07-12：`npm run test` 通过，28 个测试文件、143 条测试。
- 2026-07-12：`npm run build` 沙箱内因 Turbopack 绑定端口 `EPERM` 失败，提升权限重跑通过；仅有既有 NFT tracing warning。
- 2026-07-12：`npm run test:smoke` 沙箱内因 `tsx` IPC pipe listen `EPERM` 失败，提升权限重跑通过；`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=7，accountSource=`app-server.account/read`。
- 2026-07-12：`codex --version` 返回 `codex-cli 0.144.1`；使用 `codex app-server generate-ts --out /volume2/SSD/codex/Temp/codex-schema-probe-phase6v` 生成 598 个临时 schema 文件，`collaborationMode` 仍只出现在 `ThreadSettings.ts`，未进入 `ThreadStartParams.ts` / `TurnStartParams.ts`。
- 2026-07-12：新增 `src/codex-web/app-server-request-overrides.test.ts`，锁定当前 generated schema lag；后续 schema 更新后该测试会主动提示删除兼容层。

## Review 记录

- 2026-07-12：最终 review 确认兼容类型只位于 Web app-server 接线层，没有修改 `src/codex/protocol/generated/**`。
- 2026-07-12：后续删除路径明确：当 generated schema 在 `ThreadStartParams` / `TurnStartParams` 中包含 `collaborationMode` 时，删除 `src/codex-web/app-server-request-overrides.ts`，并把 helper 返回类型切回 generated params。
- 2026-07-12：Phase 6V 复查结论：当前 app-server 仍处于 schema lag，不能删除兼容层；兼容层升级为有测试保护的长期 guardrail。
