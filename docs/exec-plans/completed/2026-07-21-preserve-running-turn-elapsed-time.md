# 运行任务切换后保留动态时间实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 运行任务从左侧切换离开再返回时，“已处理/正在处理”动态时间继续从 app-server Turn 的真实开始时间累计，不从 0 重新计时。

**架构：** `AppServerTurnState` 保存来自 `turn/started`、`turn/start` 和 `thread/resume` 的 `startedAt`，统一转换为浏览器毫秒时间戳。`ChatView` 优先使用该事实源，仅在 app-server 没有提供开始时间时保留本地 pending clock 作为兼容回退。

**技术栈：** React、TypeScript、Codex app-server v2 Turn schema、Vitest、Playwright/Chrome CDP。

## 全局约束

- 所有开发、测试和浏览器验证显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 时间来源必须是 `app-server.turn/started`、`turn/start` 或 `thread/resume`，不得持久化 UI 伪状态。
- 不修改 `/home/rrssnas/code/CodexWeb`，不改整体 UI、文案和布局。
- 不引入依赖，不修改生成的 app-server schema，不自动提交 Git。

---

### Task 1：在活动 Turn 状态保存真实开始时间

**文件：**
- 修改：`src/codex-web/turn-reducer.ts`
- 测试：`src/codex-web/turn-reducer.test.ts`

**接口：**
- 消费：app-server `Turn.startedAt: number | null`，单位 Unix 秒。
- 产出：`AppServerTurnState.startedAtMs?: number`，单位毫秒。

- [x] **Step 1：写失败测试**

```ts
expect(reduceAppServerTurnNotification(createStartingTurnState(), {
  method: "turn/started",
  params: { threadId: "thread-1", turn: { id: "turn-1", startedAt: 1_785_000_000 } },
}).startedAtMs).toBe(1_785_000_000_000);
```

- [x] **Step 2：运行测试确认失败**

运行：`npm exec vitest run src/codex-web/turn-reducer.test.ts`

预期：新增断言因 `startedAtMs` 尚不存在而失败。

- [x] **Step 3：实现最小时间归一化**

```ts
export type AppServerTurnState = {
  startedAtMs?: number;
};

export function turnStartedAtMs(startedAt: unknown): number | undefined {
  const seconds = readFiniteNumber(startedAt);
  return seconds === undefined ? undefined : seconds * 1000;
}
```

`turn/started` 使用该函数写入新 Turn；无效或缺失值保持 `undefined`。

- [x] **Step 4：运行 targeted test 确认通过**

运行：`npm exec vitest run src/codex-web/turn-reducer.test.ts`

预期：通过。

### Task 2：覆盖请求响应与 resume 恢复路径

**文件：**
- 修改：`src/codex-web/AppServerProvider.tsx`
- 修改：`src/codex-web/resumed-turn-hydration.ts`
- 测试：`src/codex-web/resumed-turn-hydration.test.ts`
- 测试：`src/codex-web/app-server-turn-start-wiring.test.ts`

**接口：**
- 消费：`TurnStartResponse.turn.startedAt`、`ThreadResumeResponse.thread.turns[].startedAt`。
- 产出：`createAcceptedTurnState(threadId, turnId, startedAtMs?)`。

- [x] **Step 1：写失败测试**

```ts
expect(activeTurnFromResume(resumeResponse("inProgress"))?.startedAtMs).toBe(1000);
expect(providerSource).toContain("turnStartedAtMs(turnResponse.turn.startedAt)");
```

- [x] **Step 2：运行测试确认失败**

运行：`npm exec vitest run src/codex-web/resumed-turn-hydration.test.ts src/codex-web/app-server-turn-start-wiring.test.ts`

预期：resume 时间断言和 Provider 接线断言失败。

- [x] **Step 3：接入两个开始路径**

```ts
createAcceptedTurnState(threadId, turnId, turnStartedAtMs(turn.startedAt));
```

Provider 使用 `turn/start` 响应，resume hydration 使用最新 in-progress Turn；notification reducer 仍可覆盖同一 Turn 的权威值。

- [x] **Step 4：运行 targeted test 确认通过**

运行：`npm exec vitest run src/codex-web/turn-reducer.test.ts src/codex-web/resumed-turn-hydration.test.ts src/codex-web/app-server-turn-start-wiring.test.ts`

预期：通过。

### Task 3：ChatView 使用 Turn 时间事实源

**文件：**
- 创建：`src/codex-web/app-server-panel-clock.ts`
- 创建：`src/codex-web/app-server-panel-clock.test.ts`
- 修改：`src/components/chat/ChatView.tsx`

**接口：**
- 消费：`turn.startedAtMs`、`turn.durationMs`、本地 pending clock、当前时间。
- 产出：`resolveAppServerPanelStartedAt(turn, localStartedAt, nowMs): number`。

- [x] **Step 1：写任务切换失败测试**

```ts
expect(resolveAppServerPanelStartedAt(
  { status: "running", startedAtMs: 10_000 },
  55_000,
  60_000,
)).toBe(10_000);
```

反例同时断言缺少 `startedAtMs` 时返回 `localStartedAt`，终态仅在缺少开始时间时按 `durationMs` 推导。

- [x] **Step 2：运行测试确认失败**

运行：`npm exec vitest run src/codex-web/app-server-panel-clock.test.ts`

预期：模块尚不存在而失败。

- [x] **Step 3：实现并接入选择器**

```ts
export function resolveAppServerPanelStartedAt(
  turn: AppServerTurnState | null,
  localStartedAt: number,
  nowMs = Date.now(),
): number {
  if (turn?.startedAtMs !== undefined) return turn.startedAtMs;
  if (isTerminal && turn.durationMs !== undefined) return nowMs - turn.durationMs;
  return localStartedAt;
}
```

`ChatView` 调用选择器，切换任务导致组件重新挂载时不再改变同一 Turn 的起点。

- [x] **Step 4：运行 targeted test 确认通过**

运行：`npm exec vitest run src/codex-web/app-server-panel-clock.test.ts src/codex-web/turn-reducer.test.ts src/codex-web/resumed-turn-hydration.test.ts src/codex-web/app-server-turn-start-wiring.test.ts`

预期：通过。

### Task 4：全量与真实浏览器验收

**文件：**
- 更新：`docs/exec-plans/active/2026-07-21-preserve-running-turn-elapsed-time.md`

**接口：**
- 输入：两个任务路由，其中任务 A 的 Turn 保持运行。
- 输出：切回 A 后计时值不小于离开前值，且接近真实 Turn 已运行时长。

- [x] **Step 1：运行完整验证**

运行：`npm run test`、`npm run build`、`npm run test:smoke`。

预期：全部通过；构建警告单独记录。

- [x] **Step 2：执行真实浏览器正例与反例**

正例：任务 A 运行至少 3 秒，记录时间，切换 B 后再切回 A，断言时间继续增加且没有回到 0。

反例：新任务 B 首次运行从自己的起点计时，不继承任务 A 的时间；缺失 app-server 时间戳的 pending 阶段仍显示本地 elapsed。

- [x] **Step 3：更新 Smoke Ledger**

记录 app-server source breadcrumb、切换前后秒数、浏览器 console、测试数量和剩余风险。计划归档移动须先取得用户明确确认。

## Smoke Ledger

- source breadcrumb：运行起点来自 `app-server.turn/started`；`turn/start` response 和 `app-server.thread/resume` 作为同一协议 Turn 的补充水合路径。
- TDD 红灯：4 个定向文件按预期失败，覆盖缺少模块、notification 时间、response 接线和 resume 时间。
- targeted Vitest：4 个测试文件、24 项通过；包含 response/notification 两种事件顺序以及缺失时间戳回退。
- `npm run test`：typecheck 通过；103 个测试文件、498 项测试通过。
- `npm run build`：生产构建通过；仅有既存 Turbopack NFT tracing warning。
- `npm run test:smoke`：通过；隔离 `CODEX_HOME`，models=7，账号来源为 `app-server.account/read`。
- 真实 Chrome/CDP 正例：任务 A 运行中从左侧切换到任务 B，再从左侧切回任务 A；切换前 `14s`，切回后首次读取 `16s`，动态时间连续且未归零。
- 真实 Chrome/CDP 反例：任务 B 没有运行 Turn，未显示任务 A 的动态时间，读取值为 `null`。
- 浏览器诊断：无 Runtime exception；记录 9 条未影响任务切换和计时的资源 404。
- 剩余风险：旧 app-server 若未提供 `Turn.startedAt`，仍使用本地 pending clock；该兼容路径无法跨组件重新挂载保留起点，但当前目标 schema 明确提供 Unix 秒时间戳。
