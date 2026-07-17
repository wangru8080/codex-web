# App Server Turn UI 去重 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 app-server turn 完成后，已完成历史消息与残留实时消息同时展示，导致同一轮出现两个“已处理”区域的问题。

**Architecture:** 保留 app-server notification reducer、消息内容转换和历史恢复链路不变，只新增一个纯函数判断当前 turn 是否仍应作为实时内容展示。判定以 `threadId + turnId` 为边界：终态在历史消息尚未入列前保留实时结果，入列后不再显示实时副本；已经完成的 turn 即使状态迟到回退为 running 也不得重新出现，但新的 running turn 必须正常显示。

**Tech Stack:** React 19、TypeScript 5.9、Vitest 4、Next.js 16、Codex app-server v2 notification。

## Global Constraints

- app-server notification 仍是 UI 事实源，不修改或伪造消息内容。
- 不修改 CodexWeb 既有布局、样式、过程折叠结构和工具 cell。
- 不修改 `/home/rrssnas/code/CodexWeb`。
- 所有测试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- Node 环境显式使用 `NODE_HOME=/volume2/SSD/node-v24.14.0`。
- 不复制、移动、重命名或删除文件；不覆盖已有同名新文件。
- 不自动提交或推送；用户明确要求后再执行 Git 写操作。

---

## 文件结构

- Create: `src/codex-web/live-turn-presentation.ts`：集中定义实时 turn 的稳定 key 与是否展示实时输出的纯函数。
- Create: `src/codex-web/live-turn-presentation.test.ts`：覆盖 running、terminal、迟到状态回退和下一轮 turn 的反例。
- Modify: `src/components/chat/ChatView.tsx`：记录已完成 turn key，并用纯函数统一控制 `isStreaming` 与实时消息面板。
- Modify: `docs/exec-plans/active/2026-07-17-app-server-turn-ui-dedup.md`：同步 checklist、决策日志和 Smoke Ledger。

### Task 1: 用失败测试锁定实时与历史交接边界

**Files:**
- Create: `src/codex-web/live-turn-presentation.test.ts`
- Create: `src/codex-web/live-turn-presentation.ts`

**Interfaces:**
- Consumes: `AppServerTurnState`，来源为 `src/codex-web/turn-reducer.ts`。
- Produces: `appServerTurnPresentationKey(turn)` 和 `shouldPresentAppServerTurnAsStreaming({ turn, localStreaming, finalizedTurnKey })`。

- [x] **Step 1: 编写失败测试**

```ts
it("终态尚未完成历史入列时保留实时结果", () => {
  const turn = { ...createAcceptedTurnState("thread-1", "turn-1"), status: "completed" as const };
  expect(shouldPresentAppServerTurnAsStreaming({
    turn,
    localStreaming: true,
    finalizedTurnKey: "",
  })).toBe(true);
});

it("终态完成历史入列后不再同时展示实时副本", () => {
  const turn = { ...createAcceptedTurnState("thread-1", "turn-1"), status: "completed" as const };
  expect(shouldPresentAppServerTurnAsStreaming({
    turn,
    localStreaming: true,
    finalizedTurnKey: "thread-1:turn-1",
  })).toBe(false);
});

it("同一 turn 完成后即使状态迟到回退也不重新展示", () => {
  const turn = createAcceptedTurnState("thread-1", "turn-1");
  expect(shouldPresentAppServerTurnAsStreaming({
    turn,
    localStreaming: true,
    finalizedTurnKey: "thread-1:turn-1",
  })).toBe(false);
});

it("下一轮 running turn 仍正常展示", () => {
  const turn = createAcceptedTurnState("thread-1", "turn-2");
  expect(shouldPresentAppServerTurnAsStreaming({
    turn,
    localStreaming: false,
    finalizedTurnKey: "thread-1:turn-1",
  })).toBe(true);
});
```

- [x] **Step 2: 运行测试并确认先失败**

Run:

```bash
export NODE_HOME=/volume2/SSD/node-v24.14.0
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npx vitest run src/codex-web/live-turn-presentation.test.ts
```

Expected: FAIL，提示 `live-turn-presentation` 模块或导出尚不存在。

- [x] **Step 3: 实现最小纯函数**

```ts
export function appServerTurnPresentationKey(turn: AppServerTurnState | null): string {
  return turn?.threadId && turn.turnId ? `${turn.threadId}:${turn.turnId}` : "";
}

export function shouldPresentAppServerTurnAsStreaming(args: Args): boolean {
  const key = appServerTurnPresentationKey(args.turn);
  if (key && key === args.finalizedTurnKey) return false;
  return args.localStreaming || args.turn?.status === "running";
}
```

- [x] **Step 4: 运行 targeted test 并确认通过**

Run: 与 Step 2 相同。

Expected: PASS，running、terminal、迟到回退与下一轮反例全部通过。

- [x] **Step 5: 检查变更但不提交**

Run: `git diff -- src/codex-web/live-turn-presentation.ts src/codex-web/live-turn-presentation.test.ts`

Expected: 只有已确认范围内的新纯函数与测试；等待用户另行要求后才提交。

### Task 2: 接入 ChatView 的 turn 完成交接

**Files:**
- Modify: `src/components/chat/ChatView.tsx`
- Test: `src/codex-web/live-turn-presentation.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `appServerTurnPresentationKey()` 与 `shouldPresentAppServerTurnAsStreaming()`。
- Produces: 对同一 turn 只展示一个过程区域；历史消息内容继续由 `appServerTurnToMessageContent()` 生成。

- [x] **Step 1: 用稳定 key 记录已完成 turn**

```ts
const finalizedAppServerTurnKeyRef = useRef("");
```

终态 effect 在追加历史消息之前，将当前 `threadId + turnId` 写入该 ref。

- [x] **Step 2: 统一实时展示判定**

```ts
const isStreaming = appServerSend
  ? shouldPresentAppServerTurnAsStreaming({
      turn: appServerTurn ?? null,
      localStreaming: appServerLocalStreaming,
      finalizedTurnKey: finalizedAppServerTurnKeyRef.current,
    })
  : legacyIsStreaming;
```

`MessageList` 继续使用 `showStreamingMessage={showAppServerTurnPanel || isStreaming}`，但 app-server 分支的 `showAppServerTurnPanel` 只允许纯函数判定为实时状态的 turn 展示。

- [x] **Step 3: 保持最终消息转换不变**

保留：

```ts
content: appServerTurnToMessageContent(appServerTurn)
```

不修改 process block、tool result、final answer、duration 或 source breadcrumb。

- [x] **Step 4: 运行完整验证**

Run:

```bash
export NODE_HOME=/volume2/SSD/node-v24.14.0
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run build
npm run test:smoke
```

Expected: typecheck、unit、生产构建和 smoke 全部通过；普通 running 路径与 terminal 触发路径结果不同且符合预期。

- [x] **Step 5: 检查变更但不提交**

Run: `git diff --check` 和 `git status --short`。

Expected: 无空白错误、无临时日志或截图进入仓库；等待用户另行要求后才提交。

## 决策日志

- 2026-07-17：给定 JSONL 的首轮只有一个用户请求、一个 `task_started`、一个 `task_complete` 和一个 final answer；持久化 session 没有重复 turn，问题限定为前端实时/历史交接。
- 2026-07-17：不在 reducer 或消息转换层去重，避免误删 commentary、工具结果或 final answer。
- 2026-07-17：使用 `threadId + turnId` 作为完成边界，避免上一轮完成状态影响下一轮。
- 2026-07-17：terminal 在历史消息 effect 尚未入列前继续展示实时结果，避免修复重复时引入一帧空白。

## Smoke Ledger

- 通过（targeted）：7 项纯函数测试覆盖 starting、running、terminal 入列前后、迟到 running、下一轮 turn 和 key 生成。
- 通过（完整测试）：`npm run test` 在允许本地监听的环境中通过，73 个测试文件、332 项测试全部通过。
- 通过（构建）：`npm run build` 完成生产构建；仅保留项目既有的 Turbopack NFT 动态路径 warning。
- 通过（smoke）：`npm run test:smoke` 使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，bridge、7 个模型和 `app-server.account/read` 通过。
- 通过（应用启动）：`npm run dev` 使用隔离 `CODEX_HOME` 启动，Next.js 16.2.10 在 `http://localhost:3000` Ready；验证后进程已停止。
- 反例结果：同一 turn 的迟到 running 被已完成 key 阻止；不同 turnId 的下一轮 running 正常展示；terminal 历史入列前保留实时内容，不出现空白交接。
