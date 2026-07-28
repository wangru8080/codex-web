# Commentary 与最终回答归属修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** commentary 的流式文本即使曾缺少或延迟获得 phase 元数据，也只显示在过程区域，不再残留到页面底部的最终回答区域。

**架构：** 继续以 app-server `item/started`、`item/agentMessage/delta` 和 `item/completed` 为事实源。在 Turn reducer 中记录 `assistantText` 当前对应的 `itemId`；当同一 item 被确认是 commentary 时精准撤销误归类文本，真正的 `final_answer` 和旧模型 `phase: null` 最终回答保持兼容。

**技术栈：** TypeScript、Codex app-server v2 ThreadItem、Vitest、Next.js smoke。

## 全局约束

- 所有测试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不修改生成的协议 schema，不修改 UI 布局和文案，不引入依赖。
- 只按 app-server `itemId` 撤销误归类文本，不按文本内容猜测或去重。
- 不自动提交或推送 Git。

---

### Task 1：为 assistantText 增加 item 归属并处理 phase 回填

**文件：**
- 修改：`src/codex-web/turn-reducer.ts`
- 测试：`src/codex-web/tests/turn-reducer.test.ts`

**接口：**
- 消费：`item/started`、`item/agentMessage/delta`、`item/completed` 中的 `itemId` 与 `phase`。
- 产出：`AppServerTurnState.assistantTextItemId: string | null`，标识当前最终回答候选文本的来源。

- [x] **Step 1：写失败测试**

```ts
expect(completedCommentary.assistantText).toBe("");
expect(completedCommentary.items).toMatchObject([
  { id: "comment-1", text: "先确认环境。", phase: "commentary" },
]);
```

同时覆盖 delta 先于 item 元数据到达后，`item/started` 回填 commentary phase 的路径。

- [x] **Step 2：运行 targeted test 确认失败**

运行：`npm exec vitest run src/codex-web/tests/turn-reducer.test.ts`

预期：底部候选正文仍包含 commentary，新增断言失败。

- [x] **Step 3：实现最小 reducer 修复**

```ts
assistantTextItemId: string | null;

const clearsAssistantText =
  item.type === "agentMessage" &&
  item.phase === "commentary" &&
  state.assistantTextItemId === item.id;
```

delta 进入 `assistantText` 时同步记录其 `itemId`；同一 item 的 phase 回填为 commentary 时清空候选正文和归属。非 commentary 完成事件继续以完整 `item.text` 校准最终回答。

- [x] **Step 4：运行 targeted test 确认通过**

运行：`npm exec vitest run src/codex-web/tests/turn-reducer.test.ts`

预期：通过；commentary 反例为空，`final_answer` 与 legacy `phase: null` 正例保留。

### Task 2：全量验证与记录

**文件：**
- 更新：`docs/exec-plans/active/2026-07-28-commentary-final-answer-reconciliation.md`

**接口：**
- 输入：普通最终回答、commentary phase 回填、无 item 元数据 delta 三类事件序列。
- 输出：只有最终回答出现在 `data-assistant-final-answer` 对应内容，commentary 保留为 `codex_process_text`。

- [x] **Step 1：运行完整验证**

运行：`npm run test`、`npm run build`、`npm run test:smoke`。

预期：全部通过；既存警告单独记录。

- [x] **Step 2：记录 Smoke Ledger**

记录 targeted test、全量测试、构建、smoke、正例和反例结果，以及未覆盖的剩余风险。

- [x] **Step 3：归档计划**

将完成计划移动到 `docs/exec-plans/completed/2026-07-28-commentary-final-answer-reconciliation.md`。

## Smoke Ledger

- source breadcrumb：commentary 与最终回答均来自 `app-server.item/started`、`app-server.item/agentMessage/delta`、`app-server.item/completed`；撤销依据为同一 `itemId` 的 phase 回填。
- TDD 红灯：定向测试共 17 项，新增 2 条反例按预期失败，既有 15 项通过；失败值分别为残留的 `先确认环境。` 与 `先检查日志。`。
- targeted Vitest：`src/codex-web/tests/turn-reducer.test.ts` 共 17 项通过。
- 正例：真实 `final_answer` 的 `assistantText` 与 `assistantTextItemId=final-1` 保留；legacy `phase: null` 完成消息仍保存完整回答。
- 反例：开始时 `phase: null` 后完成为 commentary，以及 delta 早于 item 元数据到达，两条路径均清空 `assistantText` 和来源 id，同时保留 commentary item。
- `npm run test`：TypeScript 通过；140 个测试文件、649 项测试通过。
- `npm run build`：Next.js 生产构建通过，26 个页面生成成功，无新增构建警告。
- `npm run test:smoke`：通过；隔离 `CODEX_HOME`，models=5，账号来源为 `app-server.account/read`。
- 真实 Chrome 正例：使用隔离 `CODEX_HOME`、临时合成 Web 登录和 `codex-web` 项目发送真实只读 Turn；普通最终回答正确显示 `@wangru8080/codex-web`。
- 真实 Chrome 反例：30 秒只读命令运行到 28 秒时，DOM 为 `streamingRows=1`、流式行内 `data-assistant-final-answer=0`，commentary 与命令只出现在过程区；40 秒完成后流式行消失，最终回答为“命令完成，输出为 browser-check。”，未复现 commentary 尾部固定在页面底部。
- 浏览器诊断：有效连接期间未出现 reducer、React 或 WebSocket 错误；控制台有 6 条与本修复无关的 `/api/settings/workspace` 404。临时验证服务已停止，Playwright 产物已移入 `/volume2/SSD/Trash/2026-07-28-browser-validation/home/rrssnas/code/codex-web/.playwright-mcp/`。
- 剩余风险：上游若永久不提供 item 元数据，未知 phase delta 仍按 legacy 最终回答兼容路径展示；一旦同一 item 后续声明为 commentary，reducer 会立即撤销。
