# Phase 6B Tool Output Truncation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Codex Web 实时和历史工具输出增加与官方 TUI/core 一致的 1 MiB 展示保护，避免超大 stdout、stderr 或 MCP 结果撑爆页面状态。

**Architecture:** 新增一个纯函数 helper 负责官方 `DEFAULT_OUTPUT_BYTES_CAP = 1024 * 1024` 前缀截断策略，实时 `tool-adapter` 和历史 `thread-history-adapter` 统一调用。CodexWeb UI 层继续按 5 行头尾折叠，app-server 原始 item、协议响应和 bridge 数据保持不变。

**Tech Stack:** TypeScript, Vitest, Codex app-server generated types, CodexWeb message blocks.

## Global Constraints

- 默认开发、测试和 smoke 必须显式设置 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- Node 命令必须使用 `NODE_HOME=/volume2/SSD/node-v24.14.0` 并把 `$NODE_HOME/bin` 放入 `PATH`。
- 不修改 `/home/rrssnas/code/CodexWeb`。
- 不改 app-server protocol，不重新生成 schema。
- Commit message 使用中文。

---

### Task 1: 展示截断 helper

**Files:**
- Create: `src/codex-web/tool-output-display.ts`
- Create: `src/codex-web/tool-output-display.test.ts`

**Interfaces:**
- Produces: `formatToolDisplayOutput(output: string, options?: ToolOutputDisplayOptions): string`
- Produces: `TOOL_OUTPUT_DISPLAY_BYTE_LIMIT`

- [x] **Step 1: 写失败测试**

```ts
it("短输出原样返回", () => {
  expect(formatToolDisplayOutput("ok\n")).toBe("ok\n");
});

it("长输出按官方 1 MiB 前缀上限截断并显示提示", () => {
  const input = `A${"x".repeat(TOOL_OUTPUT_DISPLAY_BYTE_LIMIT + 1000)}Z`;
  const result = formatToolDisplayOutput(input);
  expect(result).toContain("A");
  expect(result).not.toMatch(/Z$/);
  expect(result).toContain("已按官方 DEFAULT_OUTPUT_BYTES_CAP 截断");
  expect(result.length).toBeLessThan(input.length);
});
```

- [x] **Step 2: 实现 helper**

```ts
export const TOOL_OUTPUT_DISPLAY_BYTE_LIMIT = 1024 * 1024;

export interface ToolOutputDisplayOptions {
  sourceLabel?: string;
}

export function formatToolDisplayOutput(output: string, options: ToolOutputDisplayOptions = {}): string {
  const encoded = new TextEncoder().encode(output);
  if (encoded.length <= TOOL_OUTPUT_DISPLAY_BYTE_LIMIT) return output;
  const head = new TextDecoder().decode(encoded.slice(0, TOOL_OUTPUT_DISPLAY_BYTE_LIMIT));
  const omitted = encoded.length - TOOL_OUTPUT_DISPLAY_BYTE_LIMIT;
  const source = options.sourceLabel ?? "app-server 原始 item / diagnostics";
  return `${head}\n\n... 已按官方 DEFAULT_OUTPUT_BYTES_CAP 截断至 ${TOOL_OUTPUT_DISPLAY_BYTE_LIMIT} 字节；省略 ${omitted} 字节。事实源：${source}。`;
}
```

- [x] **Step 3: 运行 targeted test**

Run: `NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test -- src/codex-web/tool-output-display.test.ts`

Expected: PASS.

### Task 2: 接入实时工具 adapter

**Files:**
- Modify: `src/codex-web/tool-adapter.ts`
- Modify: `src/codex-web/tool-adapter.test.ts`

**Interfaces:**
- Consumes: `formatToolDisplayOutput(output, { sourceLabel })`

- [x] **Step 1: 增加长 command、running output、fileChange output 测试**

测试断言 `toolResults.content` 和 `streamingToolOutput` 包含官方截断提示，不包含 1 MiB 之后的尾部标记；短输出既有测试保持不变。

- [x] **Step 2: 在 command、running、fileChange、MCP 路径调用 helper**

命令完成态先截断 stdout/stderr 聚合文本，再追加 exit code；fileChange 摘要和输出组合后截断；运行态直接截断当前增量聚合文本。

- [x] **Step 3: 运行 adapter targeted test**

Run: `NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test -- src/codex-web/tool-adapter.test.ts`

Expected: PASS.

### Task 3: 接入历史 adapter

**Files:**
- Modify: `src/codex-web/thread-history-adapter.ts`
- Modify: `src/codex-web/thread-history-adapter.test.ts`

**Interfaces:**
- Consumes: `formatToolDisplayOutput(output, { sourceLabel })`

- [x] **Step 1: 增加历史 command 和 MCP 大结果测试**

构造超过 1 MiB 的 `aggregatedOutput` 和 `structuredContent`，断言 JSON block 里的 `tool_result.content` 含官方截断提示且不包含尾部标记。

- [x] **Step 2: 历史 command/MCP result 调用 helper**

短历史输出保持原样；fileChange 历史结果仍只展示摘要和路径。

- [x] **Step 3: 运行 history targeted test**

Run: `NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test -- src/codex-web/thread-history-adapter.test.ts`

Expected: PASS.

### Task 4: 文档、全量验证和提交准备

**Files:**
- Modify: `docs/exec-plans/active/web-mvp-phase-0-4.md`
- Inspect: `next-env.d.ts`

**Interfaces:**
- Produces: Phase 6B 记录、Smoke Ledger 和剩余风险更新。

- [x] **Step 1: 更新 active plan**

把 Backlog 中“大输出与增量输出截断策略”标为 `Code complete`，追加 Phase 6B 目标、实施清单和验证记录。

- [x] **Step 2: 运行全量验证**

Run:

```bash
NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test -- src/codex-web
NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test
NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run build
NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test:smoke
```

Expected: all PASS.

- [x] **Step 3: 检查 `next-env.d.ts`**

若 `npm run build` 自动改写该文件，按用户要求还原到构建前状态，不纳入提交。

- [x] **Step 4: 检查 git diff**

确认没有临时文件、HTML、截图或本阶段无关改动进入提交。
