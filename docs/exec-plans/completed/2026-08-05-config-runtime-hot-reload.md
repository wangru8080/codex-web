# 配置运行时选择性热加载实施计划

> **状态：** 2026-08-05 完成；使用隔离 `CODEX_HOME` 验证；未提交 Git。

**目标：** Codex Web 通过 app-server 修改 `config.toml` 后，只刷新受影响的运行时能力和 UI 配置，不重启 Codex Web 或 app-server，也不覆盖已有 session 的模型、推理等级和审批策略。

**架构：** 配置写入统一使用 `config/batchWrite`。纯默认值变更只重新执行 `config/read`；运行时配置通过 `reloadUserConfig` 热加载；MCP 配置额外调用 `config/mcpServer/reload`。Web 状态分别保存 MCP、Plugin 和 Skills 修订号，扩展管理组件只在连接或相关修订变化时重新获取当前可见数据。

**技术栈：** TypeScript、React、Codex app-server JSON-RPC、Vitest、Playwright smoke。

## 全局约束

- app-server 是配置和运行时事实源，不在浏览器或 bridge 直接解析、写入 `config.toml`。
- 不增加本地文件 watcher；SSH 远端与本地必须使用同一套 app-server 协议流程。
- 不增加第三方依赖，不修改 `/home/rrssnas/code/codex`。
- 测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

## Task 1：配置刷新分类

**Files:**
- Create: `src/codex-web/config-runtime-refresh.ts`
- Create: `src/codex-web/tests/config-runtime-refresh.test.ts`

**Interfaces:**
- Produces: `configRuntimeRefreshPlan(edits)`，返回 `reloadUserConfig`、`reloadMcpServers` 和 MCP、Plugin、Skills UI 修订范围。

- [x] 先写失败测试，覆盖默认模型、MCP、Skills/Hooks/Plugins/Memory 和未知键。
- [x] 运行定向测试，确认实现前失败。
- [x] 实现最小前缀分类逻辑。
- [x] 运行定向测试，确认分类通过。

## Task 2：统一配置写入

**Files:**
- Modify: `src/codex-web/AppServerProvider.tsx`
- Modify: `src/codex-web/app-server-state.ts`
- Modify: `src/codex-web/tests/plugin-catalog-provider-wiring.test.ts`
- Create: `src/codex-web/tests/config-runtime-refresh-wiring.test.ts`

**Interfaces:**
- Consumes: `configRuntimeRefreshPlan(edits)`。
- Produces: 统一配置批量写入、选择性 MCP reload、最新 `config/read` 状态和分类修订号。

- [x] 先写接线测试，断言 MCP 和 Memory 都经过统一批量写入流程。
- [x] 运行接线测试，确认实现前失败。
- [x] 新增内部统一写入函数，并复用现有 app-server request。
- [x] MCP 只在相关键变化时调用 `config/mcpServer/reload`。
- [x] 成功后更新 `config` 以及 MCP、Plugin、Skills 分类修订号。
- [x] 运行接线与现有 provider 测试。

## Task 3：扩展页面按修订刷新

**Files:**
- Modify: `src/components/plugins/McpManager.tsx`
- Modify: `src/codex-web/tests/mcp-manager-wiring.test.ts`

**Interfaces:**
- Consumes: MCP 与 Plugin 分类修订号。
- Produces: MCP/Plugin 管理页在配置真正写入后重新获取配置、安装插件和运行状态。

- [x] 先补失败接线测试。
- [x] 将分类修订号加入 MCP/Plugin 数据加载 effect。
- [x] 运行 MCP、Plugin、Skills 定向测试。

## Task 4：验证与计划收口

**Files:**
- Modify: `docs/exec-plans/active/2026-08-05-config-runtime-hot-reload.md`
- Move when complete: `docs/exec-plans/completed/2026-08-05-config-runtime-hot-reload.md`

- [x] 运行配置分类和接线定向测试。
- [x] 运行 `npm run test`。
- [x] 运行 `npm run build`。
- [x] 运行隔离 app-server Smoke：普通默认值写入、MCP 写入、已有 session 设置不变。
- [x] 停止测试服务，记录 Smoke Ledger，将计划迁入 `completed/`。

## Smoke Ledger

- `npm run test`：Tests pass，typecheck 与完整 Vitest 以退出码 0 完成。
- `npm run build`：Tests pass，Next.js 生产构建以退出码 0 完成。
- `npm run test:smoke`：Smoke passed；bridge 使用隔离 `CODEX_HOME`，读取到 5 个模型，账号状态来自 `app-server.account/read`。
- `npm run test:smoke:config-runtime`：Smoke passed；默认值写入请求序列为 `config/batchWrite -> config/read`，反例确认未调用 MCP reload；MCP 写入序列额外包含 `config/mcpServer/reload`。
- `npm run test:e2e:permissions`：Smoke passed；权限策略工具完整 E2E 以退出码 0 完成，统一配置写入没有破坏相邻的 thread 权限路径。
- session 反例：thread 发送消息并生成 rollout 后，写回默认模型/推理等级，再执行 `thread/resume`，模型仍为 `gpt-5.6-sol`、推理等级仍为 `low`；测试 thread 随后归档。
- 浏览器验收：共享 Playwright profile 连续超时后，改用 `~/.cache/ms-playwright/chromium-1228` 的独立 Chromium 149 和生产服务完成验证。登录、`/plugins#mcp`、MCP JSON 原值保存均通过；WebSocket frame 依次包含一次 `config/batchWrite`、一次 `config/mcpServer/reload` 和后续 `config/read`，运行状态从 Pending 恢复为 Connected。
- 浏览器反例：页面没有保存/加载错误文案、JavaScript exception、console error 或横向溢出；MCP reload 后 `playwright` 与 `github` 均恢复 Connected，分别显示 23 和 44 个工具。
- 进程检查：Smoke、E2E 和浏览器尝试结束后没有残留的 Codex Web、bridge、app-server 或独立 Chromium 测试进程；本次创建的浏览器标签已关闭。
