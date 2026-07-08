# 基于官方 Codex 的 Web 前端项目实施方案

> 创建日期：2026-07-05  
> 目标仓库：`/home/rrssnas/code/codex`  
> UI 基准项目：`/home/rrssnas/code/CodexWeb`  
> 参考项目：`/home/rrssnas/code/CodexBrowser`、`/home/rrssnas/code/CodePilot`  
> 方案定位：在官方 `openai/codex` 开源代码基础上新增 Web 前端 surface，核心 Codex 执行逻辑保持不改。
> UI 边界：当前项目的 Web UI 基于 `CodexWeb` 开发；不得直接修改 `CodexWeb` 目录，可复制相关 UI 代码到当前项目后接入真实 `codex app-server` 后端。
> 参考边界：`CodexBrowser` 和 `CodePilot` 只能用于借鉴 Codex app-server 相关逻辑、产品/开发流程和测试经验；禁止直接移植、复制或复用两者的代码实现。
> 环境限制：开发、测试、smoke 和普通调试默认不得使用本地真实 `CODEX_HOME`；必须使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。最终验收阶段才允许在用户明确同意后切回本地真实 `CODEX_HOME`。

## 1. 结论

可以基于官方 `openai/codex` 开源代码开发 Web 前端。正确路线是以官方 `codex-rs/tui` 的业务语义、交互流程和状态处理作为主参考，以 `/home/rrssnas/code/CodexWeb` 作为 Web UI 样式、布局和组件体验基准，把真实 `codex app-server` 后端接入到 CodexWeb 风格的浏览器工作台中；不是把 Ratatui 终端组件直接改成 HTML，也不是迁移 `CodexBrowser` 或 `CodePilot` 代码。执行层继续复用 `codex-core`、`codex-app-server`、`codex-app-server-client` 和 `codex-app-server-protocol`。

推荐架构：

```text
Browser Web UI
  |
  | WebSocket / HTTP / SSE
  v
codex-web-server
  |
  | typed request / event stream
  v
codex-app-server-client
  |
  | in-process app-server 或 stdio/unix socket bridge
  v
codex-app-server
  |
  v
codex-core
```

如果采用“服务器已安装 `codex-cli`，根目录独立开发 `web/`”的模式，运行时链路可以简化为：

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

这条链路中，`Web bridge` 负责浏览器无法直接完成的本地能力：启动或连接 `codex app-server --stdio`、转发 JSON-RPC、接收 notification stream、处理 app-server 发起的 approval/server request，并提供 localhost token、Origin 校验和连接失败收口。`codex app-server` 继续负责 Codex 核心执行、模型调用、工具调用、沙箱、审批和会话存储，Web 侧不重写这些底层逻辑。

核心判断：

- `codex-core` 不改，除非 app-server 缺少 Web 必需的协议字段。
- `codex-app-server` 是 Web、IDE、桌面 rich interface 的事实接口，应作为 Web 前端的主后端。
- `codex-rs/tui` 是 Web 版本的主业务参考：Thread / Turn / Item 展示、approval、diff、history/resume、Plan/Goal、状态栏、错误收口等用户语义优先对齐 TUI。
- `CodexWeb` 是 Web UI 的主视觉和组件参考：开发前必须阅读 `/home/rrssnas/code/CodexWeb/README.md`，保持其左右侧边栏、聊天区、消息流、工具 Cell、输入框、文件树和工作区侧栏的既有样式与 Demo 展示结构。
- 不得直接在 `/home/rrssnas/code/CodexWeb` 目录下修改代码；如需使用其 UI，可复制相关代码到当前项目并替换 mock 数据来源。
- `codex-rs/tui` 不能整体搬到 Web。它大量混合 Ratatui 渲染、键盘事件、终端布局和 snapshot 测试；Web 只能围绕其业务语义和 app-server 接线方式重新实现浏览器交互。
- `CodexBrowser` 只能作为次级参考，用于借鉴 app-server JSON-RPC 连接思路、local/SSH transport 边界、reducer 职责、approval 状态模型、session 管理思路和测试分层；禁止复制、移植或复用其代码。
- `CodePilot` 只作为历史流程、测试分层、文档治理、Smoke Ledger 和语义验收参考；禁止复制、移植或复用其代码，也不应迁移它的多 provider、多 runtime、Electron 发版和 CodePilot tool bridge。
- 开发和测试必须隔离 `CODEX_HOME`：所有会启动 `codex app-server`、读取账号/配置/历史、执行 smoke 的命令，都必须显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`；最终验收才允许切回本地真实 `CODEX_HOME`。

## 2. 分析范围

### 2.0 CodexWeb UI 基准

已重点查看：

- `/home/rrssnas/code/CodexWeb/README.md`

开发规则：

- `CodexWeb` 已实现主要 UI，当前项目应保持其 UI 样式和布局，不得擅自改动整体视觉与交互。
- 不直接修改 `/home/rrssnas/code/CodexWeb`；允许复制必要 UI 代码到当前项目后接入真实 app-server。
- 左右侧边栏、聊天页、消息流、工具 Cell、输入框、文件树和工作区侧栏均以 CodexWeb README 描述的 Demo 结构为对照基准。
- `codex app-server` 的 initialize、model/list、account/read、thread/start、turn/start 和 notification stream 需要接入到 CodexWeb 风格 UI 的对应数据入口。

### 2.1 官方 Codex 仓库

已重点查看：

- `/home/rrssnas/code/codex/AGENTS.md`
- `/home/rrssnas/code/codex/codex-rs/Cargo.toml`
- `/home/rrssnas/code/codex/codex-rs/app-server/README.md`
- `/home/rrssnas/code/codex/codex-rs/app-server/Cargo.toml`
- `/home/rrssnas/code/codex/codex-rs/app-server-client/src/lib.rs`
- `/home/rrssnas/code/codex/codex-rs/app-server-protocol/src/lib.rs`
- `/home/rrssnas/code/codex/codex-rs/tui/Cargo.toml`
- `/home/rrssnas/code/codex/codex-rs/tui/src/lib.rs`
- `/home/rrssnas/code/codex/codex-rs/tui/src/app/app_server_events.rs`
- `/home/rrssnas/code/codex/codex-rs/tui/src/app_server_session.rs`
- `/home/rrssnas/code/codex/codex-rs/tui/src/app_server_approval_conversions.rs`
- `/home/rrssnas/code/codex/codex-rs/tui/src/diff_model.rs`

### 2.2 CodexBrowser

已重点查看。以下源码文件只用于理解 app-server 接线职责、状态边界和测试覆盖方式，不作为代码来源：

- `/home/rrssnas/code/CodexBrowser/AGENTS.md`
- `/home/rrssnas/code/CodexBrowser/package.json`
- `/home/rrssnas/code/CodexBrowser/docs/README.md`
- `/home/rrssnas/code/CodexBrowser/docs/exec-plans/README.md`
- `/home/rrssnas/code/CodexBrowser/docs/handover/codex-browser-app-development.md`
- `/home/rrssnas/code/CodexBrowser/docs/guardrails/CodexAppServer.md`
- `/home/rrssnas/code/CodexBrowser/docs/guardrails/CodexReducer.md`
- `/home/rrssnas/code/CodexBrowser/src/codex/core/client.ts`
- `/home/rrssnas/code/CodexBrowser/src/codex/core/connection-manager.ts`
- `/home/rrssnas/code/CodexBrowser/src/codex/runtime/session-manager.ts`
- `/home/rrssnas/code/CodexBrowser/src/codex/state/reducer.ts`

### 2.3 CodePilot

已重点查看。以下文件只用于理解开发流程、测试分层和文档治理经验，不作为代码来源：

- `/home/rrssnas/code/CodePilot/AGENTS.md`
- `/home/rrssnas/code/CodePilot/CLAUDE.md`
- `/home/rrssnas/code/CodePilot/ARCHITECTURE.md`
- `/home/rrssnas/code/CodePilot/package.json`
- `/home/rrssnas/code/CodePilot/docs/exec-plans/README.md`

## 3. 官方 Codex 结构判断

### 3.1 可稳定复用的核心层

官方仓库已经按 Rust crate 拆分出 Web 需要的核心能力：

| 层级 | 路径 | Web 方案中的作用 |
|---|---|---|
| 核心执行 | `codex-rs/core` | 模型交互、工具调用、沙箱、会话执行、上下文管理。原则上不改。 |
| 协议层 | `codex-rs/app-server-protocol` | JSON-RPC 的 typed request、response、notification、server request 类型。Web 必须以它为类型源。 |
| 服务层 | `codex-rs/app-server` | Codex rich interface 的后端能力，已支持 thread、turn、item、approval、model、account、MCP、Skills、config、fs 等 API。 |
| 客户端 facade | `codex-rs/app-server-client` | 已封装 in-process app-server、typed request、event stream、server request resolve/reject、背压策略。 |
| 终端 UI | `codex-rs/tui` | 可参考状态处理和交互语义，但不可整体复用为 Web 业务层。 |

官方 `app-server/README.md` 明确说明：

- `codex app-server` 是 rich interfaces 的接口。
- 协议为 JSON-RPC 2.0。
- 支持 stdio、websocket、unix socket、off。
- websocket transport 标记为 experimental / unsupported。
- 类型可通过 `codex app-server generate-ts` 和 `generate-json-schema` 生成。
- 核心对象为 Thread、Turn、Item。
- 生命周期是 initialize -> initialized -> thread/start 或 thread/resume -> turn/start -> notification stream -> turn/completed。

### 3.2 围绕官方 TUI 的 Web 化原则

开发逻辑应围绕官方 TUI 展开：先分析 TUI 在当前功能上的用户流程、app-server 请求、notification 处理、阻塞状态和错误收口，再用浏览器组件重新实现同一套业务语义。TUI 是产品行为和验收基准，Web 是新的呈现层。

TUI 可借鉴或抽取的内容：

| TUI 位置 | 可复用方式 | 原因 |
|---|---|---|
| `app/app_server_events.rs` | 作为 Web event bridge 的主参考 | 区分 app-scoped、global、thread-scoped notification 和 server request。 |
| `app_server_session.rs` | 作为 Web typed RPC facade 的主参考 | 封装 thread、turn、model、account、goal、config 等 app-server request。 |
| `app_server_approval_conversions.rs` | 可抽取为共享小模块 | file change、permissions approval 转换较纯。 |
| `diff_model.rs` | 可借鉴语义或抽成共享 crate | Add/Delete/Update 文件变更模型简洁且可序列化。 |
| `resume_picker.rs` | 作为 thread/list、thread/read、resume 的主流程参考 | 不搬 Ratatui UI，只对齐分页、preview、pathless thread、cwd、thread name 等业务语义。 |
| `thread_transcript` 相关模块 | 作为历史 transcript item 展示规则参考 | 需要先隔离掉 Ratatui cell/line 类型，再重新设计 Web timeline。 |
| `app-server-client` 的背压分类 | 直接复用官方 crate | lossless notification 和 best-effort notification 的分类对 Web 同样重要。 |

不建议复用的内容：

- Ratatui widget、layout、Line、Span、Cell。
- Crossterm 键盘与终端模式。
- TUI 快捷键系统。
- TUI snapshot 渲染测试。
- `chatwidget.rs`、`bottom_pane/*` 这类高耦合 UI 组件。
- TUI 的 terminal-specific 文本 wrap 与 ANSI 视觉实现。

Web 版本的验收顺序：

1. 与 TUI 使用相同 app-server 协议事实源。
2. 与 TUI 对齐关键用户语义：会话、turn、item、approval、diff、history、Plan、Goal、错误状态。
3. 在浏览器中重新设计布局、交互和响应式表现。
4. 只有纯数据模型或协议转换足够独立时，才考虑抽成共享 crate；不得为了复用而牵引 Ratatui 依赖进入 Web。

### 3.3 是否需要改核心逻辑

第一版不需要改 `codex-core`。只有以下情况才进入核心或 app-server 改动：

1. app-server 没有暴露 Web 必需的事件或字段。
2. Web 需要响应某类 server request，而现有协议缺少 response 类型。
3. 官方协议已有字段，但 TypeScript 生成或 JSON schema 暴露不完整。
4. 需要支持浏览器直接 WebRTC/realtime 等实验能力，并且 app-server 当前只支持特定 transport。
5. 需要多用户/远程托管，这超出本地 Codex CLI 默认安全模型。

## 4. 参考项目经验

### 4.1 CodexBrowser 可借鉴的流程

CodexBrowser 的 AGENTS 和 docs 已经把目标定义得很接近：

- 只有一个 runtime：Codex app-server。
- 本地和 SSH 远程都通过 app-server 连接。
- app-server notification 是 UI 事实源。
- 状态通过 Thread / Turn / Item / Goal / Plan reducer 构建。
- 未知 notification 必须保留为 diagnostics 或 fallback item。
- 登录由 `account/login/start`、`account/read`、`account/logout` 管理。
- 模型来自 `model/list`。
- approval response 必须匹配具体 app-server schema。
- app-server 启动期间退出时 pending request 必须快速失败。
- 默认 `RUST_LOG=warn`，避免日志洪水。
- 开发和测试使用隔离 Codex home，避免污染本地真实 `CODEX_HOME`；本项目只借鉴这一隔离要求和测试经验，不复用其实现代码。

CodexBrowser 的目录分层可以作为职责划分参考，但不得直接迁移目录、复制文件或复用实现代码。官方 Web surface 应按 `openai/codex` 的仓库结构重新实现：

```text
src/codex/core/
  client.ts
  connection-manager.ts
  local-stdio-transport.ts
  ssh-stdio-transport.ts
  account.ts
  models.ts
  turns.ts
  approvals.ts

src/codex/runtime/
  local-session.ts
  session-manager.ts
  session-store.ts

src/codex/state/
  reducer.ts
  selectors.ts
  fixtures/

src/codex/ui/
  AppWorkbench.tsx
  ThreadTimeline.tsx
  ApprovalPanel.tsx
  PlanSidebar.tsx
  GoalPanel.tsx
```

CodexBrowser 的测试脚本：

```json
{
  "dev": "next dev",
  "build": "next build",
  "typecheck": "tsc --noEmit --project tsconfig.typecheck.json",
  "test:unit": "CODEX_DISABLED=1 node --import tsx --test \"src/__tests__/unit/**/*.test.ts\"",
  "test": "npm run typecheck && npm run test:unit",
  "test:smoke": "playwright test --config=playwright.config.ts --project=smoke",
  "test:e2e": "playwright test --config=playwright.config.ts"
}
```

该分层只用于说明职责边界。实际实现必须在官方 `openai/codex` 中重新编写，并以官方 app-server 协议和当前仓库约束为准。

### 4.2 CodePilot 可借鉴的流程

CodePilot 是历史参考，不适合迁移产品架构，也不得复制、移植或复用其代码。可借鉴的是工程流程：

- 中大型功能先写执行计划。
- 活跃计划放 `docs/exec-plans/active/`，完成后归档。
- 每个阶段有状态总览、Phase checklist、决策日志、Smoke Ledger。
- 测试分层明确：
  - Tier 0：纯视觉和样式，代码审查 + 浏览器视觉检查。
  - Tier 1：UI 行为、数据接线、文案、组件状态变化，需要 targeted test 或 smoke。
  - Tier 2：Runtime、DB、权限、Stream、MCP、Electron、发版链路，需要 targeted + full tests，必要时真实凭据 smoke。
- 用户可见数字、状态、权限提示、模型列表、上下文用量等必须有 source breadcrumb。
- 不显示假 0、placeholder 或未验证能力。
- UI 改动必须实际验证，但 CDP 只作为深度诊断备用。

不应迁移的 CodePilot 内容：

- Claude Code SDK runtime。
- Native AI SDK runtime。
- 多 provider 管理。
- OpenAI-compatible / Anthropic-compatible provider governance。
- Electron 发版链路。
- CodePilot Bridge、Media Studio、Tasks、Assistant Workspace、Skills marketplace。
- CodePilot provider proxy 和 tool bridge。

更明确地说，`CodePilot` 只能提供流程经验，例如执行计划组织、测试分层、语义验收、Smoke Ledger 和完成状态词典；不能作为代码来源。

## 5. 推荐实现路径

推荐采用 “TUI-first Web 化” 的执行方式：每个 Web 功能先找到 TUI 中对应的流程和 app-server 接线，再设计浏览器中的等价用户体验，最后补 reducer、组件和测试。`CodexBrowser` 和 `CodePilot` 只在流程经验和测试经验层面辅助判断，不参与代码迁移。

### 5.1 首选方案：官方仓库内新增 Rust Web server + Web UI

这是最符合官方仓库结构的方案。

新增：

```text
/home/rrssnas/code/codex/
  codex-rs/
    web-server/
      Cargo.toml
      src/
        main.rs
        lib.rs
        server.rs
        web_session.rs
        websocket.rs
        http_api.rs
        event_bridge.rs
        static_assets.rs
        security.rs
        tests/
    web-ui-model/
      Cargo.toml
      src/
        lib.rs
        event_reducer.rs
        approval_model.rs
        file_change.rs
        diagnostics.rs
        tests/
  web/
    package.json
    tsconfig.json
    vite.config.ts 或 next.config.ts
    src/
      app/
      codex/
        protocol/
        client/
        state/
        ui/
      tests/
```

特点：

- Rust 后端直接依赖 `codex-app-server-client`，可以启动 embedded in-process app-server。
- Web UI 通过 WebSocket 接收 event stream，通过 HTTP/WS 发送 user action。
- 前端类型从 `codex app-server generate-ts` 生成，不手写协议 shape。
- `web-ui-model` 只放从 TUI 业务语义中抽出的纯状态和转换逻辑，TUI 后续也可以选择依赖它，但第一阶段不强制改 TUI。
- 不依赖 app-server websocket transport，因为官方文档标记它 experimental / unsupported。

适用场景：

- 希望最终成为官方 Codex 仓库里一个新 surface。
- 希望复用官方 Rust 内部 crate，减少 Node 进程管理复杂度。
- 希望后续打包成 `codex web` 或 `codex web-server`。

### 5.2 备选方案：Node/Next.js Web bridge

该方案接近 CodexBrowser 的 app-server 接线思路，开发速度快。

新增：

```text
/home/rrssnas/code/codex/
  web/
    package.json
    src/
      app/
      codex/core/client.ts
      codex/core/local-stdio-transport.ts
      codex/core/connection-manager.ts
      codex/state/reducer.ts
      codex/ui/
```

特点：

- Node 后端通过 `spawn("codex", ["app-server", "--stdio"])` 管理 app-server。
- 借鉴 CodexBrowser 的 JSON-RPC client 职责划分和错误处理思路，但重新实现代码。
- 更容易快速做浏览器产品原型。
- 与官方 Rust workspace 集成较弱，后续如果要作为官方 surface，还要重新收口。

适用场景：

- 目标是快速验证 Web UI。
- 后续是否合入官方仓库不确定。
- 可参考 CodexBrowser 的 app-server 接线经验和测试覆盖方式，但不得复用其已有代码。

### 5.3 不推荐方案：直接魔改 TUI

不建议：

- 给 `codex-rs/tui` 增加 Web 输出。
- 把 Ratatui 组件改造成 HTML。
- 用浏览器模拟终端运行 TUI。

原因：

- TUI 的布局、输入、渲染与终端强绑定。
- Web 需要的是协议状态、事件流和审批语义，不是终端 widget。
- 直接改 TUI 会扩大维护成本，并违反官方 AGENTS 中“避免扩大高触文件”的原则。

## 6. 建议架构设计

### 6.1 后端模块

建议新增 `codex-rs/web-server`。

职责：

1. 启动本地 Web 服务，仅监听 `127.0.0.1`。
2. 生成一次性 Web token，前端连接必须携带 token。
3. 创建并持有 `codex-app-server-client::AppServerClient`。
4. 完成 initialize / initialized handshake。
5. 将 Web action 转换为 app-server typed request。
6. 将 app-server notification 和 server request 转发给前端。
7. 处理 approval response、tool request user input、MCP elicitation 等 server request。
8. 管理 pending request，连接关闭时快速失败。
9. 为前端提供静态资源或开发代理。
10. 对诊断日志进行限流和脱敏。

建议后端接口：

```text
GET  /healthz
GET  /readyz
GET  /api/bootstrap
GET  /api/models
GET  /api/account
POST /api/account/login/start
POST /api/account/logout
GET  /api/threads
POST /api/threads
GET  /api/threads/:threadId
POST /api/threads/:threadId/resume
POST /api/turns
POST /api/turns/:turnId/interrupt
POST /api/approvals/:requestId/respond
GET  /ws/events
```

第一版可更简单：

- 所有 request 都走 WebSocket RPC。
- HTTP 只负责 bootstrap、health、静态资源。
- WebSocket 消息保留 `method`、`id`、`params` 结构，便于映射 app-server。

### 6.2 前端模块

建议前端分层：

```text
web/src/codex/
  protocol/
    generated/
    jsonRpc.ts
    methodNames.ts
  client/
    webClient.ts
    eventStream.ts
  state/
    reducer.ts
    selectors.ts
    fixtures/
  ui/
    AppShell.tsx
    TopStatusBar.tsx
    ThreadSidebar.tsx
    ChatTimeline.tsx
    ItemRenderer.tsx
    Composer.tsx
    ApprovalPanel.tsx
    PlanPanel.tsx
    GoalPanel.tsx
    DiagnosticsPanel.tsx
    ConnectionPanel.tsx
```

主界面应以官方 TUI 的任务流为主参考，并在浏览器中重新组织成 chat-first workbench；可以借鉴 CodexBrowser 的布局经验，但布局、组件和实现代码必须重新设计和编写：

```text
┌────────────────────────────────────────────────────────────┐
│ 顶部状态栏：连接、账号、模型、cwd、sandbox、approval policy │
├───────────────┬──────────────────────────────┬─────────────┤
│ Thread 列表    │ Chat / Turn / Item Timeline   │ Context Rail │
│ 历史/搜索/恢复 │ Composer + Approval Blocking  │ Plan/Files/  │
│               │                              │ Diagnostics │
└───────────────┴──────────────────────────────┴─────────────┘
```

界面原则：

- app-server notification 是唯一事实源。
- 所有用户可见状态都显示 source breadcrumb 或在 diagnostics 中可追溯。
- 缺失真实来源时隐藏字段或显示 unsupported，不显示假数字。
- approval 是阻塞层，必须贴近 composer。
- Goal 显示在 composer 附近。
- Plan 显示在右侧任务栏。
- command output、file change、MCP status、Skills status 都以 item 或 diagnostics 表达。

### 6.3 状态模型

建议抽 `codex-rs/web-ui-model` 或前端 `state/reducer`，第一版先在前端实现，稳定后再考虑 Rust 共享 crate。

核心状态：

```ts
interface CodexWorkbenchState {
  activeThreadId?: string;
  threadOrder: string[];
  threads: Record<string, CodexThreadState>;
  approvals: Record<string, CodexApprovalState>;
  diagnostics: CodexDiagnosticEvent[];
  connection: CodexConnectionState;
}

interface CodexThreadState {
  threadId: string;
  name?: string;
  status?: string;
  cwd?: string;
  goal?: CodexGoalState | null;
  usage?: CodexTokenUsageState;
  turnOrder: string[];
  turns: Record<string, CodexTurnState>;
  itemOrder: string[];
  items: Record<string, CodexThreadItemState>;
}

interface CodexTurnState {
  turnId: string;
  threadId: string;
  status: string;
  itemIds: string[];
  plan?: CodexPlanState | null;
  error?: CodexTurnErrorState | null;
}

interface CodexThreadItemState {
  itemId: string;
  threadId: string;
  turnId?: string;
  type: string;
  status: string;
  text?: string;
  reasoningText?: string;
  summaryText?: string;
  command?: string;
  outputText?: string;
  fileChanges?: CodexFileChangeState[];
}
```

必须覆盖的 notification：

- `thread/started`
- `thread/status/changed`
- `thread/name/updated`
- `thread/goal/updated`
- `thread/goal/cleared`
- `thread/tokenUsage/updated`
- `thread/settings/updated`
- `turn/started`
- `turn/completed`
- `turn/plan/updated`
- `item/started`
- `item/completed`
- `item/agentMessage/delta`
- `item/reasoning/textDelta`
- `item/reasoning/summaryTextDelta`
- `item/plan/delta`
- `item/commandExecution/outputDelta`
- `item/fileChange/patchUpdated`
- `mcpServer/startupStatus/updated`
- `account/updated`
- `account/rateLimits/updated`
- `serverRequest/resolved`
- `error`
- `warning` 或 `configWarning`

未知 notification：

- 保留 `method`、`receivedAt`、`threadId`、脱敏后的 `params`。
- 显示在 Diagnostics。
- 不得静默丢弃。

### 6.4 Approval 模型

Web approval 必须按 app-server server request schema 响应，不做通用 `{ decision }`。

第一版必须支持：

- command execution approval。
- file change approval。
- permissions request approval。
- tool request user input。
- MCP elicitation 或 form request。

审批 UI 必须显示：

- 请求来源：`app-server.<method>`。
- threadId / turnId / itemId。
- 命令或文件路径。
- sandbox / permission profile 影响。
- allow / deny / allow for session 等可用动作。
- 严格失败模式：未知 approval type 默认拒绝并提示 unsupported。

### 6.5 本地与远程

第一阶段只做本地。

本地开发和测试也必须隔离 Codex home。默认环境为：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
```

适用范围：

- 手动运行 `codex app-server --stdio`。
- Web bridge 启动 app-server 子进程。
- 单元测试、集成测试、Playwright、smoke 测试。
- 会读取账号、配置、模型、历史、MCP、skills 或 approval 记录的命令。

最终验收才允许使用本地真实 `CODEX_HOME`。切换前必须先完成隔离环境 smoke，并得到用户明确同意；验收记录必须标明使用的是隔离 `CODEX_HOME` 还是本地真实 `CODEX_HOME`。

第二阶段支持 SSH remote，借鉴 CodexBrowser 已沉淀的安全边界和验收规则：

- 使用 `ssh -T` 在远端运行 `codex app-server`。
- 不跳过 `known_hosts` 校验。
- 不复制本机 `CODEX_HOME`、OAuth token、API key、SSH password、private key 到远端。
- 远端 `CODEX_HOME`、cwd、shell、文件路径、MCP、sandbox 均属于远端机器。
- UI 必须明确展示连接目标、远端 cwd、远端 capability degraded 状态。

## 7. 实施阶段

### Phase 0：协议和构建基线

目标：

- 确认官方仓库可构建。
- 确认 app-server 类型生成和基本请求可用。
- 明确 Web surface 放置位置。

任务：

1. 在 `/home/rrssnas/code/codex` 读取最新 `AGENTS.md` 和相关 crate 约束。
2. 运行只读调研：
   - `rg "generate-ts" codex-rs/app-server codex-rs/app-server-protocol`
   - `rg "ClientRequest" codex-rs/app-server-protocol/src`
   - `rg "ServerNotification" codex-rs/app-server-protocol/src`
3. 生成协议快照：
   - `codex app-server generate-ts --out web/src/codex/protocol/generated`
   - 若使用 Rust dev binary，则先确认对应命令路径。
   - 若命令会读取 Codex 配置，必须先执行 `export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
4. 决定前端构建工具：
   - 推荐 Vite + React，用于轻量 Web surface。
   - 如果需要接近 CodexBrowser 的开发节奏和 API route 组织方式，则选 Next.js。

验收：

- 生成的 TS 类型与当前 app-server 版本一致。
- 方案中记录 exact 命令和输出路径。
- 不修改 `codex-core`。

### Phase 1：最小 Web server

目标：

- 新增 `codex-rs/web-server`。
- 浏览器能打开本地页面并建立受保护 WebSocket。

建议文件：

```text
codex-rs/web-server/Cargo.toml
codex-rs/web-server/src/main.rs
codex-rs/web-server/src/lib.rs
codex-rs/web-server/src/server.rs
codex-rs/web-server/src/security.rs
codex-rs/web-server/src/websocket.rs
codex-rs/web-server/src/static_assets.rs
```

关键实现：

- 使用 `axum` 提供 HTTP/WebSocket。
- 只监听 `127.0.0.1`。
- 启动时生成随机 token。
- 控制台输出 URL：`http://127.0.0.1:<port>/?token=<token>`。
- WebSocket 检查 token 和 Origin。
- 提供 `/healthz` 和 `/readyz`。
- 启动或连接 app-server 时显式传入隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

安全要求：

- 禁止默认监听 `0.0.0.0`。
- 禁止无 token WebSocket。
- Origin 非 localhost 默认拒绝。
- token 不写入磁盘。

验证：

- Rust unit test 覆盖 token 校验。
- Playwright 或 HTTP test 覆盖无 token 被拒绝。
- 手动打开页面看到连接状态。

### Phase 2：连接 app-server

目标：

- Web server 通过 `codex-app-server-client` 启动 embedded app-server。
- 完成 initialize / initialized。
- 前端能读取 account、model/list、thread/list。

建议文件：

```text
codex-rs/web-server/src/app_server_bridge.rs
codex-rs/web-server/src/request_router.rs
codex-rs/web-server/src/event_bridge.rs
```

关键实现：

- 复用 `codex-app-server-client::InProcessAppServerClient` 或 `AppServerClient` facade。
- app-server 进程或 in-process client 默认使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- clientInfo 使用新名称，例如：
  - `name: "codex_web"`
  - `title: "Codex Web"`
  - `version: 当前包版本`
- 默认 capabilities 不开启 experimentalApi，除非 Web 功能明确需要。
- 将 app-server event 转为 Web event：
  - notification 直接透传 method + params。
  - server request 转为 approval/request state。
  - disconnected 转为 connection closed。
  - lagged 转为 diagnostics。

验证：

- unit test：pending request 在 app-server close 时快速失败。
- unit test：未知 notification 被转发。
- smoke：页面显示 model/list 结果。

### Phase 3：Web UI foundation

目标：

- 建立前端项目。
- 实现 AppShell、连接状态、模型列表、账号状态、空 thread 页面。

建议技术栈：

- React 19。
- TypeScript。
- Vite 或 Next.js。
- Playwright。
- Node test runner 或 Vitest。
- CSS module 或 Tailwind，取决于仓库偏好。若没有现成 design system，先用普通 CSS 保持轻量。

建议文件：

```text
web/package.json
web/tsconfig.json
web/src/main.tsx
web/src/app/App.tsx
web/src/codex/client/webSocketClient.ts
web/src/codex/state/reducer.ts
web/src/codex/ui/AppShell.tsx
web/src/codex/ui/ConnectionStatus.tsx
web/src/codex/ui/ModelPicker.tsx
web/src/codex/ui/AccountStatus.tsx
web/src/codex/ui/DiagnosticsPanel.tsx
web/tests/smoke/app.spec.ts
```

验收：

- `npm run typecheck` 通过。
- `npm run test` 通过。
- `npm run build` 通过。
- `npm run test:smoke` 可启动页面并看到 ready 状态。

### Phase 4：Thread / Turn / Item lifecycle

目标：

- 支持新建 thread。
- 支持发送 turn。
- 支持 streaming assistant message。
- 支持 turn completed。

UI：

- 左侧 thread list。
- 中央 ChatTimeline。
- 底部 Composer。
- 运行中状态和 interrupt 按钮。

状态 reducer：

- `thread/started` 创建 thread。
- `turn/started` 创建 turn。
- `item/started` 创建 item。
- `item/agentMessage/delta` 追加文本。
- `item/completed` 更新 item。
- `turn/completed` 更新 turn。
- `error` 进入 diagnostics 或 turn error。

验证：

- fixture unit test 覆盖完整 turn lifecycle。
- fixture unit test 覆盖 delta 顺序和 item completed。
- smoke：输入一条消息，看到流式输出和完成状态。
- 反例：app-server 断开时 composer 禁用，pending request 失败。

### Phase 5：Approval 和工具生命周期

目标：

- Web 支持 Codex 原生审批。
- 不破坏 app-server schema。

必须支持：

- command approval。
- file change approval。
- permissions approval。
- server request resolved 后关闭 approval。
- unsupported approval fail closed。

UI：

- ApprovalPanel 显示在 composer 上方。
- 文件变更显示 diff。
- 命令审批显示 cwd、command、sandbox/permission 影响。
- 响应动作明确：Allow、Deny、Allow for session 等。

验证：

- unit test：每类 approval 生成正确 app-server response。
- unit test：未知 approval 默认拒绝。
- smoke：触发一个需要 approval 的命令，允许后继续执行。
- 反例 smoke：拒绝后 turn 状态和 UI 提示正确。

### Phase 6：Plan / Goal / diagnostics

目标：

- 支持官方 Codex 的 Goal / Plan 原生 UI。
- 支持 diagnostics 和 operational status。

UI：

- GoalPanel 靠近 composer。
- PlanPanel 放右侧 Context Rail。
- DiagnosticsPanel 显示 unknown notification、lagged、config warning、app-server disconnect。

状态：

- `thread/goal/updated`
- `thread/goal/cleared`
- `turn/plan/updated`
- `item/plan/delta`
- `mcpServer/startupStatus/updated`
- `thread/tokenUsage/updated`

验证：

- fixture test 覆盖 Goal update/clear。
- fixture test 覆盖 Plan steps 和 streaming delta。
- 反例：没有 token usage 时不显示 0。
- smoke：普通会话和触发 plan 的会话 UI 差异可见。

### Phase 7：Thread history / resume

目标：

- 支持 thread/list、thread/read、thread/resume。
- 支持历史会话恢复。

参考 TUI：

- `resume_picker.rs` 中 thread list params、pathless thread、thread name、preview、cwd、git branch 处理值得参考。

UI：

- ThreadSidebar 显示历史 thread。
- 支持搜索。
- 支持 read preview。
- 支持 resume。
- pathless / remote thread 不因 path 缺失被隐藏。

验证：

- unit test：thread/list 参数生成正确。
- unit test：pathless thread 保留。
- smoke：启动新 thread，刷新页面后 list/read/resume 可用。

### Phase 8：SSH remote

目标：

- 支持连接远端 `codex app-server`。

实现：

- 后端新增 SSH transport。
- 使用 `ssh -T`。
- 不保存密码。
- 不跳过 host key 校验。
- 远端 cwd、远端 CODEX_HOME、远端 PATH 明确展示。

验证：

- unit test：SSH 参数转义和 env 构造。
- smoke：本地 profile 与 SSH profile 行为不同且 UI 可区分。
- 反例：远端能力缺失时显示 degraded，不冒充本地成功。

### Phase 9：打包和命令入口

目标：

- 增加用户可启动命令。

可选命令：

```bash
codex web
codex web --port 0
codex web --host 127.0.0.1
codex web --open
```

实现位置需结合现有 CLI：

- 若 `codex-rs/cli` 是统一入口，则新增 subcommand。
- 若更适合独立 binary，则提供 `codex-web-server`。

验证：

- `just test -p codex-web-server`
- 若修改 CLI，跑对应 CLI crate 测试。
- 手动启动并打开 URL。

## 8. 测试策略

所有测试默认使用隔离 `CODEX_HOME`：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
```

要求：

- 测试脚本和 smoke runner 必须把隔离 `CODEX_HOME` 显式传给会启动 app-server 的子进程。
- 不得在开发、单测、集成测试、smoke 或普通调试中隐式读取本地真实 `CODEX_HOME`。
- Smoke Ledger 必须记录本次使用的是隔离 `CODEX_HOME` 还是本地真实 `CODEX_HOME`。
- 最终验收使用本地真实 `CODEX_HOME` 前，必须先完成隔离环境 smoke，并获得用户明确同意。

### 8.1 Rust 测试

遵循官方 AGENTS：

- 不直接跑 `cargo test`，使用 `just test -p <crate>`。
- 修改 Rust 后运行 `just fmt`。
- 大改前后使用 scoped `just fix -p <project>`。
- 修改共享 crate 或协议 crate 后，考虑完整 `just test`，但完整测试需单独确认。

Web server crate 建议测试：

- token 校验。
- Origin 校验。
- WebSocket subscribe。
- app-server event bridge。
- server request resolve/reject。
- pending request close failure。
- backpressure / lagged event diagnostics。

### 8.2 前端单元测试

借鉴 CodexBrowser 的测试命令分层经验，官方 Web 项目需在自身 `package.json` 中重新定义等价命令：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run typecheck
npm run test:unit
npm run test
```

必须覆盖：

- JSON-RPC response 匹配。
- notification dispatch。
- server request routing。
- transport close 时 pending request fail。
- reducer thread lifecycle。
- reducer approval lifecycle。
- reducer unknown notification。
- selector 不显示假 token usage。

### 8.3 Smoke 测试

借鉴 CodexBrowser 和 CodePilot 的 smoke 分层与记录方式，官方 Web 项目需重新编写自己的 smoke 用例：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test:smoke
```

第一版 smoke 场景：

1. 页面打开，连接 ready。
2. 读取 model/list。
3. 新建 thread。
4. 发送 turn。
5. 收到 assistant delta。
6. turn completed。
7. 断开连接显示 degraded。

审批 smoke：

1. 使用需要 approval 的命令。
2. UI 显示 ApprovalPanel。
3. 点击 allow 后继续。
4. 点击 deny 后 turn 正确结束或报错。

历史 smoke：

1. thread/list 显示历史。
2. thread/read 显示 preview。
3. thread/resume 进入 active thread。

SSH smoke：

1. local 和 SSH profile 可切换。
2. 远端 cwd 可见。
3. 远端 app-server 失败时 degraded 可见。

### 8.4 语义验收

所有用户可见字段必须有来源：

| UI 字段 | 来源 |
|---|---|
| 模型列表 | `app-server.model/list` |
| 登录状态 | `app-server.account/read` 或 `account/updated` |
| rate limit | `account/rateLimits/updated` |
| thread 状态 | `thread/started`、`thread/status/changed` |
| turn 状态 | `turn/started`、`turn/completed` |
| item 内容 | `item/*` notification |
| token usage | `thread/tokenUsage/updated` |
| Goal | `thread/goal/updated`、`thread/goal/cleared` |
| Plan | `turn/plan/updated`、`item/plan/delta` |
| MCP 状态 | `mcpServer/startupStatus/updated` |
| approval | app-server `ServerRequest` |
| unknown event | diagnostics raw notification |

禁止：

- 没有 usage 时显示 `0 token`。
- 没有 MCP 状态时显示“正常”。
- 没有远端能力验证时显示“支持”。
- 用 UI 自己推断权限已安全。

## 9. 文档和执行计划流程

建议在官方仓库中新增：

```text
docs/web/
  README.md
  architecture.md
  protocol-coverage.md
  security.md

docs/exec-plans/
  active/
  completed/
  deferred/
  tech-debt-tracker.md
```

如果不希望污染官方 `docs/`，则把执行计划放在：

```text
codex-rs/web-server/docs/
web/docs/
```

每个中大型阶段都应包含：

- 目标。
- 范围和非目标。
- 状态总览。
- Phase checklist。
- 验证计划。
- 决策日志。
- Smoke Ledger。

完成任一阶段后同步：

1. checklist。
2. 状态总览。
3. 决策日志。
4. Smoke Ledger。

## 10. 安全边界

Web 化 Codex 的主要风险是把本地命令执行能力暴露给浏览器。

必须遵守：

- 默认仅监听 `127.0.0.1`。
- WebSocket 必须 token 校验。
- token 默认一次性或进程生命周期内有效。
- Origin 必须校验。
- 不允许任意网页连接本地 Codex。
- 不在浏览器 localStorage 保存 access token、refresh token、API key。
- 不复制 `CODEX_HOME` 凭据。
- 开发、测试、smoke 和普通调试默认不得读取本地真实 `CODEX_HOME`，必须使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- approval 流程不得绕过。
- 未知 server request fail closed。
- fs 写入、删除、复制、移动等高危 app-server 方法不能在 UI 暴露为通用文件管理器，除非有单独设计和审批。
- SSH remote 不保存密码和私钥。
- 日志默认低噪声、脱敏、有上限。

## 11. 依赖策略

Rust：

- 优先使用官方 workspace 已有依赖。
- Web server 推荐使用 `axum`，官方 app-server 已使用。
- 避免引入大型新依赖。
- 改 `Cargo.toml` 或 `Cargo.lock` 后按官方要求运行 `just bazel-lock-update`。

前端：

- 优先轻量依赖。
- React + TypeScript 即可。
- 图标使用已有图标库时再引入；若无既有库，第一版先少量 CSS/文本，不为装饰引入重依赖。
- markdown 渲染、diff 渲染、ANSI 输出可以分阶段引入。

建议第一版避免：

- Electron。
- SQLite。
- 多 provider SDK。
- 多用户 auth。
- 云同步。
- 插件市场 UI。
- 复杂主题系统。

## 12. 风险和缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| app-server 协议变化 | 前端类型失配 | 每次构建生成 TS schema，保留协议覆盖审计。 |
| websocket transport experimental | 生产不稳定 | 不直连 app-server websocket，使用本地 Web server bridge。 |
| Web 版本偏离官方 TUI 语义 | 用户体验和官方 Codex 不一致 | 每个功能先对照 TUI 的用户流程、app-server 请求、notification 和错误收口，再设计 Web 等价实现。 |
| TUI 逻辑难抽取 | 复用成本上升 | 只抽纯数据模型和转换逻辑，不搬 Ratatui。 |
| 本地 Web 暴露命令执行 | 高安全风险 | localhost、token、Origin、approval、fail closed。 |
| 测试误用本地真实 `CODEX_HOME` | 污染本机账号、历史、MCP 或 approval 状态 | 默认隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，最终验收前必须显式确认。 |
| notification 丢失导致 UI 状态错乱 | 用户误判任务状态 | lossless event 分级、turn/item completed 不丢、lagged diagnostics。 |
| SSH remote 路径语义混淆 | 用户误以为操作本机 | UI 明确 remote target、remote cwd、remote CODEX_HOME。 |
| 假状态/假数字 | 产品信任损伤 | source breadcrumb、无来源隐藏、反例 smoke。 |
| 日志过大 | 磁盘和性能风险 | `RUST_LOG=warn`、环形日志、size cap。 |
| 过早改 core | 维护成本高 | 所有需求先验证 app-server 是否已有能力。 |

## 13. 最小可行版本定义

MVP 必须具备：

1. `codex web` 或等价命令启动本地 Web UI。
2. 页面只能本机访问，带 token。
3. 成功 initialize app-server。
4. 显示账号状态和模型列表。
5. 新建 thread。
6. 发送 turn。
7. 展示 assistant 流式输出。
8. 展示 command / file change / approval。
9. 支持 allow / deny。
10. 支持 interrupt。
11. turn completed 后 UI 收口。
12. 未知 notification 显示 diagnostics。
13. `npm run test`、Rust scoped test、smoke 通过。
14. 开发和 smoke 记录证明默认使用隔离 `CODEX_HOME`；最终验收如需本地真实 `CODEX_HOME`，必须有用户确认记录。

MVP 明确不做：

- 多用户远程访问。
- Electron 桌面壳。
- 多 provider。
- CodePilot tool bridge。
- 插件市场完整 UI。
- Web 端任意文件管理器。
- 直接复刻 TUI 全部快捷键。

## 14. 建议第一轮执行计划

第一轮建议只交付 Phase 0 到 Phase 4，避免一次性做完整产品。

### 第一轮范围

```text
Phase 0：协议和构建基线
Phase 1：最小 Web server
Phase 2：连接 app-server
Phase 3：Web UI foundation
Phase 4：Thread / Turn / Item lifecycle
```

第一轮成功标准：

- 用户可以在浏览器打开本地 Codex Web。
- 可以新建会话并发送一条消息。
- 可以看到流式响应和 turn 完成。
- 断线和未知 notification 有可见 diagnostics。
- 不修改 `codex-core`。

第一轮建议提交拆分：

1. `chore(web): add protocol generation baseline`
2. `feat(web-server): add local secure web server`
3. `feat(web-server): bridge app-server events`
4. `feat(web): add workbench shell`
5. `feat(web): render thread turn item lifecycle`
6. `test(web): add reducer and smoke coverage`

## 15. 后续扩展路线

第二轮：

- Approval 完整支持。
- Plan / Goal / diagnostics。
- Thread history / resume。

第三轮：

- SSH remote。
- MCP / Skills status 深化。
- 文件变更详情和 diff 体验。

第四轮：

- 打包命令收口。
- 文档补齐。
- 性能和日志治理。
- 协议覆盖审计。

第五轮：

- 评估是否把前端状态模型抽为 Rust/TS 共享生成层。
- 评估 TUI 和 Web 是否共用 `web-ui-model` 中的纯业务转换。

## 16. 自检清单

本方案满足：

- 不要求修改 `codex-core`。
- 明确开发主线是围绕官方 `codex-rs/tui` 做浏览器 Web 版本，TUI 是产品行为和业务语义基准。
- 不建议直接魔改 TUI。
- 明确 app-server 是事实源。
- 明确第一版本地 bridge 不依赖 experimental websocket transport。
- 明确 CodexBrowser 只用于借鉴 Codex-only app-server 架构、接线边界和测试经验，不作为代码来源。
- 明确 CodePilot 只用于借鉴执行计划、测试分层、语义验收和 Smoke Ledger，不作为代码来源。
- 明确安全边界。
- 明确 MVP 非目标。
- 明确测试命令和验收路径。
