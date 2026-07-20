# 移除非 Codex app-server 遗留模块实施计划

> 交接文档：[Codex app-server 单 Runtime 清理交接](../../handover/2026-07-20-single-codex-runtime-cleanup.md)

> **执行要求：** 当前环境未提供 `executing-plans` 子技能，因此在本任务内按检查项顺序执行；每个阶段完成后更新 checklist、决策日志和 Smoke Ledger。

**目标：** 按依赖顺序完整移除定时 Tasks、Dashboard/Widget、第三方 Provider、Claude Code/Native runtime、自建图片生成和相关兼容层，使浏览器工作台只保留 Codex app-server runtime 及其真实协议状态。

**架构：** 先从路由、导航和聊天组件解除遗留模块挂载，再移除文本伪协议与独立实现目录，随后收缩共享类型和依赖。账户、模型、Thread、Turn、Item、Goal、Plan、Approval、Skills、MCP、文件与图片附件继续直接通过 `AppServerProvider` 和 generated protocol 工作。

**技术栈：** Next.js、React、TypeScript、Vitest、Playwright、Codex app-server WebSocket bridge。

## 全局约束

- 唯一 runtime 为 `codex app-server`，不得保留 Claude Code、Native/CodePilot 或第三方 Provider 执行回退。
- app-server notification、response 和 server request 是唯一运行时事实源。
- 保留 CodexWeb 既有左右侧栏、聊天区和视觉样式；只移除无产品来源的模块与入口。
- 保留 app-server Goal/Plan；不得与旧 `/api/tasks`、Scheduler 或 TodoWrite 任务混淆。
- 保留图片附件、历史 `image/localImage` 和通用媒体展示；只移除 Web 自建图片生成 runtime。
- 保留 archived Threads、Skills、MCP、Plugins、文件树和 app-server diagnostics。
- Git 面板不在本计划中直接删除；若无真实 app-server 来源，只移除失效接线或显示 unsupported。
- 不执行删除命令；完整文件或目录移动到 `/volume2/SSD/Trash/home/rrssnas/code/codex/web/` 对应原层级。
- Trash 目标存在同名对象时先比较文件名、大小、修改时间、哈希和内容；未确认前不得覆盖或合并。
- 开发与测试固定使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不修改 `/home/rrssnas/code/CodexWeb`。
- 所有注释、测试说明、文档和提交信息使用简体中文。

---

### 任务 1：移除可见遗留入口

**文件：**

- 新增测试：`src/codex-web/legacy-surface-removal.test.ts`
- 修改：`src/components/settings/nav-config.ts`
- 修改：`src/components/layout/WorkspaceSidebar/TabBar.tsx`
- 修改：`src/components/layout/WorkspaceSidebar/TabPanel.tsx`
- 修改：`src/lib/workspace-sidebar.ts`
- 修改：`src/components/layout/AppShell.tsx`
- 修改：`src/components/chat/ChatView.tsx`
- 修改：`src/app/chat/page.tsx`
- 修改：`src/app/chat/[id]/page.tsx`
- 移动：`src/app/settings/tasks/`
- 移动：`src/components/settings/TasksSection.tsx`

**接口：**

- 移除：设置 Tasks 导航、固定 Widget Tab、批量生图 Provider、单选 RuntimeSelector 挂载。
- 保留：Git、文件预览动态 Tab、聊天输入框模型和推理强度选择。

- [x] **步骤 1：编写失败测试**

  源码契约断言设置导航不含 `tasks`，Workspace 固定 Tab 不含 `widget`，`ChatView` 不挂载 `BatchExecutionDashboard`、`BatchContextSync`、`TaskCheckpoint` 或 `RuntimeSelector`。

- [x] **步骤 2：验证测试先失败**

  ```bash
  export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
  npm exec vitest run -- src/codex-web/legacy-surface-removal.test.ts
  ```

  预期：FAIL，失败项对应仍然存在的入口和挂载。

- [x] **步骤 3：实施最小入口移除**

  `WorkspaceSidebar` 的固定 Tab 集合从：

  ```ts
  ['git', 'widget']
  ```

  收缩为：

  ```ts
  ['git']
  ```

  删除设置 Tasks 项和聊天页遗留组件挂载，但不在本阶段删除共享类型。

- [x] **步骤 4：运行定向测试与 typecheck**

  ```bash
  npm exec vitest run -- src/codex-web/legacy-surface-removal.test.ts
  npm run typecheck
  ```

  预期：入口契约通过；若 typecheck 暴露依赖引用，仅修复本阶段造成的孤儿引用。

### 任务 2：移除聊天旧文本协议和旧 Task 展示

**文件：**

- 新增测试：`src/codex-web/legacy-message-protocol-removal.test.ts`
- 修改：`src/components/chat/MessageItem.tsx`
- 修改：`src/components/chat/StreamingMessage.tsx`
- 修改：`src/components/chat/MessageList.tsx`
- 修改：`src/components/chat/ChatView.tsx`
- 修改：`src/types/index.ts`
- 移动：`src/components/chat/ImageGenConfirmation.tsx`
- 移动：`src/components/chat/ImageGenCard.tsx`
- 移动：`src/components/chat/TaskCheckpoint.tsx`
- 移动：`src/components/chat/TaskRunMarker.tsx`
- 移动：`src/components/chat/TaskWaitingForPermissionPanel.tsx`
- 移动：`src/components/chat/RuntimeSwitchMarker.tsx`
- 移动：`src/components/chat/batch-image-gen/`
- 移动：`src/components/project/TaskCard.tsx`
- 移动：`src/components/project/TaskList.tsx`

**接口：**

- 移除：`show-widget`、`image-gen-request`、`batch-plan`、`taskRuns`、`task_run_id` 的 UI 解释。
- 保留：app-server process blocks、tool calls、final answer、Goal/Plan block、`MediaPreview` 和图片附件。

- [x] **步骤 1：编写失败测试**

  测试扫描消息组件，要求不存在：

  ```ts
  ['show-widget', 'image-gen-request', 'batch-plan', 'TaskRunMarker', 'TaskWaitingForPermissionPanel']
  ```

  反例断言 `PlanMessageBlock`、`MediaPreview` 和 app-server process block 接线仍存在。

- [x] **步骤 2：运行失败测试**

  ```bash
  npm exec vitest run -- src/codex-web/legacy-message-protocol-removal.test.ts
  ```

  预期：旧协议断言失败，核心反例通过。

- [x] **步骤 3：移除旧协议解析分支**

  `MessageItem` 和 `StreamingMessage` 只消费普通 Markdown 与 `app-server-message-blocks` 产物；不得从 final answer 文本反推图片生成、Dashboard 或批量计划状态。

- [x] **步骤 4：运行消息相关测试**

  ```bash
  npm exec vitest run -- src/codex-web/legacy-message-protocol-removal.test.ts src/codex-web/app-server-message-blocks.test.ts src/codex-web/plan-display-adapter.test.ts src/codex-web/tool-output-display.test.ts
  ```

  预期：全部通过。

### 任务 3：移除旧 runtime、Provider、Scheduler、Dashboard 和图片生成实现

**文件：**

- 新增测试：`src/codex-web/single-runtime-boundary.test.ts`
- 修改：仍引用旧实现的 `src/lib/codex/**` 文件，只保留 app-server 实际消费的适配器。
- 移动目录：`src/lib/runtime/`
- 移动目录：`src/lib/claude-code-compat/`
- 移动目录：`src/lib/harness/`
- 移动文件族：`src/lib/claude-*`、`src/lib/headless-claude.ts`
- 移动文件族：`src/lib/provider-*`、`src/lib/ai-provider.ts`、`src/lib/model-discovery.ts`、`src/lib/auto-discover-models.ts`
- 移动文件族：`src/lib/dashboard-*`、`src/lib/builtin-tools/dashboard.ts`
- 移动文件族：`src/lib/image-generator.ts`、`src/lib/image-gen-mcp.ts`、`src/lib/job-executor.ts`
- 移动文件族：`src/lib/task-scheduler.ts`、`src/lib/agent-task-runner.ts`
- 复核后移动：仅服务上述旧 runtime 的 agent loop、notification MCP、builtin tool 和 bridge conversation-engine 文件。

**接口：**

- 唯一执行入口：`AppServerProvider -> app-server-browser-client -> WebSocket bridge -> codex app-server --stdio`。
- 禁止：`@anthropic-ai/claude-agent-sdk`、`generateTextFromProvider`、旧 `RuntimeRunEvent`、Provider DB 解析和 Scheduler 轮询进入生产 import graph。

- [x] **步骤 1：编写边界失败测试**

  断言生产入口不导入：

  ```ts
  ['claude-client', 'provider-resolver', 'task-scheduler', 'dashboard-mcp', 'image-gen-mcp', 'runtime/sdk-runtime']
  ```

- [x] **步骤 2：先解除跨模块引用**

  使用 `rg` 逐个确认每个待移动文件没有来自保留代码的 import；发现混合职责文件时只移除遗留分支，不整体移动。

- [x] **步骤 3：移动独立实现到 Trash**

  每批移动前比较 Trash 同名目标；移动后同时验证源路径不存在、Trash 对应路径存在。

- [x] **步骤 4：运行边界测试和 typecheck**

  ```bash
  npm exec vitest run -- src/codex-web/single-runtime-boundary.test.ts
  npm run typecheck
  ```

  预期：生产 import graph 不含旧 runtime，TypeScript 无悬空引用。

### 任务 4：清理类型、i18n、依赖和不可达设置组件

**文件：**

- 修改：`src/types/index.ts`
- 移动：`src/types/dashboard.ts`
- 修改：`src/i18n/en.ts`
- 修改：`src/i18n/zh.ts`
- 修改：`package.json`
- 修改：`package-lock.json`（仅通过 npm 安全更新，不手工重写锁文件）
- 移动设置组件：`OverviewSection`、`HealthSection`、`UsageStatsSection`、`ModelsSection`、`RuntimePanel`、`ProviderManager` 及其专用子组件和 hooks。
- 保留重定向壳：`/settings/providers`、`/settings/models`、`/settings/runtime`、`/settings/health`、`/settings/usage`、`/settings/overview`，除非定向测试证明无兼容价值。

**接口：**

- 从共享类型删除 Provider DB、ScheduledTask、TaskRun、DashboardWidget、旧 RuntimeId 等孤儿类型。
- 保留 generated protocol 类型、Codex UI 适配类型和普通附件/消息类型。

- [x] **步骤 1：新增孤儿语义测试**

  测试要求 `package.json` 不含 Anthropic Agent SDK 和旧 Provider SDK，i18n 不含 Dashboard、Scheduler、Claude runtime、图片 Provider 专用键。

- [x] **步骤 2：移除不可达设置实现**

  路由重定向保持：

  ```ts
  redirect('/settings/codex');
  ```

  不保留任何对失效 `/api/providers`、`/api/claude-status`、`/api/usage/stats` 的客户端调用。

- [x] **步骤 3：更新依赖锁**

  使用项目 Node 环境执行精确 `npm uninstall <已确认无引用依赖>`；不得顺带升级其他依赖。

- [x] **步骤 4：运行 typecheck 和定向测试**

  ```bash
  npm run typecheck
  npm exec vitest run -- src/codex-web/single-runtime-boundary.test.ts src/codex-web/legacy-surface-removal.test.ts
  ```

### 任务 5：复核并保护 app-server 核心能力

**文件：**

- 修改测试：`src/codex-web/legacy-surface-removal.test.ts`
- 修改测试：`src/codex-web/legacy-message-protocol-removal.test.ts`
- 按失败结果精准修改：`AppServerProvider.tsx`、Goal/Plan、ArchivedThreads、Skills、MCP、Plugins、文件和附件适配器。

**接口：**

- 模型：`app-server.model/list`
- 账户：`app-server.account/read` 和 `account/updated`
- 会话：`thread/*`、`turn/*`、`item/*`
- Goal/Plan：`thread/goal/*`、`turn/plan/updated`、`item/plan/delta`
- 文件和附件：`fs/*`、`image/localImage`

- [x] **步骤 1：增加核心反例断言**

  验证移除旧模块后以下符号仍在生产接线中：

  ```ts
  ['GoalProgressRow', 'PlanMessageBlock', 'ArchivedThreadsSection', 'SkillsManager', 'McpManager', 'persistTurnAttachments']
  ```

- [x] **步骤 2：运行 app-server 定向回归**

  ```bash
  npm exec vitest run -- src/codex-web/turn-reducer.test.ts src/codex-web/goal-display-adapter.test.ts src/codex-web/plan-display-adapter.test.ts src/codex-web/thread-history-adapter.test.ts src/codex-web/app-server-image-attachment-wiring.test.ts
  ```

  预期：核心事实源和图片附件反例全部通过。

### 任务 6：将 Codex 设置页改接 AppServerProvider

**文件：**

- 修改：`src/components/settings/CodexSection.tsx`
- 修改：`src/components/settings/CodexQuotaWidget.tsx`
- 修改：`src/codex-web/AppServerProvider.tsx`（只补公开 action，不复制状态）
- 新增测试：`src/codex-web/codex-settings-app-server-wiring.test.ts`

**接口：**

- 读取：`useAppServerState().account`、连接状态和 rate-limit 状态。
- 操作：`account/login/start`、`account/login/cancel`、`account/logout`、`account/read`、`account/rateLimits/read`。
- 禁止：`/api/codex/account`、`/api/codex/status`、`/api/codex/login`、`/api/codex/rate-limits`。

- [x] **步骤 1：编写失败接线测试**

  断言 `CodexSection` 使用：

  ```ts
  useAppServerActions();
  useAppServerState();
  ```

  并且不再包含任何旧 Codex REST URL。

- [x] **步骤 2：扩展最小 AppServer actions**

  action 直接执行 generated schema 对应 JSON-RPC method，并将 response/notification 写回现有 app-server state；不创建第二套账户 store。

- [x] **步骤 3：改接设置 UI 并运行定向测试**

  ```bash
  npm exec vitest run -- src/codex-web/codex-settings-app-server-wiring.test.ts src/codex-web/app-server-runtime-options.test.ts
  ```

  预期：设置页只使用 app-server，权限配置适配仍通过。

### 任务 7：完整验证、交接和计划归档

**文件：**

- 新增：`docs/handover/2026-07-20-single-codex-runtime-cleanup.md`
- 更新并移动：`docs/exec-plans/active/2026-07-20-remove-legacy-runtimes.md`

**接口：**

- 产出：文件迁移记录、测试结果、构建结果、正反例 Smoke Ledger、剩余 unsupported 能力。

- [x] **步骤 1：运行完整测试与构建**

  ```bash
  export NODE_HOME=/volume2/SSD/node-v24.14.0
  export PATH=$NODE_HOME/bin:$PATH
  export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
  npm run test
  npm run build
  ```

- [x] **步骤 2：运行 smoke**

  ```bash
  npm run test:smoke
  ```

  正例：连接 app-server、列出模型、启动 Thread/Turn、展示 delta、Goal/Plan、完成 Turn。

  反例：页面不出现 Tasks、Widget、Claude Code、第三方 Provider 或图片生成入口；普通图片附件仍能进入 turn，普通聊天不产生伪 Dashboard/Task 状态。

- [x] **步骤 3：浏览器轻量走查**

  只检查 `/chat`、`/settings/codex`、`/settings/archived`、`/plugins`，验证控制台无旧 `/api/tasks`、`/api/providers`、`/api/dashboard`、`/api/media/generate`、`/api/claude-status` 请求。

- [x] **步骤 4：记录结果并归档**

  更新 checklist、决策日志和 Smoke Ledger；新增 handover；将计划移动到 `docs/exec-plans/completed/`。计划与 handover 顶部互相链接。

## 决策日志

- 2026-07-20：直接移除遗留模块，不采用隐藏开关；理由是生产仓库不存在对应 REST route，且唯一 runtime 边界已经确定为 app-server。
- 2026-07-20：Task 名称按数据来源拆分；移除 Scheduler/TodoWrite UI，保留 app-server Goal/Plan 和 archived Threads。
- 2026-07-20：图片能力按方向拆分；移除 Web 自建生成 runtime，保留用户图片输入与通用媒体输出。
- 2026-07-20：`batch-image-gen` 在任务 1 仍被消息渲染器引用，因此延后到任务 2；解除旧文本协议解释后再移动，避免中间状态破坏聊天渲染。
- 2026-07-20：保留导入会话、安装向导和通用文件工具中的兼容文案；这些仍有现有 UI 入口，不属于本轮已确认的无用执行依赖。
- 2026-07-20：移除 General 设置中已失效的生成式 UI 开关和 Dashboard 默认面板选项；历史 `dashboard` 值读取时回退到 `file_tree`。

## Smoke Ledger

- 任务 1：失败优先测试初次为 3 条失败、1 条核心聊天反例通过；实现后 4 条全部通过，`npm run typecheck` 通过。
- 任务 1：`src/app/settings/tasks/` 和 `TasksSection.tsx` 已移动到 `/volume2/SSD/Trash/home/rrssnas/code/codex/web/` 对应原层级，源路径与 Trash 新条目均已验证。
- 任务 2：失败优先测试初次为 4 条失败、1 条核心消息反例通过；实现后定向消息回归 5 个测试文件、30 条测试全部通过，`npm run typecheck` 通过。
- 任务 2：9 个旧协议、Task 和批量图片组件/目录已移动到 `/volume2/SSD/Trash/home/rrssnas/code/codex/web/` 对应原层级，源路径不存在且 Trash 新条目均已验证。
- 任务 3：单 runtime 边界测试通过；旧 runtime、Provider、Scheduler、Dashboard、图片生成与相关实现共 225 个源码文件移入 Trash，生产 import graph 保留 app-server 浏览器客户端和 reducer。
- 任务 4：共享类型和中英文专用文案完成收缩；精确移除 `recharts`、`html-to-image`、`pngjs`、`qrcode`、`@types/pngjs`、`@types/qrcode`，未顺带升级依赖。
- 任务 5：Goal、Plan、历史线程、图片附件等定向核心回归包含在 10 个测试文件、62 条测试中，全部通过；普通聊天不产生 Dashboard/Task 伪状态。
- 任务 6：Codex 设置只使用 `AppServerProvider` 的账户和 rate-limit actions；旧 Codex REST URL 接线测试通过。
- 任务 7：`npm run test` 通过（93 个测试文件、443 条测试）；`npm run build` 通过（22 个路由）；`npm run test:smoke` 通过（7 个模型，账户来源 `app-server.account/read`）。
- 任务 7：生产实例 `/chat`、`/settings/codex`、`/settings/archived`、`/plugins` 均返回 HTTP 200；生产 UI 未扫描到旧 Tasks、Provider、Dashboard、图片生成和 Claude status API 请求。
