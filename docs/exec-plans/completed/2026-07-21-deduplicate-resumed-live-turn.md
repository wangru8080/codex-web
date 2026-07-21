# 窗口重开后运行 Turn 去重实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 浏览器窗口关闭后重新打开运行中的任务时，同一 app-server Turn 只显示一次过程区域，同时保留该 Turn 的用户消息。

**架构：** 历史消息仍以 `thread/turns/list` 或 `thread/read` 为来源；当 `thread/resume` 明确返回最新 `inProgress` Turn 时，历史适配器仅省略该 `turnId` 的 assistant 历史副本，由 `activeTurnsByThreadId` 驱动唯一实时面板。已完成 Turn、无可恢复实时 Turn 和 resume 失败路径保持原历史展示。

**技术栈：** React、TypeScript、Codex app-server v2 Thread/Turn schema、Vitest、Chrome CDP。

## 全局约束

- 所有测试和浏览器验证显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 去重键只使用 app-server `threadId + turnId`，不得按 commentary 文本或工具摘要比较。
- 保留运行 Turn 的 userMessage；只省略已由实时面板覆盖的 assistant 历史。
- 不修改 UI 样式、布局和文案，不修改生成的协议 schema，不引入依赖，不自动提交 Git。

---

### Task 1：历史适配器支持省略指定 Turn 的 assistant 副本

**文件：**
- 修改：`src/codex-web/thread-history-adapter.ts`
- 修改：`src/codex-web/thread-turns-page-adapter.ts`
- 测试：`src/codex-web/thread-history-adapter.test.ts`
- 测试：`src/codex-web/thread-turns-page-adapter.test.ts`

**接口：**
- 消费：`ThreadMessagesOptions.omitAssistantTurnId?: string | null`。
- 产出：目标 Turn 的 userMessage 保留，assistant 历史省略；其它 Turn 不变。

- [x] **Step 1：写失败测试**

```ts
const result = threadToMessages(thread, { omitAssistantTurnId: "turn-live" });
expect(result.messages.map((message) => message.role)).toEqual(["user"]);
```

分页适配器增加同等断言，确保 `threadTurnsPageToMessages()` 把选项传给底层转换器。

- [x] **Step 2：运行测试确认失败**

运行：`npm exec vitest run src/codex-web/thread-history-adapter.test.ts src/codex-web/thread-turns-page-adapter.test.ts`

预期：新增选项尚未生效，目标 Turn 仍产生 assistant 消息。

- [x] **Step 3：实现最小过滤**

```ts
export type ThreadMessagesOptions = {
  omitAssistantTurnId?: string | null;
};

if (assistantMessageId && turn.id !== options.omitAssistantTurnId) {
  messages.push(createAssistantMessage(...));
}
```

`threadTurnsPageToMessages()` 接收同一可选参数并传入 `threadToMessages()`；snapshot overlay 只处理仍存在的 assistant 消息。

- [x] **Step 4：运行 targeted tests 确认通过**

运行：`npm exec vitest run src/codex-web/thread-history-adapter.test.ts src/codex-web/thread-turns-page-adapter.test.ts`

预期：通过。

### Task 2：窗口恢复页按 resume active turn 接入去重

**文件：**
- 修改：`src/app/chat/[id]/page.tsx`
- 创建：`src/codex-web/resumed-live-turn-history.test.ts`

**接口：**
- 消费：`ThreadResumeResponse.thread.turns` 中最新 `status === "inProgress"` 的 Turn。
- 产出：`resumedLiveTurnId: string | null`，传给分页和 fallback 历史转换器。

- [x] **Step 1：写失败接线测试**

```ts
expect(pageSource).toContain("const resumedLiveTurnId = latestInProgressTurnId(resume.thread.turns)");
expect(pageSource).toContain("omitAssistantTurnId: resumedLiveTurnId");
```

反例断言没有 active Turn 时传入 `null`，不隐藏已完成历史。

- [x] **Step 2：运行测试确认失败**

运行：`npm exec vitest run src/codex-web/resumed-live-turn-history.test.ts`

预期：接线不存在而失败。

- [x] **Step 3：实现 active Turn id 选择与页面接线**

```ts
export function latestInProgressTurnId(turns: Turn[]): string | null {
  const latest = turns.at(-1);
  return latest?.status === "inProgress" ? latest.id : null;
}
```

页面在 `resumeThread()` 成功后计算一次 id，并同时用于正常分页与 `thread/read` fallback；resume 未返回运行 Turn 时为 `null`。

- [x] **Step 4：运行所有定向测试**

运行：`npm exec vitest run src/codex-web/thread-history-adapter.test.ts src/codex-web/thread-turns-page-adapter.test.ts src/codex-web/resumed-live-turn-history.test.ts src/codex-web/resumed-turn-hydration.test.ts`

预期：通过。

### Task 3：全量与窗口重开验收

**文件：**
- 更新：`docs/exec-plans/active/2026-07-21-deduplicate-resumed-live-turn.md`

**接口：**
- 输入：一个包含 commentary 和工具调用的运行 Turn，关闭其浏览器标签后重新打开同一任务。
- 输出：用户消息 1 份、对应过程文本 1 份、实时过程区域 1 个。

- [x] **Step 1：运行完整验证**

运行：`npm run test`、`npm run build`、`npm run test:smoke`。

预期：全部通过；构建警告单独记录。

- [x] **Step 2：执行真实浏览器正例与反例**

正例：运行任务产生 commentary/tool 后关闭标签，创建新标签打开同一 `/chat/:id`，断言重复文本计数为 1、实时计时继续。

反例：打开已完成任务，历史 assistant 仍存在；打开无 active hydration 的历史时不省略 partial assistant。

- [x] **Step 3：记录 Smoke Ledger**

记录 source breadcrumb、重开前后 DOM 计数、console、测试数量和剩余风险。计划归档移动前单独取得用户明确确认。

## Smoke Ledger

- source breadcrumb：历史副本来自 `app-server.thread/turns/list` 或 fallback `app-server.thread/read`；唯一实时面板来自 `app-server.thread/resume` 水合到 `activeTurnsByThreadId` 的同一 `threadId + turnId`。
- TDD 红灯：3 个定向文件中 4 条新增断言按预期失败，确认目标 Turn 原先同时生成 user/assistant 历史，且页面未传 resume active turn id。
- targeted Vitest：4 个测试文件、36 项通过；覆盖目标 Turn 只保留 user、非目标 Turn 保留 assistant、分页透传、最新 completed 不误判为 active。
- `npm run test`：typecheck 通过；104 个测试文件、503 项测试通过。
- `npm run build`：生产构建通过；仅有既存 Turbopack NFT tracing warning。
- `npm run test:smoke`：通过；隔离 `CODEX_HOME`，models=7，账号来源为 `app-server.account/read`。
- 真实 Chrome/CDP 正例：运行 `sleep 60` 的任务关闭标签后重新打开同一 `/chat/:id`；用户消息 1 条、过程折叠区 1 个、停止按钮可用，页面显示 `已处理 9s`，未出现截图中的第二份历史过程区。
- 真实 Chrome/CDP 反例：无 active hydration 的已完成历史仍有 1 个 `data-assistant-final-answer`，证明过滤不作用于 completed Turn。新 app-server 进程没有该 Turn 的可重放过程 snapshot，因此该历史过程区为 0。
- 浏览器诊断：运行态正例无 Runtime exception，记录 5 条未影响流程的资源 404；已完成历史反例无 Runtime exception。
- 自动化说明：前两次运行态脚本分别因模型未进入预期检测阶段、正则未匹配按钮文本换行而未形成判定；修正为停止按钮与 `includes("已处理")` 后通过。
- 剩余风险：若目标 app-server 的 `thread/resume` 不返回最新 in-progress Turn，则页面不会省略 partial assistant 历史，并按既有 degraded notice 展示；这是保守回退，避免丢失唯一可见输出。
