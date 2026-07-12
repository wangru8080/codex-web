# Phase 6U 官方 Goal / Plan UI 设计

> 对应执行计划：`docs/superpowers/plans/2026-07-12-phase-6u-official-goal-plan-ui.md`

## 目标

Phase 6U 接入官方 Codex app / `codex-rs` 的 Goal 和 Plan 展示语义。Web UI 必须保持与官方 Codex app 一致：Goal 是 composer 附近的进度与控制状态，Plan 是消息时间线中的计划输出与任务进度，不新增右侧常驻 `GoalPanel` 或 `PlanPanel`。

## 官方依据

- 官方 Codex app 文档把 `/goal` 描述为 composer slash command，用于设置持续目标；active goal 会在 composer 上方显示 goal progress row，并提供 pause/resume、edit、clear 控制。
- 官方 Codex app 文档把 `/plan` / Plan mode 描述为 composer 模式能力，用于在实现前形成方案。
- app-server 协议公开 `item/plan/delta`、`ThreadItem::Plan`、`turn/plan/updated`、`thread/goal/updated`、`thread/goal/cleared`。
- `codex-rs/tui` 是当前项目的产品语义基准，Phase 6U 的转换逻辑必须对齐以下代码：
  - `/home/rrssnas/code/codex/codex-rs/tui/src/chatwidget/streaming.rs`
  - `/home/rrssnas/code/codex/codex-rs/tui/src/history_cell/plans.rs`
  - `/home/rrssnas/code/codex/codex-rs/tui/src/thread_transcript.rs`
  - `/home/rrssnas/code/codex/codex-rs/tui/src/chatwidget/plan_implementation.rs`
  - `/home/rrssnas/code/codex/codex-rs/tui/src/chatwidget/goal_status.rs`
  - `/home/rrssnas/code/codex/codex-rs/tui/src/chatwidget/goal_menu.rs`
  - `/home/rrssnas/code/codex/codex-rs/tui/src/bottom_pane/footer.rs`

说明：本次公开文档查询中，官方 Codex manual 抓取因网络/代理返回缺少校验头未能作为可缓存来源；设计以官方公开 app 文档、app-server 协议和本地官方 `codex-rs` 代码为准。若后续官方 app 文档补充更细 UI 截图，应优先复核本文。

## 非目标

- 不实现右侧常驻 Goal / Plan 面板。
- 不从 assistant 文本推断 plan 或 goal 状态。
- 不把 `turn/plan/updated` 当作 proposed plan。
- 不在没有真实 source breadcrumb 时显示 token、MCP、goal、plan 的默认值。
- 不直接移植 Ratatui 代码，只复刻官方产品语义和视觉层级。
- 不直接修改 `/home/rrssnas/code/CodexWeb`。

## Plan 展示设计

### Proposed Plan

来源：

- 实时：`item/plan/delta`
- 完成：`item/completed` 中的 `ThreadItem::Plan`
- 历史：`thread/read` 或 `thread/turns/list` 返回的 `ThreadItem::Plan`

官方语义：

- 只在 Plan mode 下消费 `item/plan/delta`。
- 流式 plan 先作为 transient plan stream 展示。
- `ThreadItem::Plan.text` 是完成后的权威文本；完成后要把流式 tail 合并成持久 proposed plan。
- 历史 replay 直接渲染为 `Proposed Plan` cell。

Web 等价：

- 在消息时间线中渲染 `Proposed Plan` 块，位置与 assistant/message/tool cell 同级。
- 块标题使用 `Proposed Plan`，正文按 Markdown 渲染。
- 对表格、代码块、链接继续复用现有 Markdown 渲染能力。
- plan 流式阶段可显示在当前 active turn 的过程区域；完成后成为同一 turn 的持久消息块。
- 刷新后只显示 app-server 历史 API 返回的真实 `ThreadItem::Plan`，不从 final answer 反推 plan。

### Updated Plan

来源：

- `turn/plan/updated`

官方语义：

- 对应 `update_plan` 工具的任务进度，不是 proposed plan。
- TUI 标题为 `Updated Plan`。
- 可选 explanation 以弱化说明显示。
- checklist 状态：
  - `completed`：完成项。
  - `inProgress`：当前进行项。
  - `pending`：待办项。

Web 等价：

- 在消息时间线中渲染 `Updated Plan` checklist cell。
- 保留官方状态语义：完成、进行中、待办。
- 如果 plan 为空，显示类似官方 `(no steps provided)` 的低优先级空态。
- `turn/plan/updated` 还要更新 task-progress 摘要，供后续标题/状态区使用；如果没有 plan steps，不显示 `0/0`。

### Plan Implementation Prompt

触发：

- 当前处于 Plan mode。
- 当前 live turn 输出了 proposed plan。
- turn completed。
- 不是历史 replay。
- 没有待发送 queued message。

官方选项：

- `Yes, implement this plan`：切到 Default mode，发送 `Implement the plan.`
- `Yes, clear context and implement`：新上下文里带上完整 plan 作为用户意图。
- `No, stay in Plan mode`：关闭提示，保持 Plan mode。

Web 等价：

- 在 composer 附近展示确认 UI，而不是右侧面板。
- 三个动作的语义必须与 `codex-rs/tui/src/chatwidget/plan_implementation.rs` 保持一致。
- 如果 Default mode 不可用，对应按钮禁用并显示原因。
- 如果没有已批准/已完成 proposed plan，`clear context and implement` 禁用。

### Plan Mode Nudge

官方 app / TUI 在用户表达 planning intent 但尚未进入 Plan mode 时，会提示创建计划。

Web 等价：

- Phase 6U 可先记录为可选子任务；若实现，必须是轻量 composer 附近提示。
- 不因为用户输入包含 `planning` 等子串误触发；对齐 TUI 的独立单词 `plan` 判断。

## Goal 展示设计

### Goal Progress Row

来源：

- `thread/goal/updated`
- `thread/goal/cleared`

官方语义：

- active goal 在 composer 上方显示 progress row。
- row 提供 pause/resume、edit、clear 控制。
- Goal 状态不是右侧面板主内容。

Web 等价：

- 在 composer 上方展示目标进度行。
- 没有 goal 时不渲染该行。
- 控制动作调用官方 app-server 方法：
  - `thread/goal/set`
  - `thread/goal/get`
  - `thread/goal/clear`
- pause/resume 通过 `thread/goal/set` 修改 `status`。
- edit 通过 `thread/goal/set` 修改 `objective`，并保留官方状态调整规则。
- clear 走 `thread/goal/clear`，清理操作本身仍需遵守本仓库删除/清理确认规则；这里不涉及文件删除。

### Goal Status Text

必须对齐 `codex-rs/tui/src/chatwidget/goal_status.rs` 和 `footer.rs`：

- `active`：`Pursuing goal (...)`
- `paused`：`Goal paused (/goal resume)`
- `blocked`：`Goal blocked (/goal resume)`
- `usageLimited`：`Goal hit usage limits (/goal resume)`
- `budgetLimited`：有 token budget 时显示 `Goal unmet (used / budget tokens)`，否则显示 `Goal abandoned`
- `complete`：有 usage 时显示 `Goal achieved (...)`，否则显示 `Goal achieved`

usage 规则：

- active 且有 token budget：`tokensUsed / tokenBudget`
- active 且无 token budget：elapsed time
- budget limited 且有 token budget：`tokensUsed / tokenBudget tokens`
- complete 且有 token budget：`tokensUsed tokens`
- complete 且无 token budget：elapsed time

格式化规则要对齐 `format_goal_elapsed_seconds()` 和 `format_tokens_compact()`，例如 `1m`、`2d 23h 42m`、`40K / 50K`。

### /goal Summary

官方 `/goal` 裸命令显示一段 history lines：

- `Goal`
- `Status: ...`
- `Objective: ...`
- `Time used: ...`
- `Tokens used: ...`
- 可选 `Token budget: ...`
- 空行
- commands hint

Web 等价：

- Slash command `/goal` 不应打开右侧面板。
- 无参数时读取 `thread/goal/get` 并在消息时间线中追加 Goal summary 系统块。
- 不存在 goal 时显示官方等价的清晰提示，不伪造空 goal。
- `edit/pause/resume/clear` 子命令通过 app-server 方法执行，并把结果体现在 progress row 和消息提示中。

## 数据模型

建议新增纯转换层，避免 UI 直接解析协议：

- `goal-display-adapter.ts`
  - 输入：`ThreadGoal`
  - 输出：progress row label、usage、summary lines、可用 action。
  - 逻辑必须覆盖 `active/paused/blocked/usageLimited/budgetLimited/complete`。
- `plan-display-adapter.ts`
  - 输入：`PlanDeltaNotification`、`ThreadItem::Plan`、`TurnPlanUpdatedNotification`
  - 输出：`ProposedPlanBlock`、`UpdatedPlanBlock`。
- `plan-implementation-adapter.ts`
  - 输入：mode、last proposed plan、default-mode availability、queued state。
  - 输出：是否显示 prompt、三个 action 的 enabled/disabled 和 user message。

所有用户可见字段必须带 source breadcrumb：

- Proposed Plan：`app-server.item/plan/delta` 或 `app-server.item/completed`
- 历史 Proposed Plan：`app-server.thread/turns/list` 或 `app-server.thread/read`
- Updated Plan：`app-server.turn/plan/updated`
- Goal：`app-server.thread/goal/updated`、`app-server.thread/goal/get`、`app-server.thread/goal/cleared`

## 错误处理

- 未知 goal status：进入 diagnostics，不显示错误状态文本。
- `thread/goal/set/get/clear` 失败：composer 恢复可用，显示可见错误，不写入伪成功状态。
- `item/plan/delta` 在非 Plan mode 到达：按 TUI 语义忽略展示，但保留 diagnostics。
- plan 流式 delta 与 completed plan 文本不一致：以 completed `ThreadItem::Plan.text` 为最终权威。
- `turn/plan/updated` 没有 steps：显示低优先级空态，不显示任务进度数字。

## 验收标准

- 普通消息不会显示 Goal row、Proposed Plan、Updated Plan。
- Plan mode proposed plan 实时显示，完成后合并为 `Proposed Plan`，刷新后只 replay 真实 `ThreadItem::Plan`。
- `turn/plan/updated` 显示 `Updated Plan` checklist，completed / inProgress / pending 状态可区分。
- Plan mode 完成 proposed plan 后显示 `Implement this plan?` 三选项；历史 replay 不弹。
- active goal 显示 composer 上方 progress row；pause/resume/edit/clear 后状态来自 app-server notification 或 response。
- 无 token usage 时不显示 `0`；无 goal 时不显示空 progress row；无 MCP 状态时不显示“正常”。
- 代码逻辑测试覆盖 `codex-rs` 的关键分支：goal usage 文案、plan implementation prompt gating、非 Plan mode delta 忽略、空 plan steps。

## 设计自查

- 没有新增右侧 GoalPanel / PlanPanel。
- 没有把 plan/goal 状态从 assistant 文本中推断出来。
- 没有绕过 app-server 方法或 approval 流程。
- 没有直接复用 `CodexBrowser` / `CodePilot` 代码。
- 没有修改 `/home/rrssnas/code/CodexWeb`。
