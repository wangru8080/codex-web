# Phase 6F 工具历史 fallback 与独立工具验证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 确认并修复 `thread/read` fallback 历史页的工具 cell 展示；如果 app-server 历史不含工具 item，则明确降级并用独立浏览器路径验证常见工具类别。

**Architecture:** 先用只读 protocol probe 观察真实 `Thread.turns[].items`，再决定是否修复 `thread-history-adapter` / `MessageItem` 历史工具展示。工具 UI 继续复用 CodexWeb `ProcessCollapseGroup` 和 `ToolActionsGroup`，所有状态来自 app-server `ThreadItem`，不从 assistant 文本推断。

**Tech Stack:** Next.js、React、TypeScript、Vitest、Codex app-server generated v2 schema、现有 Web bridge、Playwright MCP/CDP。

## Global Constraints

- 官方 `codex-rs/tui` 是产品行为和业务语义基准。
- 当前项目 Web UI 必须保持 CodexWeb 既有 UI 风格，不新增平行工具 UI。
- app-server notification / request response 是事实源；不得伪造工具状态。
- 历史没有工具 item 时，不得从 assistant 汇总文本解析出伪 tool cell。
- 开发、测试、smoke 和真实浏览器验证必须显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- Node 命令必须显式使用 `NODE_HOME=/volume2/SSD/node-v24.14.0` 并把 `$NODE_HOME/bin` 放进 `PATH`。
- 构建后必须检查并恢复 `next-env.d.ts` 到 `./.next/dev/types/routes.d.ts`。
- 不得执行删除命令；测试或浏览器工具生成文件只允许在单独确认后移动到 `/volume2/SSD/Trash/` 并保留原层级。
- Commit message 使用中文说明。

---

## File Structure

- Create: `scripts/inspect-thread-items.ts`
  - 只读连接 app-server，读取指定 thread，输出 turn/item 类型摘要；用于 Phase 6F 观察，不保存临时 JSON。
- Modify: `src/codex-web/thread-history-adapter.ts`
  - 如果真实历史包含工具 item，则补充历史 process summary block 或 source metadata，保证历史工具 process 稳定渲染。
- Modify: `src/codex-web/thread-history-adapter.test.ts`
  - 覆盖 command success/failed、fileChange、MCP、dynamic/collab 历史 blocks 与 summary。
- Possible Create: `src/components/chat/MessageItem.test.tsx`
  - 如果当前渲染层缺少测试，新增最小测试覆盖 JSON tool blocks 被渲染为历史工具 group。
- Modify: `docs/exec-plans/active/web-mvp-phase-0-4.md`
  - 更新 Phase 6F 记录、Backlog 和 Smoke Ledger。

---

### Task 1: 协议观察脚本和真实 fallback 数据判定

**Files:**
- Create: `scripts/inspect-thread-items.ts`
- Modify: `docs/exec-plans/active/web-mvp-phase-0-4.md`

**Interfaces:**
- Consumes:
  - CLI args: `threadId` as `process.argv[2]`
  - `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`
- Produces:
  - Console summary with `thread.id`, `turns.length`, each `turn.status`, each item `type/status/id`.

- [x] **Step 1: Write the read-only inspection script**

Create `scripts/inspect-thread-items.ts`:

```ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

type JsonRpcMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

const threadId = process.argv[2];
if (!threadId) {
  console.error("Usage: tsx scripts/inspect-thread-items.ts <thread-id>");
  process.exit(1);
}

const codexHome = process.env.CODEX_HOME;
if (!codexHome) {
  console.error("CODEX_HOME is required");
  process.exit(1);
}

let nextId = 1;
const pending = new Map<number, (message: JsonRpcMessage) => void>();

const child = spawn("codex", ["app-server", "--stdio"], {
  env: {
    ...process.env,
    CODEX_HOME: codexHome,
    RUST_LOG: process.env.RUST_LOG ?? "warn",
  },
  stdio: ["pipe", "pipe", "inherit"],
});

const rl = createInterface({ input: child.stdout });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line) as JsonRpcMessage;
  if (typeof message.id === "number") {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  }
});

function request(method: string, params?: unknown): Promise<unknown> {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    pending.set(id, (message) => {
      if (message.error) reject(new Error(message.error.message ?? "app-server request failed"));
      else resolve(message.result);
    });
  });
}

function notify(method: string, params?: unknown) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

type ThreadItemSummary = {
  id?: string;
  type?: string;
  status?: string;
  command?: string;
  server?: string;
  tool?: string;
};

function summarizeItem(item: Record<string, unknown>): ThreadItemSummary {
  return {
    id: typeof item.id === "string" ? item.id : undefined,
    type: typeof item.type === "string" ? item.type : undefined,
    status: typeof item.status === "string" ? item.status : undefined,
    command: typeof item.command === "string" ? item.command : undefined,
    server: typeof item.server === "string" ? item.server : undefined,
    tool: typeof item.tool === "string" ? item.tool : undefined,
  };
}

try {
  const initialize = await request("initialize", {
    clientInfo: { name: "codex-web-phase6f-inspector", version: "0.0.0" },
  });
  notify("initialized");
  const response = await request("thread/read", { threadId, includeTurns: true });
  const thread = (response as { thread?: { id: string; turns?: Array<Record<string, unknown>> } }).thread;
  if (!thread) throw new Error("thread/read returned no thread");

  console.log(`thread=${thread.id}`);
  console.log(`turns=${thread.turns?.length ?? 0}`);
  for (const [turnIndex, turn] of (thread.turns ?? []).entries()) {
    const items = Array.isArray(turn.items) ? turn.items as Array<Record<string, unknown>> : [];
    console.log(`turn[${turnIndex}] id=${String(turn.id)} status=${String(turn.status)} items=${items.length}`);
    for (const [itemIndex, item] of items.entries()) {
      console.log(`  item[${itemIndex}] ${JSON.stringify(summarizeItem(item))}`);
    }
  }
  console.log(`initialize=${JSON.stringify(initialize)}`);
} finally {
  child.kill();
}
```

- [x] **Step 2: Run inspector against the Phase 6E browser thread**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm exec tsx scripts/inspect-thread-items.ts 019f4a15-70d7-7d02-93e9-1b780fefab7f
```

Expected:

- PASS if it prints turn/item summaries.
- Record whether item types include `commandExecution`, `fileChange`, `mcpToolCall`, `dynamicToolCall`, or `collabAgentToolCall`.

- [x] **Step 3: Update active plan with observation result**

Append a Phase 6F observation note to `docs/exec-plans/active/web-mvp-phase-0-4.md`.

If the inspector output contains tool items, write this concrete form and include the observed item types:

```md
## Phase 6F：工具历史 fallback 与独立工具验证

Phase 6F 记录：

- 2026-07-10：使用 `scripts/inspect-thread-items.ts` 在隔离 `CODEX_HOME` 下读取 Phase 6E thread `019f4a15-70d7-7d02-93e9-1b780fefab7f`，确认 `thread/read(includeTurns:true)` 返回可恢复工具 item；观察到的 item types 包括 `userMessage`、`commandExecution`、`agentMessage`。
```

If the inspector output does not contain any tool item, write this concrete form:

```md
- 2026-07-10：该 fallback 历史只含 `userMessage` / `agentMessage`，不含可恢复的工具 item；Web 不从 assistant 汇总文本伪造工具 cell，Phase 6F 后续转为独立工具验证。
```

- [x] **Step 4: Commit Task 1**

Run:

```bash
git add scripts/inspect-thread-items.ts docs/exec-plans/active/web-mvp-phase-0-4.md
git commit -m "docs: 记录 Phase 6F 工具历史观察"
```

Expected: commit succeeds.

---

### Task 2: 历史工具 block 一致性修复

**Files:**
- Modify: `src/codex-web/thread-history-adapter.ts`
- Modify: `src/codex-web/thread-history-adapter.test.ts`
- Possible Create: `src/components/chat/MessageItem.test.tsx`

**Interfaces:**
- Consumes:
  - `threadToMessages(thread: Thread): ThreadMessagesResult`
  - `MessageItem` JSON block parser behavior.
- Produces:
  - Assistant history messages containing `tool_use`, `tool_result`, and `codex_summary` when a turn has tool/process blocks.

- [ ] **Step 1: Add failing summary metadata test**

Add this test to `src/codex-web/thread-history-adapter.test.ts`:

```ts
it("历史工具 turn 添加 process summary，便于 MessageItem 稳定显示折叠过程区", () => {
  const result = threadToMessages(createThread());
  const assistantContent = JSON.parse(result.messages[1].content);

  expect(assistantContent).toContainEqual({
    type: "codex_summary",
    elapsed_ms: 3000,
    process_count: 1,
  });
});
```

Expected current failure: no `codex_summary` block.

- [ ] **Step 2: Implement summary block only for process content**

Modify `threadToMessages()` in `src/codex-web/thread-history-adapter.ts`:

```ts
    if (assistantBlocks.length > 0) {
      const hasProcessBlocks = assistantBlocks.some(
        (block) => block.type === "tool_use" || block.type === "tool_result",
      );
      const contentBlocks = hasProcessBlocks
        ? [
            ...assistantBlocks,
            {
              type: "codex_summary" as const,
              elapsed_ms: turn.durationMs ?? undefined,
              process_count: assistantBlocks.filter((block) => block.type === "tool_use").length,
            },
          ]
        : assistantBlocks;
      messages.push(
        createMessage(
          thread,
          turn,
          assistantMessageId ?? `${turn.id}-assistant-history`,
          "assistant",
          JSON.stringify(contentBlocks),
        ),
      );
    }
```

Keep text-only assistant messages unchanged except for existing JSON structure.

- [ ] **Step 3: Run history adapter tests**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/thread-history-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 4: Add render-layer test only if parser regression is suspected**

If Task 1 or browser inspection shows `threadToMessages()` produces tool blocks but UI still hides them, create `src/components/chat/MessageItem.test.tsx` with a minimal render test that passes a saved assistant message containing `tool_use` / `tool_result` JSON and asserts `已运行` appears.

If Vitest project currently lacks React DOM test setup, do not add a new test harness in this task; record the gap and rely on browser validation.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/codex-web/thread-history-adapter.ts src/codex-web/thread-history-adapter.test.ts src/components/chat/MessageItem.test.tsx
git commit -m "fix: 稳定历史工具过程摘要"
```

If `MessageItem.test.tsx` was not created, omit it from `git add`.

Expected: commit succeeds.

---

### Task 3: 独立工具路径真实浏览器验证

**Files:**
- Modify: `docs/exec-plans/active/web-mvp-phase-0-4.md`
- Possible generated artifact: `.playwright-mcp/`
- Possible test-created file: a small file under `/volume2/SSD/codex/Temp/` or repo-controlled test path, only after separate cleanup confirmation.

**Interfaces:**
- Consumes:
  - Existing `npm run dev`
  - Playwright MCP/CDP
- Produces:
  - Smoke Ledger for read/search、web/network、write/fileChange tool paths.

- [x] **Step 1: Run full verification before browser**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run build
git diff -- next-env.d.ts
npm run test:smoke
```

Expected:

- `npm run test`: PASS.
- `npm run build`: PASS; existing Turbopack NFT warning may remain.
- If `next-env.d.ts` changed to `./.next/types/routes.d.ts`, restore it to `./.next/dev/types/routes.d.ts`.
- `npm run test:smoke`: PASS with isolated `CODEX_HOME`.

- [x] **Step 2: Start dev server**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run dev
```

Expected: dev server starts and prints URL.

- [x] **Step 3: Validate file read/search tool path**

In real browser `/chat`, send:

```text
请读取当前仓库的 package.json，只回复 scripts 字段摘要；如果需要运行命令，请使用只读命令。
```

Expected:

- If Codex uses command/read tool, realtime tool cell shows running then completed state.
- No write operation occurs.
- Final answer references `package.json` scripts.
- Console has 0 errors / 0 warnings.

- [x] **Step 4: Validate web/network tool path**

In a new chat, send:

```text
请访问 https://example.com/ 并只回复页面标题或可见的域名；如果网络或权限被限制，请说明真实错误。
```

Expected:

- If approval appears, approve or deny according to visible UI and record decision.
- If network succeeds, realtime tool cell shows success and final answer mentions `Example Domain` or `example.com`.
- If network fails due to sandbox、proxy、账号或权限，record exact visible error; do not count it as UI failure if the tool state and error are visible.

- [x] **Step 5: Validate write/fileChange tool path**

Before running this step, choose a deterministic path under `/volume2/SSD/codex/Temp/phase6f-write-check.txt`.

Send:

```text
请创建或覆盖 /volume2/SSD/codex/Temp/phase6f-write-check.txt，内容只写一行：phase6f-write-ok。完成后只回复写入结果。
```

Expected:

- If approval appears, approve it only for this visible request.
- Tool or fileChange UI shows completed write state.
- Final answer says write completed or reports official denial/error.
- The created file is test artifact. Do not delete it. If cleanup is desired, output a separate “拟执行操作清单” to move it to `/volume2/SSD/Trash/volume2/SSD/codex/Temp/phase6f-write-check.txt` and wait for user confirmation.

- [x] **Step 6: Validate history route after tool turns**

Open or refresh the history route for each tool thread.

Expected:

- If `thread/read` history includes tool items, historical process group remains visible and default collapsed; expanding shows status/source/output.
- If `thread/read` history does not include tool items, no fake tool cell appears; document that only assistant summary is recoverable in fallback.

Observed on 2026-07-10 after completion fix:

- New write thread `/chat/019f4ccb-3432-7692-a164-f631394a66de` restored only the user message and assistant `写入成功` summary.
- No fake tool cell appeared when fallback history did not expose recoverable tool items.
- Page showed `thread/turns/list requires experimentalApi capability` and used the stable fallback path.

- [x] **Step 7: Stop dev server and inspect artifacts**

Stop dev server with `Ctrl+C`.

Run:

```bash
git status --short
find .playwright-mcp -maxdepth 2 -type f -print 2>/dev/null
```

Expected:

- If `.playwright-mcp` contains files, output a separate “拟执行操作清单” to move it to `/volume2/SSD/Trash/home/rrssnas/code/codex/web/.playwright-mcp/` and wait for confirmation.
- If write-check file exists and user wants cleanup, output a separate “拟执行操作清单” for that file.

- [x] **Step 8: Update execution plan and commit**

Update `docs/exec-plans/active/web-mvp-phase-0-4.md` with:

- Phase 6F implementation notes.
- Whether history fallback contains tool items.
- Browser observations for file read/search、web/network、write/fileChange.
- Any environment blockers.

Run:

```bash
git add docs/exec-plans/active/web-mvp-phase-0-4.md
git commit -m "docs: 更新 Phase 6F 工具历史验证"
```

Expected: commit succeeds after approved artifact cleanup.

Follow-up implementation notes on 2026-07-10:

- `turn/start` / `thread/start` Web action semantics now match official TUI: accepted request returns after app-server accepts the turn; terminal state is notification-driven.
- `curl -I https://www.baidu.com/` was rechecked in the browser. Without proxy it failed with DNS resolution; with proxy env it failed to connect to `192.168.3.12:7899` from the app-server command environment. Both errors were visible and no completion timeout occurred.
- Write/fileChange was rechecked in the browser. `Allow Once` created `/volume2/SSD/codex/Temp/phase6f-write-check.txt` with `phase6f-write-ok`, and the page completed with `写入成功`.

---

## Self-Review Checklist

- Spec coverage: Task 1 distinguishes real history item availability; Task 2 fixes history process rendering when item data exists; Task 3 covers independent read/web/write tool validation.
- 占位扫描：没有需要后续猜测的空白项；Task 1 和 Task 3 的观察记录必须来自实际命令和浏览器输出。
- Type consistency: `threadToMessages()` remains the adapter boundary; `codex_summary` matches existing `MessageItem.parseToolBlocks()` fields `elapsed_ms` and `process_count`.
- Cleanup rules: browser and write artifacts require separate confirmation before movement; no delete command is allowed.
