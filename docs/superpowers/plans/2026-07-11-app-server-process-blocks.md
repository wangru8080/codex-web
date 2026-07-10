# App-Server Process Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复 CodexWeb 原有过程块 UI，并让 app-server live、completed 和 history replay 都按官方 TUI 的 ThreadItem 语义展示中间过程。

**Architecture:** 官方 TUI 把 `Reasoning`、`CommandExecution`、`FileChange`、`McpToolCall` 等 ThreadItem 渲染成独立过程 cell，最终 `AgentMessage` 单独作为回答。Web 侧通过一个共享 helper 将 app-server turn 转为 CodexWeb 既有 JSON block 协议，避免 completed turn 被压成纯 final text。

**Tech Stack:** Next.js、React、TypeScript、Vitest、Codex app-server generated protocol types。

## Global Constraints

- 默认使用隔离环境：`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- Node 环境：`NODE_HOME=/volume2/SSD/node-v24.14.0` 并把 `$NODE_HOME/bin` 放入 `PATH`。
- 不改 `/home/rrssnas/code/CodexWeb`。
- 不伪造 app-server 状态；过程块只能来自 app-server notification、ThreadItem 或 turn duration。
- 提交前必须运行实际测试；不得声称未运行的验证通过。

---

### Task 1: app-server initialize capabilities

**Files:**
- Create: `src/codex-web/app-server-capabilities.ts`
- Modify: `src/codex-web/AppServerProvider.tsx`
- Modify: `server/app-server-session.ts`
- Modify: `scripts/inspect-thread-items.ts`
- Test: `server/app-server-session.test.ts`

**Interfaces:**
- Produces: `appServerInitializeCapabilities(): InitializeCapabilities`
- Consumes: generated `InitializeCapabilities`

- [x] **Step 1: Add shared capabilities helper**

Create `src/codex-web/app-server-capabilities.ts`:

```ts
import type { InitializeCapabilities } from "@/codex/protocol/generated/InitializeCapabilities";

export function appServerInitializeCapabilities(): InitializeCapabilities {
  return {
    experimentalApi: true,
    requestAttestation: false,
    mcpServerOpenaiFormElicitation: false,
  };
}
```

- [x] **Step 2: Use helper in all initialize paths**

Replace `capabilities: null` or omitted capabilities in Web bootstrap, server bootstrap, and inspector script with `appServerInitializeCapabilities()`.

- [x] **Step 3: Update bootstrap test**

Expect initialize request params to include `experimentalApi: true` and `requestAttestation: false`.

### Task 2: turn reducer preserves official turn metadata

**Files:**
- Modify: `src/codex-web/turn-reducer.ts`
- Test: `src/codex-web/turn-reducer.test.ts`

**Interfaces:**
- Produces: `AppServerTurnState.durationMs?: number`
- Produces: `AppServerTurnState.reasoningText: string`

- [x] **Step 1: Extend state**

Add `durationMs?: number` and `reasoningText: string` to `AppServerTurnState` and defaults.

- [x] **Step 2: Capture reasoning deltas**

Append `item/reasoning/summaryTextDelta` to `reasoningText`. If raw reasoning is enabled later, the raw text path can be added separately; this task preserves official summary behavior only.

- [x] **Step 3: Capture completed duration**

On `turn/completed`, read `turn.durationMs` and store it if it is a finite number.

### Task 3: shared message block helper

**Files:**
- Create: `src/codex-web/app-server-message-blocks.ts`
- Test: `src/codex-web/app-server-message-blocks.test.ts`

**Interfaces:**
- Consumes: `AppServerTurnState`
- Produces: `appServerTurnToMessageContent(turn: AppServerTurnState): string`
- Produces: `turnItemsToMessageContent(args: { items: ThreadItem[]; assistantText?: string; durationMs?: number; reasoningText?: string }): string`

- [x] **Step 1: Build blocks from ThreadItem**

Emit `thinking` from reasoning summary, `tool_use` and `tool_result` from supported tool items, `codex_summary` from duration/process count, and final `text` from agent message or assistantText.

- [x] **Step 2: Keep final-only turns simple**

If a turn has no reasoning and no tool blocks, return the final answer text instead of JSON so direct answers keep the original simple rendering.

- [x] **Step 3: Test tool turn**

A commandExecution plus final answer must produce JSON blocks containing `tool_use`, `tool_result`, `codex_summary`, and final `text`.

- [x] **Step 4: Test reasoning-only turn**

Reasoning summary plus final answer must produce `thinking`, `codex_summary`, and final `text`.

### Task 4: live completion and history use the same helper

**Files:**
- Modify: `src/app/chat/page.tsx`
- Modify: `src/components/chat/ChatView.tsx`
- Modify: `src/codex-web/thread-history-adapter.ts`
- Test: `src/codex-web/thread-history-adapter.test.ts`

**Interfaces:**
- Consumes: `appServerTurnToMessageContent`
- Consumes: `turnItemsToMessageContent`

- [x] **Step 1: Preserve completed turn process blocks**

In both chat completion effects, store `appServerTurnToMessageContent(appServerTurn)` as assistant message content.

- [x] **Step 2: Preserve history process blocks**

Replace duplicated history block construction with `turnItemsToMessageContent`, passing `turn.items` and `turn.durationMs`.

- [x] **Step 3: Keep interrupted and failed behavior unchanged**

Do not create process blocks for failed or interrupted notices unless app-server provided completed assistant/tool items.

### Task 5: Verification

**Files:**
- Modify: `docs/exec-plans/active/web-mvp-phase-0-4.md`
- Modify: `docs/superpowers/plans/2026-07-10-phase-6f-tool-history-fallback.md`

**Commands:**
- `export NODE_HOME="/volume2/SSD/node-v24.14.0"; export PATH="$NODE_HOME/bin:$PATH"; export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home; npm run test`
- `export NODE_HOME="/volume2/SSD/node-v24.14.0"; export PATH="$NODE_HOME/bin:$PATH"; export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home; npm run build`

**Browser checks:**
- 历史 route 不再出现 `thread/turns/list requires experimentalApi capability`。
- 工具 turn 生成中显示 `正在处理 + 时间 + 工具 cell`。
- 工具 turn 完成后显示 `已处理 + 时间 + 工具 cell`，final answer 保留在过程块下方。
- 普通 final-only 回答不强行显示过程块。

### Task 6: TUI-equivalent in-process replay after session switch

**Files:**
- Modify: `src/codex-web/app-server-state.ts`
- Modify: `src/codex-web/AppServerProvider.tsx`
- Modify: `src/codex-web/thread-turns-page-adapter.ts`
- Modify: `src/app/chat/[id]/page.tsx`
- Test: `src/codex-web/thread-turns-page-adapter.test.ts`

**Interfaces:**
- Produces: `CodexWebAppServerState.turnSnapshots`
- Produces: `applyTurnSnapshotsToMessages(thread, messages, turnSnapshots)`

- [x] **Step 1: Preserve notification-derived turn snapshots in memory**

Store completed/running turn state by `threadId:turnId` in the provider while the browser process is alive. This mirrors official TUI `ThreadEventStore` replay semantics and intentionally does not persist to localStorage or IndexedDB.

- [x] **Step 2: Overlay snapshots on history messages**

When a history route rebuilds messages from `thread/turns/list` or fallback `thread/read`, replace the same turn's assistant message content with `appServerTurnToMessageContent(snapshot)` if a same-process notification snapshot exists.

- [x] **Step 3: Keep refresh behavior official**

After browser refresh there is no Web-side snapshot. The UI only renders what app-server history returns and does not infer tools from final text.

## Verification Log

- 2026-07-11：已运行 targeted tests：`npm run test -- src/codex-web/thread-turns-page-adapter.test.ts src/codex-web/app-server-message-blocks.test.ts src/codex-web/thread-history-adapter.test.ts src/codex-web/turn-reducer.test.ts`，4 个测试文件、22 个测试通过。
- 2026-07-11：已运行 `npm run test`，17 个测试文件、90 个测试通过。
- 2026-07-11：已运行 `npm run build`，构建通过；仍有既有 `next.config.mjs` / `theme/loader.ts` NFT trace warning。构建后已把 `next-env.d.ts` 还原为 `.next/dev/types/routes.d.ts`。
- 2026-07-11：已运行 `npm run test:smoke`，隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，bridge smoke 通过，`models=7`，`accountSource=app-server.account/read`。
- 2026-07-11：真实浏览器回归通过：工具 turn 完成后显示 `已处理 7s`，展开可见 `已运行 /bin/bash -lc ... package.json`，final answer 为 `6`；同一浏览器进程切到其它 session 再切回仍保留过程块；刷新后只显示 app-server 历史可恢复的 final answer，不伪造工具过程；console 0 error / 0 warning。
- 2026-07-11：验证后 `.playwright-mcp` 诊断目录已按用户确认移动到 `/volume2/SSD/Trash/home/rrssnas/code/codex/web/.playwright-mcp-20260711-0244`，保留原路径层级和既有 Trash 同名目录。
