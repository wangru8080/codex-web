# Config 模型与推理等级默认值对齐实施计划

> **执行要求：** 在当前会话按任务逐项实施并更新复选框；使用隔离 `CODEX_HOME` 验证，不自动提交 Git。

**目标：** 用户未在当前新聊天页面显式选择时使用 app-server `config/read` 默认模型和推理等级；用户手动选择后按 app-server thread 独立保存、恢复和同步，不在不同会话之间串值。

**架构：** AppServerProvider 在初始化阶段并行读取 `model/list` 与 `config/read`，并以 source breadcrumb 存入共享状态。新聊天页通过纯 resolver 校验配置默认值，并在每次真正的新对话重置时重新应用。线程存在后对齐官方 TUI：模型或 effort 选择立即调用 `thread/settings/update`，以 `thread/settings/updated` 为事实源；历史会话通过不携带模型覆盖的 `thread/resume` 返回值恢复线程设置。

**技术栈：** React 19、TypeScript、Vitest、Codex app-server v2 `model/list`、`config/read`。

## 全局约束

- 模型目录来自 `app-server.model/list`，配置来自 `app-server.config/read`。
- 不直接解析浏览器可见文件路径，不在浏览器读取 `config.toml`。
- 配置模型必须匹配可见模型的 `id` 或 `model`。
- 配置 effort 只有在目标模型支持时才采用，否则使用该模型 `defaultReasoningEffort`。
- 当前页面用户显式选择优先于初始化默认值。
- 已创建线程的模型和 effort 按 `threadId` 隔离，以 `thread/resume` 与 `thread/settings/updated` 为事实源。
- Codex 会话不得使用全局 `localStorage` 作为历史线程模型或 effort 的恢复来源。
- 测试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

### Task 1：默认值解析规则

**文件：**
- 新增：`src/codex-web/new-chat-model-defaults.ts`
- 新增：`src/codex-web/new-chat-model-defaults.test.ts`

- [x] 编写失败测试：有效 config 模型/effort 优先于目录默认值。
- [x] 编写反例：配置模型不可用、effort 不受支持、无配置时回退模型目录默认值。
- [x] 实现最小纯 resolver 并通过定向测试。

### Task 2：接入 app-server 初始化和输入框状态

**文件：**
- 修改：`src/codex-web/app-server-state.ts`
- 修改：`src/codex-web/AppServerProvider.tsx`
- 修改：`src/app/chat/page.tsx`

- [x] 为 `config/read` 增加 source breadcrumb 和共享状态字段。
- [x] bootstrap 与 `model/list` 并行读取 base config，不传项目 cwd。
- [x] 新聊天页等待 models/config 后一次性设置 `currentModel` 与 `selectedEffort`。
- [x] 移除新聊天页 localStorage 对默认模型的优先覆盖，保留当前页面显式选择行为。

### Task 3：按线程保存和恢复手动选择

**文件：**
- 新增：`src/codex-web/thread-model-settings.ts`
- 新增：`src/codex-web/thread-model-settings.test.ts`
- 修改：`src/codex-web/resume-adapter.ts`
- 修改：`src/codex-web/resume-adapter.test.ts`
- 修改：`src/codex-web/AppServerProvider.tsx`
- 修改：`src/app/chat/page.tsx`
- 修改：`src/app/chat/[id]/page.tsx`
- 修改：`src/components/chat/ChatView.tsx`

- [x] 编写失败测试：无覆盖恢复只发送 `threadId`；模型和 effort 更新生成独立的官方 `thread/settings/update` 参数。
- [x] 新对话重置时重新应用 config 默认值，不继承上一会话手动选择。
- [x] 线程存在后选择模型或 effort 立即调用 `thread/settings/update`，并等待 `thread/settings/updated`。
- [x] 历史会话以 `thread/resume.model` 和 `thread/resume.reasoningEffort` 初始化输入框。
- [x] 当前线程收到 `thread/settings/updated` 后同步模型和 effort，其他 thread 通知不影响当前输入框。
- [x] 移除 Codex 新会话对全局 last-model/last-provider 的写入和历史恢复依赖。

### Task 4：验证与归档

- [x] 运行定向测试、`npm run test` 和 `npm run build`。
- [x] 使用隔离 config 设置的模型/effort 验证输入框显示和真实 rollout。
- [x] 记录有效配置触发与无效配置回退反例到 Smoke Ledger。
- [x] 重新运行定向测试、完整测试和生产构建。
- [x] 用两个隔离线程分别设置不同模型/effort，切换并重开后验证各自输入框与 rollout。
- [x] 验证点击新对话恢复 config 默认值，不继承上一线程手动选择。
- [x] 输出清理及归档拟执行操作清单，取得用户明确同意后执行移动。

## Smoke Ledger

- TDD 失败基线：新增 resolver 测试首次运行因模块尚不存在而失败，确认测试能捕获缺失实现。
- 定向测试：`new-chat-model-defaults.test.ts` 与 `turn-start-request.test.ts` 共 6 项通过。
- 完整测试：`npm run test` 通过，共 41 个测试文件、193 项测试；包含 TypeScript 类型检查。
- 生产构建：`npm run build` 通过，共生成 22 个静态页面；保留现有 Turbopack NFT 关于 `next.config.mjs` / `theme/loader.ts` 的警告。
- 有效配置触发：隔离 `config.toml` 配置 `model = "gpt-5.5"`、`model_reasoning_effort = "low"`，新聊天输入框无需打开菜单即显示“5.5 低”。
- 真实调用：未在页面显式选模型或推理等级，发送 `只回复 CONFIG_DEFAULT_OK，不调用任何工具。`；rollout `rollout-2026-07-15T11-07-11-019f63be-1bc5-7fe1-a717-b1530cca9d16.jsonl` 的 `turn_context` 记录 `model = "gpt-5.5"`、`effort = "low"`，回复成功完成。
- 反例：配置模型不存在时回退 `model/list` 默认模型；配置 effort 不受目标模型支持时回退该模型默认 effort；无配置时回退 `model/list` 默认模型及其默认 effort。三项均由 resolver 单元测试覆盖。
- 环境收口：生产服务使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 和随机端口 `41057`；验收后端口与 app-server 子进程均已停止。
- 浏览器控制台出现既有 `/api/setup`、`/api/settings/app` 404；与本次默认模型功能无关，未在本次范围内修改。
- 官方语义对照：TUI `thread_settings.rs` 在模型或 effort 选择后立即调用 `thread/settings/update`，并用 `thread/settings/updated` 更新缓存会话；Web 已按同一时机和事实源接线。
- TDD 扩展失败基线：无覆盖恢复原先错误包含 `model:null`、`cwd:null`；线程模型设置模块不存在。实现后相关 6 个文件共 15 项定向测试通过。
- 完整回归：首次沙箱运行仅 WebSocket 本地监听测试因 `EPERM` 失败；允许回环监听后 `npm run test` 共 42 个文件、197 项全部通过。
- 生产构建：首次沙箱运行因 Turbopack 需要绑定本地端口而失败；允许回环监听后 `npm run build` 成功生成 22 个页面，仍只有既有 NFT 动态追踪警告。
- 新对话反例：线程 A 切换到 `gpt-5.5/high` 后点击“新对话”，输入框恢复隔离 config 的 `gpt-5.5/low`，没有继承 A。
- 多线程 E2E：线程 A 为 `gpt-5.5/high`，线程 B 为 `gpt-5.6-sol/high`；通过侧栏站内切换 B→A 后，两个输入框分别恢复自己的设置，互不串值。
- 真实 rollout：线程 A 首轮 `turn_context` 为 `gpt-5.5/low`；线程 B 首轮为 `gpt-5.6-sol/high`，与创建时输入框选择一致。
- CDP 帧级验证：历史线程 A 与新建线程 C 的 effort 选择均发送真实 `thread/settings/update`，携带各自 threadId；app-server 返回同 threadId 的 `thread/settings/updated`，其中 model、effort 和 collaboration mode 一致。
- 生命周期边界：整页加载会断开 WebSocket，当前 bridge 会为新连接重启 app-server；尚未执行下一 turn 的纯内存 thread setting 会回到 rollout 最后上下文。正常侧栏/路由站内切换保持同一 app-server 连接并正确隔离；本次未用浏览器存储伪造跨进程状态。
- 环境收口：本轮随机端口 `41975`、bridge 和 app-server 子进程均已停止；日志保存在 `/volume2/SSD/codex/Temp/codex-thread-model-isolation-smoke-20260715.log`。
