# Phase 6F：工具历史 fallback 与独立工具验证设计

## 背景

Phase 6E 已验证实时工具状态和 interrupted 刷新恢复路径。真实浏览器验证时发现当前隔离环境缺少 `thread/turns/list` experimental capability，历史页会回退到 `thread/read { includeTurns: true }`。在该 fallback route 中，页面能显示 assistant 汇总文本和 interrupted notice，但没有稳定看到历史工具 cell。

这可能有两种原因：

- `thread/read(includeTurns:true)` 的真实 `Thread.turns[].items` 包含工具 item，但 Web 历史渲染链路没有正确保留或展示工具块。
- `thread/read(includeTurns:true)` 只返回 assistant 汇总文本，不包含可恢复的工具 item；这种情况下 Web 不应从文本里猜造工具状态。

Phase 6F 先区分这两种情况，再做精准修复或明确降级。

## 官方与 UI 基准

官方 TUI 的历史 transcript 使用 `thread/read(include_turns=true)`，逐个读取 `ThreadItem`：

- `CommandExecution` 显示 `$ command`、`status`、`exit` 和 `aggregated_output`。
- `FileChange` 显示 file changes 状态和变更数。
- `McpToolCall` 显示 MCP server/tool 和状态。
- dynamic / collab 等工具使用 fallback transcript cell 显示工具名和状态。

CodexWeb 的 UI 基准不是逐行 Ratatui cell，而是：

- 历史 assistant message 解析结构化 `tool_use` / `tool_result` blocks。
- `ProcessCollapseGroup` 承载历史过程区，默认折叠。
- `ToolActionsGroup` 展示工具标题、状态、输入摘要和输出详情。

Phase 6F 保持 CodexWeb 风格，但工具语义必须来自 app-server `ThreadItem`，不能由 assistant 汇总文本推断。

## 目标

- 观察并记录 `thread/read(includeTurns:true)` 在 fallback 环境下是否返回真实工具 item。
- 如果返回工具 item，修复历史 fallback 下的工具 cell 展示一致性。
- 如果不返回工具 item，显示或记录明确 degraded 结论，不伪造工具状态。
- 独立验证常见工具类别：读取/搜索文件、网页或网络访问、写文件或 fileChange。
- 更新执行计划和 Smoke Ledger，写明真实浏览器里哪些路径是工具 item 恢复，哪些只是 assistant 汇总。

## 范围

### 产品修复

- 检查 `thread-history-adapter` 输出的结构化 blocks 是否能被 `MessageItem` 解析为历史工具 process。
- 必要时增强历史工具 block 的 summary metadata，例如 `codex_summary`，让历史过程区标题、折叠状态和工具数量更稳定。
- 必要时补充 fallback notice 文案，说明当前 app-server 返回的历史不包含工具 item。

### 协议观察

- 新增只读观察脚本或测试 helper，读取指定 thread 并输出 turns/items 的类型摘要。
- 观察结果只保存到文档，不把临时 JSON 输出提交到仓库。

### 独立工具验证

如果历史 fallback 不含工具 item，仍需单独验证工具类别：

- 文件读取/搜索类：请求 Codex 读取仓库内一个确定存在的小文件，例如 `package.json` 或 `README`。
- 网页或网络类：请求 Codex 访问一个稳定网页，优先记录 approval、网络失败或 sandbox 限制；不得把网络失败当作工具 UI 失败。
- 写文件类：请求 Codex 写入隔离临时路径下的小文件，路径必须在允许的临时目录或仓库测试夹内；若会产生清理对象，按项目清理规则另行确认。

这些验证的目标是工具 UI 与状态，而不是扩大 app-server 权限能力。

## 数据流

历史 fallback 工具恢复路径：

1. `/chat/[id]` 调用 `thread/read { includeTurns: false }` 获取 metadata。
2. `thread/turns/list` 因 experimental capability 不可用失败。
3. `/chat/[id]` fallback 调用 `thread/read { includeTurns: true }`。
4. `thread-history-adapter.threadToMessages()` 遍历 `Thread.turns[].items`。
5. 工具 item 通过 `tool-item-adapter` 转成 `tool_use` 和 `tool_result` blocks。
6. `MessageItem.parseToolBlocks()` 解析 JSON blocks。
7. `ProcessCollapseGroup` 默认折叠显示历史过程区，`ToolActionsGroup` 显示工具状态和详情。

如果第 4 步没有工具 item，Web 只能显示 app-server 返回的 agentMessage，不从文本中构造工具 cell。

## 验证标准

Targeted tests：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/thread-history-adapter.test.ts
npm run test -- src/components/chat/MessageItem.test.tsx
```

如果当前没有 `MessageItem` 测试文件，优先新增一个聚焦解析和渲染的测试；不要引入大型 E2E runner。

完整验证：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run build
npm run test:smoke
```

真实浏览器验证：

- 打开已有或新建工具 thread 的历史 route。
- 若历史 `ThreadItem` 包含工具 item：刷新后仍显示历史工具 process，工具默认折叠，展开后可见 output、status、exit code 或 source breadcrumb。
- 若历史 `ThreadItem` 不包含工具 item：页面不得伪造工具 cell，文档记录 app-server 返回限制。
- 独立工具验证覆盖 file read/search、web/network、write/fileChange 至少三类中的可触发路径，并记录 approval、失败原因和 console 状态。

## 不做范围

- 不新增一套与 CodexWeb 不一致的历史工具 UI。
- 不把 assistant 汇总文本解析成伪工具状态。
- 不修改 generated schema 或 app-server。
- 不使用本地真实 `CODEX_HOME`。
- 不在未确认清理方案前移动或删除测试产生的文件。
- 不把网络、账号、额度或 sandbox 限制伪装成 UI 通过。
