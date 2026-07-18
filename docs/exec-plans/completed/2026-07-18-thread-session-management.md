# 会话归档管理实施计划

> **执行要求：** 在当前会话内逐项实现并验证；未经用户要求不创建 Git 提交。

**目标：** 把会话重命名、归档、取消归档和归档管理全部接入 Codex app-server，并在设置中提供已归档任务管理页。

**架构：** `AppServerProvider` 提供带生成协议类型的 thread 管理 actions；左侧栏与顶部栏只消费 actions，不再请求旧会话 REST。归档设置页使用 `thread/list { archived: true }` 读取事实数据，在浏览器端完成搜索、项目筛选与分组，并通过 `thread/unarchive` 或经确认的 `thread/delete` 执行管理动作。

**技术栈：** React 19、Next.js 16、TypeScript、Vitest、Codex app-server JSON-RPC。

## 全局约束

- UI 行为以官方 `codex-rs/tui` 和 app-server 生成协议为语义基准，以 `/home/rrssnas/code/CodexWeb` 为 UI 基准。
- 不修改 `/home/rrssnas/code/CodexWeb`，不引入第三方依赖。
- 开发与测试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 所有用户可见会话数据来自 app-server；没有真实来源时显示空态或错误态。
- 不执行文件删除命令；验证期间不向真实 app-server 发送 `thread/delete`。
- 所有代码注释、文档和说明使用中文。

---

### 任务 1：app-server 会话管理 actions

**文件：**

- 修改：`src/codex-web/AppServerProvider.tsx`
- 新建：`src/codex-web/thread-session-management-wiring.test.ts`

**接口：**

- `listThreads(params: ThreadListParams): Promise<ThreadListResponse>`
- `setThreadName(params: ThreadSetNameParams): Promise<ThreadSetNameResponse>`
- `archiveThread(threadId: string): Promise<ThreadArchiveResponse>`
- `unarchiveThread(threadId: string): Promise<ThreadUnarchiveResponse>`
- `deleteThread(threadId: string): Promise<ThreadDeleteResponse>`

- [x] **步骤 1：添加失败的 provider 接线测试**
- [x] **步骤 2：实现最小 actions，并在影响活动列表的动作后刷新 `thread/list { archived: false }`**
- [x] **步骤 3：运行定向测试并确认通过**

### 任务 2：左侧栏和顶部栏改接

**文件：**

- 修改：`src/components/layout/ChatListPanel.tsx`
- 修改：`src/components/layout/SessionListItem.tsx`
- 修改：`src/components/layout/UnifiedTopBar.tsx`
- 修改：`src/i18n/en.ts`
- 修改：`src/i18n/zh.ts`

**接口：**

- 重命名消费 `setThreadName({ threadId, name })`。
- 单会话和项目会话移除消费 `archiveThread(threadId)`。
- app-server rollout 保留分屏只读限制，但开放重命名和归档管理。

- [x] **步骤 1：把现有“删除对话”文案与处理器纠正为“归档对话”**
- [x] **步骤 2：移除重命名和归档路径中的 `/api/chat/sessions/*` 请求**
- [x] **步骤 3：验证归档当前会话后返回 `/chat`，归档其他会话不改变路由**

### 任务 3：设置中的已归档任务 UI

**文件：**

- 新建：`src/app/settings/archived/page.tsx`
- 新建：`src/components/settings/ArchivedThreadsSection.tsx`
- 修改：`src/components/settings/nav-config.ts`
- 修改：`src/components/layout/SettingsSidebar.tsx`
- 修改：`src/app/settings/page.tsx`
- 修改：`src/i18n/en.ts`
- 修改：`src/i18n/zh.ts`

**接口：**

- 逐页调用 `listThreads({ archived: true, cursor, limit: 100, sortKey: "recency_at", sortDirection: "desc" })`。
- 搜索匹配 thread name、preview、cwd 和项目名；项目筛选来自实际归档 thread 的 cwd。
- 取消归档调用 `unarchiveThread`；单条和批量永久删除调用 `deleteThread`，执行前必须确认。

- [x] **步骤 1：增加设置导航分组和独立路由**
- [x] **步骤 2：实现加载、搜索、筛选、项目分组、空态与错误态**
- [x] **步骤 3：实现取消归档、单条删除、项目批量删除和全部删除确认流程**
- [x] **步骤 4：检查桌面与窄视口布局，保持现有设置外壳不变**

### 任务 4：验证与记录

**文件：**

- 更新并移动：`docs/exec-plans/active/2026-07-18-thread-session-management.md` -> `docs/exec-plans/completed/2026-07-18-thread-session-management.md`

- [x] **步骤 1：运行定向 Vitest**
- [x] **步骤 2：运行 `npm run test`**
- [x] **步骤 3：运行 `npm run build`**
- [x] **步骤 4：运行 `npm run test:smoke`**
- [x] **步骤 5：启动开发应用，检查设置导航、归档列表空态/数据态与浏览器 console**

## Smoke Ledger

| 场景 | 预期 | 结果 |
| --- | --- | --- |
| 重命名活动会话 | 只调用 `thread/name/set`，标题同步更新 | 定向接线测试通过；旧 PATCH 反例通过 |
| 归档活动会话 | 只调用 `thread/archive`，会话移出活动列表并返回 `/chat` | 定向接线测试与代码审查通过；未移动真实会话 |
| 归档页有数据 | 真实项目分组、数量、搜索和筛选正确 | 数据映射和接线测试通过；隔离环境当前无归档 thread，未取得数据态截图 |
| 取消归档 | 调用 `thread/unarchive`，条目移出归档页并回到活动列表 | 定向接线测试通过；未移动真实会话 |
| 无归档会话 | 显示空态，不显示假项目或假数量 | 桌面与 390px CDP 实测通过，console 无错误 |
| 永久删除 | 只有确认后才构造 `thread/delete`；不在真实环境执行 | 确认门控静态测试通过，未发送真实删除请求 |

## 状态总览

- 当前状态：Smoke passed
- 用户影响：会话重命名和归档不再依赖旧 REST；设置中可搜索、筛选、恢复和管理已归档任务。
- 验证：定向 Vitest 5 项通过；`npm run test` 通过；`npm run build` 通过并生成 `/settings/archived`；`npm run test:smoke` 通过并确认隔离 `CODEX_HOME`；桌面与 390px CDP 检查无 console 错误和布局溢出。
- 剩余风险：隔离环境没有归档 thread，真实数据行视觉由代码审查和接线测试覆盖，未取得数据态截图；永久删除未实际执行。构建保留既有 `next.config.mjs` NFT 动态追踪警告。

## 决策日志

- 2026-07-18：现有“删除对话”实际产品意图调整为归档，避免把普通会话管理误接硬删除。
- 2026-07-18：归档页独立读取 `archived: true`，不混入活动会话状态。
- 2026-07-18：截图中的永久删除操作映射到官方 `thread/delete`，但验证阶段不实际触发。
- 2026-07-18：首次完整测试在沙箱内因 WebSocket 用例绑定 `127.0.0.1` 遇到 EPERM；沙箱外复跑退出码为 0。
- 2026-07-18：首次构建在沙箱内因 Turbopack PostCSS worker 绑定端口遇到 EPERM；沙箱外复跑完整通过。
- 2026-07-18：CDP 的 `localhost:3107` 指向浏览器主机并拒绝连接，改用开发服务器公布的 `192.168.3.12:3107` 后验证通过。
