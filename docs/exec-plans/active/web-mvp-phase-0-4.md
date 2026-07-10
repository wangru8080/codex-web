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
| Phase 5A-5G | 历史恢复、继续发送、approval、中断、刷新 degraded 提示 | 已完成 | 历史 thread 可恢复、继续发送和中断；approval 按官方 schema 闭环；刷新后 running 状态显示明确 degraded |
| Phase 6A | 历史分页加载 | 已完成 | `thread/read` metadata-first，`thread/turns/list` 分页加载更早 turn，失败时回退稳定历史读取 |
| Phase 6B | 工具大输出展示截断 | Code complete | 实时和历史工具输出进入 CodexWeb 消息结构前按官方 1 MiB 前缀上限做展示保护 |
| Phase 6C | Approval 队列与过期响应硬化 | Code complete | 多个 approval request 排队处理，resolved 时移除，历史页按 thread 过滤可见 approval |

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
| 2026-07-09 | local dev server，隔离 CODEX_HOME | app-server default | `gpt-5.5` | Phase 5C 历史 thread resume 后继续发送 | 通过 | 真实浏览器打开 `/chat/019f452c-2c35-7ee3-a876-cc0770789a58`；composer 可输入，发送“请只回复：resume-pong”后页面显示 user 新消息和 assistant `resume-pong`，状态恢复，console 0 errors / 0 warnings；验证后已停止 dev server |
| 2026-07-09 | local dev server，隔离 CODEX_HOME | app-server default | `gpt-5.5` | Phase 5D-B resume 多轮、new thread 反例、turn/interrupt | 通过 | 历史页 `/chat/019f452c-2c35-7ee3-a876-cc0770789a58` 连续发送“请只回复：resume-5d-a”和“请只回复：resume-5d-b”均完成；新建 `/chat` 发送“请只回复：new-5d”完成；运行 `sleep 60 && echo done` 后点击“停止生成”，页面显示“Codex 已中断。可以继续发送下一轮。”，随后发送“请只回复：after-interrupt”完成；当前 console 0 errors / 0 warnings；Playwright 产物保存到 `/volume2/SSD/codex/Temp/playwright-mcp-phase5d-20260709/`，验证后已停止 dev server |
| 2026-07-09 | local dev server，隔离 CODEX_HOME | app-server default | `gpt-5.5` | Phase 5E-B approval 复杂边界 | 通过 | 新建 `/chat` 普通消息“请只回复：approval-normal”未出现 PermissionPrompt；`curl https://example.com` 触发 command approval 后 composer disabled，Deny 后恢复；再次触发后 Allow Once，同一 turn 继续完成；历史页 `/chat/019f452c-2c35-7ee3-a876-cc0770789a58` resume 后触发 command approval，仅当前历史页显示 PermissionPrompt，Deny 后恢复；当前 console 0 errors / 0 warnings；Playwright 产物保存到 `/volume2/SSD/codex/Temp/playwright-mcp-phase5e-20260709/`，验证后已停止 dev server |

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

## Phase 5C：Thread Resume 与历史会话继续发送

用户可见变化：打开 app-server 历史 thread 后，可以直接继续发送新消息；第一条继续消息前 Web 调用官方 `thread/resume`，后续新 turn 仍由 app-server notification 驱动。
本阶段不做：手工拼接历史 prompt、使用 unstable `thread/resume.history`、历史 diff 完整映射、分页加载、归档/删除/重命名。

- [x] 对照官方 TUI `resume_thread` 与 app-server `thread_processor`，确认历史上下文由 app-server/core 从 persisted rollout 恢复。
- [x] 新增 `resume-adapter`，构造 `thread/resume` 参数时只使用 `threadId`、`cwd`、`model` 和 approval policy，不传 `history`。
- [x] `AppServerProvider` 暴露 `resumeThread()`，source breadcrumb 为 `app-server.thread/resume`。
- [x] `AppServerProvider` 暴露 `sendTurnInThread()`，在已恢复 thread 上调用 `turn/start`，继续复用 reducer、approval 和工具 cell。
- [x] `/chat/[id]` 历史页首次发送前执行 `thread/resume`，并用 resume response 的 `thread.id`、`cwd`、`model` 启动新 turn。
- [x] `ChatView` 增加 app-server 发送 override，历史页保持 CodexWeb 输入框和消息流 UI，不走旧 `/api/chat` 流。
- [x] 历史页 app-server approval 继续复用 CodexWeb `PermissionPrompt` 显示层，response 仍由 `approval-adapter` 按官方 schema 返回。

验证：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web
npm run test
npm run build
npm run test:smoke
```

Phase 5C 记录：

- 2026-07-09：官方语义确认：`thread/resume` 正常客户端应传 `threadId`；`thread/resume.history` 标注为 unstable，不用于 Web 第一版。历史上下文会进入模型上下文，但由 app-server/core 恢复，不由 Web 拼 prompt。
- 2026-07-09：`AppServerProvider` 新增 `resumeThread()` 和 `sendTurnInThread()`；`sendOneTurn()` 复用同一条 resumed/new-thread turn 启动逻辑。
- 2026-07-09：`ChatView` 新增 app-server 发送 override；有 override 时绕过旧 provider/API 发送 gate，并使用外部 `appServerTurn` 派生 streaming/tool 状态。
- 2026-07-09：已运行 `npm run test -- src/codex-web`，5 个测试文件、14 个测试通过。
- 2026-07-09：已运行 `npm run test`，9 个测试文件、32 个测试通过；已运行 `npm run build`，通过但仍有既有 Turbopack theme loader trace warning；已运行 `npm run test:smoke`，真实 bridge bootstrap 通过。
- 2026-07-09：真实页面验证：启动 dev server 后打开 `/chat/019f452c-2c35-7ee3-a876-cc0770789a58`；发送“请只回复：resume-pong”后历史页追加 user 新消息和 assistant `resume-pong`，处理状态恢复，console 0 errors / 0 warnings；验证后已停止 dev server。

## 未实现复杂场景 Backlog

本清单用于明确 Phase 4A-5C 简单闭环之外尚未覆盖的复杂场景。后续每完成一项，需要同步更新状态、目标 Phase、验收方式和 Smoke Ledger；未完成项不得在汇报中表述为完整支持。

| 模块 | 场景 | 当前状态 | 建议 Phase | 验收标准 |
|---|---|---|---|---|
| Resume / History | 历史 thread 恢复后多轮连续发送 | 已完成 | Phase 5D-B | 同一历史 thread 连续发送至少 2 轮，消息顺序、active turn、composer 状态均正确恢复 |
| Resume / History | 恢复后的 active turn 页面刷新再进入 | Code complete | Phase 5G | turn running 期间刷新页面，重新进入同一 thread 后 UI 能显示进行中或明确 degraded 状态 |
| Resume / History | 历史 thread 切换时 active turn 隔离 | Code complete | Phase 5F-B | A thread running 时切到 B thread，不把 A 的 delta、approval 或工具状态显示到 B |
| Resume / History | `thread/resume` 失败收口 | Code complete | Phase 5F-B | resume 返回错误或 bridge 断开时，composer 恢复可用，消息区显示可见错误，不追加伪 assistant 成功消息 |
| Resume / History | 历史分页加载 | Code complete | Phase 6A | thread/list 或 thread/read 有分页/截断时，UI 能继续加载且不重复消息 |
| Resume / History | 历史归档、重命名、删除/清理入口 | 未开始 | Phase 6 | 仅接入官方 app-server 支持的方法；删除类操作必须按项目清理规则另行确认 |
| Approval | 历史会话继续发送时触发 approval | 已完成 | Phase 5E-B | resume 后触发 command/file/permission approval，PermissionPrompt 出现并按官方 schema 返回 response |
| Approval | approval pending 时 composer 与状态栏 | 已完成 | Phase 5E-B | pending approval 期间 composer 不产生并发 turn；用户 approve/deny 后状态恢复 |
| Approval | approve / deny 后同一个 turn 继续完成 | 已完成 | Phase 5E-B | approve 后 turn 继续到 completed；deny 后显示官方返回的失败/中断语义 |
| Approval | 多个 approval 或过期 approval | Code complete | Phase 6C | 多个 server request 不串线；已完成/过期 approval 不再接受重复响应 |
| Tools | exec / patch / file change / MCP / skill 完整状态映射 | 部分完成 | Phase 6 | running、success、failed、cancelled、interrupted 都有真实 source breadcrumb 和 CodexWeb 展示 |
| Tools | 工具结果默认折叠、展开详情 | 部分完成 | Phase 6 | 历史工具和新 turn 工具都默认折叠，展开后展示 stdout、stderr、patch 或 MCP 详情 |
| Tools | 大输出与增量输出截断策略 | Code complete | Phase 6B | 大 stdout/stderr 不撑爆页面；截断信息可见，原始输出保留在可诊断来源中 |
| Interrupt | 运行中 turn 中断 | 已完成 | Phase 5D-B | 点击停止后调用官方中断路径，turn 进入 interrupted 或等价官方状态 |
| Interrupt | interrupted 后继续下一轮 | 已完成 | Phase 5D-B | 中断后的同一 thread 可以继续发送新 turn，历史消息不丢失 |
| Interrupt | 页面刷新后恢复 interrupted 状态 | 未开始 | Phase 6 | 刷新后历史页能从 app-server 状态显示 interrupted，而不是误报 completed |
| Diagnostics | app-server transport close 与 pending request fail-fast | 部分完成 | Phase 6 | bridge/app-server 退出时 pending request 快速失败，UI 显示 diagnostics，不长时间挂起 |
| Diagnostics | 未知 notification 可见诊断 | 部分完成 | Phase 6 | 未知 notification 不静默丢弃，在 diagnostics 中保留 method、source 和摘要 |
| E2E / Smoke | 普通消息 vs 工具消息反例 | 未开始 | Phase 5D | 同一轮验证无工具普通消息和触发工具消息，断言工具 cell 只在触发路径出现 |
| E2E / Smoke | 无 approval vs approval 反例 | 已完成 | Phase 5E-B | 同一轮验证普通消息无 PermissionPrompt，触发权限时才出现 PermissionPrompt |
| E2E / Smoke | 新 thread vs resume thread 反例 | 已完成 | Phase 5D-B | 新建会话走 `thread/start`，历史继续发送先走 `thread/resume`，两者日志和 UI 行为可区分 |
| E2E / Smoke | success vs failed / interrupted 反例 | 未开始 | Phase 6 | completed、failed、interrupted 三类状态分别有可复现验证记录 |

优先级说明：

- Phase 5D 优先补齐“用户已经能触发但还没有完整边界保护”的路径：resume 多轮、approval、interrupt 和反例 smoke。
- Phase 6 再补齐更重的历史管理、完整工具语义、大输出、分页和诊断深化。
- Web 不手工拼接历史 prompt、不使用 unstable `thread/resume.history` 的决策保持不变；复杂场景也必须基于官方 app-server 状态恢复和 notification 驱动。

## Phase 5D-B：Resume 复杂边界优先

目标：不继续扩展简单 demo，而是优先补齐用户已经能触发的复杂边界，确保历史继续发送、approval、中断和反例 smoke 不串线。

架构：继续以官方 TUI 和 generated schema 为准。Web 只调用 app-server 官方方法并消费 notification；ChatView 仍保持 CodexWeb UI，只在 app-server 分支覆盖发送、approval 和中断行为。

本阶段不做：分页加载、归档/删除/重命名、完整大输出截断、所有工具类型的深度详情、真实 `CODEX_HOME` 验收。

实施清单：

- [x] 对照官方 TUI `turn_interrupt` 和 generated schema，确认 `turn/interrupt` 参数与响应。
- [x] 新增 `interrupt-adapter`，只构造 `{ threadId, turnId }`，不创造 Web 私有中断协议。
- [x] `AppServerProvider` 暴露 `interruptTurn()`，有 active turn 时调用 `turn/interrupt`，无 active turn 时快速返回。
- [x] `ChatView` app-server 分支的 Stop 按钮调用 `interruptTurn()`，旧 `/api/chat` stop 仍只用于 legacy stream。
- [x] 历史页继续按 thread id 过滤 active turn 和 approval，避免切换历史 thread 时串线。
- [x] 补单元测试覆盖中断参数、无 active turn 快速返回、interrupted 状态映射。
- [x] 补反例验证记录：新 thread vs resume thread、普通消息 vs 触发中断路径。

验证：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web
npm run test
npm run build
npm run test:smoke
```

Phase 5D-B 记录：

- 2026-07-09：官方语义确认：generated schema 中 `turn/interrupt` 参数为 `{ threadId, turnId }`，响应为空对象；TUI 通过 app-server `turn_interrupt(thread_id, turn_id)` 提交中断。
- 2026-07-09：新增 `src/codex-web/interrupt-adapter.ts`，统一构造官方 `TurnInterruptParams`，并在无 active thread 或 terminal turn 时快速返回，不创造 Web 私有中断协议。
- 2026-07-09：`AppServerProvider` 新增 `interruptTurn()`；`/chat` 与 `/chat/[id]` 的 app-server 分支均接入 Stop 行为，停止按钮调用 `turn/interrupt`。
- 2026-07-09：修复 `MessageInputParts` 流式状态下 Stop 按钮仍受 composer disabled 影响的问题；新增 `messageInput.stopAriaLabel` 中英文文案。
- 2026-07-09：已运行 `npm run test -- src/codex-web`，6 个测试文件、19 个测试通过。
- 2026-07-09：已运行 `npm run test`，10 个测试文件、37 个测试通过；已运行 `npm run build`，通过但仍有既有 Turbopack theme loader trace warning；已运行 `npm run test:smoke`，真实 bridge bootstrap 通过。
- 2026-07-09：真实页面验证：历史页 `/chat/019f452c-2c35-7ee3-a876-cc0770789a58` 连续发送“请只回复：resume-5d-a”和“请只回复：resume-5d-b”均完成，composer 恢复。
- 2026-07-09：真实页面反例验证：新建 `/chat` 发送“请只回复：new-5d”完成，与历史 resume 路径区分。
- 2026-07-09：真实页面中断验证：新建 `/chat` 发送“请运行命令：sleep 60 && echo done”后点击“停止生成”，页面显示“Codex 已中断。可以继续发送下一轮。”；随后发送“请只回复：after-interrupt”完成，当前 console 0 errors / 0 warnings；验证后已停止 dev server。

## Phase 5E-B：Approval 复杂边界硬化

目标：让 app-server approval 在新 thread 和 resume thread 中成为可靠闭环，而不是只显示 PermissionPrompt。pending approval 期间不得并发启动新 turn，approval response 必须按 requestId 精确响应，approve/deny 后 UI 状态要恢复。

架构：继续以 app-server server request 为 approval 事实源，`approval-adapter` 只负责官方 schema 映射；`AppServerProvider` 负责防重复响应和 diagnostics；`ChatView`、`/chat`、`/chat/[id]` 只做 UI 禁用和 thread 过滤，不改写 prompt 或 turn input。

本阶段不做：多个 approval 队列、过期 approval 的复杂队列调度、MCP elicitation、完整工具详情和 Phase 6 的大输出策略。

实施清单：

- [x] 新增 approval response guard，区分 `idle/responding/resolved`，防止同一个 requestId 重复响应。
- [x] `AppServerProvider.respondToApproval()` 使用 guard，stale requestId 快速失败并写 diagnostics。
- [x] `ChatView` app-server 分支在 pending approval 时禁止发送新 turn，不把输入加入队列。
- [x] `/chat` 新建会话 pending approval 时禁用 composer，避免 approval 期间并发发送。
- [x] `/chat/[id]` 历史会话继续按 threadId / resumedThreadId 过滤 approval，避免跨 thread 显示。
- [x] 补单元测试覆盖 approval guard、重复响应、stale 响应和官方 schema 映射不变。
- [x] 补真实页面反例验证：普通消息无 PermissionPrompt，触发 command approval 才出现 PermissionPrompt，approve/deny 后状态恢复。

验证：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web
npm run test
npm run build
npm run test:smoke
```

Phase 4C 记录：

- 2026-07-09：`AppServerBrowserClient` 支持识别 app-server 发起的 JSON-RPC server request，并可通过同一 WebSocket 返回 JSON-RPC response。
- 2026-07-09：新增 `src/codex-web/approval-adapter.ts`，把 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval` 映射到 CodexWeb `PermissionPrompt` 可显示的数据，并把用户选择转换回官方 app-server response schema。
- 2026-07-09：`AppServerProvider` 保存 `pendingApproval`，暴露 `respondToApproval()`；unsupported server request 进入 diagnostics 并返回 JSON-RPC error，避免静默挂起。
- 2026-07-09：`/chat` 权限确认 UI 只作为 app-server approval 的显示层；不会改写 system prompt、user message 或 turn input。
- 2026-07-09：已运行 `npm run typecheck`，通过；已运行 `npm run test -- src/codex-web`，3 个测试文件、10 个测试通过。
- 2026-07-09：已运行 `npm run test`，7 个测试文件、28 个测试通过；已运行 `npm run build`，通过但仍有 Turbopack theme loader trace warning；已运行 `npm run test:smoke`，真实 bridge bootstrap 通过。
- 2026-07-09：真实页面验证：启动 dev server 后打开 `/chat`，页面标题 `CodexWeb`，console 0 errors / 0 warnings；验证后已停止 dev server。

## Phase 5F-B：Resume 错误收口与 active turn 隔离

目标：补齐历史会话继续发送的错误收口与跨 thread active turn 隔离。`thread/resume`、`turn/start` 或 bridge 失败时必须显示可见错误，不追加伪 user/assistant 成功消息；其它 thread 正在运行时，当前历史页必须明确 degraded，而不是展示不属于本页的 delta、approval 或工具状态。

架构：继续以 app-server notification 为事实源。`ChatView` 只负责 app-server 分支的错误 banner 和 composer 状态；`selectVisibleActiveTurn()` 负责纯逻辑判断 active turn 是否属于当前 route thread 或 resumed thread；历史页只消费 selector 结果，不手写多处分支。

本阶段不做：页面刷新后恢复 running turn、分页加载、多个 approval 队列、真实 `CODEX_HOME` 验收。

实施清单：

- [x] `ChatView` 增加 app-server 错误 banner，app-server 发送失败只显示 banner，不追加伪 assistant 错误消息。
- [x] `ChatView` app-server 分支改为发送成功后再追加本地 user/assistant 历史消息；前置失败返回 `false`，保留 composer 输入。
- [x] 新增 `active-turn-visibility-adapter`，判断 active turn 是否属于当前历史页或 resumed thread。
- [x] `/chat/[id]` 使用 selector 过滤 active turn，并把其它 thread running/starting 状态显示为 degraded notice。
- [x] 补 targeted 单元测试覆盖当前 route thread、resumed thread、其它 running thread、其它 completed thread 反例。

验证：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/active-turn-visibility-adapter.test.ts
npm run test -- src/codex-web
npm run test
npm run build
npm run test:smoke
```

Phase 5F-B 记录：

- 2026-07-09：新增 `src/codex-web/active-turn-visibility-adapter.ts`，返回当前页面可见 active turn 或 degraded notice；其它 completed thread 不显示提示。
- 2026-07-09：`/chat/[id]` 通过 selector 过滤 app-server active turn，避免其它 thread 的 delta、approval 或工具状态串入当前页。
- 2026-07-09：`ChatView` 增加 app-server 错误 banner；`appServerSend` 抛错或返回 failed 时不追加伪 assistant 错误消息；`thread/resume` 或 `turn/start` 前置失败返回 `false`，保留 composer 输入。
- 2026-07-09：`sendTurnInThread` 增加 `onAccepted` 回调，在 app-server `turn/start` 成功后追加 optimistic user，避免前置失败制造伪消息，同时保持成功 turn 的即时用户消息反馈。
- 2026-07-09：重新执行 Phase 5F-B 时补充 provider 层失败清理：`thread/start` 或 `turn/start` 请求失败会清掉本次留下的 `starting` active turn 和 pending completion，避免 composer 或跨 thread degraded notice 残留错误状态。
- 2026-07-09：真实页面验证发现 `FolderPicker` 在 browse 响应缺少 `directories` 数组时会触发 ErrorBoundary；已最小修复为非数组目录按空列表处理，避免影响 `/chat` 页面走查。
- 2026-07-09：已运行 `npm run test -- src/codex-web/active-turn-visibility-adapter.test.ts`，包含 `tsc --noEmit`，1 个测试文件、4 个测试通过。
- 2026-07-09：已运行 `npm run test -- src/codex-web`，包含 `tsc --noEmit`，8 个测试文件、28 个测试通过。
- 2026-07-09：已运行 `npm run test`，包含 `tsc --noEmit`，12 个测试文件、46 个测试通过。
- 2026-07-09：已运行 `npm run build`，通过；仍有既有 Turbopack `theme/loader.ts` trace warning，未阻塞构建。
- 2026-07-09：已运行 `npm run test:smoke`，真实 bridge bootstrap 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=5，accountSource=`app-server.account/read`。
- 2026-07-09：真实页面验证：启动 dev server 后通过 CDP 打开 `http://192.168.3.12:3000/chat` 和 `/chat/019f452c-2c35-7ee3-a876-cc0770789a58`；标题 `CodexWeb`，页面有 Codex UI 文本，无 ErrorBoundary，console 0 errors / 0 warnings；验证后已停止 dev server。
- 2026-07-09：重新执行 Phase 5F-B 后已运行 `npm run test -- src/codex-web/active-turn-visibility-adapter.test.ts`，包含 `tsc --noEmit`，1 个测试文件、4 个测试通过。
- 2026-07-09：重新执行 Phase 5F-B 后已运行 `npm run test -- src/codex-web`，包含 `tsc --noEmit`，8 个测试文件、28 个测试通过。
- 2026-07-09：重新执行 Phase 5F-B 后已运行 `npm run test`，包含 `tsc --noEmit`，12 个测试文件、46 个测试通过。
- 2026-07-09：重新执行 Phase 5F-B 后已运行 `npm run test:smoke`，真实 bridge bootstrap 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=5，accountSource=`app-server.account/read`。
- 2026-07-09：重新执行 Phase 5F-B 时 `npm run build` 在沙箱、代理和非沙箱代理环境均未通过，失败点为 Next/Turbopack 下载 Google Fonts / `fonts.gstatic.com` 字体资源连接失败；未出现本阶段 TypeScript 或 5F-B 代码编译错误。
- 2026-07-09：重新执行 Phase 5F-B 真实页面验证：启动 dev server 后打开 `http://192.168.3.12:3000/chat` 和 `/chat/019f452c-2c35-7ee3-a876-cc0770789a58`；标题 `CodexWeb`，历史页显示隔离 thread “请只回复：pong”，无 ErrorBoundary，console 0 errors / 0 warnings；验证后已停止 dev server。
- 2026-07-10：构建稳定化：移除 `next/font/google` 的构建期联网字体依赖，在 `globals.css` 保留 `--font-geist-sans` / `--font-geist-mono` 变量名并映射到系统字体栈，避免 Google Fonts 下载失败阻塞生产构建。
- 2026-07-10：构建稳定化后已运行 `npm run build`，通过；仍有既有 Turbopack `theme/loader.ts` / `next.config.mjs` NFT trace warning，未阻塞构建。
- 2026-07-10：构建稳定化后已运行 `npm run test`，包含 `tsc --noEmit`，12 个测试文件、46 个测试通过。
- 2026-07-10：构建稳定化后已运行 `npm run test:smoke`，真实 bridge bootstrap 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=5，accountSource=`app-server.account/read`。
- 2026-07-10：构建稳定化后启动 dev server 并用 HTTP 验证 `/chat` 与 `/chat/019f452c-2c35-7ee3-a876-cc0770789a58` 均返回 `200 text/html; charset=utf-8`；验证后已停止 dev server。

## Phase 5G：刷新后 active turn degraded 提示

目标：补齐历史会话在 turn running 期间刷新页面后的可见状态。刷新后 WebSocket notification 流不可恢复时，Web 不伪造实时 running/delta；如果 `thread/read` 显示该 thread 仍为 active 或存在 `inProgress` turn，则在当前历史页显示明确 degraded 提示。

架构：继续以 app-server 为事实源。`thread/read { includeTurns: true }` 返回的 `thread.status` 与 `turn.status` 是刷新后唯一可用状态来源；`selectVisibleActiveTurn()` 统一决定当前页显示真实 active turn、跨 thread degraded notice，或刷新后 degraded notice；`ChatView` 复用 Phase 5F-B 的 `appServerNotice` banner。

本阶段不做：恢复旧 WebSocket notification 流、补齐页面刷新后的实时 delta、自动 reconnect 到运行中 turn、分页加载、真实 `CODEX_HOME` 验收。

实施清单：

- [x] 对照 generated schema，确认 `Thread.status` 支持 `active`，`Turn.status` 支持 `inProgress`。
- [x] `/chat/[id]` 保存当前页面 `thread/read` 返回的 Thread，避免从全局 selectedThread 读取导致串页。
- [x] `selectVisibleActiveTurn()` 在无可见 active turn 时读取 `thread.status` / `turn.status`，返回刷新后 degraded notice。
- [x] 保持已有跨 thread running notice 优先，不把其它 thread 的 delta、approval 或工具状态显示到当前页。
- [x] 补 targeted 单元测试覆盖刷新后 `thread.status=active`、`turn.status=inProgress` 和 completed 历史反例。

验证：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/active-turn-visibility-adapter.test.ts
npm run test -- src/codex-web
npm run test
npm run build
npm run test:smoke
```

Phase 5G 记录：

- 2026-07-10：`thread/read` schema 确认：`Thread.status` 可为 `{ type: "active" }`，`Turn.status` 可为 `"inProgress"`；刷新后 UI 只能基于这些历史读取状态显示 degraded，不能伪造实时 notification。
- 2026-07-10：`/chat/[id]` 保存本页 `thread/read` 返回的 Thread，并传给 `selectVisibleActiveTurn()`；selector 在没有可见 active turn 时返回“此会话可能仍在运行”的 app-server.thread/read breadcrumb 提示。
- 2026-07-10：已运行 `npm run test -- src/codex-web/active-turn-visibility-adapter.test.ts`，包含 `tsc --noEmit`，1 个测试文件、7 个测试通过。
- 2026-07-10：已运行 `npm run test -- src/codex-web`，包含 `tsc --noEmit`，8 个测试文件、31 个测试通过。
- 2026-07-10：已运行 `npm run test`，包含 `tsc --noEmit`，12 个测试文件、49 个测试通过。
- 2026-07-10：已运行 `npm run build`，通过；仍有既有 Turbopack `theme/loader.ts` / `next.config.mjs` NFT trace warning，未阻塞构建。
- 2026-07-10：已运行 `npm run test:smoke`，真实 bridge bootstrap 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=5，accountSource=`app-server.account/read`。

## Phase 6A：历史分页加载

目标：为 app-server 历史会话接入 turn 分页加载。长历史打开时不依赖一次性全量 `thread/read includeTurns=true`，而是通过 experimental `thread/turns/list` 获取 turn page 和 cursor；用户点击“加载更早”时继续拉取更早 turn，并避免重复消息。

架构：稳定 `thread/read` 仅用于 metadata-first 读取；分页使用官方 experimental `thread/turns/list`。当前项目 generated TS schema 未包含 experimental method，因此新增本地最小 `ThreadTurnsListParams` / `ThreadTurnsListResponse` 类型，字段严格对齐官方 Rust protocol，不重新生成整套 schema。消息映射复用 `threadToMessages()`，新增 `thread-turns-page-adapter` 负责 page 顺序和去重。

本阶段不做：`thread/items/list` 深度 item 分页、重新生成 experimental TS schema、历史归档/删除/重命名、真实 `CODEX_HOME` 验收。

实施清单：

- [x] 对照官方 Rust protocol 和 app-server tests，确认 `thread/turns/list` 参数为 `threadId`、`cursor`、`limit`、`sortDirection`、`itemsView`，响应包含 `data`、`nextCursor`、`backwardsCursor`。
- [x] 新增 `src/codex-web/thread-turns-page-adapter.ts`，定义本地 experimental 类型，支持 desc page 反转为时间正序，并按 message id 去重合并。
- [x] `AppServerProvider` 暴露 `listThreadTurns()`，仅发起 JSON-RPC request，不写入全局 selectedThread。
- [x] `/chat/[id]` 改为 metadata-first：先 `thread/read { includeTurns: false }`，再尝试 `thread/turns/list` 读取第一页；experimental 不可用时回退稳定 `thread/read { includeTurns: true }`。
- [x] `ChatView` 增加 app-server load-earlier override，复用现有 `MessageList` 的“加载更早”入口。
- [x] unsupported 或分页失败时显示 `历史分页暂不可用` notice，不追加伪消息。

验证：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/thread-turns-page-adapter.test.ts
npm run test -- src/codex-web
npm run test
npm run build
npm run test:smoke
```

Phase 6A 记录：

- 2026-07-10：新增 `docs/superpowers/specs/2026-07-10-phase-6a-history-pagination-design.md` 和 `docs/superpowers/plans/2026-07-10-phase-6a-history-pagination.md`，记录 experimental adapter 方案与执行步骤。
- 2026-07-10：新增 `src/codex-web/thread-turns-page-adapter.ts` 和测试，覆盖 desc page 时间正序、asc page 保持正序、prepend 合并去重。
- 2026-07-10：`/chat/[id]` 初始历史加载改为 metadata-first，并用 `thread/turns/list(limit=30, sortDirection=desc, itemsView=full)` 获取第一页和 `nextCursor`；加载更早继续使用该 cursor。
- 2026-07-10：已运行 `npm run test -- src/codex-web/thread-turns-page-adapter.test.ts`，包含 `tsc --noEmit`，1 个测试文件、3 个测试通过。
- 2026-07-10：已运行 `npm run test -- src/codex-web`，包含 `tsc --noEmit`，9 个测试文件、34 个测试通过。
- 2026-07-10：已运行 `npm run test`，包含 `tsc --noEmit`，13 个测试文件、52 个测试通过。
- 2026-07-10：已运行 `npm run build`，通过；仍有既有 Turbopack `theme/loader.ts` / `next.config.mjs` NFT trace warning，未阻塞构建。
- 2026-07-10：已运行 `npm run test:smoke`，真实 bridge bootstrap 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=5，accountSource=`app-server.account/read`。
- 2026-07-10：启动 dev server 后用 HTTP 验证 `/chat` 与 `/chat/019f452c-2c35-7ee3-a876-cc0770789a58` 均返回 `200 text/html; charset=utf-8`；临时 HTML 保存到 `/volume2/SSD/codex/Temp/codex-web-phase6a-chat-20260710.html` 和 `/volume2/SSD/codex/Temp/codex-web-phase6a-history-20260710.html`；验证后已停止 dev server。

## Phase 6B：工具大输出展示截断

目标：对实时和历史工具输出做与官方 TUI/core 一致的展示保护，避免超过官方上限的 stdout、stderr 或 MCP JSON 结果完整进入 CodexWeb 消息状态导致页面卡顿。

架构：新增纯展示 helper `tool-output-display`。实时 `tool-adapter` 和历史 `thread-history-adapter` 在把工具输出转成 CodexWeb `tool_result.content` 或 `streamingToolOutput` 前调用该 helper；阈值对齐官方 `DEFAULT_OUTPUT_BYTES_CAP = 1024 * 1024`，超过阈值时保留前缀并提示省略字节数。CodexWeb UI 层继续按 5 行头尾折叠；不改 app-server 协议、不改 bridge、不新增完整输出 UI。

本阶段不做：完整输出弹窗、下载完整 stdout、浏览器端保存原始输出副本、工具 cell 视觉布局调整、真实 `CODEX_HOME` 验收。

实施清单：

- [x] 新增 `src/codex-web/tool-output-display.ts`，短输出原样返回，长输出按官方 1 MiB 前缀上限插入可见截断提示。
- [x] 实时 adapter 的 running output、completed command、fileChange output、MCP result 统一接入展示截断。
- [x] 历史 adapter 的 commandExecution result 和 MCP result 接入展示截断。
- [x] 补单元测试覆盖短输出原样、运行中 command 大输出、完成 command 大输出、fileChange 大输出、历史 command / MCP 大输出。
- [x] 在隔离 `CODEX_HOME` 下完成 targeted、全量、build 和 smoke 验证。

验证：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/tool-output-display.test.ts
npm run test -- src/codex-web/tool-adapter.test.ts
npm run test -- src/codex-web/thread-history-adapter.test.ts
npm run test -- src/codex-web
npm run test
npm run build
npm run test:smoke
```

Phase 6B 记录：

- 2026-07-10：新增 `docs/superpowers/specs/2026-07-10-phase-6b-tool-output-truncation-design.md` 和 `docs/superpowers/plans/2026-07-10-phase-6b-tool-output-truncation.md`，记录展示层截断方案与执行步骤。
- 2026-07-10：对照官方实现：`codex-rs/utils/pty/src/lib.rs` 定义 `DEFAULT_OUTPUT_BYTES_CAP = 1024 * 1024`；`codex-rs/core/src/exec.rs` 的 shell tool 聚合输出按该上限前缀保留；`codex-rs/core/src/mcp_tool_call.rs` 的 MCP result 事件也使用同一上限族；`codex-rs/tui/src/exec_cell/render.rs` 展示层使用 `TOOL_CALL_MAX_LINES = 5` 做行级头尾折叠。
- 2026-07-10：新增 `src/codex-web/tool-output-display.ts`，展示保护阈值为官方 1 MiB；超阈值时保留前缀并提示省略字节数。
- 2026-07-10：`tool-adapter` 和 `thread-history-adapter` 已接入展示截断；短输出保持原样；命令输出先截断 stdout/stderr 聚合文本，再追加 exit code，保留命令元数据。
- 2026-07-10：已运行 `npm run test -- src/codex-web/tool-output-display.test.ts`，包含 `tsc --noEmit`，1 个测试文件、2 个测试通过。
- 2026-07-10：已运行 `npm run test -- src/codex-web/tool-adapter.test.ts`，包含 `tsc --noEmit`，1 个测试文件、6 个测试通过。
- 2026-07-10：已运行 `npm run test -- src/codex-web/thread-history-adapter.test.ts`，包含 `tsc --noEmit`，1 个测试文件、4 个测试通过。
- 2026-07-10：已运行 `npm run test -- src/codex-web`，包含 `tsc --noEmit`，10 个测试文件、40 个测试通过。
- 2026-07-10：已运行 `npm run test`，包含 `tsc --noEmit`，14 个测试文件、58 个测试通过。
- 2026-07-10：已运行 `npm run build`，通过；仍有既有 Turbopack `theme/loader.ts` / `next.config.mjs` NFT trace warning，未阻塞构建。
- 2026-07-10：`npm run build` 后 `next-env.d.ts` 被 Next 自动改为 `./.next/types/routes.d.ts`，已按用户要求还原为 `./.next/dev/types/routes.d.ts`，不纳入本阶段提交。
- 2026-07-10：已运行 `npm run test:smoke`，真实 bridge bootstrap 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=5，accountSource=`app-server.account/read`。
- 2026-07-10：按用户要求对比官方 TUI/core 后调整 Phase 6B：Web 展示保护从 12KB 头尾字符截断改为官方 1 MiB 前缀字节上限；CodexWeb UI 层继续复用 5 行头尾折叠，保持与 TUI 展示节奏一致。
- 2026-07-10：官方一致调整后已重新运行 `npm run test -- src/codex-web/tool-output-display.test.ts`，包含 `tsc --noEmit`，1 个测试文件、2 个测试通过。
- 2026-07-10：官方一致调整后已重新运行 `npm run test -- src/codex-web/tool-adapter.test.ts`，包含 `tsc --noEmit`，1 个测试文件、6 个测试通过。
- 2026-07-10：官方一致调整后已重新运行 `npm run test -- src/codex-web/thread-history-adapter.test.ts`，包含 `tsc --noEmit`，1 个测试文件、4 个测试通过。
- 2026-07-10：官方一致调整后已重新运行 `npm run test -- src/codex-web`，包含 `tsc --noEmit`，10 个测试文件、40 个测试通过。
- 2026-07-10：官方一致调整后已重新运行 `npm run test`，包含 `tsc --noEmit`，14 个测试文件、58 个测试通过。
- 2026-07-10：官方一致调整后已重新运行 `npm run build`，通过；仍有既有 Turbopack `theme/loader.ts` / `next.config.mjs` NFT trace warning，未阻塞构建；构建后 `next-env.d.ts` 已按用户要求再次还原。
- 2026-07-10：官方一致调整后已重新运行 `npm run test:smoke`，真实 bridge bootstrap 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=5，accountSource=`app-server.account/read`。

## Phase 6C：Approval 队列与过期响应硬化

目标：补齐多个 app-server approval server request 的队列语义。连续 approval 不得互相覆盖；`serverRequest/resolved` 或用户响应成功后必须按 requestId 移除；历史页只显示当前 thread 的 approval，避免跨 thread 串线。

架构：对照官方 TUI `chatwidget/interrupts.rs` 的 `VecDeque<QueuedInterrupt>` 和 `remove_resolved_prompt()` 语义。Web 新增纯函数 `approval-queue-adapter` 管理队列；`AppServerProvider` 新增 `pendingApprovals`，继续派生兼容字段 `pendingApproval`；页面可按 thread 过滤队列中的可见 approval，并把 requestId 传回 `respondToApproval()`。

本阶段不做：approval 列表 UI、MCP elicitation、requestUserInput 队列、真实 `CODEX_HOME` 验收。

实施清单：

- [x] 新增 `src/codex-web/approval-queue-adapter.ts`，支持入队、按 requestId 去重、移除、查找和 thread 过滤。
- [x] `CodexWebAppServerState` 新增 `pendingApprovals`，`pendingApproval` 保持为全局队首兼容字段。
- [x] `AppServerProvider` 收到 approval server request 时入队，收到 `serverRequest/resolved` 时按 requestId 移除。
- [x] `respondToApproval(decision, requestId?)` 支持精确响应当前可见 approval；stale/duplicate 继续通过 guard 失败并写 diagnostics。
- [x] 历史页从队列中选择当前 route thread 或 resumed thread 的第一个 approval，避免其它 thread 的队首 approval 遮住当前页。
- [x] 在隔离 `CODEX_HOME` 下完成 targeted、全量、build 和 smoke 验证。

验证：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/approval-queue-adapter.test.ts
npm run test -- src/codex-web
npm run test
npm run build
npm run test:smoke
```

Phase 6C 记录：

- 2026-07-10：新增 `docs/superpowers/specs/2026-07-10-phase-6c-approval-queue-design.md` 和 `docs/superpowers/plans/2026-07-10-phase-6c-approval-queue.md`，记录官方 TUI 队列语义和 Web 实施边界。
- 2026-07-10：对照官方 TUI：`chatwidget/interrupts.rs` 使用 `VecDeque<QueuedInterrupt>` 排队 approval / permission / elicitation，并用 `remove_resolved_prompt()` 按 resolved request 移除；Phase 6C 在 Web 中实现 approval 子集。
- 2026-07-10：新增 `approval-queue-adapter`，并接入 `AppServerProvider`、`/chat` 和 `/chat/[id]`。
- 2026-07-10：已运行 `npm run test -- src/codex-web/approval-queue-adapter.test.ts`，包含 `tsc --noEmit`，1 个测试文件、5 个测试通过。
- 2026-07-10：已运行 `npm run test -- src/codex-web`，包含 `tsc --noEmit`，11 个测试文件、45 个测试通过。
- 2026-07-10：已运行 `npm run test`，包含 `tsc --noEmit`，15 个测试文件、63 个测试通过。
- 2026-07-10：已运行 `npm run build`，通过；仍有既有 Turbopack `theme/loader.ts` / `next.config.mjs` NFT trace warning，未阻塞构建。
- 2026-07-10：`npm run build` 后 `next-env.d.ts` 被 Next 自动改为 `./.next/types/routes.d.ts`，已按用户要求还原为 `./.next/dev/types/routes.d.ts`，不纳入本阶段提交。
- 2026-07-10：已运行 `npm run test:smoke`，真实 bridge bootstrap 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=5，accountSource=`app-server.account/read`。

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
