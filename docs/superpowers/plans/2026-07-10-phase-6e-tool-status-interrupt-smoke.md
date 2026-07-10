# Phase 6E 工具状态与中断反例验证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 页面刷新后能从 app-server 最新历史 turn 恢复 interrupted notice，并用确定性测试和隔离环境真实浏览器验证普通、success、failed、interrupted 四类路径。

**Architecture:** `active-turn-visibility-adapter` 只负责根据实时 turn、Thread metadata 和最新历史 turn snapshot 决定可见 turn/notice。`thread-turns-page-adapter` 负责按明确排序方向提取最新历史 turn snapshot；`/chat/[id]` 保存 snapshot 并传给 selector。浏览器验证复用现有 UI 和 CDP，不引入 Playwright npm 依赖。

**Tech Stack:** Next.js、React、TypeScript、Vitest、Codex app-server generated v2 schema、Playwright MCP/CDP、现有 Web bridge smoke。

## Global Constraints

- 官方 `codex-rs/tui` 是产品行为和业务语义基准。
- `interrupted` 是 turn 级状态，不得写成工具 item 的 cancelled/interrupted 状态。
- 主路径 source breadcrumb 必须是 `app-server.thread/turns/list`；fallback 才是 `app-server.thread/read`。
- 不得向历史 transcript 注入伪 assistant 中断消息。
- 不新增 turn-status UI 组件，复用现有 `appServerNotice -> ChatView -> ErrorBanner`。
- 不引入新的 Playwright npm 依赖或持久 E2E runner。
- 开发、测试、smoke 和真实浏览器验证必须显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- Node 命令必须显式使用 `NODE_HOME=/volume2/SSD/node-v24.14.0` 并把 `$NODE_HOME/bin` 放进 `PATH`。
- 构建后必须检查并恢复 `next-env.d.ts` 到 `./.next/dev/types/routes.d.ts`。
- 不得执行删除命令；浏览器工具若生成 `.playwright-mcp`，必须先列出拟移动清单并等待用户确认后才能移动到 `/volume2/SSD/Trash/`。
- Commit message 使用中文说明。

---

## File Structure

- Modify: `src/codex-web/active-turn-visibility-adapter.ts`
  - 定义最新历史 turn snapshot 类型。
  - 根据 interrupted / inProgress / completed 返回来源明确的 notice。
- Modify: `src/codex-web/active-turn-visibility-adapter.test.ts`
  - 覆盖 interrupted notice、真实 source breadcrumb、旧 interrupted 不误报和实时状态优先级。
- Modify: `src/codex-web/thread-turns-page-adapter.ts`
  - 按 `asc/desc` 明确排序方向提取最新历史 turn snapshot。
- Modify: `src/codex-web/thread-turns-page-adapter.test.ts`
  - 覆盖 desc 第一项、asc 最后一项和空 page。
- Modify: `src/app/chat/[id]/page.tsx`
  - 保存最新历史 turn snapshot。
  - 分页主路径和 fallback 分别记录真实 source。
  - 把 snapshot 传给 `selectVisibleActiveTurn()`。
- Modify: `docs/exec-plans/active/web-mvp-phase-0-4.md`
  - 新增 Phase 6E checklist、验证结果和 Smoke Ledger。

---

### Task 1: 扩展 active turn visibility selector

**Files:**
- Modify: `src/codex-web/active-turn-visibility-adapter.ts`
- Modify: `src/codex-web/active-turn-visibility-adapter.test.ts`

**Interfaces:**
- Consumes:
  - `TurnStatus` from `@/codex/protocol/generated/v2/TurnStatus`
  - 现有 `AppServerTurnState`
  - 现有 `Thread`
- Produces:
  - `HistoryTurnStatusSource = "app-server.thread/turns/list" | "app-server.thread/read"`
  - `LatestHistoryTurn = { status: TurnStatus; source: HistoryTurnStatusSource }`
  - `selectVisibleActiveTurn({ activeTurn, routeThreadId, resumedThreadId, thread, latestHistoryTurn })`

- [x] **Step 1: Add failing selector tests**

Add these tests to `src/codex-web/active-turn-visibility-adapter.test.ts`:

```ts
it("刷新后最新历史 turn interrupted 时返回来源明确的中断提示", () => {
  const result = selectVisibleActiveTurn({
    activeTurn: null,
    routeThreadId: "thread-a",
    thread: createThreadFixture(),
    latestHistoryTurn: {
      status: "interrupted",
      source: "app-server.thread/turns/list",
    },
  });

  expect(result.visibleTurn).toBeNull();
  expect(result.notice).toEqual({
    message: "Codex 已中断",
    description:
      "此状态来自 app-server.thread/turns/list 的最新 turn；可以继续发送下一轮。",
  });
});

it("fallback interrupted notice 使用 thread/read breadcrumb", () => {
  const result = selectVisibleActiveTurn({
    activeTurn: null,
    routeThreadId: "thread-a",
    thread: createThreadFixture(),
    latestHistoryTurn: {
      status: "interrupted",
      source: "app-server.thread/read",
    },
  });

  expect(result.notice?.description).toContain("app-server.thread/read");
});

it("最新历史 turn completed 时不显示旧中断提示", () => {
  expect(
    selectVisibleActiveTurn({
      activeTurn: null,
      routeThreadId: "thread-a",
      thread: createThreadFixture({
        turns: [
          createTurnFixture("interrupted", 10),
          createTurnFixture("completed", 20),
        ],
      }),
      latestHistoryTurn: {
        status: "completed",
        source: "app-server.thread/read",
      },
    }),
  ).toEqual({ visibleTurn: null, notice: null });
});

it("实时 interrupted turn 优先作为 visibleTurn，不重复显示历史 notice", () => {
  const activeTurn = {
    ...createStartingTurnState(),
    status: "interrupted" as const,
    threadId: "thread-a",
    turnId: "turn-live",
  };

  expect(
    selectVisibleActiveTurn({
      activeTurn,
      routeThreadId: "thread-a",
      latestHistoryTurn: {
        status: "interrupted",
        source: "app-server.thread/turns/list",
      },
    }),
  ).toEqual({ visibleTurn: activeTurn, notice: null });
});

it("thread status active 时优先显示运行中 degraded notice", () => {
  const result = selectVisibleActiveTurn({
    activeTurn: null,
    routeThreadId: "thread-a",
    thread: createThreadFixture({
      status: { type: "active", activeFlags: [] },
    }),
    latestHistoryTurn: {
      status: "interrupted",
      source: "app-server.thread/turns/list",
    },
  });

  expect(result.notice?.message).toBe("此会话可能仍在运行");
});
```

Add this fixture helper:

```ts
function createTurnFixture(status: Turn["status"], startedAt: number): Turn {
  return {
    id: `turn-${startedAt}`,
    items: [],
    itemsView: "full",
    status,
    error: null,
    startedAt,
    completedAt: status === "inProgress" ? null : startedAt + 1,
    durationMs: status === "inProgress" ? null : 1000,
  };
}
```

Add the import:

```ts
import type { Turn } from "@/codex/protocol/generated/v2/Turn";
```

- [x] **Step 2: Run selector tests and verify failure**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/active-turn-visibility-adapter.test.ts
```

Expected: FAIL because `latestHistoryTurn` is not accepted and interrupted history notice is not implemented.

- [x] **Step 3: Implement latest history notice semantics**

Modify `src/codex-web/active-turn-visibility-adapter.ts`:

```ts
import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import type { TurnStatus } from "@/codex/protocol/generated/v2/TurnStatus";
import type { AppServerTurnState } from "./turn-reducer";

export type HistoryTurnStatusSource =
  | "app-server.thread/turns/list"
  | "app-server.thread/read";

export type LatestHistoryTurn = {
  status: TurnStatus;
  source: HistoryTurnStatusSource;
};
```

Extend the selector parameter:

```ts
export function selectVisibleActiveTurn(params: {
  activeTurn: AppServerTurnState | null;
  routeThreadId: string;
  resumedThreadId?: string | null;
  thread?: Thread | null;
  latestHistoryTurn?: LatestHistoryTurn | null;
}): ActiveTurnVisibility {
  const { activeTurn, routeThreadId, resumedThreadId, thread, latestHistoryTurn } = params;
```

Replace calls to `selectThreadReadDegradedNotice(thread)` with:

```ts
selectHistoryNotice(thread, latestHistoryTurn)
```

Use this history notice helper:

```ts
function selectHistoryNotice(
  thread?: Thread | null,
  latestHistoryTurn?: LatestHistoryTurn | null,
): ActiveTurnVisibility {
  const suggestsRunning =
    latestHistoryTurn?.status === "inProgress" ||
    (!!thread && threadReadSuggestsRunning(thread));
  if (suggestsRunning) {
    return {
      visibleTurn: null,
      notice: {
        message: "此会话可能仍在运行",
        description:
          `页面刷新后没有可复用的实时 notification 流；当前提示来自 ${
            latestHistoryTurn?.status === "inProgress"
              ? latestHistoryTurn.source
              : "app-server.thread/read"
          }，Web 不会伪造实时输出。`,
      },
    };
  }

  if (latestHistoryTurn?.status === "interrupted") {
    return {
      visibleTurn: null,
      notice: {
        message: "Codex 已中断",
        description:
          `此状态来自 ${latestHistoryTurn.source} 的最新 turn；可以继续发送下一轮。`,
      },
    };
  }

  return { visibleTurn: null, notice: null };
}
```

Keep current priority:

```ts
if (activeTurn.threadId === routeThreadId || activeTurn.threadId === resumedThreadId) {
  return { visibleTurn: activeTurn, notice: null };
}
```

This ensures a current visible real turn wins over historical notice.

- [x] **Step 4: Run selector tests**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/active-turn-visibility-adapter.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit Task 1**

Run:

```bash
git add src/codex-web/active-turn-visibility-adapter.ts src/codex-web/active-turn-visibility-adapter.test.ts
git commit -m "fix: 恢复刷新后的中断状态提示"
```

Expected: commit succeeds.

---

### Task 2: 从历史分页提取最新 turn 并接入页面

**Files:**
- Modify: `src/codex-web/thread-turns-page-adapter.ts`
- Modify: `src/codex-web/thread-turns-page-adapter.test.ts`
- Modify: `src/app/chat/[id]/page.tsx`

**Interfaces:**
- Consumes:
  - `LatestHistoryTurn`
  - `HistoryTurnStatusSource`
  - `Turn[]`
  - `SortDirection`
- Produces:
  - `latestHistoryTurnFromPage(turns, sortDirection, source): LatestHistoryTurn | null`
  - `/chat/[id]` state `latestHistoryTurn`

- [x] **Step 1: Add failing page-adapter tests**

Add imports to `src/codex-web/thread-turns-page-adapter.test.ts`:

```ts
import {
  latestHistoryTurnFromPage,
  mergeThreadTurnMessages,
  threadTurnsPageToMessages,
} from "./thread-turns-page-adapter";
```

Add these tests:

```ts
it("desc page 第一项是最新历史 turn", () => {
  const latest = latestHistoryTurnFromPage(
    [
      { ...createTurn("turn-3", "user-3", "third", 30), status: "interrupted" },
      createTurn("turn-2", "user-2", "second", 20),
    ],
    "desc",
    "app-server.thread/turns/list",
  );

  expect(latest).toEqual({
    status: "interrupted",
    source: "app-server.thread/turns/list",
  });
});

it("asc page 最后一项是最新历史 turn", () => {
  const latest = latestHistoryTurnFromPage(
    [
      { ...createTurn("turn-1", "user-1", "first", 10), status: "interrupted" },
      createTurn("turn-2", "user-2", "second", 20),
    ],
    "asc",
    "app-server.thread/read",
  );

  expect(latest).toEqual({
    status: "completed",
    source: "app-server.thread/read",
  });
});

it("空 turns page 没有最新历史状态", () => {
  expect(
    latestHistoryTurnFromPage([], "desc", "app-server.thread/turns/list"),
  ).toBeNull();
});
```

- [x] **Step 2: Run page-adapter tests and verify failure**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/thread-turns-page-adapter.test.ts
```

Expected: FAIL because `latestHistoryTurnFromPage` does not exist.

- [x] **Step 3: Implement latest turn extraction**

Modify `src/codex-web/thread-turns-page-adapter.ts`:

```ts
import type {
  HistoryTurnStatusSource,
  LatestHistoryTurn,
} from "./active-turn-visibility-adapter";
```

Add:

```ts
export function latestHistoryTurnFromPage(
  turns: Turn[],
  sortDirection: SortDirection,
  source: HistoryTurnStatusSource,
): LatestHistoryTurn | null {
  const latestTurn =
    sortDirection === "desc" ? turns[0] : turns[turns.length - 1];
  if (!latestTurn) return null;

  return {
    status: latestTurn.status,
    source,
  };
}
```

- [x] **Step 4: Wire `/chat/[id]` state**

Modify `src/app/chat/[id]/page.tsx` imports:

```ts
import type { LatestHistoryTurn } from "@/codex-web/active-turn-visibility-adapter";
import {
  latestHistoryTurnFromPage,
  mergeThreadTurnMessages,
  threadTurnsPageToMessages,
} from "@/codex-web/thread-turns-page-adapter";
```

Add state:

```ts
const [latestHistoryTurn, setLatestHistoryTurn] = useState<LatestHistoryTurn | null>(null);
```

Reset it when route changes:

```ts
setLatestHistoryTurn(null);
```

After the initial desc page succeeds:

```ts
setLatestHistoryTurn(
  latestHistoryTurnFromPage(
    turnsPage.data,
    "desc",
    "app-server.thread/turns/list",
  ),
);
```

After fallback full thread succeeds or remains metadata-only:

```ts
setLatestHistoryTurn(
  latestHistoryTurnFromPage(
    fallbackThread.turns,
    "asc",
    "app-server.thread/read",
  ),
);
```

Pass it to the selector:

```ts
const activeTurnVisibility = isAppServerThread
  ? selectVisibleActiveTurn({
      activeTurn: activeAppServerTurn,
      routeThreadId: id,
      resumedThreadId,
      thread: appServerThread,
      latestHistoryTurn,
    })
  : { visibleTurn: null, notice: null };
```

Do not update `latestHistoryTurn` when loading earlier pages. Earlier pages cannot replace the latest status from the initial desc page.

- [x] **Step 5: Run targeted tests**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/thread-turns-page-adapter.test.ts
npm run test -- src/codex-web/active-turn-visibility-adapter.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit Task 2**

Run:

```bash
git add src/codex-web/thread-turns-page-adapter.ts src/codex-web/thread-turns-page-adapter.test.ts src/app/chat/[id]/page.tsx
git commit -m "fix: 接入历史最新 turn 状态来源"
```

Expected: commit succeeds.

---

### Task 3: 全量验证、真实浏览器和执行记录

**Files:**
- Modify: `docs/exec-plans/active/web-mvp-phase-0-4.md`
- Check: `next-env.d.ts`
- Possible generated artifact: `.playwright-mcp/`

**Interfaces:**
- Consumes:
  - Task 1-2 commits.
  - Existing `npm run dev`, `npm run test`, `npm run build`, `npm run test:smoke`.
- Produces:
  - Phase 6E verification ledger.
  - Real browser observations for ordinary/success/failed/interrupted.

- [x] **Step 1: Run targeted status regression tests**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/active-turn-visibility-adapter.test.ts
npm run test -- src/codex-web/thread-turns-page-adapter.test.ts
npm run test -- src/codex-web/tool-item-adapter.test.ts
npm run test -- src/codex-web/tool-adapter.test.ts
```

Expected: all targeted tests PASS.

- [x] **Step 2: Run full verification**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run build
npm run test:smoke
```

Expected:

- `npm run test`: PASS.
- `npm run build`: PASS; existing Turbopack NFT trace warning may remain.
- `npm run test:smoke`: bridge bootstrap PASS and reports the isolated CODEX_HOME.

- [x] **Step 3: Restore `next-env.d.ts` if Next rewrites it**

Run:

```bash
git diff -- next-env.d.ts
```

Expected: no diff. If the import changed to:

```ts
import "./.next/types/routes.d.ts";
```

restore it to:

```ts
import "./.next/dev/types/routes.d.ts";
```

Use `apply_patch`; do not include generated Next changes in the commit.

- [x] **Step 4: Start the isolated dev server**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run dev
```

Expected: the terminal prints the localhost URL and bridge/app-server startup succeeds. Keep the session open until browser validation finishes.

- [x] **Step 5: Validate ordinary message in the real browser**

Use Playwright MCP with CDP endpoint `http://192.168.3.12:45737`.

Open the dev server `/chat` route and send:

```text
请只回复：phase6e-plain
```

Expected:

- Assistant responds with `phase6e-plain`.
- No tool group/header appears for this turn.
- Browser console has no new errors or warnings.

- [x] **Step 6: Validate success command**

Start a new chat and send:

```text
请运行命令：printf 'phase6e-success\n'
```

If command approval appears, approve it using the visible app-server approval UI.

Expected:

- A terminal tool cell appears.
- Completed header is success (`已运行`), not `运行失败`.
- Expanding the tool group shows `phase6e-success`, `status: completed` and `exit code: 0`.

- [x] **Step 7: Validate failed command**

Start a new chat and send:

```text
请运行命令：sh -c 'echo phase6e-failed >&2; exit 7'
```

If command approval appears, approve it.

Expected:

- A terminal tool cell appears.
- Completed header is `运行失败`.
- Expanding the tool group shows `phase6e-failed` and `exit code: 7`.
- The page remains usable after the failed tool result.

- [x] **Step 8: Validate interrupted and refreshed history**

Start a new chat and send:

```text
请运行命令：sleep 60
```

After the command starts, click the existing stop control.

Expected before refresh:

- UI shows `Codex 已中断` or `Codex 已中断。可以继续发送下一轮。`.
- The tool item is not relabeled as tool interrupted/cancelled.
- Capture the resulting `/chat/<thread-id>` route.

Reload or reopen the same history route.

Expected after refresh:

- An `ErrorBanner` shows message `Codex 已中断`.
- Description contains the actual source breadcrumb:
  - normal paginated path: `app-server.thread/turns/list`
  - fallback path: `app-server.thread/read`
- Composer remains usable for the next turn.
- Browser console has no new errors or warnings.

- [x] **Step 9: Stop the dev server and inspect browser artifacts**

Stop the dev server cleanly with `Ctrl+C`.

Run:

```bash
git status --short
find .playwright-mcp -maxdepth 2 -type f -print 2>/dev/null
```

Expected:

- No dev server process remains.
- If `.playwright-mcp` does not exist, continue.
- If `.playwright-mcp` contains files, do not delete or move them automatically. Output a separate “拟执行操作清单”，列出源路径和 `/volume2/SSD/Trash/home/rrssnas/code/codex/web/.playwright-mcp/` 目标路径，等待用户明确同意。

- [x] **Step 10: Update the active execution plan**

Append `## Phase 6E：工具状态与中断反例验证` to `docs/exec-plans/active/web-mvp-phase-0-4.md`:

```md
## Phase 6E：工具状态与中断反例验证

目标：页面刷新后从最新历史 turn 恢复 interrupted notice，并验证普通、success、failed、interrupted 四类路径。

架构：`active-turn-visibility-adapter` 消费 `{ status, source }` 最新历史 turn snapshot；`thread-turns-page-adapter` 按 asc/desc 提取 snapshot；`/chat/[id]` 记录分页主路径或 fallback 的真实 source。

本阶段不做：持久 Playwright E2E runner、伪 assistant 中断消息、工具详情 UI 改版、真实 `CODEX_HOME` 验收。

Checklist:

- [x] 最新历史 turn interrupted 时显示来源明确的 notice。
- [x] interrupted 后有更新 completed turn 时不误报旧中断。
- [x] metadata-first 主路径记录 `app-server.thread/turns/list` breadcrumb。
- [x] fallback 路径记录 `app-server.thread/read` breadcrumb。
- [x] targeted、全量、build、bridge smoke 验证完成。
- [x] 真实浏览器验证普通、success、failed、interrupted 路径，或记录无法触发的具体环境原因。
```

Update backlog rows according to actual results:

```md
| Interrupt | 页面刷新后恢复 interrupted 状态 | Code complete | Phase 6E | 最新历史 turn interrupted 时显示真实 source breadcrumb，不误报旧 interrupted |
| E2E / Smoke | 普通消息 vs 工具消息反例 | Smoke passed | Phase 6E | 普通消息无工具 cell，命令消息才出现工具 cell |
| E2E / Smoke | success vs failed / interrupted 反例 | Smoke passed | Phase 6E | success、failed、interrupted 三类状态均有真实浏览器验证记录 |
```

Only use `Smoke passed` for rows whose real-browser checks actually completed. If an environment dependency blocks a path, keep the row `部分完成` and record the exact blocker.

- [x] **Step 11: Commit Task 3**

Run:

```bash
git add docs/exec-plans/active/web-mvp-phase-0-4.md
git commit -m "docs: 更新 Phase 6E 验证记录"
```

Expected: commit succeeds and `git status --short` is empty after any separately approved browser-artifact cleanup.

---

## Self-Review

Spec coverage:

- 最新 interrupted notice：Task 1 selector 和 tests。
- metadata-first 最新状态与 source：Task 2 page adapter 和 route wiring。
- 旧 interrupted 不误报：Task 1 completed-latest test。
- 普通/success/failed/interrupted：Task 3 deterministic tests and real browser.
- 真实 source breadcrumb：Task 1 types、Task 2 source wiring、Task 3 browser assertions。
- 不引入 Playwright npm dependency：Task 3 only uses existing Playwright MCP/CDP.
- 不伪造 transcript message：implementation only supplies `appServerNotice`.
- Next generated file restoration：Task 3 Step 3.
- Browser artifacts cleanup rules：Task 3 Step 9 requires a separate confirmation.

Type consistency:

- `HistoryTurnStatusSource` and `LatestHistoryTurn` are defined in Task 1.
- `latestHistoryTurnFromPage()` in Task 2 returns the Task 1 type.
- `/chat/[id]` stores and passes the same `LatestHistoryTurn | null`.
- Source strings are exactly `app-server.thread/turns/list` and `app-server.thread/read`.
