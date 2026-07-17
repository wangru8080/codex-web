# App-Server Skills 与 MCP 管理实施计划

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** 修复插件页，使 Skills 与 MCP 的列表、启停、详情、试用、配置和运行状态全部由 Codex app-server 权威数据驱动。

**Architecture:** `AppServerProvider` 提供 typed catalog/config/MCP actions，并保存 Skills invalidation 与 MCP startup notification。Skills 页面直接消费 `skills/list` 元数据，通过 `fs/readFile` 延迟读取正文/图标；MCP 页面读取 `config/read.config.mcp_servers`，通过 config write + reload 持久化，再用 `mcpServerStatus/list` 与 startup notification 展示真实运行状态。聊天发送链路把 Skill tag 转换为官方 `UserInput::{Text,Skill}`，不再只发送装饰性文本。

**Tech Stack:** React 19、TypeScript、Codex app-server 0.144.4 generated schema、Radix UI、Vitest、Chrome CDP。

## Global Constraints

- 开发与测试只使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- Skills 来源必须是 `app-server.skills/list`，启停必须是 `app-server.skills/config/write`。
- MCP 配置来源必须是 `app-server.config/read.config.mcp_servers`；写入后必须调用 `config/mcpServer/reload`。
- MCP 运行信息必须来自 `mcpServerStatus/list` 与 `mcpServer/startupStatus/updated`。
- “立即试用”必须生成可见 Skill tag，发送时同时带 `$skill-name` 文本与 `{type:"skill", name, path}` input item。
- 技能市场保持现状，不改市场搜索、详情和安装流程。
- 系统或管理员 Skill 不提供可执行卸载；仅对 app-server 可写范围内的用户/项目 Skill展示卸载入口并要求确认。

### Task 1: App-Server Skills 与 MCP Actions

**Files:**
- Modify: `src/codex-web/AppServerProvider.tsx`
- Modify: `src/codex-web/app-server-state.ts`
- Create: `src/codex-web/mcp-startup-adapter.ts`
- Create: `src/codex-web/mcp-startup-adapter.test.ts`
- Create: `src/codex-web/mcp-config-adapter.ts`
- Create: `src/codex-web/mcp-config-adapter.test.ts`

- [x] 增加 Skills list/toggle/read/remove actions，并在 `skills/changed` 后递增 invalidation revision。
- [x] 增加 config refresh、MCP config write/reload/status list actions，状态列表自动遍历 cursor。
- [x] 保存 MCP startup notification 的 ready/starting/failed/cancelled、错误和 source breadcrumb。

### Task 2: Skills 列表、详情与试用

**Files:**
- Modify: `src/components/skills/SkillsManager.tsx`
- Modify: `src/components/skills/SkillDetailDialog.tsx`
- Modify: `src/components/skills/SkillListItem.tsx`
- Modify: `src/app/plugins/page.tsx`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Create: `src/codex-web/skills-manager-wiring.test.ts`

- [x] 用 app-server metadata 替换 `/api/skills`，按 cwd 去重并保持两列布局。
- [x] 卡片和详情增加真实启停开关，延迟读取正文与图标。
- [x] 详情增加条件化卸载和“立即试用”；试用导航到新对话并注入 Skill tag。

### Task 3: 结构化 Skill 输入

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/components/chat/MessageInput.tsx`
- Modify: `src/app/chat/page.tsx`
- Modify: `src/components/chat/ChatView.tsx`
- Modify: `src/codex-web/AppServerProvider.tsx`
- Modify: `src/codex-web/turn-input.ts`
- Modify: `src/codex-web/turn-input.test.ts`
- Create: `src/codex-web/skill-try-wiring.test.ts`

- [x] 扩展 tag 保存 Skill path，并从 `/chat?skill=...&skillPath=...` 初始化 tag。
- [x] 保持用户消息 UI 为 tag + 问题文本，模型输入使用 `$skill-name` 与结构化 skill item。
- [x] 验证无 Skill、单 Skill、多 Skill和无 path 反例。

### Task 4: MCP 配置与运行状态

**Files:**
- Modify: `src/components/plugins/McpManager.tsx`
- Modify: `src/components/plugins/McpServerList.tsx`
- Modify: `src/components/plugins/McpServerDetailDialog.tsx`
- Modify: `src/components/plugins/McpServerEditorForm.tsx`
- Modify: `src/components/plugins/McpJsonConfigDialog.tsx`
- Create: `src/codex-web/mcp-manager-wiring.test.ts`

- [x] 用 config actions 替换全部失效 `/api/plugins/mcp*` 请求。
- [x] 修正 Codex config 的 stdio/streamable HTTP 字段映射、添加、编辑、启停与 JSON 保存。
- [x] 合并 status list 与 startup notification，展示工具数、serverInfo、auth、失败错误和刷新结果。

### Task 5: 验证与收口

- [x] 运行定向测试、全量测试和生产构建。
- [x] 使用隔离 CODEX_HOME 启动生产服务，真实 Chrome/CDP 验证 Skills 与 MCP 页面只读与导航路径。
- [x] 在涉及隔离 config 写入前输出拟执行操作清单并取得确认；验证后恢复原配置并核对内容。
- [x] 更新状态总览、决策日志和 Smoke Ledger。

## 状态总览

- `Code complete`：已完成。
- `Tests pass`：71 个测试文件、318 项测试通过；生产构建通过。
- `Smoke passed`：真实 Chrome 已验证 Skills 列表/详情/试用/启停，以及 MCP 列表/详情/启停/添加/JSON 保存/运行状态。
- `Review passed`：已完成定向代码复核与配置恢复核验。

## 决策日志

- 官方 app-server 0.144.4 POC 已确认 `skills/list` 能返回 system Skills 的 displayName、icons、defaultPrompt、path、scope、enabled。
- 官方 app-server 0.144.4 POC 已确认 `config/read` 返回 snake_case `mcp_servers`，`mcpServerStatus/list` 能返回 Playwright serverInfo、tools、resources 和 authStatus。
- 不复用旧 `/api/skills` 与 `/api/plugins/mcp`，因为生产 App Router 中不存在这些 route。
- 真实 Chrome 发现并修复了 Provider 尚未连接时 Skills/MCP 首次请求失败且不重试的竞态。

## Smoke Ledger

- 调研 POC：隔离环境识别 5 个 system Skills 和 1 个 Playwright MCP；MCP 返回 Playwright 1.61 serverInfo 与真实工具表。
- 真实 Chrome 正例：5 个 Skill 两列展示；Image Gen 详情读取完整 SKILL.md，立即试用在新对话生成 `imagegen` tag。
- 真实 Chrome MCP 正例：Playwright 显示 Connected、版本和 23 个真实工具；JSON 对话框读取当前官方 snake_case 配置，添加表单可切换 stdio/HTTP/JSON。
- 真实 Chrome Skill 写入正例：Image Gen 经 `skills/config/write` 禁用后立即显示“启用”，重新启用后恢复为“禁用”。
- 隔离配置恢复：测试前后 `config.toml` SHA-256 均为 `3ef591b97d5bc89bf95949274fe0eae1f6aee2cf5dc1d7795cecf3ee02bbe893`。
- MCP 写入 E2E：进入写入阶段时浏览器操作的自动审批上游返回 502；已停止服务并恢复配置，等待用户再次明确同意后重试。
- MCP 写入 E2E 重试正例：`playwright` 禁用后卡片与运行状态均为 Disabled，重新启用后恢复 Connected。
- MCP 添加正例：临时 `codex-web-e2e` 写入配置后显示为第二个服务，成功启动为 Connected，并暴露 23 个工具。
- MCP JSON 正例：将临时服务 `enabled` 改为 `false` 并保存后，卡片与运行状态均同步为 Disabled，原 `playwright` 保持 Connected。
- 最终恢复：变更中配置哈希为 `b9033dc1fb0d5051a3804b571d62aef9e40103b328b5cf47463c769cef32341a`；停止服务后恢复为原哈希 `3ef591b97d5bc89bf95949274fe0eae1f6aee2cf5dc1d7795cecf3ee02bbe893`，且临时服务已不存在。
- 反例：首次进入插件页时 Provider 未连接，旧实现停留在“Web bridge 尚未连接”；修复后连接成功自动重试并恢复真实列表。
- 反例：Skill 无 path 时仅发送 `$skill-name` 文本，不生成无效结构化 Skill input；无 Skill 时保持原输入结构。
