# 多侧边聊天实现计划

> **执行要求：** 按步骤跟踪复选框；实现使用最小改动，先写失败测试，再完成代码与验证。

**目标：** 对齐官方 Codex App，让一个主会话可同时打开多个互相独立的临时侧边聊天标签。

**架构：** 每个侧聊标签拥有唯一标签 ID，并映射到一个由 `app-server.thread/fork { ephemeral: true }` 创建的子线程。工作区侧栏 Provider 按标签 ID 保存创建状态和子线程 ID；标签内容、重试、关闭及清理均通过该 ID 定位，刷新后不恢复任何侧聊。

**技术栈：** React、TypeScript、Next.js、Vitest、Codex app-server JSON-RPC。

## 全局约束

- 官方 Codex App 截图是多标签交互基准，app-server notification 仍是运行状态事实源。
- 不修改 `~/code/codex`，不新增第三方依赖，不保存临时线程凭据或伪造协议状态。
- 所有 app-server 验证默认使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 侧聊保持非持久化；关闭时先中断运行中的 Turn，再取消订阅，不调用 `thread/delete`。
- 第一个标签显示“侧边聊天”，后续按创建顺序显示“侧边聊天 2、3…”。

---

### 任务 1：定义多侧聊标签状态

**文件：**
- 修改：`src/lib/workspace-sidebar.ts`
- 测试：`src/lib/tests/workspace-sidebar.test.ts`

**接口：**
- 产出：`createSideChatTab(baseTitle: string, ordinal: number): SideChatTab`
- 产出：可使用唯一字符串 `id`、`key` 的 `SideChatTab`

- [x] 写入失败测试，断言三个侧聊可共存、名称依次编号且序列化时全部过滤。
- [x] 运行 targeted Vitest，确认测试因 `createSideChatTab` 缺失失败。
- [x] 最小实现标签工厂和宽化后的侧聊标签类型。
- [x] 重跑 targeted Vitest，确认状态测试通过。

### 任务 2：按标签管理临时子线程

**文件：**
- 修改：`src/hooks/useWorkspaceSidebar.tsx`
- 修改：`src/components/layout/WorkspaceSidebar/SideChatPanel.tsx`
- 修改：`src/components/layout/WorkspaceSidebar/TabPanel.tsx`

**接口：**
- 产出：`sideChats: Record<string, SideChatState>`
- 产出：`openSideChat(title: string): void`
- 产出：`retrySideChat(id: string): void`
- 产出：`closeSideChat(id: string): Promise<void>`
- 消费：`SideChatPanel({ sideChatId })`

- [x] 把单例状态和操作号改为按标签 ID 保存，允许并发创建互不失效。
- [x] 让重试复用原标签，让关闭只中断和取消订阅目标线程。
- [x] 切换主会话或卸载时取消订阅全部侧聊线程并清空内存状态。
- [x] 让活动标签把自身 ID 传给 `SideChatPanel`，所有 selector 使用对应子线程。

### 任务 3：对齐标签创建与关闭交互

**文件：**
- 修改：`src/components/layout/WorkspaceSidebar/TabBar.tsx`
- 测试：`src/codex-web/tests/workspace-sidebar-ui-wiring.test.ts`

**接口：**
- 消费：`closeSideChat(id)`
- 消费：`openSideChat(title)`

- [x] 加号菜单和工作区总览每次点击都创建新的侧聊标签。
- [x] 关闭确认保存目标标签 ID；成功只关闭目标，失败保留目标标签并显示真实错误。
- [x] 补充接线断言，确认面板传 ID、关闭传 ID，且没有 `thread/delete`。
- [x] 运行两个 targeted Vitest 文件并确认 8/8 通过。

### 任务 4：验证与交接

**文件：**
- 新建：`docs/handover/2026-08-21-multiple-side-chats.md`
- 移动：`docs/exec-plans/active/2026-08-21-multiple-side-chats.md` → `docs/exec-plans/completed/2026-08-21-multiple-side-chats.md`

- [x] 使用隔离 `CODEX_HOME` 运行 `npm run test`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run test:smoke` 和 `npm run test:smoke:interrupt`，记录普通主聊天与中断反例。
- [ ] 启动开发应用，检查多标签布局、创建、切换、关闭和浏览器 console；开发服务已实际启动并可由 HTTP 访问，但 Playwright 到宿主开发端口连续超时，按项目规则停止自动化并关闭页面与服务，未声明视觉验证通过。
- [x] 更新本计划 checklist、状态和 Smoke Ledger，新增技术交接文档。
- [x] 将本计划移动到 `docs/exec-plans/completed/`。

## 后续缺陷修复（2026-08-22）

- [x] 侧聊面板保持挂载，切换标签后保留本地消息与实时 Turn 状态。
- [x] app-server `turn.status === 'running'` 直接驱动输入框停止按钮，并继续复用 `turn/interrupt`。
- [x] 针对性测试、全量测试、生产构建和隔离 app-server smoke 全部通过。
- [x] 真实浏览器复测消息保留、停止按钮、非运行态发送按钮和 820px 窄屏无横向溢出；截图保存至 `/volume2/SSD/codex/Temp/side-chat-fix-browser-20260822-0106.png`。

## 状态总览

- 当前状态：Code complete、Tests pass、Smoke passed；本轮真实浏览器复测通过。此前 Playwright MCP 导航超时，改用同一 Chrome 的轻量 CDP 完成验证，不标记 Release ready。
- 已确认：官方桌面 App 支持多个侧聊标签；改动前的 Web 实现是固定 `side-chat` 单例。

## 决策日志

- 2026-08-21：以官方桌面 App 截图为多标签 UI 基准；TUI 的单侧聊限制不适用于此 Web 标签容器。
- 2026-08-21：继续复用现有 `thread/fork`、`thread/inject_items`、`turn/interrupt` 和 `thread/unsubscribe`，不引入新协议或依赖。
- 2026-08-21：标签 ID 使用应用生命周期内递增序号；首个显示基础名称，后续追加序号。侧聊状态和异步操作号均按标签 ID 隔离。

## Smoke Ledger

- 通过：`npm run test`，197 个测试文件、964 条测试通过；普通主聊天 reducer、selector 和 UI 接线回归保持通过。
- 通过：`npm run test:smoke`，隔离环境完成 bridge、模型和账号状态普通路径，`accountSource=app-server.account/read`。
- 通过：`npm run test:smoke:interrupt`，真实 app-server Turn 最终状态为 `interrupted`。
- 通过：状态反例验证 3 个侧聊标签共存，关闭中间标签后首尾标签仍保留；序列化结果不包含任何侧聊。
- 通过：每个 `SideChatPanel` 按自己的标签 ID 选择子线程、Turn、审批、设置和 token usage；主聊天仍使用原线程 selector。
- 未完成：浏览器视觉走查。开发服务在 `3001` 启动且 HTTP 返回登录重定向；Playwright MCP 无法访问宿主开发端口并连续超时，按规则停止，测试页与服务均已关闭。
