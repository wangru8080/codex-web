# AGENTS.md

Codex Web 是基于官方 `openai/codex` 的浏览器 Web 版本。开发主线是围绕官方 `codex-rs/tui` 做 TUI-first Web 化：以 TUI 的业务语义、交互流程、app-server 接线和错误收口为主参考，在浏览器中重新实现等价体验。

## 核心边界

- 官方 `codex-rs/tui` 是产品行为和业务语义基准。
- `codex app-server` 是运行时事实源。Web UI 状态必须来自 app-server request、notification 和 server request。
- 第一版采用 Web bridge 连接已安装的 `codex app-server --stdio`，不改 `codex-core`。
- 浏览器不能直接连接本地进程；必须经过 Web bridge。
- `CodexBrowser` 和 `CodePilot` 只能用于借鉴 Codex app-server 相关逻辑、开发流程和测试经验；禁止直接移植、复制或复用两者代码。
- 开发、单元测试、smoke 测试和手动调试默认不得使用本地真实 `CODEX_HOME`。必须使用隔离环境：`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 只有最终验收阶段，且用户明确同意后，才允许切回本地真实 `CODEX_HOME` 做验收。

## 架构

```text
浏览器 Web UI
  |
  | WebSocket / HTTP
  v
Web bridge
  |
  | JSON-RPC
  v
codex app-server
```

Web bridge 负责启动或连接 `codex app-server --stdio`、转发 JSON-RPC、接收 notification stream、处理 app-server 发起的 approval/server request，并提供 localhost token、Origin 校验和连接失败收口。

## TUI-first 工作方式

新增 Web 功能前必须先对照官方 TUI：

1. 找到 TUI 中对应的用户流程和模块。
2. 确认 TUI 调用的 app-server method。
3. 确认 TUI 处理的 notification / server request。
4. 确认 running、completed、failed、interrupted 等状态如何展示。
5. 在 Web 中重新设计布局和组件，不搬 Ratatui、Crossterm 或 TUI UI 代码。

常用 TUI 参考：

- `../codex-rs/tui/src/app/app_server_events.rs`
- `../codex-rs/tui/src/app_server_session.rs`
- `../codex-rs/tui/src/app_server_approval_conversions.rs`
- `../codex-rs/tui/src/diff_model.rs`
- `../codex-rs/tui/src/resume_picker.rs`

## 禁止事项

- 禁止复制、移植或复用 `CodexBrowser` / `CodePilot` 代码。
- 禁止把 Ratatui 组件改造成 HTML。
- 禁止让浏览器直接连接 unsupported app-server websocket transport 作为第一版方案。
- 禁止在浏览器端保存 OAuth access token、refresh token、API key 或复制来的 `CODEX_HOME` 凭据。
- 禁止在开发、测试、smoke 或普通调试中隐式读取本地真实 `CODEX_HOME`。
- 禁止显示没有真实 app-server 来源的假状态、假数字或 placeholder。
- 禁止绕过 app-server approval 流程。

## CODEX_HOME 隔离

默认开发环境必须显式设置：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
```

适用范围：

- `codex app-server --stdio` 手动调试。
- Web bridge 启动 app-server。
- `npm run test`、`npm run test:smoke`、Playwright、Vitest 和所有会触发 app-server 的测试。
- 任何会读取账号、配置、历史会话、MCP、skills、approval 记录或模型设置的命令。

要求：

- 测试 fixture、脚本和 smoke runner 必须把 `CODEX_HOME` 作为显式环境变量传入子进程。
- UI diagnostics 必须能显示当前 app-server 使用的是隔离 `CODEX_HOME` 还是本地真实 `CODEX_HOME`。
- 隔离环境可以参考 `CodexBrowser` 的隔离环境要求和经验，但不得复用其实现代码。
- 最终验收使用本地真实 `CODEX_HOME` 前，必须先记录隔离环境测试结果，并得到用户明确同意。

## 语义验收

所有用户可见字段都必须有 source breadcrumb：

- 模型列表：`app-server.model/list`
- 登录状态：`app-server.account/read` 或 `account/updated`
- Thread 状态：`thread/started`、`thread/status/changed`
- Turn 状态：`turn/started`、`turn/completed`
- Item 内容：`item/*`
- Approval：app-server server request
- Token usage：`thread/tokenUsage/updated`
- Goal：`thread/goal/updated`、`thread/goal/cleared`
- Plan：`turn/plan/updated`、`item/plan/delta`
- Diagnostics：未知 notification、transport close、app-server stderr 摘要

没有真实来源时隐藏字段、显示 unsupported，或明确标记为估算。

## 测试

第一版建议脚本：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run typecheck
npm run test
npm run build
npm run test:smoke
```

测试分层：

- Unit：JSON-RPC request/response、notification dispatch、server request routing、reducer、selector。
- Smoke：页面启动、bridge 启动 app-server、initialize、model/list、thread/start、turn/start、delta、turn/completed。
- E2E：approval、interrupt、history/resume、diagnostics 等高风险路径。

不得声称测试通过，除非实际运行对应命令。

## 文档和计划

- 活跃执行计划放 `docs/exec-plans/active/`。
- 完成后移动到 `docs/exec-plans/completed/`。
- 延后计划放 `docs/exec-plans/deferred/`。
- 中大型功能必须先写执行计划再实现。
- 完成任一阶段后同步 checklist、状态总览、决策日志和 Smoke Ledger。

## 提交

- Commit message 使用中文说明，标题可用 conventional commits 格式。
- 提交前确认没有临时日志、截图、调试输出误入仓库。
- 不要自动 `git push`，除非用户明确要求。
