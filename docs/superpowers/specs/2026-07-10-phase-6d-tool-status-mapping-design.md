# Phase 6D：工具状态完整映射设计

## 背景

Phase 6B 已经把工具输出展示截断对齐到官方 `DEFAULT_OUTPUT_BYTES_CAP = 1024 * 1024`，并继续复用 CodexWeb 的 5 行折叠展示。Phase 6C 已经把 approval 队列语义对齐到官方 TUI 的排队和 resolved 移除模型。

Phase 6D 聚焦工具 item 的状态语义。当前 Web 已经支持 `commandExecution`、`fileChange`、`mcpToolCall` 的基础展示，但实时 adapter 和历史 adapter 各自实现映射逻辑，状态只粗略折成 `running / success / error`。这会带来两个问题：

- 实时消息和历史 transcript 对同一个 app-server item 可能展示不一致。
- generated schema 中已有的状态、duration、source 等 breadcrumb 没有稳定进入 CodexWeb 工具输入或结果摘要。

## 官方事实源

本阶段以 generated schema 和官方 TUI 为准。

generated schema 中的工具状态：

- `commandExecution.status`: `inProgress | completed | failed | declined`
- `fileChange.status`: `inProgress | completed | failed | declined`
- `mcpToolCall.status`: `inProgress | completed | failed`
- `dynamicToolCall.status`: `inProgress | completed | failed`
- `collabAgentToolCall.status`: `inProgress | completed | failed`

`interrupted` 是 `TurnStatus`，不是这些工具 item 的状态。Web 不得把 interrupted 或 cancelled 伪造成工具 item 状态；若 turn 被中断，应由 turn 级 UI、diagnostics 或历史会话状态承载。

官方 TUI 的对应行为：

- exec / MCP 进行中显示活动态，完成后根据成功或失败显示结果态。
- exec 输出展示使用 `TOOL_CALL_MAX_LINES = 5` 的头尾折叠。
- command 的失败主要来自 app-server 状态、非零 exit code 或执行失败。
- MCP 的失败来自 `failed` 状态、error，或 result 内的 error 标志。

## 推荐方案

新增一个共享的工具映射层，让实时 `tool-adapter` 和历史 `thread-history-adapter` 复用同一套状态判断与结果格式化规则。

职责边界：

- `tool-adapter` 仍负责把当前 running turn 转成 CodexWeb 可渲染的 `toolUses`、`toolResults` 和 `streamingToolOutput`。
- `thread-history-adapter` 仍负责把 `thread/read` 返回的历史 items 转成 CodexWeb 消息块。
- 新共享 helper 只负责纯数据转换：识别 tool item、生成 tool use、生成 tool result、判断 error、格式化 source breadcrumb 和 display output。

工具类型覆盖：

- `commandExecution`：保留 `command`、`cwd`、`source`、`status`、`durationMs`、`exitCode`、`commandActions`；完成后结果包含输出预览和 exit code；`failed`、`declined`、非零 exit code 都视为 error。
- `fileChange`：保留 `status`、文件列表、change kind 和 diff 来源；完成后结果包含状态、文件数和路径摘要；`failed`、`declined` 视为 error。
- `mcpToolCall`：保留 `server`、`tool`、`arguments`、`appContext`、`pluginId`、`status`、`durationMs`；完成后展示 structured content / content / error；`failed`、error、result `isError` 视为 error。
- `dynamicToolCall`：映射为 `dynamic:<namespace>/<tool>` 或 `dynamic:<tool>`；保留 `arguments`、`status`、`success`、`durationMs`；完成后展示 `contentItems`；`failed` 或 `success === false` 视为 error。
- `collabAgentToolCall`：映射为 `collab:<tool>`；保留 sender、receivers、prompt、model、reasoning effort、agentsStates、status；完成后展示接收线程和 agent 状态摘要；`failed` 视为 error。

## 展示策略

CodexWeb UI 层保持现有风格：

- 不改整体布局。
- 不搬 Ratatui / Crossterm UI。
- 工具组默认折叠策略沿用现状：运行中自动展开，历史或完成态默认折叠，用户可展开查看详情。
- 输出仍先经过 Phase 6B 的展示截断，再进入 CodexWeb 工具 result。

Phase 6D 只补齐状态与 source breadcrumb，不做完整 transcript 弹窗、下载原始 stdout、独立 stderr 面板或复杂工具详情页。

## 数据流

实时路径：

1. app-server notification 更新 `AppServerTurnState.items`、`toolOutputs`、`filePatchChanges`、`mcpProgress`。
2. `deriveCodexWebToolState()` 调用共享 helper。
3. 共享 helper 输出 CodexWeb `tool_use`、`tool_result` 和运行中输出。
4. `ChatView` / `ToolActionsGroup` 按现有组件渲染。

历史路径：

1. `thread/read { include_turns: true }` 返回 `Thread.turns[].items`。
2. `threadToMessages()` 调用共享 helper。
3. 历史工具 block 与实时工具 block 使用同一套 result/error/status 语义。

## 错误处理

- 对 schema 已知但暂不支持的 item，继续计入 unsupported diagnostics，不静默丢弃。
- 对未知 status，保留原始 status 字符串，按 error 处理，并在 result 中显示 `status: <value>`，避免误报 success。
- 对空输出的 completed command，保持 CodexWeb 现有 `(no output)` 行为，同时保留 exit code 和 status breadcrumb。
- 对 turn interrupted，不修改工具 item；由现有 turn 状态展示继续承担中断提示。

## 验证标准

单元测试：

- 实时 adapter 覆盖 command `completed / failed / declined / non-zero exit`。
- 实时 adapter 覆盖 fileChange `completed / failed / declined`。
- 实时 adapter 覆盖 MCP `completed / failed / result isError`。
- 实时 adapter 覆盖 dynamic tool `completed / failed / success false`。
- 实时 adapter 覆盖 collab tool `completed / failed`。
- 历史 adapter 验证与实时 adapter 对同类 item 的 result/error/status 语义一致。
- 验证 turn `interrupted` 不被伪造成 tool item 状态。

集成验证：

- 运行 `npm run test -- src/codex-web/tool-adapter.test.ts`。
- 运行 `npm run test -- src/codex-web/thread-history-adapter.test.ts`。
- 风险允许时运行 `npm run test`。
- 提交前按项目规则恢复 `next-env.d.ts`，避免 Next build 改写进入提交。

Smoke Ledger 需要记录至少一个反例：

- 普通消息不出现工具 cell。
- command success 和 failed/non-zero exit 的工具 result 状态不同。
- interrupted turn 显示为 turn 级状态，不显示为工具 cancelled/interrupted。

## 不做范围

- 不新增浏览器端 app-server 私有协议。
- 不改 `codex-core` 或官方 generated schema。
- 不把本地真实 `CODEX_HOME` 用于开发、测试或普通 smoke。
- 不做历史归档、删除、重命名入口。
- 不做完整 transcript 或原始输出下载功能。
