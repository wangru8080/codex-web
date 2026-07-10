# Phase 6D Tool Status Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让实时 turn 和历史 thread 使用同一套 app-server 工具 item 状态映射，覆盖 command、fileChange、MCP、dynamic tool 和 collab tool。

**Architecture:** 新增一个纯数据 adapter，把 generated `ThreadItem` 转成 CodexWeb `tool_use` / `tool_result`。`tool-adapter` 和 `thread-history-adapter` 只负责提供实时或历史上下文，不再各自维护状态判断与结果格式化。

**Tech Stack:** Next.js、TypeScript、Vitest、generated app-server v2 schema、CodexWeb `ToolActionsGroup` 消息块格式。

## Global Constraints

- 官方 `codex-rs/tui` 是产品行为和业务语义基准。
- Web UI 状态必须来自 app-server request、notification 和 server request。
- 不得把 turn 级 `interrupted` 或 cancelled 伪造成工具 item 状态。
- 开发、测试和 smoke 必须显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- Node 命令必须显式使用 `NODE_HOME=/volume2/SSD/node-v24.14.0` 并把 `$NODE_HOME/bin` 放进 `PATH`。
- 输出展示继续使用 Phase 6B 的官方 `DEFAULT_OUTPUT_BYTES_CAP = 1024 * 1024` 截断策略。
- UI 层保持 CodexWeb 现有布局和折叠体验，不搬 Ratatui / Crossterm UI。
- 提交前检查并恢复 `next-env.d.ts`，避免 Next build 改写进入提交。
- Commit message 使用中文说明。

---

## File Structure

- Create: `src/codex-web/tool-item-adapter.ts`
  - 负责识别 generated `ThreadItem` 中的工具 item。
  - 输出 CodexWeb `CodexWebToolUseInfo`、`CodexWebToolResultInfo`。
  - 封装 status、error、duration、source breadcrumb 和展示输出格式化。
- Create: `src/codex-web/tool-item-adapter.test.ts`
  - 覆盖共享 helper 的状态语义。
  - 包含 success / failed / declined / non-zero / MCP content block is_error / MCP error message / dynamic success false / collab failed 反例。
- Modify: `src/codex-web/tool-adapter.ts`
  - 删除本文件内重复的 tool use/result 格式化逻辑。
  - 使用 `tool-item-adapter` 根据实时 `AppServerTurnState` 派生工具状态。
- Modify: `src/codex-web/tool-adapter.test.ts`
  - 保留实时 streaming output、file patch updates、MCP progress、大输出截断测试。
  - 添加 turn interrupted 不伪造成工具状态的回归测试。
- Modify: `src/codex-web/thread-history-adapter.ts`
  - 历史 item 转消息块时复用 `tool-item-adapter`。
  - 保持 unsupported item 计数逻辑。
- Modify: `src/codex-web/thread-history-adapter.test.ts`
  - 验证历史工具 block 与共享 helper 语义一致。
  - 添加 dynamic / collab 历史展示覆盖。
- Modify: `docs/exec-plans/active/web-mvp-phase-0-4.md`
  - 更新 Phase 6D checklist、状态总览、决策日志和 Smoke Ledger。

---

### Task 1: 新增共享工具 item adapter

**Files:**
- Create: `src/codex-web/tool-item-adapter.ts`
- Create: `src/codex-web/tool-item-adapter.test.ts`

**Interfaces:**
- Consumes:
  - `ThreadItem` from `@/codex/protocol/generated/v2/ThreadItem`
  - `FileUpdateChange` from `@/codex/protocol/generated/v2/FileUpdateChange`
  - `formatToolDisplayOutput(output, { sourceLabel })` from `./tool-output-display`
- Produces:
  - `CodexWebToolUseInfo`
  - `CodexWebToolResultInfo`
  - `ToolItemContext`
  - `codexWebToolUseFromItem(item: ThreadItem, context?: ToolItemContext): CodexWebToolUseInfo | null`
  - `codexWebToolResultFromItem(item: ThreadItem, context?: ToolItemContext): CodexWebToolResultInfo | null`
  - `codexWebRunningOutputFromItem(item: ThreadItem, context?: ToolItemContext): string`

- [ ] **Step 1: Write the failing tests**

Add `src/codex-web/tool-item-adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";

import {
  codexWebRunningOutputFromItem,
  codexWebToolResultFromItem,
  codexWebToolUseFromItem,
} from "./tool-item-adapter";

describe("tool-item-adapter", () => {
  it("映射 commandExecution 的状态、breadcrumb 和非零 exit code", () => {
    const item: ThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "npm test",
      cwd: "/repo",
      processId: "proc-1",
      source: "agent",
      status: "completed",
      commandActions: [],
      aggregatedOutput: "failed tests\n",
      exitCode: 1,
      durationMs: 1200,
    };

    expect(codexWebToolUseFromItem(item)).toEqual({
      id: "cmd-1",
      name: "bash",
      input: expect.objectContaining({
        command: "npm test",
        cwd: "/repo",
        source: "agent",
        status: "completed",
        durationMs: 1200,
        exitCode: 1,
        sourceBreadcrumb: "app-server.commandExecution",
      }),
    });
    expect(codexWebToolResultFromItem(item)).toEqual({
      tool_use_id: "cmd-1",
      content: expect.stringContaining("exit code: 1"),
      is_error: true,
    });
  });

  it("把 declined command 和 failed fileChange 映射为 error", () => {
    const declinedCommand: ThreadItem = {
      type: "commandExecution",
      id: "cmd-declined",
      command: "rm -rf tmp",
      cwd: "/repo",
      processId: null,
      source: "agent",
      status: "declined",
      commandActions: [],
      aggregatedOutput: "",
      exitCode: null,
      durationMs: null,
    };
    const failedPatch: ThreadItem = {
      type: "fileChange",
      id: "patch-failed",
      changes: [{ path: "src/app.ts", kind: { type: "update", move_path: null }, diff: "@@" }],
      status: "failed",
    };

    expect(codexWebToolResultFromItem(declinedCommand)).toMatchObject({ is_error: true });
    expect(codexWebToolResultFromItem(failedPatch)).toMatchObject({
      content: expect.stringContaining("failed: 1 file"),
      is_error: true,
    });
  });

  it("映射 MCP content block is_error 和 error message", () => {
    const completedResult: ThreadItem = {
      type: "mcpToolCall",
      id: "mcp-1",
      server: "docs",
      tool: "search",
      status: "completed",
      arguments: { q: "codex" },
      appContext: null,
      pluginId: null,
      result: { content: [{ type: "text", text: "bad", is_error: true }], structuredContent: null, _meta: null },
      error: null,
      durationMs: 25,
    };
    const failedByError: ThreadItem = {
      ...completedResult,
      id: "mcp-2",
      status: "failed",
      result: null,
      error: { message: "MCP unavailable" },
    };

    expect(codexWebToolResultFromItem(completedResult)).toMatchObject({ is_error: true });
    expect(codexWebToolResultFromItem(failedByError)).toEqual({
      tool_use_id: "mcp-2",
      content: "MCP unavailable",
      is_error: true,
    });
  });

  it("映射 dynamic tool 和 collab tool", () => {
    const dynamicItem: ThreadItem = {
      type: "dynamicToolCall",
      id: "dyn-1",
      namespace: "browser",
      tool: "open",
      arguments: { url: "http://localhost:3000" },
      status: "completed",
      contentItems: [{ type: "inputText", text: "opened" }],
      success: false,
      durationMs: 10,
    };
    const collabItem: ThreadItem = {
      type: "collabAgentToolCall",
      id: "collab-1",
      tool: "wait",
      status: "failed",
      senderThreadId: "thread-a",
      receiverThreadIds: ["thread-b"],
      prompt: null,
      model: null,
      reasoningEffort: null,
      agentsStates: { "thread-b": { status: "errored", message: "boom" } },
    };

    expect(codexWebToolUseFromItem(dynamicItem)).toMatchObject({ name: "dynamic:browser/open" });
    expect(codexWebToolResultFromItem(dynamicItem)).toMatchObject({ is_error: true });
    expect(codexWebToolUseFromItem(collabItem)).toMatchObject({ name: "collab:wait" });
    expect(codexWebToolResultFromItem(collabItem)).toMatchObject({
      content: expect.stringContaining("thread-b: errored"),
      is_error: true,
    });
  });

  it("运行中 item 不产生 result，但保留增量输出", () => {
    const item: ThreadItem = {
      type: "commandExecution",
      id: "cmd-running",
      command: "sleep 1",
      cwd: "/repo",
      processId: "proc-running",
      source: "agent",
      status: "inProgress",
      commandActions: [],
      aggregatedOutput: null,
      exitCode: null,
      durationMs: null,
    };

    expect(codexWebToolResultFromItem(item)).toBeNull();
    expect(codexWebRunningOutputFromItem(item, { output: "still running\n" })).toBe("still running\n");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/tool-item-adapter.test.ts
```

Expected: FAIL because `src/codex-web/tool-item-adapter.ts` does not exist.

- [ ] **Step 3: Implement the shared adapter**

Create `src/codex-web/tool-item-adapter.ts` with these exported interfaces and functions:

```ts
import type { FileUpdateChange } from "@/codex/protocol/generated/v2/FileUpdateChange";
import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";

import { formatToolDisplayOutput } from "./tool-output-display";

export interface CodexWebToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

export interface CodexWebToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ToolItemContext = {
  output?: string;
  fileChanges?: FileUpdateChange[];
  mcpProgress?: string;
  sourceLabel?: string;
};

export function codexWebToolUseFromItem(item: ThreadItem, context: ToolItemContext = {}): CodexWebToolUseInfo | null {
  if (item.type === "commandExecution") {
    return {
      id: item.id,
      name: "bash",
      input: {
        command: item.command,
        cwd: item.cwd,
        source: item.source,
        status: item.status,
        durationMs: item.durationMs,
        exitCode: item.exitCode,
        processId: item.processId,
        actions: item.commandActions,
        sourceBreadcrumb: "app-server.commandExecution",
      },
    };
  }

  if (item.type === "fileChange") {
    const changes = context.fileChanges ?? item.changes;
    return {
      id: item.id,
      name: "fileChange",
      input: {
        status: item.status,
        files: changes.map((change) => change.path),
        changes,
        sourceBreadcrumb: "app-server.fileChange",
      },
    };
  }

  if (item.type === "mcpToolCall") {
    return {
      id: item.id,
      name: `mcp:${item.server}/${item.tool}`,
      input: {
        server: item.server,
        tool: item.tool,
        arguments: item.arguments,
        appContext: item.appContext,
        pluginId: item.pluginId,
        status: item.status,
        durationMs: item.durationMs,
        sourceBreadcrumb: "app-server.mcpToolCall",
      },
    };
  }

  if (item.type === "dynamicToolCall") {
    const name = item.namespace ? `dynamic:${item.namespace}/${item.tool}` : `dynamic:${item.tool}`;
    return {
      id: item.id,
      name,
      input: {
        namespace: item.namespace,
        tool: item.tool,
        arguments: item.arguments,
        status: item.status,
        success: item.success,
        durationMs: item.durationMs,
        sourceBreadcrumb: "app-server.dynamicToolCall",
      },
    };
  }

  if (item.type === "collabAgentToolCall") {
    return {
      id: item.id,
      name: `collab:${item.tool}`,
      input: {
        tool: item.tool,
        status: item.status,
        senderThreadId: item.senderThreadId,
        receiverThreadIds: item.receiverThreadIds,
        prompt: item.prompt,
        model: item.model,
        reasoningEffort: item.reasoningEffort,
        agentsStates: item.agentsStates,
        sourceBreadcrumb: "app-server.collabAgentToolCall",
      },
    };
  }

  return null;
}

export function codexWebToolResultFromItem(
  item: ThreadItem,
  context: ToolItemContext = {},
): CodexWebToolResultInfo | null {
  if (item.type === "commandExecution") {
    if (item.status === "inProgress") return null;
    const output = (item.aggregatedOutput ?? context.output ?? "").trimEnd();
    const lines = [
      output,
      `status: ${item.status}`,
      typeof item.exitCode === "number" ? `exit code: ${item.exitCode}` : "",
      typeof item.durationMs === "number" ? `duration: ${item.durationMs}ms` : "",
      "source: app-server.commandExecution",
    ].filter(Boolean);
    return {
      tool_use_id: item.id,
      content: display(lines.join("\n"), context, "app-server commandExecution item / diagnostics"),
      is_error: item.status === "failed" || item.status === "declined" || (item.exitCode ?? 0) !== 0,
    };
  }

  if (item.type === "fileChange") {
    if (item.status === "inProgress") return null;
    const changes = context.fileChanges ?? item.changes;
    return {
      tool_use_id: item.id,
      content: display(formatFileChanges(item.status, changes, context.output), context, "app-server fileChange item / diagnostics"),
      is_error: item.status === "failed" || item.status === "declined",
    };
  }

  if (item.type === "mcpToolCall") {
    if (item.status === "inProgress") return null;
    return {
      tool_use_id: item.id,
      content: display(formatMcpResult(item), context, "app-server mcpToolCall item / diagnostics"),
      is_error: item.status === "failed" || !!item.error || mcpResultHasErrorContent(item.result),
    };
  }

  if (item.type === "dynamicToolCall") {
    if (item.status === "inProgress") return null;
    return {
      tool_use_id: item.id,
      content: display(formatDynamicToolResult(item), context, "app-server dynamicToolCall item / diagnostics"),
      is_error: item.status === "failed" || item.success === false,
    };
  }

  if (item.type === "collabAgentToolCall") {
    if (item.status === "inProgress") return null;
    return {
      tool_use_id: item.id,
      content: display(formatCollabToolResult(item), context, "app-server collabAgentToolCall item / diagnostics"),
      is_error: item.status === "failed",
    };
  }

  return null;
}

export function codexWebRunningOutputFromItem(item: ThreadItem, context: ToolItemContext = {}): string {
  if (item.type === "commandExecution" || item.type === "fileChange") {
    return display(context.output ?? "", context, "app-server 工具增量 diagnostics");
  }
  if (item.type === "mcpToolCall") {
    return display((context.mcpProgress ?? "").trimEnd(), context, "app-server MCP progress diagnostics");
  }
  return "";
}

function display(output: string, context: ToolItemContext, fallbackSourceLabel: string): string {
  return formatToolDisplayOutput(output, {
    sourceLabel: context.sourceLabel ?? fallbackSourceLabel,
  });
}

function formatFileChanges(status: string, changes: FileUpdateChange[], output = ""): string {
  const header = `${status}: ${changes.length} file${changes.length === 1 ? "" : "s"}`;
  const paths = changes.map((change) => `- ${formatChangeKind(change.kind)}: ${change.path}`).join("\n");
  return [header, paths, output.trim(), "source: app-server.fileChange"].filter(Boolean).join("\n");
}

function formatChangeKind(kind: FileUpdateChange["kind"]): string {
  if (kind.type === "update" && kind.move_path) return `update from ${kind.move_path}`;
  return kind.type;
}

function formatMcpResult(item: Extract<ThreadItem, { type: "mcpToolCall" }>): string {
  if (item.error?.message) return item.error.message;
  const resultText = item.result ? stringifyJson(item.result.structuredContent ?? item.result.content) : "";
  return [resultText, `status: ${item.status}`, typeof item.durationMs === "number" ? `duration: ${item.durationMs}ms` : "", "source: app-server.mcpToolCall"]
    .filter(Boolean)
    .join("\n");
}

function mcpResultHasErrorContent(result: Extract<ThreadItem, { type: "mcpToolCall" }>["result"]): boolean {
  if (!result) return false;
  return result.content.some((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return false;
    const data = block as Record<string, unknown>;
    return data.is_error === true || data.isError === true;
  });
}

function formatDynamicToolResult(item: Extract<ThreadItem, { type: "dynamicToolCall" }>): string {
  return [
    item.contentItems ? stringifyJson(item.contentItems) : "",
    `status: ${item.status}`,
    item.success === null ? "" : `success: ${item.success}`,
    typeof item.durationMs === "number" ? `duration: ${item.durationMs}ms` : "",
    "source: app-server.dynamicToolCall",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCollabToolResult(item: Extract<ThreadItem, { type: "collabAgentToolCall" }>): string {
  const agentLines = Object.entries(item.agentsStates).map(([threadId, state]) =>
    `${threadId}: ${state.status}${state.message ? ` - ${state.message}` : ""}`,
  );
  return [
    `status: ${item.status}`,
    `sender: ${item.senderThreadId}`,
    item.receiverThreadIds.length > 0 ? `receivers: ${item.receiverThreadIds.join(", ")}` : "",
    ...agentLines,
    "source: app-server.collabAgentToolCall",
  ]
    .filter(Boolean)
    .join("\n");
}

function stringifyJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
```

- [ ] **Step 4: Run the shared adapter tests**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/tool-item-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/codex-web/tool-item-adapter.ts src/codex-web/tool-item-adapter.test.ts
git commit -m "feat: 增加工具 item 状态映射 adapter"
```

Expected: commit succeeds.

---

### Task 2: 迁移实时 tool-adapter

**Files:**
- Modify: `src/codex-web/tool-adapter.ts`
- Modify: `src/codex-web/tool-adapter.test.ts`

**Interfaces:**
- Consumes:
  - `codexWebToolUseFromItem(item, context)`
  - `codexWebToolResultFromItem(item, context)`
  - `codexWebRunningOutputFromItem(item, context)`
  - `CodexWebToolUseInfo`
  - `CodexWebToolResultInfo`
- Produces:
  - `deriveCodexWebToolState(turn: AppServerTurnState | null): CodexWebToolState`

- [ ] **Step 1: Add failing realtime adapter assertions**

Modify `src/codex-web/tool-adapter.test.ts` by adding:

```ts
it("实时 adapter 保留 command 状态 breadcrumb 且不把 interrupted turn 写成工具状态", () => {
  const turn: AppServerTurnState = {
    ...createStartingTurnState(),
    status: "interrupted",
    items: [
      {
        type: "commandExecution",
        id: "cmd-1",
        command: "sleep 60",
        cwd: "/repo",
        processId: "proc-1",
        source: "agent",
        status: "completed",
        commandActions: [],
        aggregatedOutput: "",
        exitCode: 0,
        durationMs: 100,
      },
    ],
  };

  const state = deriveCodexWebToolState(turn);

  expect(state.toolUses[0].input).toMatchObject({
    status: "completed",
    sourceBreadcrumb: "app-server.commandExecution",
  });
  expect(state.toolUses[0].input).not.toMatchObject({ status: "interrupted" });
  expect(state.toolResults[0]).toMatchObject({ is_error: false });
});

it("实时 adapter 显示 dynamic 和 collab 工具 item", () => {
  const turn: AppServerTurnState = {
    ...createStartingTurnState(),
    items: [
      {
        type: "dynamicToolCall",
        id: "dyn-1",
        namespace: null,
        tool: "analyze",
        arguments: { file: "a.ts" },
        status: "completed",
        contentItems: [{ type: "inputText", text: "done" }],
        success: true,
        durationMs: 12,
      },
      {
        type: "collabAgentToolCall",
        id: "collab-1",
        tool: "spawnAgent",
        status: "completed",
        senderThreadId: "thread-a",
        receiverThreadIds: ["thread-b"],
        prompt: "review",
        model: null,
        reasoningEffort: null,
        agentsStates: { "thread-b": { status: "completed", message: null } },
      },
    ],
  };

  const state = deriveCodexWebToolState(turn);

  expect(state.toolUses.map((tool) => tool.name)).toEqual(["dynamic:analyze", "collab:spawnAgent"]);
  expect(state.toolResults).toHaveLength(2);
  expect(state.toolResults.every((result) => result.is_error === false)).toBe(true);
});
```

- [ ] **Step 2: Run realtime adapter tests to verify they fail**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/tool-adapter.test.ts
```

Expected: FAIL because `tool-adapter.ts` does not yet use the shared adapter for dynamic / collab items.

- [ ] **Step 3: Replace duplicate realtime mapping**

Modify `src/codex-web/tool-adapter.ts` to import the shared adapter and keep only realtime context assembly:

```ts
import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";

import type { AppServerTurnState } from "./turn-reducer";
import {
  codexWebRunningOutputFromItem,
  codexWebToolResultFromItem,
  codexWebToolUseFromItem,
  type CodexWebToolResultInfo,
  type CodexWebToolUseInfo,
  type ToolItemContext,
} from "./tool-item-adapter";

export type { CodexWebToolResultInfo, CodexWebToolUseInfo };

export type CodexWebToolState = {
  toolUses: CodexWebToolUseInfo[];
  toolResults: CodexWebToolResultInfo[];
  streamingToolOutput: string;
};

export function deriveCodexWebToolState(turn: AppServerTurnState | null): CodexWebToolState {
  if (!turn) {
    return { toolUses: [], toolResults: [], streamingToolOutput: "" };
  }

  const toolUses: CodexWebToolUseInfo[] = [];
  const toolResults: CodexWebToolResultInfo[] = [];
  let lastRunningToolOutput = "";

  for (const item of turn.items) {
    const context = toolContext(item, turn);
    const toolUse = codexWebToolUseFromItem(item, context);
    if (!toolUse) continue;

    toolUses.push(toolUse);

    const result = codexWebToolResultFromItem(item, context);
    if (result) {
      toolResults.push(result);
    } else {
      lastRunningToolOutput = codexWebRunningOutputFromItem(item, context);
    }
  }

  return {
    toolUses,
    toolResults,
    streamingToolOutput: lastRunningToolOutput,
  };
}

function toolContext(item: ThreadItem, turn: AppServerTurnState): ToolItemContext {
  if (item.type === "fileChange") {
    return {
      output: turn.toolOutputs[item.id],
      fileChanges: turn.filePatchChanges[item.id] ?? item.changes,
    };
  }
  if (item.type === "mcpToolCall") {
    return {
      mcpProgress: turn.mcpProgress[item.id],
    };
  }
  if (item.type === "commandExecution") {
    return {
      output: turn.toolOutputs[item.id],
    };
  }
  return {};
}
```

- [ ] **Step 4: Run realtime adapter tests**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/tool-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/codex-web/tool-adapter.ts src/codex-web/tool-adapter.test.ts
git commit -m "refactor: 统一实时工具状态映射"
```

Expected: commit succeeds.

---

### Task 3: 迁移历史 thread-history-adapter

**Files:**
- Modify: `src/codex-web/thread-history-adapter.ts`
- Modify: `src/codex-web/thread-history-adapter.test.ts`

**Interfaces:**
- Consumes:
  - `codexWebToolUseFromItem(item)`
  - `codexWebToolResultFromItem(item)`
- Produces:
  - `threadToMessages(thread: Thread): ThreadMessagesResult`
  - 历史 `tool_use` 和 `tool_result` block 与实时 adapter 使用同一套状态语义。

- [ ] **Step 1: Add failing history adapter assertions**

Modify `src/codex-web/thread-history-adapter.test.ts` by extending the patch/MCP test expected values:

```ts
expect(assistantContent[0].input).toMatchObject({
  status: "completed",
  sourceBreadcrumb: "app-server.fileChange",
});
expect(assistantContent[1].content).toContain("source: app-server.fileChange");
expect(assistantContent[2].input).toMatchObject({
  status: "completed",
  sourceBreadcrumb: "app-server.mcpToolCall",
});
expect(assistantContent[3].content).toContain("source: app-server.mcpToolCall");
```

Add a new test:

```ts
it("把历史 dynamic 和 collab 工具映射为 CodexWeb 工具块", () => {
  const result = threadToMessages(createThreadWithDynamicAndCollab());
  const assistantContent = JSON.parse(result.messages[0].content);

  expect(assistantContent).toEqual([
    expect.objectContaining({
      type: "tool_use",
      id: "dyn-1",
      name: "dynamic:browser/open",
      input: expect.objectContaining({
        status: "failed",
        success: false,
        sourceBreadcrumb: "app-server.dynamicToolCall",
      }),
    }),
    expect.objectContaining({
      type: "tool_result",
      tool_use_id: "dyn-1",
      is_error: true,
    }),
    expect.objectContaining({
      type: "tool_use",
      id: "collab-1",
      name: "collab:wait",
      input: expect.objectContaining({
        status: "completed",
        sourceBreadcrumb: "app-server.collabAgentToolCall",
      }),
    }),
    expect.objectContaining({
      type: "tool_result",
      tool_use_id: "collab-1",
      is_error: false,
    }),
  ]);
  expect(result.unsupportedItemCount).toBe(0);
});
```

Add this helper in the same test file:

```ts
function createThreadWithDynamicAndCollab(): Thread {
  return {
    ...createThread(),
    turns: [
      {
        id: "turn-dynamic",
        items: [
          {
            type: "dynamicToolCall",
            id: "dyn-1",
            namespace: "browser",
            tool: "open",
            arguments: { url: "http://localhost:3000" },
            status: "failed",
            contentItems: [{ type: "inputText", text: "failed" }],
            success: false,
            durationMs: 10,
          },
          {
            type: "collabAgentToolCall",
            id: "collab-1",
            tool: "wait",
            status: "completed",
            senderThreadId: "thread-a",
            receiverThreadIds: ["thread-b"],
            prompt: null,
            model: null,
            reasoningEffort: null,
            agentsStates: { "thread-b": { status: "completed", message: null } },
          },
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1783570300,
        completedAt: 1783570301,
        durationMs: 1000,
      },
    ],
  };
}
```

- [ ] **Step 2: Run history adapter tests to verify they fail**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/thread-history-adapter.test.ts
```

Expected: FAIL because `thread-history-adapter.ts` does not yet use the shared adapter for source breadcrumbs, dynamic tool, or collab tool.

- [ ] **Step 3: Replace duplicate history mapping**

Modify `src/codex-web/thread-history-adapter.ts`:

```ts
import {
  codexWebToolResultFromItem,
  codexWebToolUseFromItem,
} from "./tool-item-adapter";
```

Replace the tool branches in `assistantItemToBlocks(item)` with:

```ts
  const toolUse = codexWebToolUseFromItem(item);
  if (toolUse) {
    const result = codexWebToolResultFromItem(item);
    return [
      {
        type: "tool_use",
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input,
      },
      ...(result
        ? [
            {
              type: "tool_result" as const,
              tool_use_id: result.tool_use_id,
              content: result.content,
              is_error: result.is_error,
            },
          ]
        : []),
    ];
  }
```

Then remove the now-unused local helper functions:

```ts
commandExecutionResult
formatFileChanges
formatChangeKind
formatMcpResult
stringifyJson
```

Keep `isUnsupportedHistoryItem(item)` but extend it so newly supported tools are not counted unsupported:

```ts
function isUnsupportedHistoryItem(item: ThreadItem): boolean {
  return (
    item.type !== "userMessage" &&
    item.type !== "agentMessage" &&
    item.type !== "commandExecution" &&
    item.type !== "fileChange" &&
    item.type !== "mcpToolCall" &&
    item.type !== "dynamicToolCall" &&
    item.type !== "collabAgentToolCall"
  );
}
```

- [ ] **Step 4: Run history adapter tests**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/thread-history-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/codex-web/thread-history-adapter.ts src/codex-web/thread-history-adapter.test.ts
git commit -m "refactor: 统一历史工具状态映射"
```

Expected: commit succeeds.

---

### Task 4: 全量验证与执行计划记录

**Files:**
- Modify: `docs/exec-plans/active/web-mvp-phase-0-4.md`
- Check: `next-env.d.ts`

**Interfaces:**
- Consumes:
  - Task 1-3 commits and tests.
- Produces:
  - Phase 6D checklist、决策日志、Smoke Ledger 更新。
  - 干净工作区或仅剩用户明确要求保留的文件。

- [ ] **Step 1: Run targeted tests**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/tool-item-adapter.test.ts
npm run test -- src/codex-web/tool-adapter.test.ts
npm run test -- src/codex-web/thread-history-adapter.test.ts
```

Expected: all targeted tests PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
```

Expected: PASS.

- [ ] **Step 3: Update active execution plan**

Append a `## Phase 6D：工具状态完整映射` section to `docs/exec-plans/active/web-mvp-phase-0-4.md` with:

```md
## Phase 6D：工具状态完整映射

目标：实时 turn 和历史 thread 使用同一套 app-server 工具 item 状态映射，覆盖 command、fileChange、MCP、dynamic tool 和 collab tool。

架构：新增 `tool-item-adapter` 作为纯数据转换层；实时 `tool-adapter` 和历史 `thread-history-adapter` 复用该 helper，不新增 Web 私有工具状态。

本阶段不做：完整 transcript、原始输出下载、工具详情 UI 大改、历史清理入口、真实 `CODEX_HOME` 验收。

Checklist:

- [x] 对照 generated schema 确认工具 item 状态枚举；`interrupted` 仅作为 turn 级状态处理。
- [x] 新增共享 `tool-item-adapter`，统一 tool use / result / error / breadcrumb 语义。
- [x] 实时 `tool-adapter` 接入共享 adapter。
- [x] 历史 `thread-history-adapter` 接入共享 adapter。
- [x] 补单元测试覆盖 command、fileChange、MCP、dynamic tool、collab tool 状态反例。

Phase 6D 记录：

- 2026-07-10：新增 `docs/superpowers/specs/2026-07-10-phase-6d-tool-status-mapping-design.md` 和 `docs/superpowers/plans/2026-07-10-phase-6d-tool-status-mapping.md`。
- 2026-07-10：generated schema 确认：command/fileChange 支持 `inProgress/completed/failed/declined`；MCP/dynamic/collab 支持 `inProgress/completed/failed`；`interrupted` 是 turn 级状态，不写入工具 item。
- 2026-07-10：Smoke 反例：普通消息路径不产生工具 cell；command 非零 exit code 产生 error result；turn interrupted 不显示为工具 interrupted/cancelled。
```

Also update the backlog table row:

```md
| Tools | exec / patch / file change / MCP / skill 完整状态映射 | Code complete | Phase 6D | running、success、failed、declined 都有真实 source breadcrumb；interrupted 保持 turn 级状态 |
```

- [ ] **Step 4: Check generated Next env file**

Run:

```bash
git diff -- next-env.d.ts
```

Expected: no diff. If there is a diff from `./.next/dev/types/routes.d.ts` to `./.next/types/routes.d.ts`, restore only this file:

```bash
git restore next-env.d.ts
```

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add docs/exec-plans/active/web-mvp-phase-0-4.md
git commit -m "docs: 更新 Phase 6D 执行记录"
```

Expected: commit succeeds.

---

## Self-Review

Spec coverage:

- 工具状态枚举：Task 1 adapter 和 Task 4 文档记录覆盖。
- 实时/历史共享映射：Task 2 和 Task 3 覆盖。
- command/fileChange/MCP/dynamic/collab：Task 1 测试和实现覆盖。
- interrupted 不伪造成工具状态：Task 2 测试和 Task 4 Smoke Ledger 覆盖。
- Phase 6B 截断沿用：Task 1 实现继续调用 `formatToolDisplayOutput`。
- CodexWeb UI 不大改：所有任务只改 adapter 和测试，不改组件布局。

Placeholder scan:

- 本计划没有使用待补内容，所有步骤给出文件、接口、代码片段、命令和预期结果。

Type consistency:

- 共享 helper 的 exported type 名称由 Task 1 定义，Task 2 和 Task 3 使用相同名称。
- CodexWeb result 字段在 helper 中为 `is_error`，进入历史 JSON block 时仍写入 `is_error`。
- `ThreadItem` 字段名使用 generated schema 的 camelCase：`durationMs`、`appContext`、`pluginId`、`contentItems`、`agentsStates`。
