# Codex Web MVP Phase 0-4 执行计划

> 创建时间：2026-07-06  
> 状态：进行中  
> 主线：围绕官方 `codex-rs/tui` 做 TUI-first Web 化。  
> UI 基准：基于 `/home/rrssnas/code/CodexWeb` 的既有 UI 样式、布局和 Demo 展示接入真实 app-server；不得直接修改 `CodexWeb` 目录。  
> 范围：只实现本地 Web bridge + CodexWeb 风格浏览器基础 UI + Thread / Turn / Item 生命周期。  
> 非目标：SSH remote、完整 approval、插件市场、Electron、provider 管理、多用户远程访问。
> 环境限制：开发、测试和 smoke 默认必须使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，最终验收才允许在用户明确同意后切回本地真实 `CODEX_HOME`。

## 目标

在 `/home/rrssnas/code/codex/web` 中实现一个最小可用的 Codex Web MVP：浏览器通过本地 Web bridge 连接服务器已安装的 `codex app-server --stdio`，并把 initialize、model/list、thread/start、turn/start、流式 item delta 和 turn completed 接入到 CodexWeb 风格 UI 中。

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
codex app-server --stdio
```

实现原则：

- app-server 是事实源。
- TUI 是业务语义和用户流程基准。
- CodexWeb 是 Web UI 样式、布局、左右侧边栏、聊天区和 Demo 展示基准。
- 开发 UI 前必须阅读 `/home/rrssnas/code/CodexWeb/README.md`，确认对应模块职责和产品背景。
- 不得直接修改 `/home/rrssnas/code/CodexWeb` 目录；如需复用 UI，可复制相关代码到当前项目后接入真实 app-server 后端。
- Web 保持 CodexWeb 既有 UI 风格，重点实现状态 reducer、真实数据接线和必要的小模块适配。
- `CodexBrowser` / `CodePilot` 只能借鉴经验，不作为代码来源。
- 默认使用隔离 `CODEX_HOME`，避免开发测试误读或污染本地真实 Codex 配置、账号、历史和 MCP 状态。

## CODEX_HOME 隔离规则

隔离路径：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
```

硬性要求：

- Phase 0-4 的所有开发命令、单元测试、smoke 测试、手动 app-server 调试都必须显式使用隔离 `CODEX_HOME`。
- Web bridge 启动 `codex app-server --stdio` 时必须把隔离 `CODEX_HOME` 传给子进程。
- smoke 记录必须写明本次使用的是隔离 `CODEX_HOME` 还是本地真实 `CODEX_HOME`。
- 最终验收前不得使用本地真实 `CODEX_HOME`。最终验收切换前必须先完成隔离环境 smoke，并获得用户明确同意。
- 可以借鉴 `CodexBrowser` 的隔离环境要求和测试经验，但不得复用其实现代码。

## 状态总览

| Phase | 内容 | 状态 | 验收 |
|---|---|---|---|
| Phase 0 | 协议和项目基线 | 已完成 | 能生成或引用 app-server TS schema，Web 项目脚本可运行 |
| Phase 1 | 最小 Web bridge | 已完成 | 浏览器能连接 bridge，bridge 能启动或连接 app-server |
| Phase 2 | app-server 初始化和基础 API | 已完成 | initialize、initialized、model/list、account/read 可用 |
| Phase 3 | CodexWeb 风格 UI foundation | 已完成 | 页面基于 CodexWeb 布局显示连接、账号、模型、空会话和 diagnostics |
| Phase 4 | Thread / Turn / Item 生命周期 | 已完成 | 已完成 Phase 4A one-turn 真实闭环、Phase 4B 工具 cell、Phase 4C approval 闭环 |
| Phase 5A | Thread 列表与历史恢复基础 | 进行中 | app-server `thread/list` 接入左侧会话；`thread/read` 恢复 user/assistant 历史文本 |

## Phase 0：协议和项目基线

用户可见变化：可以进入 `web/` 项目并运行基础开发命令。  
本阶段不做：真实聊天、approval、SSH remote。

- [x] 确认系统 `codex` 可执行文件存在，并记录版本。
- [x] 使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 确认 `codex app-server --stdio` 可启动。
- [x] 生成或复制当前版本 app-server TypeScript schema 到 `src/codex/protocol/generated/`。
- [x] 创建 `package.json`、`tsconfig.json` 和基础源码目录。
- [x] 定义脚本：`typecheck`、`test`、`build`、`test:smoke`。
- [x] 编写最小 JSON-RPC 类型和测试 fixture。

验证：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run typecheck
npm run test
```

Phase 0 记录：

- 2026-07-09：`codex --version` 返回 `codex-cli 0.143.0`。
- 2026-07-09：隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 下 `codex app-server --stdio` initialize 成功，返回 `codexHome=/volume2/SSD/codex/Temp/codex-dev-home`。
- 2026-07-09：使用 `codex app-server generate-ts --out src/codex/protocol/generated` 生成 595 个协议 TypeScript 文件。
- 2026-07-09：已创建 `package.json`、TypeScript/Vitest 配置、`src/codex/protocol/json-rpc.ts` 和 JSON-RPC 基线测试。
- 2026-07-09：已运行 `npm run typecheck`，通过。
- 2026-07-09：已运行 `npm run test`，1 个测试文件、5 个测试通过。
- 2026-07-09：已运行 `npm run build`，通过。
- 2026-07-09：已运行 `npm run test:smoke`，隔离 `CODEX_HOME` 检查通过。

## Phase 1：最小 Web bridge

用户可见变化：浏览器可以连接本地 bridge，并看到连接状态。  
本阶段不做：Codex 会话和模型渲染。

- [x] 实现 `server/codex-process.ts`：启动 `codex app-server --stdio`。
- [x] 实现 `server/json-rpc-client.ts`：request、response、notification、server request 基础分发。
- [x] 实现 `server/websocket-bridge.ts`：浏览器 WebSocket 连接。
- [x] 实现 `server/security.ts`：localhost、token、Origin 校验。
- [x] app-server 子进程环境显式传入隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- [x] app-server stderr 只进入 diagnostics 摘要，不混入 JSON-RPC stdout。
- [x] transport close 时所有 pending request 快速失败。

验证：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run test:smoke
```

Smoke 记录：

| Date | Runtime | 场景 | Result | Evidence |
|---|---|---|---|---|
| 2026-07-09 | local codex app-server | bridge connect，隔离 CODEX_HOME，initialize 往返 | 通过 | `npm run test:smoke` 返回 `smoke bridge 通过：CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` |

Phase 1 记录：

- 2026-07-09：实现 `server/codex-process.ts`，启动 `codex app-server --stdio` 时强制传入隔离 `CODEX_HOME` 和 `RUST_LOG=warn`，stderr 保存为最近 50 条 diagnostics。
- 2026-07-09：实现 `server/json-rpc-client.ts`，支持 response resolve/reject、notification、server request 分发，以及 transport close 后 pending request 快速失败。
- 2026-07-09：实现 `server/security.ts`，覆盖 localhost、Bearer/query token 和 Origin 校验。
- 2026-07-09：实现 `server/websocket-bridge.ts`，每个浏览器 WebSocket 连接独立启动一个 app-server stdio 子进程，避免跨连接 JSON-RPC id 串扰。
- 2026-07-09：已运行 `npm run test`，3 个测试文件、15 个测试通过。
- 2026-07-09：已运行 `npm run build`，通过。
- 2026-07-09：已运行 `npm run test:smoke`，真实 bridge initialize 往返通过，返回隔离 `CODEX_HOME`。
- 2026-07-09：反例验证已覆盖无效 token、非 localhost 地址、非法 Origin 均拒绝；transport close 时 pending request 被快速 reject。

## Phase 2：app-server 初始化和基础 API

用户可见变化：页面能显示 Codex 连接状态、账号状态和模型列表。  
本阶段不做：聊天流和 approval。

- [x] 对照 TUI `app_server_session.rs`，确认 initialize / initialized 语义。
- [x] 发送 `initialize`，clientInfo 使用 Web 专属标识。
- [x] 发送 `initialized` notification。
- [x] 实现 `model/list`。
- [x] 实现 `account/read` 或当前 app-server 对应账号读取方法。
- [x] 处理 `account/updated`、`account/rateLimits/updated` 为 diagnostics 或状态。
- [x] 初始化失败时展示明确错误：未安装、启动失败、协议失败、认证缺失。

验证：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run test:smoke
```

Phase 2 记录：

- 2026-07-09：已对照 `/home/rrssnas/code/codex/codex-rs/tui/src/app_server_session.rs` 和 `/home/rrssnas/code/codex/codex-rs/app-server/README.md`，确认连接生命周期为 `initialize` request 后发送 `initialized` notification。
- 2026-07-09：已确认当前 generated schema 中账号读取 method 为 `account/read`，参数类型为 `GetAccountParams`，响应类型为 `GetAccountResponse`。
- 2026-07-09：实现 `server/app-server-session.ts`，提供 `initialize()`、`initialized()`、`listModels()`、`readAccount()` 和 `bootstrap()`。
- 2026-07-09：`model/list` 使用 `{ includeHidden: false }`，source breadcrumb 为 `app-server.model/list`；`account/read` 使用 `{ refreshToken: false }`，source breadcrumb 为 `app-server.account/read`。
- 2026-07-09：未知 notification、`account/updated`、`account/rateLimits/updated` 等通过 `AppServerSession.diagnostics` 保留，source breadcrumb 为 `app-server.notification`。
- 2026-07-09：已运行 `npm run test`，4 个测试文件、17 个测试通过。
- 2026-07-09：已运行 `npm run build`，通过。
- 2026-07-09：已运行 `npm run test:smoke`，真实 bridge bootstrap 通过，返回 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`、`models=5`、`accountSource=app-server.account/read`。

## Phase 3：CodexWeb 风格 UI foundation

用户可见变化：出现 Codex Web 基础工作台。  
本阶段不做：完整历史、完整 approval、复杂 diff。

- [x] 阅读 `/home/rrssnas/code/CodexWeb/README.md`，确认 `AppShell`、`ChatView`、`MessageList`、`MessageInput`、左右侧边栏和工作区侧栏职责。
- [x] 基于 CodexWeb `AppShell` Demo 结构实现当前项目基础工作台：顶部状态栏、左侧 Thread 区、中央聊天区、右侧文件树/工作区或 diagnostics 入口。
- [x] 保持 CodexWeb 既有 UI 样式和布局，不擅自修改整体视觉；只做真实 app-server 接线所需的小模块适配。
- [x] 实现 `ConnectionStatus`，接入 bridge / app-server 真实连接状态。
- [x] 实现 `ModelPicker`，只读取 `model/list` 并接入 CodexWeb 输入框或顶部模型入口。
- [x] 实现 `AccountStatus`，只读取 app-server 账号状态。
- [x] 实现 diagnostics 入口，未知 notification 不丢弃。
- [x] 页面文案使用中文，字段必须有 source breadcrumb。

验证：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run typecheck
npm run test
npm run build
```

Phase 3 记录：

- 2026-07-09：已基于 `/home/rrssnas/code/CodexWeb` 迁移完整 UI、主题和静态资源到当前项目，未直接修改 CodexWeb 源目录。
- 2026-07-09：`AppServerProvider` 接入 Web bridge，初始化后读取 `initialize`、`model/list`、`account/read`，并保留 notification diagnostics。
- 2026-07-09：已运行 `npm run typecheck`、`npm run test`、`npm run build`、`npm run build:server`、`npm run test:smoke`，均通过。
- 2026-07-09：已用真实浏览器验证 `/chat` 和 `/chat/demo-session`，桌面与 390px 移动视口均能渲染 CodexWeb UI，console 无错误，验证截图保存到 `/volume2/SSD/codex/Temp/`。

## Phase 4：Thread / Turn / Item 生命周期

用户可见变化：可以在浏览器中发起一轮 Codex 对话并看到流式输出。  
本阶段不做：完整 approval 决策、SSH remote、插件 UI。

- [x] 对照 TUI `app/app_server_events.rs` 和 `app_server_session.rs`，确认 thread/start 与 turn/start 接线。
- [x] 对照 CodexWeb 聊天 Demo，确认左侧会话、中央消息流、输入框、生成中状态和右侧工作区如何承载真实 app-server 状态。
- [x] 实现 `thread/start`。
- [x] 实现 `turn/start`。
- [x] reducer 支持 `thread/started`。
- [x] reducer 支持 `turn/started`。
- [x] reducer 支持 `item/started`。
- [x] reducer 支持 `item/agentMessage/delta`。
- [x] reducer 支持 `item/completed`。
- [x] reducer 支持 `turn/completed`。
- [x] reducer 支持 `error`。
- [x] 在 CodexWeb 消息流结构中展示 user message、assistant delta、running、completed、failed、interrupted。
- [x] 将 app-server commandExecution / fileChange / mcpToolCall item 与 delta 状态最小映射到 CodexWeb 流式工具 Cell 展示结构。
- [x] 接收 app-server server request，并保留 source breadcrumb 与 diagnostics。
- [x] 将 `item/commandExecution/requestApproval` 接入 CodexWeb 权限确认 UI，并按官方 schema 返回 response。
- [x] 将 `item/fileChange/requestApproval` 接入 CodexWeb 权限确认 UI，并按官方 schema 返回 response。
- [x] 将 `item/permissions/requestApproval` 接入 CodexWeb 权限确认 UI，并按官方 schema 返回 response。
- [ ] 将 app-server item / tool / delta 状态映射到 CodexWeb 历史消息结构。
- [x] Composer 在 active turn 期间禁用或进入可控状态，并保持 CodexWeb 输入框交互风格。

验证：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run test:smoke
```

Smoke 记录：

| Date | Runtime | Provider | Model | 场景 | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-09 | local codex app-server，隔离 CODEX_HOME | app-server default | `gpt-5.5` | one-turn chat，提示“请只回复：pong” | 通过 | CDP 页面验证 `/chat` 显示 user message 与 assistant `pong`，console 无错误；截图 `codexweb-phase4a-real-one-turn.png` |
| 2026-07-09 | local dev server，隔离 CODEX_HOME | app-server default | N/A | Phase 4B tool cell 接线后打开 `/chat` | 通过 | 真实浏览器打开 `http://192.168.3.12:3000/chat`，页面标题 `CodexWeb`，console 0 errors / 0 warnings；Playwright 日志保存到 `/volume2/SSD/codex/Temp/playwright-mcp-phase4b-20260709/` |
| 2026-07-09 | local dev server，隔离 CODEX_HOME | app-server default | N/A | Phase 4C approval 接线后打开 `/chat` | 通过 | 真实浏览器打开 `http://192.168.3.12:3000/chat`，页面标题 `CodexWeb`，console 0 errors / 0 warnings；Playwright 日志保存到 `/volume2/SSD/codex/Temp/playwright-mcp-phase4c-20260709/` |
| 2026-07-09 | local dev server，隔离 CODEX_HOME | app-server default | N/A | Phase 5A thread/list 与 thread/read 历史恢复 | 通过 | `thread/list` 返回 22 个隔离环境 thread；真实浏览器打开 `/chat/019f452c-2c35-7ee3-a876-cc0770789a58` 显示 user “请只回复：pong” 与 assistant “pong”，只读提示可见，console 0 errors / 0 warnings；Playwright 日志保存到 `/volume2/SSD/codex/Temp/playwright-mcp-phase5a-20260709/` |
| 2026-07-09 | local dev server，隔离 CODEX_HOME | app-server default | N/A | Phase 5B 历史工具 cell 默认折叠 | 通过 | 隔离历史 thread `019f1c15-da0b-71e1-a3c3-d407b96f8ccb` 含 `fileChange` item；真实浏览器打开历史页后看到 `已处理` 工具摘要，默认 `aria-expanded=false` 且详情不可见；点击后展开显示 `fileChange` 详情，再次点击恢复折叠；console 0 errors / 0 warnings |

Phase 4A 记录：

- 2026-07-09：新增 `src/codex-web/turn-reducer.ts`，按 app-server notification 构建 one-turn 状态；测试覆盖 thread/turn 启动、agent delta 拼接、item completed 覆盖最终文本和 error 失败态。
- 2026-07-09：`AppServerProvider` 暴露 `sendOneTurn()`，复用已建立的 WebSocket bridge 发送 `thread/start` 和 `turn/start`，notification 统一进入 reducer 与 diagnostics。
- 2026-07-09：`/chat` 新对话发送路径改为读取真实 `app-server.model/list`，并通过 `sendOneTurn()` 驱动 CodexWeb `MessageList` 的 user message、assistant streaming、running 和 completed 状态。
- 2026-07-09：真实页面验证：CDP 打开 `http://192.168.3.12:3000/chat`，发送“请只回复：pong”，页面出现 assistant `pong`，状态恢复，输入框可用，console 无错误。
- 2026-07-09：已运行 `npm run test`，5 个测试文件、20 个测试通过。
- 2026-07-09：已运行 `npm run build`，通过；Turbopack 输出 theme loader trace warning，未阻塞构建。
- 2026-07-09：已运行 `npm run test:smoke`，真实 bridge bootstrap 仍通过。

Phase 4B 记录：

- 2026-07-09：新增 `src/codex-web/tool-adapter.ts`，把 app-server `commandExecution`、`fileChange`、`mcpToolCall` item 派生为 CodexWeb 现有 `toolUses`、`toolResults`、`streamingToolOutput` 结构。
- 2026-07-09：`turn-reducer` 支持 `item/commandExecution/outputDelta`、`item/fileChange/outputDelta`、`item/fileChange/patchUpdated`、`item/mcpToolCall/progress`，保留原始增量供工具 cell 展示。
- 2026-07-09：`/chat` 流式消息接入工具 adapter，复用 CodexWeb `StreamingMessage` 与 `ToolActionsGroup`，不改变整体 UI 布局。
- 2026-07-09：单元测试覆盖 commandExecution running output、fileChange patch 摘要、MCP progress 和失败结果映射。
- 2026-07-09：已运行 `npm run test`，6 个测试文件、24 个测试通过；已运行 `npm run build`，通过但仍有 Turbopack theme loader trace warning；已运行 `npm run test:smoke`，真实 bridge bootstrap 通过。
- 2026-07-09：真实页面验证：启动 dev server 后打开 `/chat`，页面标题 `CodexWeb`，console 0 errors / 0 warnings；验证后已停止 dev server。

## Phase 5A：Thread 列表与历史恢复基础

用户可见变化：左侧会话列表来自 app-server `thread/list`，打开历史 thread 时可以看到历史 user/assistant 文本和已完成工具 cell。
本阶段不做：历史 diff 完整映射、`thread/resume` 继续发送、分页加载、归档/删除/重命名。

- [x] 对照 TUI `resume_picker.rs`，确认历史列表使用 `thread/list`，预览/读取使用 `thread/read { includeTurns: true }`。
- [x] 对照 CodexWeb `ChatListPanel`、`SessionListItem` 和 `/chat/[id]`，确认左侧列表和历史页接线入口。
- [x] `AppServerProvider` 初始化后读取 `thread/list`，source breadcrumb 为 `app-server.thread/list`。
- [x] `AppServerProvider` 暴露 `refreshThreads()` 和 `readThread(threadId)`，`readThread` source breadcrumb 为 `app-server.thread/read`。
- [x] 新增 `thread-history-adapter`，把 app-server `Thread` 映射为 CodexWeb `ChatSession`。
- [x] 新增 `thread-history-adapter`，把历史 `userMessage` / `agentMessage` 映射为 CodexWeb `Message`。
- [x] `ChatListPanel` 优先使用 app-server `thread/list` 作为 Codex 历史事实源。
- [x] `/chat/[id]` 通过 `thread/read { includeTurns: true }` 恢复历史 user/assistant 文本。
- [x] 历史 thread 初版设为只读，继续发送留到 `thread/resume` 阶段。
- [x] 历史 commandExecution / fileChange / mcpToolCall 映射到 CodexWeb 历史工具 cell。

验证：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run build
npm run test:smoke
```

Phase 5A 记录：

- 2026-07-09：新增 `src/codex-web/thread-history-adapter.ts`，将 app-server `Thread` 映射到 CodexWeb `ChatSession`，并将 `userMessage`、`agentMessage` 历史 item 映射到 `Message[]`。
- 2026-07-09：`AppServerProvider` 接入 `thread/list`、`thread/read`，并在 one-turn 完成后 best-effort 刷新 thread 列表。
- 2026-07-09：`ChatListPanel` 优先展示 app-server `thread/list` 返回的历史 thread；旧 `/api/chat/sessions` fallback 暂保留给非 app-server 连接状态。
- 2026-07-09：`/chat/[id]` 打开 app-server thread 时通过 `thread/read { includeTurns: true }` 恢复历史 user/assistant 文本，并标记为只读。
- 2026-07-09：已运行 `npm run typecheck`，通过；已运行 `npm run test -- src/codex-web`，4 个测试文件、12 个测试通过。
- 2026-07-09：已运行 `npm run test`，8 个测试文件、30 个测试通过；已运行 `npm run build`，通过但仍有 Turbopack theme loader trace warning；已运行 `npm run test:smoke`，真实 bridge bootstrap 通过。
- 2026-07-09：只读协议验证：隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 下 `thread/list` 返回 22 个 thread，第一个 thread 为 `019f452c-2c35-7ee3-a876-cc0770789a58`，preview 为“请只回复：pong”。
- 2026-07-09：真实页面验证：启动 dev server 后打开 `/chat` 和 `/chat/019f452c-2c35-7ee3-a876-cc0770789a58`；历史页显示 user “请只回复：pong”、assistant “pong” 与只读提示，console 0 errors / 0 warnings；验证后已停止 dev server。
- 2026-07-09：Phase 5B 对照官方 TUI `thread_transcript.rs`：历史恢复使用 `thread/read { include_turns: true }`，逐项读取 app-server `ThreadItem`；工具项作为只读历史 transcript 展示，不进入 prompt，不冒充实时执行态。
- 2026-07-09：`thread-history-adapter` 将历史 `commandExecution`、`fileChange`、`mcpToolCall` 聚合为 CodexWeb `MessageContentBlock` JSON，复用 `MessageItem` 和 `ToolActionsGroup`；工具结果态默认折叠。
- 2026-07-09：已运行 `npm run test -- src/codex-web/thread-history-adapter.test.ts`，1 个测试文件、3 个测试通过；已运行 `npm run test -- src/codex-web`，4 个测试文件、13 个测试通过。
- 2026-07-09：已运行 `npm run test`，8 个测试文件、31 个测试通过；已运行 `npm run build`，通过但仍有既有 Turbopack theme loader trace warning；已运行 `npm run test:smoke`，真实 bridge bootstrap 通过。
- 2026-07-09：真实页面验证：启动 dev server 后打开 `/chat/019f1c15-da0b-71e1-a3c3-d407b96f8ccb`；历史工具 cell 默认折叠，展开后显示 `fileChange` 详情，再次点击恢复折叠；console 0 errors / 0 warnings；验证后已停止 dev server。

Phase 4C 记录：

- 2026-07-09：`AppServerBrowserClient` 支持识别 app-server 发起的 JSON-RPC server request，并可通过同一 WebSocket 返回 JSON-RPC response。
- 2026-07-09：新增 `src/codex-web/approval-adapter.ts`，把 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval` 映射到 CodexWeb `PermissionPrompt` 可显示的数据，并把用户选择转换回官方 app-server response schema。
- 2026-07-09：`AppServerProvider` 保存 `pendingApproval`，暴露 `respondToApproval()`；unsupported server request 进入 diagnostics 并返回 JSON-RPC error，避免静默挂起。
- 2026-07-09：`/chat` 权限确认 UI 只作为 app-server approval 的显示层；不会改写 system prompt、user message 或 turn input。
- 2026-07-09：已运行 `npm run typecheck`，通过；已运行 `npm run test -- src/codex-web`，3 个测试文件、10 个测试通过。
- 2026-07-09：已运行 `npm run test`，7 个测试文件、28 个测试通过；已运行 `npm run build`，通过但仍有 Turbopack theme loader trace warning；已运行 `npm run test:smoke`，真实 bridge bootstrap 通过。
- 2026-07-09：真实页面验证：启动 dev server 后打开 `/chat`，页面标题 `CodexWeb`，console 0 errors / 0 warnings；验证后已停止 dev server。

## 决策日志

- 2026-07-06：第一版采用 TUI-first Web 化。官方 TUI 是业务语义基准，Web bridge 连接已安装的 `codex app-server --stdio`，不改 `codex-core`。
- 2026-07-06：`CodexBrowser` 和 `CodePilot` 只用于借鉴 app-server 经验、开发流程和测试经验，禁止作为代码来源。
- 2026-07-06：开发、测试和 smoke 默认使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`；最终验收才在用户明确同意后使用本地真实 `CODEX_HOME`。
- 2026-07-08：Web UI 基于 `/home/rrssnas/code/CodexWeb` 开发；开发前阅读其 README，保持 CodexWeb 既有 UI 样式和 Demo 结构，不直接修改 CodexWeb 目录，只在当前项目中接入真实 app-server 后端。

## 剩余风险

- 系统安装的 `codex` 版本可能与生成的 TypeScript schema 不一致。
- 隔离 `CODEX_HOME` 可能缺少账号、模型、MCP 或历史配置；测试失败时要先区分隔离环境配置问题和 Web 实现问题。
- app-server server request 类型较多，Phase 4 前只做 diagnostics 和 fail-safe，完整 approval 需要后续计划。
- 浏览器 UI 可能偏离 TUI 语义或 CodexWeb 既有体验，所有新增功能必须先对照 TUI 业务语义和 CodexWeb UI Demo。
- 从 CodexWeb 复制 UI 代码时可能引入 mock 数据路径或前端预览逻辑，接入当前项目前必须替换为 app-server 真实数据来源并保留 source breadcrumb。
- 真实模型调用需要账号、网络和额度，smoke 失败时要区分认证、网络、额度和协议问题。
