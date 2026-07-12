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
| Phase 6D | 工具状态完整映射 | Code complete | 实时和历史工具 item 统一复用 app-server 状态映射，覆盖 command、fileChange、MCP、dynamic 和 collab |
| Phase 6E | 工具状态与中断反例验证 | Smoke passed | 普通、success、failed、interrupted 四类路径已用单元测试、build、smoke 和真实浏览器验证；当前隔离环境刷新后 interrupted 使用 `app-server.thread/read` fallback breadcrumb |
| Phase 6F Task 1 | 协议观察脚本和真实 fallback 数据判定 | Code complete | `thread/read(includeTurns:true)` 已用只读脚本观察；当前目标 thread 不含可恢复工具 item，Web 不从 assistant 文本伪造工具 cell |
| Phase 6F Task 3 | 独立工具路径真实浏览器验证 | Smoke passed | file read、web direct、write/fileChange 和历史 route 复查完成；curl baidu 在当前 app-server 命令环境仍受网络/代理限制但错误可见；write completion timeout 已修复 |
| Phase 6F Process Blocks | TUI 等价过程块 replay | Smoke passed | completed 工具 turn 显示 `已处理 + 时间 + 中间过程 + final answer`；同一浏览器进程切 session 再切回仍保留；刷新后只信 app-server 历史，不伪造工具过程 |
| Phase 6G | 历史分页 capability 复查 | Smoke passed | `experimentalApi: true` 后 `thread/turns/list` 主路径可用；历史 route 不再显示 capability fallback notice |
| Phase 6H | 官方 TUI / app-server 历史工具边界复查 | Review passed | 官方 TUI replay 只显示 app-server 返回的 `Turn.items`；官方 app-server 历史 API 明确不返回 command execution，Web 不做额外持久化或伪造恢复 |
| Phase 6I | 历史续聊上下文真实回归 | Smoke passed | 重启 Web/bridge 后历史 UI 不显示过程块，但续聊仍能从官方 resume 上下文回答上一轮工具读取到的 scripts |
| Phase 6J | 多 active turn 并发状态模型 | Smoke passed | 多个 thread active turn 按 threadId 隔离；新建 B 不打断 A，客户端切回 A 保留 `已处理 + 时间 + 过程 + final answer` |
| Phase 6K | 多 active turn 失败/中断/approval 并发回归 | Smoke passed | approval、interrupt、failed/completed 在多个 active thread 之间不串线；真实浏览器验证 B approval 与 A interrupt 互不影响 |
| Phase 6L | 新建页多轮发送归属修复 | Smoke passed | `/chat?new=...` 首轮完成后继续发送复用同一个 app-server thread，不再创建第二个新 thread |
| Phase 6M | 历史页多轮续聊归属回归 | Smoke passed | 历史页首次 `thread/resume` 后，后续多轮复用 `resumedThreadId`，不重复 resume 或串回 route id |
| Phase 6N | 多轮历史列表/分页一致性回归 | Smoke passed | 四轮历史 thread 通过 `thread/turns/list` 正序展示，刷新和切 session 后仍保留全部文本且不出现分页 fallback notice |
| Phase 6O | 长历史 Load Earlier 真实回归 | Smoke passed | 35-turn 隔离历史 thread 首屏加载最近 30 turn，点击“加载更早”后 prepend 早期 5 turn，35 条 final answer 无重复无缺失 |
| Phase 6P | 长历史分页后续聊上下文回归 | Smoke passed | 未 Load Earlier 与已 Load Earlier 两条路径都通过官方 resume 找到最早 answer，并落回同一 thread 的第 36 个 turn |
| Phase 6Q | 历史分页失败边界硬化 | Smoke passed | `thread/turns/list` 失败时保留当前消息、关闭后续分页并显示统一 notice；resume 失败不写入 resumed thread 状态 |
| Phase 6R | Load Earlier 真实失败路径回归 | Smoke passed | 测试专用 bridge 拦截第二次 `thread/turns/list`；真实浏览器验证已有消息保留、早期 page 不伪造、notice 可见 |
| Phase 6S | 失败注入能力防误用收口 | Smoke passed | `CODEX_WEB_FAIL_THREAD_TURNS_LIST_ON_CALL` 解析集中在测试 helper，默认/非法值不创建拦截器，只有 dev 脚本显式接入 |
| Phase 6T | 历史分页回归入口整理 | Smoke passed | 新增 `npm run regression:history-pagination`，集中打印 fixture、inspect、失败注入浏览器验证和提交前验证清单 |
| Phase 6U | 官方 Goal / Plan UI | Smoke passed | Goal 为 composer 上方 progress row；Proposed Plan / Updated Plan 为消息时间线 cell；Plan implementation prompt 在 composer 附近；真实浏览器 Plan mode、update_plan、Goal pause/resume/clear 和 clear context implement 已验证 |

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
| Tools | exec / patch / file change / MCP / skill 完整状态映射 | Code complete | Phase 6D | command、fileChange、MCP、dynamic、collab 的 running、success、failed、declined 使用真实 source breadcrumb；interrupted 保持 turn 级状态，不伪造成工具状态 |
| Tools | 工具结果默认折叠、展开详情 | 部分完成 | Phase 6 | 历史工具和新 turn 工具都默认折叠，展开后展示 stdout、stderr、patch 或 MCP 详情 |
| Tools | 大输出与增量输出截断策略 | Code complete | Phase 6B | 大 stdout/stderr 不撑爆页面；截断信息可见，原始输出保留在可诊断来源中 |
| Interrupt | 运行中 turn 中断 | 已完成 | Phase 5D-B | 点击停止后调用官方中断路径，turn 进入 interrupted 或等价官方状态 |
| Interrupt | interrupted 后继续下一轮 | 已完成 | Phase 5D-B | 中断后的同一 thread 可以继续发送新 turn，历史消息不丢失 |
| Interrupt | 页面刷新后恢复 interrupted 状态 | Smoke passed | Phase 6E/6G | 刷新后历史页能从最新历史 turn 显示 interrupted；Phase 6G 已确认 `thread/turns/list` capability 主路径可用，旧 fallback 仅作为稳定降级路径保留 |
| Diagnostics | app-server transport close 与 pending request fail-fast | 部分完成 | Phase 6 | bridge/app-server 退出时 pending request 快速失败，UI 显示 diagnostics，不长时间挂起 |
| Diagnostics | 未知 notification 可见诊断 | 部分完成 | Phase 6 | 未知 notification 不静默丢弃，在 diagnostics 中保留 method、source 和摘要 |
| Goal / Plan | 官方 Codex app 等价 UI | Smoke passed | Phase 6U | Goal 显示为 composer 上方 progress row；Proposed Plan / Updated Plan 显示为消息时间线 cell；`Implement this plan?` 在 composer 附近确认；真实 Plan/Goal 端到端浏览器路径已验证 |
| E2E / Smoke | 普通消息 vs 工具消息反例 | Smoke passed | Phase 6E | 普通文本消息无工具状态；触发 shell 命令时实时工具 cell 显示 success / failed 状态 |
| E2E / Smoke | 无 approval vs approval 反例 | 已完成 | Phase 5E-B | 同一轮验证普通消息无 PermissionPrompt，触发权限时才出现 PermissionPrompt |
| E2E / Smoke | 新 thread vs resume thread 反例 | 已完成 | Phase 5D-B | 新建会话走 `thread/start`，历史继续发送先走 `thread/resume`，两者日志和 UI 行为可区分 |
| E2E / Smoke | success vs failed / interrupted 反例 | Smoke passed | Phase 6E | 真实浏览器验证 success 显示 `已运行`、failed 显示 `运行失败`、中断后刷新显示 `Codex 已中断`；历史工具 cell 在当前 fallback 环境不保留，已记录限制 |

优先级说明：

- Phase 5D 优先补齐“用户已经能触发但还没有完整边界保护”的路径：resume 多轮、approval、interrupt 和反例 smoke。
- Phase 6 再补齐更重的历史管理、完整工具语义、大输出、分页和诊断深化。
- Phase 6U 专门处理官方 Codex app 的 Goal / Plan UI：不得实现右侧常驻 GoalPanel / PlanPanel；实现逻辑必须与 `codex-rs/tui` 的 `goal_status`、`goal_menu`、`plans` 和 `plan_implementation` 保持一致。
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

## Phase 6D：工具状态完整映射

目标：实时 turn 和历史 thread 使用同一套 app-server 工具 item 状态映射，覆盖 commandExecution、fileChange、mcpToolCall、dynamicToolCall 和 collabAgentToolCall。

架构：新增 `tool-item-adapter` 作为纯数据转换层；实时 `tool-adapter` 和历史 `thread-history-adapter` 复用该 helper，不新增 Web 私有工具状态。MCP error 对齐官方：`failed`、`error` 或 `result.content[]` 内 `is_error` / `isError` 为 error；`interrupted` 仍是 turn 级状态，不写入工具 item。

本阶段不做：完整 transcript、原始输出下载、工具详情 UI 大改、历史清理入口、真实 `CODEX_HOME` 验收。

实施清单：

- [x] 对照 generated schema 确认工具 item 状态枚举；`interrupted` 仅作为 turn 级状态处理。
- [x] 新增 `src/codex-web/tool-item-adapter.ts`，统一 tool use、tool result、error 和 breadcrumb 语义。
- [x] 实时 `tool-adapter` 接入共享 adapter，保留 command/fileChange 输出、file patch updates 和 MCP progress 上下文。
- [x] 历史 `thread-history-adapter` 接入共享 adapter，dynamicToolCall 和 collabAgentToolCall 不再计入 unsupported。
- [x] 补单元测试覆盖 command、fileChange、MCP content block `is_error`、dynamic tool、collab tool 和 turn interrupted 反例。

验证：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/tool-item-adapter.test.ts
npm run test -- src/codex-web/tool-adapter.test.ts
npm run test -- src/codex-web/thread-history-adapter.test.ts
npm run test
npm run build
```

Phase 6D 记录：

- 2026-07-10：新增 `docs/superpowers/specs/2026-07-10-phase-6d-tool-status-mapping-design.md` 和 `docs/superpowers/plans/2026-07-10-phase-6d-tool-status-mapping.md`。
- 2026-07-10：generated schema 确认：command/fileChange 支持 `inProgress/completed/failed/declined`；MCP/dynamic/collab 支持 `inProgress/completed/failed`；`interrupted` 是 turn 级状态，不写入工具 item。
- 2026-07-10：新增 `tool-item-adapter`，实时 `tool-adapter` 和历史 `thread-history-adapter` 已复用同一套 tool use / result / error / breadcrumb 映射。
- 2026-07-10：MCP error 按官方 content block 语义处理：`status=failed`、`error.message`、或 `result.content[]` 内 `is_error` / `isError` 都映射为 CodexWeb error result；不访问 generated `McpToolCallResult` 不存在的顶层 `isError`。
- 2026-07-10：已运行 `npm run test -- src/codex-web/tool-item-adapter.test.ts`，包含 `tsc --noEmit`，1 个测试文件、7 个测试通过。
- 2026-07-10：已运行 `npm run test -- src/codex-web/tool-adapter.test.ts`，包含 `tsc --noEmit`，1 个测试文件、8 个测试通过。
- 2026-07-10：已运行 `npm run test -- src/codex-web/thread-history-adapter.test.ts`，包含 `tsc --noEmit`，1 个测试文件、6 个测试通过。
- 2026-07-10：已运行 `npm run test`，包含 `tsc --noEmit`，16 个测试文件、74 个测试通过。
- 2026-07-10：已运行 `npm run build`，通过；仍有既有 Turbopack `theme/loader.ts` / `next.config.mjs` NFT trace warning，未阻塞构建。
- 2026-07-10：`npm run build` 后 `next-env.d.ts` 被 Next 自动改为 `./.next/types/routes.d.ts`，已按用户要求还原为 `./.next/dev/types/routes.d.ts`，不纳入本阶段提交。
- 2026-07-10：单元测试反例：普通 agentMessage 不产生工具信息；command 非零 exit code 产生 error result；MCP completed 但 content block `is_error=true` 产生 error result；turn interrupted 不显示为工具 interrupted/cancelled。

## Phase 6E：工具状态与中断反例验证

目标：补齐 Phase 6D 后的语义验收闭环，确保普通消息不会显示工具状态，触发工具路径能区分 success / failed，并且页面刷新后能从 app-server 历史状态恢复最新 interrupted notice。

架构：`active-turn-visibility-adapter` 接收最新历史 turn snapshot 和真实 source breadcrumb；`thread-turns-page-adapter` 只按明确排序方向提取最新 turn；`/chat/[id]` 在 metadata-first 分页成功时记录 `app-server.thread/turns/list`，fallback 时记录 `app-server.thread/read`。中断提示复用现有 `appServerNotice -> ChatView -> ErrorBanner`，不向 transcript 注入伪 assistant 消息。

本阶段不做：新增 turn-status UI、引入持久 Playwright E2E runner、使用本地真实 `CODEX_HOME`、伪造 `thread/turns/list` capability、把 turn interrupted 写成工具 item 状态。

实施清单：

- [x] 扩展 `selectVisibleActiveTurn()`，支持最新历史 turn 的 `interrupted` / `inProgress` notice，并保留 source breadcrumb。
- [x] 新增 `latestHistoryTurnFromPage()`，`desc` 取第一页第一项，`asc` 取最后一项，空 page 返回 `null`。
- [x] `/chat/[id]` 在初始历史加载和 fallback 中保存最新历史 turn snapshot，并传入 selector；加载更早页面不覆盖最新 snapshot。
- [x] 补单元测试覆盖 interrupted notice、completed 反例、实时 turn 优先级、分页排序和空 page。
- [x] 在隔离 `CODEX_HOME` 下完成 targeted、全量、build、smoke 和真实浏览器验证。

验证：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/active-turn-visibility-adapter.test.ts src/codex-web/thread-turns-page-adapter.test.ts src/codex-web/tool-item-adapter.test.ts src/codex-web/tool-adapter.test.ts
npm run test
npm run build
npm run test:smoke
```

Phase 6E 记录：

- 2026-07-10：新增 `docs/superpowers/specs/2026-07-10-phase-6e-tool-status-interrupt-smoke-design.md` 和 `docs/superpowers/plans/2026-07-10-phase-6e-tool-status-interrupt-smoke.md`，记录工具状态与中断反例验证设计。
- 2026-07-10：`active-turn-visibility-adapter` 支持最新历史 turn snapshot；`interrupted` 返回 `Codex 已中断` notice，`completed` 不显示旧中断，`inProgress` / `thread.status=active` 继续显示运行中 degraded notice。
- 2026-07-10：`thread-turns-page-adapter` 新增 `latestHistoryTurnFromPage()`；`/chat/[id]` 主分页 source 为 `app-server.thread/turns/list`，fallback source 为 `app-server.thread/read`。
- 2026-07-10：已运行 targeted adapter 测试，包含 `tsc --noEmit`，4 个测试文件、34 个测试通过。
- 2026-07-10：已运行 `npm run test`，包含 `tsc --noEmit`，16 个测试文件、83 个测试通过。
- 2026-07-10：已运行 `npm run build`，通过；仍有既有 Turbopack `theme/loader.ts` / `next.config.mjs` NFT trace warning，未阻塞构建。
- 2026-07-10：`npm run build` 后 `next-env.d.ts` 被 Next 自动改为 `./.next/types/routes.d.ts`，已按用户要求还原为 `./.next/dev/types/routes.d.ts`，不纳入本阶段提交。
- 2026-07-10：已运行 `npm run test:smoke`，真实 bridge bootstrap 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=5，accountSource=`app-server.account/read`。
- 2026-07-10：真实浏览器普通消息反例：`/chat` 发送“请只回复：phase6e-plain”，assistant 回复 `phase6e-plain`，主区未出现 `已运行`、`运行失败` 或命令输出。
- 2026-07-10：真实浏览器 success 路径：历史 route `/chat/019f4a15-70d7-7d02-93e9-1b780fefab7f` 触发 `sh -c 'printf phase6e-success-live\n; sleep 3; exit 0'`，approval 后实时工具 cell 显示 `已运行` 和真实 `/bin/bash -lc ...` 命令。
- 2026-07-10：真实浏览器 failed 路径：同一历史 route 触发 `sh -c 'echo phase6e-failed >&2; sleep 3; exit 7'`，approval 后实时工具 cell 显示 `运行失败`，最终 assistant 汇总退出码 7 和 `phase6e-failed` 输出。
- 2026-07-10：真实浏览器 interrupted 路径：停止当前运行 turn 后页面显示“Codex 已中断。可以继续发送下一轮。”；刷新同一 route 后 ErrorBanner 显示 `Codex 已中断` 和 `此状态来自 app-server.thread/read 的最新 turn；可以继续发送下一轮。`
- 2026-07-10：当前隔离环境中 `thread/turns/list` 返回 `requires experimentalApi capability`，因此真实浏览器刷新后 interrupted breadcrumb 走 fallback `app-server.thread/read`；主路径 `app-server.thread/turns/list` 已由单元测试覆盖。
- 2026-07-11：Phase 6G 复查后确认上述 capability 错误是旧 initialize capability 问题；当前 Web/bridge/inspector 初始化都发送 `experimentalApi: true`，`thread/turns/list` 主路径已可用。
- 2026-07-10：真实浏览器 console 检查：0 errors / 0 warnings；验证后已停止 dev server。

## Phase 6F：工具历史 fallback 与独立工具验证

目标：先用只读协议观察区分 fallback 历史是否包含真实工具 item；如果 `thread/read(includeTurns:true)` 不返回工具 item，Web 只能展示 app-server 返回的普通历史消息和明确 degraded 结论，不从 assistant 汇总文本推断或伪造工具 cell。

Phase 6F Task 1 记录：

- 2026-07-10：新增只读脚本 `scripts/inspect-thread-items.ts`，要求显式设置 `CODEX_HOME`，通过 `codex app-server --stdio` 调用 `thread/read { threadId, includeTurns: true }`，输出 thread、turn 和 item 摘要。
- 2026-07-10：使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 读取 Phase 6E thread `019f4a15-70d7-7d02-93e9-1b780fefab7f`；结果为 `turns=3`，turn 状态依次为 `completed`、`completed`、`interrupted`，item 数依次为 2、2、1。
- 2026-07-10：实际 item types 只有 `userMessage` 和 `agentMessage`；`thread/read(includeTurns:true)` 未返回 `commandExecution`、`fileChange`、`mcpToolCall`、`dynamicToolCall`、`collabAgentToolCall` 等工具 item。
- 2026-07-10：因此当前 fallback 历史没有可恢复的真实工具 item；Web 不从 assistant 汇总文本伪造工具 cell，后续 Phase 6F 只能在独立工具验证或 app-server 返回真实工具 item 时展示工具过程区。
- 2026-07-10：已运行单文件自检 `npm exec -- tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --types node scripts/inspect-thread-items.ts`，通过。

Phase 6F Task 3 记录：

- 2026-07-10：独立工具验证前已运行 `npm run test`，包含 `tsc --noEmit`，16 个测试文件、83 个测试通过。
- 2026-07-10：已运行 `npm run build`，通过；仍有既有 Turbopack `theme/loader.ts` / `next.config.mjs` NFT trace warning，未阻塞构建。
- 2026-07-10：`npm run build` 后 `next-env.d.ts` 被 Next 自动改为 `./.next/types/routes.d.ts`，已按用户要求还原为 `./.next/dev/types/routes.d.ts`，不纳入本阶段提交。
- 2026-07-10：已运行 `npm run test:smoke`，真实 bridge bootstrap 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=5，accountSource=`app-server.account/read`。
- 2026-07-10：真实浏览器 file read/search 路径：`/chat` 请求读取 `package.json` scripts；approval 后实时工具 cell 显示 `已运行`，命令为只读 shell，最终回复 scripts 摘要。
- 2026-07-10：真实浏览器 web direct 路径：请求访问 `https://example.com/`，页面最终回复 `Example Domain`；该路径未出现可见 shell/tool cell，记录为模型直接完成或非 shell 工具不可见路径。
- 2026-07-10：真实浏览器 web/network shell 路径：显式请求 `curl -I https://example.com/`；approval 后实时工具 cell 显示 `运行失败`，展开可见 `curl: (6) Could not resolve host: example.com`，属于隔离环境 DNS/网络限制，UI 正确显示失败状态和错误输出。
- 2026-07-10：真实浏览器 write 路径：请求写入 `/volume2/SSD/codex/Temp/phase6f-write-check.txt`，权限面板显示目标路径并支持 `Allow Once`；允许后文件实际创建，内容为 `phase6f-write-ok`。
- 2026-07-10：write 路径残留风险：虽然文件写入成功，页面最终显示“创建会话失败 / 等待 turn/completed 超时”，未进入正常 completed 收口；需后续单独调查 approval 后 completion timeout。
- 2026-07-10：本轮没有完成新工具 thread 的历史 route 复查；dev server 停止后浏览器标签进入 `chrome-error://chromewebdata/`，无法再从 DOM 取本轮新 thread 链接。当前可确定结论仍以 Task 1 的 `thread/read` 协议观察为准：fallback 不含可恢复工具 item 时 Web 不伪造工具 cell。
- 2026-07-10：真实浏览器 console 检查：0 errors / 0 warnings；验证后已停止 dev server。
- 2026-07-10：修复 completion 收口：Web 的 `turn/start` / `thread/start` Promise 语义改为与官方 TUI 对齐，只表示 app-server accepted；running、completed、failed、interrupted 继续由 notification reducer 驱动，避免缺失或延迟 `turn/completed` 时把已执行动作误报为“创建会话失败”。
- 2026-07-10：修复后已运行 `npm run test`，包含 `tsc --noEmit`，16 个测试文件、85 个测试通过；新增 accepted turn 不等待 completed、accepted 不覆盖已到达终态 notification 的单元测试。
- 2026-07-10：修复后 `npm run build` 在默认 sandbox 下因 Turbopack 创建进程 / 绑定端口触发 `Operation not permitted`；提权重跑通过，仍仅有既有 `theme/loader.ts` / `next.config.mjs` NFT trace warning。`next-env.d.ts` 已按用户要求还原为 `./.next/dev/types/routes.d.ts`。
- 2026-07-10：修复后 `npm run test:smoke` 在默认 sandbox 下因 `tsx` IPC pipe `listen EPERM` 失败；提权重跑通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=7，accountSource=`app-server.account/read`。
- 2026-07-10：修复后真实浏览器 curl baidu 路径：无代理 dev server 下请求 `curl -I https://www.baidu.com/`，页面回复 `curl: (6) Could not resolve host: www.baidu.com`；代理环境 dev server 下命令可见代理地址但 app-server 命令环境无法连接 `192.168.3.12:7899`，页面回复 `curl: (7) Failed to connect ... Couldn't connect to server`。两次均无 completion timeout，属于环境网络/代理连通性限制。
- 2026-07-10：修复后真实浏览器 write 路径：请求创建 `/volume2/SSD/codex/Temp/phase6f-write-check.txt`，approval 显示目标路径，`Allow Once` 后文件实际创建，内容为 `phase6f-write-ok`，页面正常回复“写入成功”，未再出现“等待 turn/completed 超时”。
- 2026-07-10：Step 6 历史 route 复查完成：打开 `/chat/019f4ccb-3432-7692-a164-f631394a66de` 后历史只恢复用户消息和 assistant “写入成功”，没有伪造工具 cell；页面显示 `thread/turns/list requires experimentalApi capability` 后回退到 `thread/read`，符合 fallback 不伪造工具过程区的原则。
- 2026-07-10：修复后真实浏览器 console 检查：0 errors / 0 warnings；验证后已停止 dev server。
- 2026-07-11：对齐官方 TUI 过程块 replay：Web bootstrap、server bootstrap 和只读 inspector 都发送 `experimentalApi: true` capability；live/completed/history 统一通过 `app-server-message-blocks` 从真实 `ThreadItem` / notification turn 构造 CodexWeb 过程块，普通 final-only turn 仍保持纯文本。
- 2026-07-11：对齐官方 TUI `ThreadEventStore` 的同进程 replay 边界：`AppServerProvider` 在内存中按 `threadId:turnId` 保存 notification-derived turn snapshot；`/chat/[id]` 历史 route 重建消息时仅用同一进程 snapshot 覆盖同一 turn 的 assistant 消息，不写入 localStorage / IndexedDB。
- 2026-07-11：真实浏览器过程块回归：在 `/chat` 发送“必须使用工具读取当前仓库 package.json，然后只回复 scripts 里有多少个脚本。”，完成后显示 `已处理 7s`，展开可见 `已运行 /bin/bash -lc ... package.json`，final answer 为 `6`。
- 2026-07-11：真实浏览器切换 session 回归：从工具 thread `019f4d56-297b-7743-93e1-a65f8747d73a` 切到 `019f4d55-366f-7742-89a4-90b9581ad266` 后再切回，过程块仍可展开，保留 `已运行`、真实 shell 命令和 final answer。
- 2026-07-11：刷新反例验证：刷新 `/chat/019f4d56-297b-7743-93e1-a65f8747d73a` 后页面只显示 app-server 历史可恢复的 final answer `6`，没有 `已处理` 或工具命令；这符合官方 TUI 重启后只 replay app-server 历史 `Turn.items` 的边界，Web 不从 final answer 伪造工具过程。
- 2026-07-11：验证命令已完成：targeted tests 4 个文件 22 个测试通过；`npm run test` 17 个文件 90 个测试通过；`npm run build` 通过且仅有既有 NFT trace warning，`next-env.d.ts` 已还原；`npm run test:smoke` 通过，`models=7`，`accountSource=app-server.account/read`；真实浏览器 console 0 error / 0 warning。

## Phase 6G：历史分页 capability 复查

目标：确认 Phase 6F 中记录的 `thread/turns/list requires experimentalApi capability` 是否已由统一 initialize capability 修复，并保留稳定 fallback 的边界说明。

Phase 6G 记录：

- 2026-07-11：扩展只读脚本 `scripts/inspect-thread-items.ts`，在同一个 initialized app-server 会话中先调用 `thread/read(includeTurns:true)`，再调用 `thread/turns/list { threadId, cursor:null, limit:30, sortDirection:"desc", itemsView:"full" }`，用于复查 experimental capability 主路径。
- 2026-07-11：使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 读取真实浏览器生成的 thread `019f4d56-297b-7743-93e1-a65f8747d73a`；`thread/read` 返回 `turns=1`，仍只有 `userMessage` / `agentMessage`，说明刷新后没有可恢复工具 item 的边界不变。
- 2026-07-11：同一 inspector 会话调用 `thread/turns/list` 返回 `data:1 nextCursor=null`，不再出现 `requires experimentalApi capability`；返回 turn id `019f4d56-29c0-7d10-9ef5-132d439a6da9`，status `completed`，items=2。
- 2026-07-11：真实浏览器打开 `/chat/019f4d56-297b-7743-93e1-a65f8747d73a`，页面显示 final answer `6`；未出现 `历史分页暂不可用`、`requires experimentalApi capability` 或 `experimentalApi` 错误文本。当前导航增量 console 为 0 warning / 0 error；旧 HMR 断连日志来自前一次 dev server 停止后的浏览器累计 console，不计入本轮页面错误。
- 2026-07-11：验证命令已完成：`npm run test` 17 个测试文件、90 个测试通过；`npm run build` 通过且仅有既有 NFT trace warning，`next-env.d.ts` 已还原；`npm run test:smoke` 通过，`models=7`，`accountSource=app-server.account/read`。

## Phase 6H：官方 TUI / app-server 历史工具边界复查

目标：针对“切换 session 后同进程保留中间过程，刷新后中间过程消失”的现象，复查官方 TUI 和 app-server 历史实现，确认是否需要继续改 Web 消息 block 构造。

Phase 6H 记录：

- 2026-07-11：官方 TUI `chatwidget/replay.rs` 的 `replay_thread_turns()` 只遍历 app-server 返回的 `Turn.items` 并调用 `replay_thread_item()`；terminal turn 再通过 `handle_turn_completed_notification()` 补齐完成状态和 duration，不从 rollout 额外恢复命令过程。
- 2026-07-11：官方 app-server 测试 `app-server/tests/suite/v2/thread_shell_command.rs` 明确断言 `thread/read`、`thread/turns/list`、`thread/fork` 返回的历史 turn 不包含 `ThreadItem::CommandExecution`，断言文案为这些接口应始终排除 command executions。
- 2026-07-11：官方 `ThreadHistoryBuilder::handle_response_item()` 只把特定 hook prompt 的 user message 转成历史 item；普通 `function_call` / `function_call_output` 即使存在于 rollout，也不会被该路径还原成历史工具 block。
- 2026-07-11：真实隔离 session `019f4d56-297b-7743-93e1-a65f8747d73a` 的 rollout 文件包含 `function_call` 和 `function_call_output`，但 `thread/read(includeTurns:true)` 与 `thread/turns/list(itemsView:"full")` 都只返回 `userMessage` / `agentMessage` 两个 item，和官方实现一致。
- 2026-07-11：结论：当前 Web 已按官方 TUI 行为实现。实时生成和同一浏览器进程切 session 返回时，Web 可用 notification-derived in-memory snapshot 保留 `已处理 + 时间 + 中间过程`；刷新或重启后只能 replay app-server 历史 `Turn.items`，不写入 localStorage / IndexedDB，也不从 rollout 或 final answer 伪造工具过程。
- 2026-07-11：补充确认模型上下文边界：官方 core resume 并不使用 UI replay 的 `Turn.items` 作为下一轮上下文，而是通过 `stored_thread_to_initial_history()` 把 persisted rollout items 装入 `InitialHistory::Resumed`，再由 `reconstruct_history_from_rollout()` 重建 `ResponseItem` 历史并安装到 `ContextManager`。
- 2026-07-11：官方 `ContextManager::record_items()` 的 `is_api_message()` 保留 `FunctionCall`、`FunctionCallOutput`、`LocalShellCall`、`CustomToolCall`、`CustomToolCallOutput`、`ToolSearch*`、`WebSearchCall` 和 `ImageGenerationCall` 等 API 消息；模型请求使用 `clone_history().for_prompt(...)`，所以重启后 UI 不显示 command execution 过程块，不代表模型上下文丢失工具调用/输出历史。
- 2026-07-11：Web 对照：历史页继续发送时先调用 `thread/resume`，随后 `turn/start` 只发送当前用户输入；Web 不把页面 `messages`、history route、in-memory process block、localStorage 或 IndexedDB 重组成上下文。上下文结构完全由官方 app-server/core resume 管理，和官方 TUI 保持一致。

## Phase 6I：历史续聊上下文真实回归

目标：用真实浏览器验证 Phase 6H 的上下文结论：重启后 Web UI 不恢复工具过程块，但历史续聊的模型上下文仍包含官方 core 从 rollout 恢复的工具调用/输出。

Phase 6I 记录：

- 2026-07-11：使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 启动 `npm run dev`，新建真实浏览器会话 `019f4e7d-f2cb-7a82-a496-2ca28a0d1248`；第一轮提示要求必须读取 `package.json`，但 final 只回复“已读取”，不列出 scripts 数量或名称。
- 2026-07-11：第一轮完成后 UI 显示 `已处理 7s`，展开过程块可见真实命令 `/bin/bash -lc "sed -n '1,220p' package.json"`；final answer 只有“已读取。”，没有泄露 scripts 列表。
- 2026-07-11：停止并重新启动 `npm run dev`，bridge URL 变化，Web/bridge 进程内 snapshot 被清空；打开 `/chat/019f4e7d-f2cb-7a82-a496-2ca28a0d1248` 后页面 `hasProcessed=false`、`hasCommand=false`、`hasFinal=true`，说明历史 UI 只按官方 `Turn.items` 恢复普通消息，不显示工具过程块。
- 2026-07-11：在重启后的历史页继续发送“不要调用任何工具或命令。根据上一轮工具读取到的 package.json 内容，回答 scripts 的数量和名称”；第二轮未出现过程块或命令文本，最终回复 `{"count":6,"names":["dev","typecheck","test","build","build:server","test:smoke"]}`。
- 2026-07-11：结论：Web 续聊路径与官方 TUI 一致。UI replay 不展示历史 command execution，不影响 app-server/core resume 的模型上下文；Web 没有把 UI 消息或本地缓存重组成上下文，真实续聊结果来自官方 `thread/resume` 后的恢复历史。
- 2026-07-11：真实浏览器 console 增量检查：0 warning / 0 error；验证后已停止 dev server。

## Phase 6J：多 active turn 并发状态模型

目标：修复 Web 端全局单一 `activeTurn` 对多会话并发的限制。多个 thread 同时运行时，UI 必须按 threadId 隔离 turn、approval、过程块和完成状态；在 `/chat` 已承载新建会话 A 时再次点击“新对话”，必须进入独立 B 入口，不中断 A。

Phase 6J 记录：

- 2026-07-11：对照官方 TUI 行为和 Phase 6H/6I 决策，Web 不新增跨刷新持久化；同一浏览器进程内的多 active turn 使用 notification-derived 内存状态，刷新后仍只信 app-server 历史 API。
- 2026-07-11：`CodexWebAppServerState` 新增 `activeTurnsByThreadId`，`AppServerProvider` 收到 notification 后按 threadId 记住对应 active turn；保留旧 `activeTurn` 仅作为兼容最后事件和 threadless starting turn。
- 2026-07-11：新增 `active-turns-adapter`，提供按当前 route/resumed threadId 选择 active turn、筛出其它运行中 turn、仅清理指定 thread starting turn 的纯函数；单元测试覆盖 A/B 独立保存、历史 route/resumed id、单 thread 失败清理和其它 running notice 反例。
- 2026-07-11：`/chat/[id]` 改为只选择当前历史 thread 或 resumed thread 的 active turn；其它 thread 正在运行时只显示“其它 Codex 会话正在运行” notice，不把工具输出、approval 或 delta 串到当前页。
- 2026-07-11：`/chat` 新建页在已有 A 会话时点击侧栏“新对话”会跳转到唯一 `/chat?new=...`，并清空本页临时 `createdSessionId`、messages、stream/tool/permission 状态；A 已交给 app-server 的 turn 不会被 interrupt。
- 2026-07-11：`MessageList` 支持“显示过程面板”和“是否仍在 streaming”分离；客户端切回已完成的 active turn 时能显示 completed 过程面板，不显示运行中 status bar，并在历史 final 已存在时隐藏重复 final。
- 2026-07-11：真实浏览器回归反例：A3 运行 `sleep 45 && echo phase6j-a3-45` 时点击“新对话”创建 B3，B3 立即完成 `phase6j-b3-done`，A3 侧栏入口仍存在；通过侧栏 link 客户端切回 A3 后页面显示 `已处理 53s` 和 final answer `phase6j-a3-45-done`，console 增量 0 warning / 0 error。
- 2026-07-11：刷新/硬导航反例：使用 `page.goto` 进入已完成 A2 时 Provider 重建，内存 active turn snapshot 丢失，页面只显示 app-server 历史文本；该行为和官方 TUI 重启后不恢复工具过程块一致，不作为缺陷修复。
- 2026-07-11：验证命令已完成：targeted `npm run test -- src/lib/new-chat-url.test.ts src/codex-web/active-turns-adapter.test.ts src/codex-web/active-turn-visibility-adapter.test.ts src/codex-web/turn-reducer.test.ts` 4 个测试文件、26 个测试通过；`npm run test` 19 个测试文件、98 个测试通过；`npm run build` 通过且仅有既有 NFT trace warning，`next-env.d.ts` 已还原；`npm run test:smoke` 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=7，accountSource=`app-server.account/read`。

## Phase 6K：多 active turn 失败/中断/approval 并发回归

目标：在 Phase 6J 的多 active turn 状态模型上，补齐 approval、interrupt、failed/completed 三类高风险并发反例。多个 thread 同时 active 时，页面只消费本 thread 的 turn、approval 和错误状态；对某一 thread 的 approval response 或 interrupt 不影响其它 thread。

实施计划：

- [ ] 单元测试覆盖 approval 按 threadId 过滤：B 触发 approval 时，A 的 route 不显示 PermissionPrompt，B 的 route 精确匹配 requestId。
- [x] 单元测试覆盖 approval 按 threadId 过滤：B 触发 approval 时，A 的 route 不显示 PermissionPrompt，B 的 route 精确匹配 requestId。
- [x] 单元测试覆盖 interrupt 参数选择：A/B 同时 active 时，中断 A 只构造 A 的 `{ threadId, turnId }`，不回退到最后一个全局 `activeTurn`。
- [x] 单元测试覆盖 failed/completed 隔离：A failed、B completed 时，selector 和渲染输入分别只返回本 thread 状态。
- [x] 真实浏览器反例验证：A running 时 B 触发 approval；B approval 决策后不影响 A；随后只中断 A，确认 B 继续完成或保持自身状态。
- [x] 更新 Smoke Ledger，记录刷新/硬导航仍按官方 TUI 边界不恢复过程块，不新增 localStorage / IndexedDB 持久化。

验证命令：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/approval-queue-adapter.test.ts src/codex-web/interrupt-adapter.test.ts src/codex-web/active-turns-adapter.test.ts src/codex-web/active-turn-visibility-adapter.test.ts
npm run test
npm run build
npm run test:smoke
```

Phase 6K 记录：

- 2026-07-11：补充 `approval-queue-adapter` 并发测试：多个 pending approval 同时存在时，`firstApproval(queue, approvalRequestMatchesThread(...))` 只返回当前 thread 的 requestId，B 的 approval 不暴露给 A。
- 2026-07-11：补充 `interrupt-adapter` 反例测试并修复：显式 `{ threadId, turnId }` 中断不再被其它 terminal active turn 阻止；`AppServerProvider.interruptTurn()` 在传入 `params.threadId` 时优先读取 `activeTurnsByThreadId[threadId]`，不回退到最后一个全局 `activeTurn`。
- 2026-07-11：补充 `active-turns-adapter` 测试：failed 和 completed turn 仍按 threadId 隔离选择，但不会被 `selectOtherRunningActiveTurns()` 当作其它 running notice。
- 2026-07-11：真实浏览器回归：A `sleep 90 && echo phase6k-a-long` running 时，B `curl -I https://www.baidu.com/` 触发 command approval；客户端切到 A 后没有 `Deny / Allow Once / 本次会话允许` approval 按钮，A 最终显示 `已处理 1m 39s` 与 `phase6k-a-long-done`。
- 2026-07-11：真实浏览器 interrupt 反例：在 B approval 仍 pending 时新建 A2 执行 `sleep 120 && echo phase6k-a2-interrupt`，点击 A2 停止后页面显示“Codex 已中断。可以继续发送下一轮。”；切回 B curl thread 后 approval 仍可见，且没有 A2 的中断文本。
- 2026-07-11：真实浏览器 failed/approval 收口：对 B curl approval 点击 Deny 后，B 收口为 completed 面板，显示真实错误 `curl: (6) Could not resolve host: www.baidu.com`；approval 和 stop button 均消失，console 增量 0 warning / 0 error。
- 2026-07-11：验证命令已完成：targeted `npm run test -- src/codex-web/approval-queue-adapter.test.ts src/codex-web/interrupt-adapter.test.ts src/codex-web/active-turns-adapter.test.ts src/codex-web/active-turn-visibility-adapter.test.ts` 4 个测试文件、31 条测试通过；`npm run test` 19 个测试文件、101 条测试通过；`npm run build` 通过且仅有既有 NFT trace warning，`next-env.d.ts` 已还原；`npm run test:smoke` 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=7，accountSource=`app-server.account/read`。
- 2026-07-11：刷新/重启边界保持 Phase 6H/6J 决策：Web 不新增 localStorage / IndexedDB 过程块持久化，不从 final answer 反推工具过程；硬导航后仍只按官方 app-server 历史 API replay。

## Phase 6L：新建页多轮发送归属修复

目标：修复 `/chat?new=...` 页面首轮完成后继续发送仍走 `sendOneTurn()` 的问题。首轮接受后，页面应固定真实 app-server threadId；后续发送走 `sendTurnInThread()`，保持同一个 thread 的多轮上下文、左侧列表归属和历史页 replay。

实施记录：

- 2026-07-11：新增 `new-chat-turn-routing` helper，明确区分临时 `app-server-*` session id 和真实 app-server thread id；只有真实 thread id 才允许作为新建页后续 turn 的目标。
- 2026-07-11：`/chat` 新建页 `sendFirstMessage()` 在 `createdSessionId` 已是真实 threadId 时改用 `sendTurnInThread({ threadId })`；没有真实 threadId 的首轮仍使用 `sendOneTurn()` 创建 thread。
- 2026-07-11：新建页第二轮 optimistic user message 改为追加到现有消息列表；首轮仍保持单消息初始化，避免影响新建页 hero 到 active layout 的既有切换。
- 2026-07-11：真实浏览器验证：打开 `/chat?new=phase6l`，连续发送“请只回复 phase6l-first-done。”和“请只回复 phase6l-second-done。”；页面同时显示两轮 final，左侧只出现 1 个 phase6l 会话链接，href 固定为第一轮 thread `019f4fab-d6e3-75e2-847a-a60a9f325013`。
- 2026-07-11：历史页验证：打开 `/chat/019f4fab-d6e3-75e2-847a-a60a9f325013` 后能看到第一轮 `phase6l-first-done` 和第二轮 `phase6l-second-done`，证明两轮归属同一个 app-server thread；console 增量 0 warning / 0 error。
- 2026-07-11：验证命令已完成：targeted `npm run test -- src/codex-web/new-chat-turn-routing.test.ts src/lib/new-chat-url.test.ts src/codex-web/active-turns-adapter.test.ts` 3 个测试文件、11 条测试通过；`npm run test` 20 个测试文件、104 条测试通过；`npm run build` 通过且仅有既有 NFT trace warning，`next-env.d.ts` 已还原；`npm run test:smoke` 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=7，accountSource=`app-server.account/read`。
- 2026-07-11：官方边界不变：刷新/重启后仍只按 app-server 历史 API replay，不新增 localStorage / IndexedDB 过程块持久化。

## Phase 6M：历史页多轮续聊归属回归

目标：对称验证 Phase 6L 的历史页路径。打开 `/chat/[id]` 历史页后，第一轮继续发送需要调用 `thread/resume`；一旦拿到真实 `resumedThreadId`，后续同页多轮发送必须直接走 `sendTurnInThread(resumedThreadId)`，不重复 resume、不串回原 route id。

实施记录：

- 2026-07-11：新增 `history-turn-routing` helper，把历史页发送目标显式拆成 `requiresResume`、`threadId`、`cwd` 和 `model`；首次发送使用 route thread id 触发 resume，resume 后续发送优先使用 `resumedThreadId`、`resumedCwd` 和 `resumedModel`。
- 2026-07-11：`/chat/[id]` 的 `appServerSend` 改为通过 `resolveHistoryTurnTarget()` 选择目标；`target.requiresResume` 为 true 时调用 `thread/resume`，否则直接调用 `sendTurnInThread()`。
- 2026-07-11：真实浏览器验证：打开历史页 `/chat/019f4fab-d6e3-75e2-847a-a60a9f325013`，连续发送“请只回复 phase6m-history-first-done。”和“请只回复 phase6m-history-second-done。”；页面 URL 始终保持同一历史 thread，正文同时显示两轮 final。
- 2026-07-11：左侧归属反例：第二轮完成后，左侧没有新增 `phase6m` 会话链接；目标历史 thread 链接仍只有 1 个，说明第二轮没有新建 thread。
- 2026-07-11：真实浏览器 console 增量检查 0 warning / 0 error；验证后已停止 dev server。
- 2026-07-11：验证命令已完成：targeted `npm run test -- src/codex-web/history-turn-routing.test.ts src/codex-web/resume-adapter.test.ts src/codex-web/active-turns-adapter.test.ts src/codex-web/active-turn-visibility-adapter.test.ts` 4 个测试文件、23 条测试通过；`npm run test` 21 个测试文件、107 条测试通过；`npm run build` 通过且仅有既有 NFT trace warning，`next-env.d.ts` 已还原；`npm run test:smoke` 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=7，accountSource=`app-server.account/read`。

## Phase 6N：多轮历史列表/分页一致性回归

目标：在 Phase 6L/6M 修复后，回归同一个 app-server thread 的多轮历史读取、分页顺序、刷新恢复和切换 session 恢复。Web 必须继续以 app-server `thread/read` metadata 和 `thread/turns/list` page 为事实源，不从本地缓存或 assistant 文本伪造历史过程。

实施记录：

- 2026-07-11：复查 `thread-history-adapter`、`thread-turns-page-adapter` 和 `/chat/[id]` 接线；当前实现仍为 metadata-first `thread/read(includeTurns:false)`，再通过 `thread/turns/list(limit=30, sortDirection:"desc", itemsView:"full")` 获取第一页，Web 端反转为时间正序展示，加载更早使用 cursor + prepend 去重。
- 2026-07-11：只读 inspector 验证隔离环境 thread `019f4fab-d6e3-75e2-847a-a60a9f325013`：`thread/read(includeTurns:true)` 返回 4 个 completed turn；`thread/turns/list(desc, full)` 返回同 4 个 turn，顺序为最新到最旧，`nextCursor=null`，没有 `requires experimentalApi capability`。
- 2026-07-11：rollout 文件反查确认四轮文本都属于同一 thread：`phase6l-first-done`、`phase6l-second-done`、`phase6m-history-first-done`、`phase6m-history-second-done`。
- 2026-07-11：真实浏览器回归：打开 `/chat/019f4fab-d6e3-75e2-847a-a60a9f325013` 后四轮 user/assistant 文本按时间正序展示；硬导航刷新后四轮仍在；切到 `/chat` 再回目标历史 session 后四轮仍在。
- 2026-07-11：反例验证：该 thread 的 `nextCursor=null`，页面没有“加载更早”入口，也没有“历史分页暂不可用”notice；浏览器 console 全程 0 warning / 0 error。
- 2026-07-11：本阶段未修改产品代码；定位结论是 Phase 6L/6M 后当前多轮历史分页和切换恢复路径符合官方 app-server 投影。刷新后工具过程块边界仍保持 Phase 6H 决策：只显示 app-server 历史 API 返回的真实 `Turn.items`，不做 localStorage / IndexedDB 持久化。
- 2026-07-11：验证命令已完成：targeted `npm run test -- src/codex-web/thread-turns-page-adapter.test.ts src/codex-web/thread-history-adapter.test.ts` 2 个测试文件、14 条测试通过；`npm run test` 21 个测试文件、107 条测试通过；`npm run build` 通过且仅有既有 NFT trace warning，`next-env.d.ts` 已还原；`npm run test:smoke` 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=7，accountSource=`app-server.account/read`；真实浏览器验证同样使用隔离 `CODEX_HOME`。

## Phase 6O：长历史 Load Earlier 真实回归

目标：补齐 Phase 6A/6N 未覆盖的长历史分页场景。使用真实 `codex app-server --stdio` 和真实浏览器验证超过第一页的历史 thread：首屏只加载最近 page，`nextCursor` 驱动“加载更早”，prepend 后消息时间顺序正确、无重复、无缺失。

实施记录：

- 2026-07-12：新增只读回归辅助脚本 `scripts/create-long-history-fixture.ts` 和 `scripts/inspect-thread-pagination.ts`。前者在隔离 `CODEX_HOME` 中创建不覆盖的 legacy rollout fixture，后者通过真实 app-server 初始化和 `thread/turns/list` 分页打印 page 边界；两者不参与 Web 运行时代码。
- 2026-07-12：在 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 创建 35-turn fixture thread `7b531c06-1bf8-4855-ac46-24603b6352a9`，rollout 路径为 `/volume2/SSD/codex/Temp/codex-dev-home/sessions/2026/07/11/rollout-2026-07-11T15-30-00-7b531c06-1bf8-4855-ac46-24603b6352a9.jsonl`。
- 2026-07-12：真实 app-server 分页验证：`thread/read(includeTurns:false)` preview 为 `phase6o-user-01`；`thread/turns/list(limit=30, sortDirection:"desc", itemsView:"full")` 第一页返回 30 个 turn，最新 `phase6o-user-35 | phase6o-answer-35`，最旧 `phase6o-user-06 | phase6o-answer-06`，`nextCursor` 存在；第二页返回 5 个 turn，最新 `phase6o-user-05 | phase6o-answer-05`，最旧 `phase6o-user-01 | phase6o-answer-01`；累计 35 个 turn 且 unique=35。
- 2026-07-12：真实浏览器回归：打开 `/chat/7b531c06-1bf8-4855-ac46-24603b6352a9`，首屏存在“加载更早的消息”按钮；初始页面可见 `phase6o-answer-06` 和 `phase6o-answer-35`，`phase6o-answer-01` 尚未进入正文，符合最近 30 turn 首屏加载。
- 2026-07-12：点击“加载更早的消息”后，页面正文包含 `phase6o-answer-01` 到 `phase6o-answer-35` 全部 35 条 final answer；每条 answer 计数为 1，没有缺失或重复；按钮消失，说明 `nextCursor=null` 已反映到 UI。
- 2026-07-12：反例验证：断线恢复期间 console 历史里出现过 HMR / API connection refused 旧错误；Load Earlier 完成后的增量 console 为 0 warning / 0 error。首次 `/chat/[id]` Turbopack 编译耗时约 98s，属于 dev server 冷启动噪声，不影响分页结果。
- 2026-07-12：验证命令已完成：`npm run test` 21 个测试文件、107 条测试通过；`npm run build` 通过且仅有既有 NFT trace warning，`next-env.d.ts` 已还原；`npm run test:smoke` 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=7，accountSource=`app-server.account/read`。

## Phase 6P：长历史分页后续聊上下文回归

目标：验证长历史 thread 在分页 UI 状态不同的情况下继续发送，仍由官方 `thread/resume` / `turn/start` 决定模型上下文和 thread 归属。Web 不应因为首屏只加载最近 page 或用户点击过 Load Earlier 而改变 resume 历史、重复 resume 或新建错误 thread。

实施记录：

- 2026-07-12：更新 `scripts/create-long-history-fixture.ts`，保持 `EventMsg` 用于 UI replay，同时写入 user/assistant `response_item`，用于官方 resume 的模型上下文；新增可选 marker prefix，便于生成互不混淆的回归 thread。
- 2026-07-12：生成两个隔离 fixture：`phase6p-a` thread `f357ae15-5c92-4f45-a9c8-98c14d35dae8` 用于不点击 Load Earlier 直接续聊；`phase6p-b` thread `d8935155-42b7-44d1-98be-53bc19562587` 用于 Load Earlier 后续聊。两者分页检查均为 30+5，累计 35 个 turn 且 unique=35。
- 2026-07-12：真实浏览器 A 路径：打开 `/chat/f357ae15-5c92-4f45-a9c8-98c14d35dae8`，首屏有 Load Earlier，正文没有 `phase6p-a-answer-01`，但有 `phase6p-a-answer-06` 和 `phase6p-a-answer-35`；不点击 Load Earlier 直接发送“根据历史记录只回复最早一轮 assistant final answer”，模型返回 `phase6p-a-answer-01`。
- 2026-07-12：真实浏览器 B 路径：打开 `/chat/d8935155-42b7-44d1-98be-53bc19562587`，先点击“加载更早的消息”，页面正文包含 `phase6p-b-answer-01` 到 `phase6p-b-answer-35` 且无重复；随后发送相同 prompt，模型返回 `phase6p-b-answer-01`，该文本计数从历史中的 1 次变成 2 次。
- 2026-07-12：只读 app-server 复查：两个原 thread 续聊后都变成 36 个 turn，`thread/turns/list(limit=40)` 最新 turn 是本次 prompt + `phase6p-*-answer-01`，最旧 turn 仍为原 `phase6p-*-user-01 | phase6p-*-answer-01`，`uniqueTurns=36`，没有新 thread 分裂。
- 2026-07-12：浏览器增量 console 为 0 warning / 0 error；验证后已停止 dev server。
- 2026-07-12：验证命令已完成：`npm run test` 21 个测试文件、107 条测试通过；`npm run build` 通过且仅有既有 NFT trace warning，`next-env.d.ts` 已还原；`npm run test:smoke` 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=7，accountSource=`app-server.account/read`。

## Phase 6Q：历史分页失败边界硬化

目标：补齐历史分页失败和切换 session 的边界回归。Web 仍保持官方 TUI / app-server 历史语义：分页数据来自 `thread/turns/list`，失败时不伪造历史、不清空已展示消息；历史页继续发送只有 `thread/resume` 成功后才写入 `resumedThreadId`。

实施记录：

- 2026-07-12：复查 `/chat/[id]` 历史加载路径：session id 变化时会重置 messages、cursor、pagination notice 和 resumed thread 状态；`appServerLoadEarlier` 失败路径已经保留闭包中的当前 messages，不会清空页面正文。
- 2026-07-12：新增 `history-pagination-state` helper，将分页失败收口为统一状态：保留当前 messages、`hasMore=false`、`nextCursor=null`，并生成 `历史分页暂不可用` notice；初始分页 fallback 和 Load Earlier 失败共用同一 notice 构造。
- 2026-07-12：补充单元测试覆盖 Error/string 两类失败描述，以及 Load Earlier 失败时返回同一个 messages 数组，防止后续误改成清空历史。
- 2026-07-12：resume 边界保持 Phase 6M 实现：`resolveHistoryTurnTarget()` 只负责计算目标；`/chat/[id]` 只有在 `resumeThread()` 成功返回后才设置 `resumedThreadId`、`resumedCwd` 和 `resumedModel`，失败时 ChatView 只显示 `Codex 发送失败` banner，不固定错误 thread。
- 2026-07-12：验证命令已完成：targeted `npm run test -- src/codex-web/history-pagination-state.test.ts src/codex-web/thread-turns-page-adapter.test.ts src/codex-web/history-turn-routing.test.ts` 3 个测试文件、13 条测试通过；`npm run test` 22 个测试文件、110 条测试通过；`npm run build` 通过且仅有既有 NFT trace warning，`next-env.d.ts` 已还原；`npm run test:smoke` 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=7，accountSource=`app-server.account/read`。

## Phase 6R：Load Earlier 真实失败路径回归

目标：在真实浏览器中强制制造 Load Earlier 的 `thread/turns/list` 失败，验证 Phase 6Q 的状态收口确实落到 UI：当前消息不能丢，早期 page 不能被伪造，后续分页入口关闭，并展示可见失败 notice。

实施记录：

- 2026-07-12：为 `createWebSocketBridge()` 增加测试专用 `clientMessageInterceptor` 钩子；默认不传入时不改变 bridge 行为。该钩子只用于开发/回归验证时直接返回 JSON-RPC error，不修改 app-server、UI reducer 或历史数据结构。
- 2026-07-12：新增 `createThreadTurnsListFailureInterceptor()`，可配置第 N 次 `thread/turns/list` 失败；`scripts/dev-next-with-bridge.ts` 通过 `CODEX_WEB_FAIL_THREAD_TURNS_LIST_ON_CALL` 启用，默认关闭。
- 2026-07-12：真实浏览器验证：以 `CODEX_WEB_FAIL_THREAD_TURNS_LIST_ON_CALL=2` 启动 dev server，打开长历史 thread `7b531c06-1bf8-4855-ac46-24603b6352a9`；初始页面有“加载更早的消息”，无 `phase6o-answer-01`，有 `phase6o-answer-06` 和 `phase6o-answer-35`。
- 2026-07-12：点击“加载更早的消息”后，第二次 `thread/turns/list` 被注入失败；页面不再显示 Load Earlier，显示 `历史分页暂不可用` 和注入错误文本；`phase6o-answer-06`、`phase6o-answer-35` 仍各 1 次，`phase6o-answer-01` 仍不可见，说明已展示消息被保留且早期 page 没有被伪造。
- 2026-07-12：反例验证：第一次尝试曾因 dev 冷编译超时使失败落到初始分页 fallback；重启并关闭旧标签页后重新验证，确认失败准确落在 Load Earlier 路径。
- 2026-07-12：验证命令已完成：targeted `npm run test -- server/thread-turns-list-failure-interceptor.test.ts src/codex-web/history-pagination-state.test.ts` 2 个测试文件、5 条测试通过；`npm run test` 23 个测试文件、112 条测试通过；`npm run build` 通过且仅有既有 NFT trace warning，`next-env.d.ts` 已还原；`npm run test:smoke` 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=7，accountSource=`app-server.account/read`。

## Phase 6S：失败注入能力防误用收口

目标：把 Phase 6R 新增的失败注入能力明确限制为测试/开发验证工具，避免未来被误当成产品功能或被普通 bridge/smoke 路径隐式启用。

实施记录：

- 2026-07-12：将 `CODEX_WEB_FAIL_THREAD_TURNS_LIST_ON_CALL` 解析集中到 `createThreadTurnsListFailureInterceptorFromEnv()`；`scripts/dev-next-with-bridge.ts` 只显式传入返回的 `clientMessageInterceptor`，默认标准 bridge 不读取该 env。
- 2026-07-12：新增单元测试覆盖默认 env、`0`、非数字字符串都不创建拦截器；只有正整数 env 会创建测试专用 `thread/turns/list` 失败注入器。
- 2026-07-12：`rg` 复查确认 env 开关只出现在 dev 脚本、测试 helper、单测和本执行计划中；生产 build、标准 smoke、Web UI 和 app-server 语义路径没有隐式读取。
- 2026-07-12：验证命令已完成：targeted `npm run test -- server/thread-turns-list-failure-interceptor.test.ts` 1 个测试文件、4 条测试通过；`npm run test` 23 个测试文件、114 条测试通过；`npm run build` 在沙箱中因 Turbopack 创建子进程/绑定端口被拒绝失败，提权重跑后通过且仅有既有 NFT trace warning，`next-env.d.ts` 已还原；`npm run test:smoke` 在沙箱中因 `tsx` IPC pipe listen EPERM 失败，提权重跑后通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=7，accountSource=`app-server.account/read`。

## Phase 6T：历史分页回归入口整理

目标：把 Phase 6O-6S 已验证的长历史分页、续聊上下文、Load Earlier 失败和失败注入边界整理成可重复执行的入口。该入口只打印命令和断言，不自动创建 fixture、不启动 dev server、不写入临时文件，避免误碰用户环境。

实施记录：

- 2026-07-12：新增 `history-pagination-regression-plan` helper，集中生成历史分页回归步骤：创建隔离长历史 fixture、通过真实 app-server inspect 30+5 分页、用 `CODEX_WEB_FAIL_THREAD_TURNS_LIST_ON_CALL=2` 启动失败注入 dev server、真实浏览器断言初始分页和 Load Earlier 失败、最后运行 test/build/smoke。
- 2026-07-12：新增 `scripts/history-pagination-regression.ts` 和 package script `npm run regression:history-pagination`；脚本启动前强制校验 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，可传入已有 thread id 和 marker prefix，用于复用 Phase 6O/6P fixture 或生成新的 marker 命令。
- 2026-07-12：补充单元测试覆盖回归清单标题、命令必须带隔离 `CODEX_HOME`、失败注入 env、30+5 分页断言、无 thread id 时保留 `<thread-id-from-fixture-output>` 占位，以及非隔离 `CODEX_HOME` 会失败。
- 2026-07-12：验证命令已完成：targeted `npm run test -- server/history-pagination-regression-plan.test.ts` 1 个测试文件、4 条测试通过；`npm run regression:history-pagination -- 7b531c06-1bf8-4855-ac46-24603b6352a9 phase6o` 在沙箱中因 `tsx` IPC pipe listen EPERM 失败，提权重跑后成功打印 6 步回归清单；`npm run test` 24 个测试文件、118 条测试通过；`npm run build` 提权运行通过且仅有既有 NFT trace warning，`next-env.d.ts` 已还原；`npm run test:smoke` 提权运行通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，models=7，accountSource=`app-server.account/read`。
- 2026-07-12：复查 `.playwright-mcp` 目录无文件；本阶段未运行真实浏览器，不产生新的 Playwright 生成物。

## Phase 6U：官方 Goal / Plan UI

目标：按官方 Codex app 和 `codex-rs/tui` 语义接入 Goal / Plan。Goal 不做右侧常驻面板，而是在 composer 上方显示 progress row 和 pause/resume/edit/clear 控制；Plan 不做右侧常驻面板，而是在消息时间线中显示 `Proposed Plan` 和 `Updated Plan` cell，并在 Plan mode 完成 proposed plan 后显示 `Implement this plan?` 确认。

设计和执行计划：

- `docs/superpowers/specs/2026-07-12-phase-6u-official-goal-plan-ui-design.md`
- `docs/superpowers/plans/2026-07-12-phase-6u-official-goal-plan-ui.md`

实施清单：

- [x] 新增 `goal-display-adapter`，对齐 `codex-rs/tui/src/chatwidget/goal_status.rs`、`goal_menu.rs` 和 `footer.rs`。
- [x] 新增 `plan-display-adapter`，对齐 `codex-rs/tui/src/history_cell/plans.rs`、`streaming.rs` 和 `thread_transcript.rs`。
- [x] 新增 `plan-implementation-adapter`，对齐 `codex-rs/tui/src/chatwidget/plan_implementation.rs` 的三选项和 gating。
- [x] `AppServerProvider` / reducer 接入 `thread/goal/updated`、`thread/goal/cleared`、`item/plan/delta`、`item/completed` 中的 `ThreadItem::Plan`、`turn/plan/updated`。
- [x] 历史 replay 只显示 app-server 历史 API 返回的真实 `ThreadItem::Plan`，不从 assistant final answer 推断。
- [x] Composer 上方显示 Goal progress row；无 goal 时不显示。
- [x] 消息时间线显示 `Proposed Plan` 和 `Updated Plan`；普通消息不显示 plan cell。
- [x] Plan mode 完成 proposed plan 后显示 `Implement this plan?`，history replay 和 queued message 反例由 adapter 覆盖。
- [x] Smoke Ledger 记录 adapter/reducer/history 反例、普通页无 Goal/Plan 的浏览器反例、build、bridge smoke、真实 Plan mode、`update_plan`、Goal active/pause/resume/clear 和 clear-context implement。

验证：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/goal-display-adapter.test.ts src/codex-web/plan-display-adapter.test.ts src/codex-web/plan-implementation-adapter.test.ts
npm run test
npm run build
npm run test:smoke
```

Phase 6U 记录：

- 2026-07-12：新增 `goal-display-adapter`、`plan-display-adapter`、`plan-implementation-adapter` 及单元测试，覆盖 elapsed/token 文案、goal status、Updated Plan 空 steps、Plan implementation prompt gating。
- 2026-07-12：`AppServerProvider` 接入 `thread/goal/get`、`thread/goal/set`、`thread/goal/clear` actions，并按 `thread/goal/updated` / `thread/goal/cleared` 更新按 threadId 隔离的 goal 状态。
- 2026-07-12：`turn-reducer` 接入 `item/plan/delta`、`item/completed` 中的 `ThreadItem::Plan` 和 `turn/plan/updated`；`thread-history-adapter` 只 replay 真实 `ThreadItem::Plan`，assistant final answer 中出现 plan 文本不生成 Proposed Plan。
- 2026-07-12：消息时间线新增 `Proposed Plan` / `Updated Plan` cell，显示 source breadcrumb；composer 附近新增 Goal progress row 和 `Implement this plan?` prompt；未新增右侧 GoalPanel / PlanPanel。
- 2026-07-12：`/plan` 切换 Plan mode；`/goal` summary/pause/resume/edit/clear 走 composer 命令入口和 app-server goal 方法，不打开右侧面板。
- 2026-07-12：修复 `/plan` 只切 UI mode 但未向 app-server 发送 `collaborationMode` 的问题；`thread/start` 与 `turn/start` 均按官方 Plan mode schema 发送 `collaborationMode.mode = "plan"`，implement plan 时显式回到 code/default 路径。
- 2026-07-12：修复 live turn 第一帧被误判为 history replay 导致 `Implement this plan?` 不显示的问题；prompt gating 改为 completion effect 标记的 live plan turn。
- 2026-07-12：新聊天页和历史页均接入 `/goal <objective>`、pause/resume/clear；clear context implement 在新 thread 中发送完整 plan markdown，不复用旧 thread。
- 2026-07-12：`collaborationMode` 的 schema lag 风险已收口到 `src/codex-web/app-server-request-overrides.ts`，不再通过泛型 helper 隐式绕行 generated params；后续 generated schema 更新后可删除该兼容类型。

Smoke Ledger：

| Date | Runtime | 场景 | Result | Evidence |
|---|---|---|---|---|
| 2026-07-12 | Vitest，隔离 `CODEX_HOME` | Goal/Plan adapters、reducer、历史 replay 反例：assistant final answer 含 plan 文本不生成 Proposed Plan | 通过 | `npm run test -- src/codex-web/goal-display-adapter.test.ts src/codex-web/plan-display-adapter.test.ts src/codex-web/plan-implementation-adapter.test.ts src/codex-web/turn-reducer.test.ts src/codex-web/app-server-message-blocks.test.ts src/codex-web/thread-history-adapter.test.ts`，6 files / 35 tests passed |
| 2026-07-12 | local codex app-server，隔离 `CODEX_HOME` | 全量单元测试 | 通过 | `npm run test`，27 files / 138 tests passed |
| 2026-07-12 | Next production build，隔离 `CODEX_HOME` | 生产构建 | 通过 | `npm run build` 提升权限运行通过；Turbopack 仅报告既有 NFT tracing warning |
| 2026-07-12 | local bridge smoke，隔离 `CODEX_HOME` | bridge initialize、model/list、account/read | 通过 | `npm run test:smoke` 提升权限运行通过：`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home，models=7，accountSource=app-server.account/read` |
| 2026-07-12 | 浏览器，`http://192.168.3.12:3000/chat` | 普通新聊天页桌面/390px 窄屏渲染；无 active goal/plan 时不显示 Goal row、Proposed Plan、Updated Plan | 通过 | Playwright snapshot，console 0 errors / 0 warnings；`localhost` 在浏览器环境不可达，网络地址可用 |
| 2026-07-12 | 浏览器，隔离 `CODEX_HOME`，真实 app-server/模型 | `/plan` 触发完整 Plan mode proposed plan；完成后出现 `Implement this plan?` | 通过 | 捕获 `thread/start` 与 `turn/start` 均包含 `collaborationMode.mode = "plan"`；时间线显示 `Proposed Plan`，source 为 `app-server.item/completed` |
| 2026-07-12 | 浏览器，隔离 `CODEX_HOME`，真实 app-server/模型 | 真实 `update_plan` 更新 checklist | 通过 | 时间线显示 `Updated Plan`，来自 `app-server.turn/plan/updated`，普通消息路径不生成 plan cell |
| 2026-07-12 | 浏览器，隔离 `CODEX_HOME`，真实 app-server/模型 | Goal active、pause、resume、clear | 通过 | Goal 仅显示在 composer 上方 progress row；状态变化跟随 `thread/goal/updated` / `thread/goal/cleared` |
| 2026-07-12 | 浏览器，隔离 `CODEX_HOME`，真实 app-server/模型 | `Yes, clear context and implement` | 通过 | 点击后创建新 `thread/start`；后续 `turn/start` 不带 Plan mode `collaborationMode`，输入包含 clear-context prefix 和完整 plan markdown |
| 2026-07-12 | Vitest，隔离 `CODEX_HOME` | `77e651e` 后 collaborationMode schema lag 类型收口 | 通过 | `npm run test -- src/codex-web/app-server-collaboration-mode.test.ts`，1 file / 5 tests passed；`npm run test`，28 files / 143 tests passed |
| 2026-07-12 | Next production build，隔离 `CODEX_HOME` | `77e651e` 后生产构建回归 | 通过 | `npm run build` 沙箱内因 Turbopack port bind EPERM 失败，提升权限重跑通过；仅有既有 NFT tracing warning，`next-env.d.ts` 生成噪声已还原 |
| 2026-07-12 | local bridge smoke，隔离 `CODEX_HOME` | `77e651e` 后 bridge smoke 回归 | 通过 | `npm run test:smoke` 沙箱内因 `tsx` IPC pipe listen EPERM 失败，提升权限重跑通过：models=7，accountSource=`app-server.account/read` |

## 决策日志

- 2026-07-06：第一版采用 TUI-first Web 化。官方 TUI 是业务语义基准，Web bridge 连接已安装的 `codex app-server --stdio`，不改 `codex-core`。
- 2026-07-06：`CodexBrowser` 和 `CodePilot` 只用于借鉴 app-server 经验、开发流程和测试经验，禁止作为代码来源。
- 2026-07-06：开发、测试和 smoke 默认使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`；最终验收才在用户明确同意后使用本地真实 `CODEX_HOME`。
- 2026-07-11：Phase 6H 确认刷新后历史工具过程不恢复是官方 app-server 历史 API 边界；Web 保持 TUI 等价，不新增本地持久化、不直接解析 rollout、不伪造 command execution 历史 item。
- 2026-07-11：Phase 6H 进一步确认“UI 历史展示”和“模型上下文历史”是两种官方投影：UI replay 使用 `Turn.items`，续聊上下文使用 rollout 重建出的 `ResponseItem` 历史；Web 续聊只接入官方 `thread/resume` / `turn/start`，不自行改变上下文结构。
- 2026-07-11：Phase 6I 真实浏览器验证通过：重启 Web/bridge 后历史 UI 没有过程块，第二轮禁止工具调用时仍能回答上一轮工具输出中的 scripts；该行为证明 Web 保持官方 resume 上下文，不额外持久化或重组 UI 历史。
- 2026-07-08：Web UI 基于 `/home/rrssnas/code/CodexWeb` 开发；开发前阅读其 README，保持 CodexWeb 既有 UI 样式和 Demo 结构，不直接修改 CodexWeb 目录，只在当前项目中接入真实 app-server 后端。
- 2026-07-11：过程块保留策略保持官方 TUI 等价：同一浏览器进程内切换 session 使用 notification-derived 内存 snapshot replay；刷新或重启后只使用 app-server 历史 API 返回的真实 `Turn.items`，不引入 IndexedDB / localStorage 持久缓存，也不从 assistant final text 反推工具 cell。
- 2026-07-11：多 active turn 状态以 `threadId -> AppServerTurnState` 为 Web 内存事实源；页面只选择本 route/resumed thread 的 turn，其它 running turn 只作为 notice，不允许跨 session 复用全局 `activeTurn`。
- 2026-07-12：Phase 6U 的 Goal / Plan UI 保持官方 Codex app 一致：Goal 是 composer 上方 progress row，Plan 是消息时间线 cell，Plan implementation 是 composer 附近确认；不得实现右侧常驻 GoalPanel / PlanPanel。代码逻辑必须对齐 `codex-rs/tui` 的 Goal / Plan 分支。

## 剩余风险

- 系统安装的 `codex` 版本可能与生成的 TypeScript schema 不一致。
- 隔离 `CODEX_HOME` 可能缺少账号、模型、MCP 或历史配置；测试失败时要先区分隔离环境配置问题和 Web 实现问题。
- app-server server request 类型较多，Phase 4 前只做 diagnostics 和 fail-safe，完整 approval 需要后续计划。
- 浏览器 UI 可能偏离 TUI 语义或 CodexWeb 既有体验，所有新增功能必须先对照 TUI 业务语义和 CodexWeb UI Demo。
- 从 CodexWeb 复制 UI 代码时可能引入 mock 数据路径或前端预览逻辑，接入当前项目前必须替换为 app-server 真实数据来源并保留 source breadcrumb。
- 真实模型调用需要账号、网络和额度，smoke 失败时要区分认证、网络、额度和协议问题。
- 历史 session 如果 app-server 历史 API 只返回 `userMessage` / `agentMessage`，刷新后无法恢复工具中间过程；这是与官方 TUI 重启恢复一致的边界。后续若要跨刷新保留，需要另立非 TUI 等价的持久缓存设计并明确 source breadcrumb。
- Goal / Plan 公开 app 文档对视觉细节描述有限，Phase 6U 实现需以官方 app-server 协议和 `codex-rs/tui` 代码快照为主基准；后续若官方 Codex app 文档补充 UI 截图，需要复核 Web 等价层。
- `collaborationMode` 当前仍是 Web 兼容类型覆盖 generated schema lag；真实 app-server 已验证接受，后续 schema 生成文件包含该字段后应删除 `app-server-request-overrides.ts`。
