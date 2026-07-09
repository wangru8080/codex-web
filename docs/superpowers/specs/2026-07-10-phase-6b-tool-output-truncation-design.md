# Phase 6B 工具输出截断设计

关联计划：`docs/superpowers/plans/2026-07-10-phase-6b-tool-output-truncation.md`

## 背景

CodexWeb 的 `ToolActionsGroup` 已经会在 UI 层按 5 行头尾折叠工具输出，这一点接近官方 TUI 的 `TOOL_CALL_MAX_LINES = 5`。但 `src/codex-web/tool-adapter.ts` 和 `src/codex-web/thread-history-adapter.ts` 仍需要一层展示保护，避免未按官方 cap 返回的超大 stdout、stderr 或 MCP JSON 结果塞进消息状态。

官方对齐点：

- `/home/rrssnas/code/codex/codex-rs/utils/pty/src/lib.rs` 定义 `DEFAULT_OUTPUT_BYTES_CAP = 1024 * 1024`。
- `/home/rrssnas/code/codex/codex-rs/core/src/exec.rs` 的 shell tool 输出使用该 1 MiB 上限，并按前缀保留输出。
- `/home/rrssnas/code/codex/codex-rs/core/src/mcp_tool_call.rs` 的 MCP result 事件也使用同一上限族。
- `/home/rrssnas/code/codex/codex-rs/tui/src/exec_cell/render.rs` 展示层再按行做头尾折叠，并提示 transcript。

Phase 6B 只解决展示层的大字符串问题：Web UI 不改协议，不新增“查看完整输出”入口，不比官方更早裁掉 12KB 之外内容。

## 目标

- 实时工具输出和完成后的工具结果进入 CodexWeb 消息结构前做官方 1 MiB 展示保护。
- 历史会话恢复时，对 commandExecution 和 MCP tool result 做同一策略截断。
- 截断提示必须用户可见，说明按官方 `DEFAULT_OUTPUT_BYTES_CAP` 截断，并说明省略字节数。
- 短输出保持原样，避免改变已有 UI 和测试快照。

## 非目标

- 不修改 app-server 协议、bridge 存储或 generated schema。
- 不在浏览器端保存完整输出副本。
- 不新增弹窗、下载、复制完整输出等 UI。
- 不调整 CodexWeb 的视觉布局和工具 cell 折叠规则。

## 方案

新增 `src/codex-web/tool-output-display.ts`，提供 `formatToolDisplayOutput(text, options)`。当 UTF-8 字节长度不超过 `1024 * 1024` 时原样返回；超过阈值时保留前 `1024 * 1024` 字节并插入中文截断提示。该策略对齐官方 core/app-server 的输出上限和前缀保留行为；CodexWeb UI 层继续负责 5 行头尾折叠。

实时 adapter：

- `deriveCodexWebToolState()` 的 `streamingToolOutput` 使用展示截断。
- completed `commandExecution` 先截断 stdout/stderr 聚合文本，再追加 exit code，保留命令元数据。
- `fileChange` 的摘要、路径和 output 组合后截断。
- MCP result stringify 后截断。

历史 adapter：

- `commandExecutionResult()` 在追加 exit code 后截断。
- `formatMcpResult()` stringify 后截断。
- `fileChange` 历史目前只有摘要和路径，没有大 output，不额外扩展字段。

## 成功标准

- 超过 1 MiB 的 command 输出不会完整进入 `toolResults.content` 或 `streamingToolOutput`。
- 长 MCP structuredContent 不会完整进入历史 tool result。
- 截断提示包含官方 cap 名称和省略字节数。
- 短输出保持完全一致。
- `npm run test -- src/codex-web`、`npm run test`、`npm run build`、`npm run test:smoke` 在隔离 `CODEX_HOME` 下通过。

## 自审

- 无占位项，要求已经明确。
- 方案只作用于展示字符串，不改变 app-server 事实源；阈值和前缀保留行为已对齐官方。
- 与 Phase 6A 历史分页无冲突，分页只决定取哪些 turn，本阶段只决定每个工具结果如何进入消息展示。
