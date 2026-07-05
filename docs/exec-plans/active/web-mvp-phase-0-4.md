# Codex Web MVP Phase 0-4 执行计划

> 创建时间：2026-07-06  
> 状态：进行中  
> 主线：围绕官方 `codex-rs/tui` 做 TUI-first Web 化。  
> 范围：只实现本地 Web bridge + 浏览器基础 UI + Thread / Turn / Item 生命周期。  
> 非目标：SSH remote、完整 approval、插件市场、Electron、provider 管理、多用户远程访问。
> 环境限制：开发、测试和 smoke 默认必须使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，最终验收才允许在用户明确同意后切回本地真实 `CODEX_HOME`。

## 目标

在 `/home/rrssnas/code/codex/web` 中实现一个最小可用的 Codex Web MVP：浏览器通过本地 Web bridge 连接服务器已安装的 `codex app-server --stdio`，完成 initialize、model/list、thread/start、turn/start、流式 item delta 和 turn completed 展示。

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
- Web 重新实现浏览器布局、状态 reducer 和组件。
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
| Phase 0 | 协议和项目基线 | 待开始 | 能生成或引用 app-server TS schema，Web 项目脚本可运行 |
| Phase 1 | 最小 Web bridge | 待开始 | 浏览器能连接 bridge，bridge 能启动或连接 app-server |
| Phase 2 | app-server 初始化和基础 API | 待开始 | initialize、initialized、model/list、account/read 可用 |
| Phase 3 | Web UI foundation | 待开始 | 页面显示连接、账号、模型、空会话和 diagnostics |
| Phase 4 | Thread / Turn / Item 生命周期 | 待开始 | 能新建 thread、发送 turn、显示 delta、完成 turn |

## Phase 0：协议和项目基线

用户可见变化：可以进入 `web/` 项目并运行基础开发命令。  
本阶段不做：真实聊天、approval、SSH remote。

- [ ] 确认系统 `codex` 可执行文件存在，并记录版本。
- [ ] 使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 确认 `codex app-server --stdio` 可启动。
- [ ] 生成或复制当前版本 app-server TypeScript schema 到 `src/codex/protocol/generated/`。
- [ ] 创建 `package.json`、`tsconfig.json` 和基础源码目录。
- [ ] 定义脚本：`typecheck`、`test`、`build`、`test:smoke`。
- [ ] 编写最小 JSON-RPC 类型和测试 fixture。

验证：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run typecheck
npm run test
```

## Phase 1：最小 Web bridge

用户可见变化：浏览器可以连接本地 bridge，并看到连接状态。  
本阶段不做：Codex 会话和模型渲染。

- [ ] 实现 `server/codex-process.ts`：启动 `codex app-server --stdio`。
- [ ] 实现 `server/json-rpc-client.ts`：request、response、notification、server request 基础分发。
- [ ] 实现 `server/websocket-bridge.ts`：浏览器 WebSocket 连接。
- [ ] 实现 `server/security.ts`：localhost、token、Origin 校验。
- [ ] app-server 子进程环境显式传入隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- [ ] app-server stderr 只进入 diagnostics 摘要，不混入 JSON-RPC stdout。
- [ ] transport close 时所有 pending request 快速失败。

验证：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run test:smoke
```

Smoke 记录：

| Date | Runtime | 场景 | Result | Evidence |
|---|---|---|---|---|
| 未运行 | local codex app-server | bridge connect，隔离 CODEX_HOME | 待验证 | 待补充 |

## Phase 2：app-server 初始化和基础 API

用户可见变化：页面能显示 Codex 连接状态、账号状态和模型列表。  
本阶段不做：聊天流和 approval。

- [ ] 对照 TUI `app_server_session.rs`，确认 initialize / initialized 语义。
- [ ] 发送 `initialize`，clientInfo 使用 Web 专属标识。
- [ ] 发送 `initialized` notification。
- [ ] 实现 `model/list`。
- [ ] 实现 `account/read` 或当前 app-server 对应账号读取方法。
- [ ] 处理 `account/updated`、`account/rateLimits/updated` 为 diagnostics 或状态。
- [ ] 初始化失败时展示明确错误：未安装、启动失败、协议失败、认证缺失。

验证：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run test:smoke
```

## Phase 3：Web UI foundation

用户可见变化：出现 Codex Web 基础工作台。  
本阶段不做：完整历史、完整 approval、复杂 diff。

- [ ] 实现 `AppShell`：顶部状态栏、左侧 Thread 区、中央 timeline、右侧 diagnostics。
- [ ] 实现 `ConnectionStatus`。
- [ ] 实现 `ModelPicker` 只读取 `model/list`。
- [ ] 实现 `AccountStatus` 只读取 app-server 账号状态。
- [ ] 实现 `DiagnosticsPanel`，未知 notification 不丢弃。
- [ ] 页面文案使用中文，字段必须有 source breadcrumb。

验证：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run typecheck
npm run test
npm run build
```

## Phase 4：Thread / Turn / Item 生命周期

用户可见变化：可以在浏览器中发起一轮 Codex 对话并看到流式输出。  
本阶段不做：完整 approval 决策、SSH remote、插件 UI。

- [ ] 对照 TUI `app/app_server_events.rs` 和 `app_server_session.rs`，确认 thread/start 与 turn/start 接线。
- [ ] 实现 `thread/start`。
- [ ] 实现 `turn/start`。
- [ ] reducer 支持 `thread/started`。
- [ ] reducer 支持 `turn/started`。
- [ ] reducer 支持 `item/started`。
- [ ] reducer 支持 `item/agentMessage/delta`。
- [ ] reducer 支持 `item/completed`。
- [ ] reducer 支持 `turn/completed`。
- [ ] reducer 支持 `error` 和 transport close。
- [ ] UI 展示 user message、assistant delta、running、completed、failed、interrupted。
- [ ] Composer 在 active turn 期间禁用或进入可控状态。

验证：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run test:smoke
```

Smoke 记录：

| Date | Runtime | Provider | Model | 场景 | Result | Evidence |
|---|---|---|---|---|---|---|
| 未运行 | local codex app-server，隔离 CODEX_HOME | app-server default | model/list default | one-turn chat | 待验证 | 待补充 |

## 决策日志

- 2026-07-06：第一版采用 TUI-first Web 化。官方 TUI 是业务语义基准，Web bridge 连接已安装的 `codex app-server --stdio`，不改 `codex-core`。
- 2026-07-06：`CodexBrowser` 和 `CodePilot` 只用于借鉴 app-server 经验、开发流程和测试经验，禁止作为代码来源。
- 2026-07-06：开发、测试和 smoke 默认使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`；最终验收才在用户明确同意后使用本地真实 `CODEX_HOME`。

## 剩余风险

- 系统安装的 `codex` 版本可能与生成的 TypeScript schema 不一致。
- 隔离 `CODEX_HOME` 可能缺少账号、模型、MCP 或历史配置；测试失败时要先区分隔离环境配置问题和 Web 实现问题。
- app-server server request 类型较多，Phase 4 前只做 diagnostics 和 fail-safe，完整 approval 需要后续计划。
- 浏览器 UI 可能偏离 TUI 语义，所有新增功能必须先对照 TUI。
- 真实模型调用需要账号、网络和额度，smoke 失败时要区分认证、网络、额度和协议问题。
