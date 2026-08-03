# 左侧栏项目与会话置顶实施计划

> 技术交接：[左侧栏项目与会话置顶技术交接](../../handover/2026-08-03-sidebar-pinning.md)

> **执行要求：** 当前环境未提供 `executing-plans` 子技能，因此在本任务内按下列检查项顺序执行并逐项验证。步骤使用 checkbox 跟踪。

**目标：** 对齐官方 Codex App，为左侧栏增加项目级和会话级置顶，并在没有有效置顶内容时隐藏整个“置顶”分组。

**架构：** app-server Thread 继续作为会话内容、项目目录与运行状态的事实源；置顶仅是 Web UI 排序偏好，复用现有 `localStorage` 模式。纯函数负责把项目组分割为置顶会话、置顶项目和普通项目，React 组件只负责交互与渲染。

**技术栈：** React 19、TypeScript、Next.js、Vitest、Playwright smoke、浏览器 CDP。

## 全局约束

- 不修改 `codex app-server` 协议、Thread 数据或数据库 schema。
- 不引入第三方依赖。
- 项目置顶后整个项目只在“置顶”分组出现；会话置顶后该会话只在“置顶”分组出现。
- 项目已置顶时，其内部置顶会话不得重复显示为独立置顶项。
- 没有匹配当前 app-server Thread/当前项目的有效置顶项时，不显示“置顶”标题和折叠图标。
- “置顶”和“项目”分组分别控制展开状态；项目内部继续复用现有折叠状态。
- 测试与开发默认使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 必须在真实浏览器中验证并保存截图，同时记录至少一个无置顶内容的反例。

---

## 状态总览

- [x] 任务 1：置顶偏好与分组逻辑
- [x] 任务 2：项目、会话操作入口与侧栏渲染
- [x] 任务 3：完整验证、浏览器截图与文档收口

## 任务 1：置顶偏好与分组逻辑

**文件：**

- 修改：`src/components/layout/chat-list-utils.ts`
- 测试：`src/codex-web/tests/chat-list-utils.test.ts`

**接口：**

- 产出：`loadPinnedProjects()`、`savePinnedProjects()`、`loadPinnedSessions()`、`savePinnedSessions()`。
- 产出：`partitionPinnedSidebar(projectGroups, pinnedProjects, pinnedSessions)`，返回 `pinnedSessions`、`pinnedProjects`、`regularProjects`。

- [x] 编写失败测试：覆盖项目置顶、会话置顶、项目包含会话时去重、无有效置顶项、存储损坏回退。
- [x] 运行定向测试并确认新增 5 条断言在实现前失败，原有 5 条保持通过。
- [x] 实现最小存储和分组逻辑，不添加通用偏好抽象。
- [x] 再次运行定向测试并确认通过。

## 任务 2：项目、会话操作入口与侧栏渲染

**文件：**

- 修改：`src/components/layout/ChatListPanel.tsx`
- 修改：`src/components/layout/ProjectGroupHeader.tsx`
- 修改：`src/components/layout/SessionListItem.tsx`
- 修改：`src/i18n/en.ts`
- 修改：`src/i18n/zh.ts`
- 测试：必要时新增 `src/codex-web/tests/sidebar-pinning-wiring.test.ts`

**接口：**

- `ProjectGroupHeader` 接收 `isPinned` 与 `onTogglePin`，菜单显示“置顶项目/取消置顶项目”。
- `SessionListItem` 接收 `isPinned` 与 `onTogglePin`，菜单显示“置顶聊天/取消置顶聊天”；独立置顶会话悬停时显示取消置顶快捷按钮。
- `ChatListPanel` 持有两个持久化集合与独立的 `pinnedCollapsed` 状态。

- [x] 接入项目和会话置顶切换，写入对应本地偏好。
- [x] 在普通“项目”分组之前渲染条件式“置顶”分组。
- [x] 复用现有项目头、会话行、动画和项目内部折叠状态。
- [x] 确保普通项目截断只统计普通项目，置顶项目与会话不重复。
- [x] 增加中英文文案和最小接线测试。

## 任务 3：验证与收口

**文件：**

- 创建：`docs/handover/2026-08-03-sidebar-pinning.md`
- 更新：`docs/exec-plans/active/2026-08-03-sidebar-pinning.md`
- 完成后移动：`docs/exec-plans/active/2026-08-03-sidebar-pinning.md` → `docs/exec-plans/completed/2026-08-03-sidebar-pinning.md`

- [x] 运行定向 Vitest，2 个测试文件、13 条测试通过。
- [x] 运行 `npm run test`，退出码 0。
- [x] 运行 `npm run build`，生产构建通过。
- [x] 运行 `npm run test:smoke`，bridge smoke 通过。
- [x] 启动隔离开发服务，通过真实浏览器验证无置顶、会话置顶、项目置顶、折叠与取消置顶。
- [x] 将浏览器截图保存在 `/volume2/SSD/codex/Temp/sidebar-pinning-2026-08-03/` 并记录路径。
- [x] 检查 console，无本功能引入的新错误。
- [x] 创建交接文档，更新本计划 checklist、决策日志和 Smoke Ledger，并移动到 completed。

## 决策日志

- 2026-08-03：app-server 当前没有项目/会话置顶协议，置顶定义为浏览器 UI 偏好；不伪造 app-server 字段。
- 2026-08-03：置顶项目从普通项目列表移除；单独置顶会话从所属普通项目中移除，避免重复内容。
- 2026-08-03：项目置顶覆盖会话置顶的显示层级，但保留会话置顶偏好，以便取消项目置顶后恢复独立置顶会话。
- 2026-08-03：真实浏览器使用已加载隔离 app-server Thread 的现有标签页验证，未注入或伪造会话数据。

## Smoke Ledger

| 场景 | 预期 | 结果 |
| --- | --- | --- |
| 无有效置顶内容 | 不显示“置顶”标题和图标 | 通过；`04-unpinned-again.png`，标题数量为 0 |
| 置顶单个会话 | 会话独立显示且原项目内不重复 | 通过；`01-session-pinned.png`，目标 href 仅出现 1 次 |
| 置顶整个项目 | 项目及会话进入置顶区且普通区不重复 | 通过；`03-project-pinned.png`，普通项目区只保留“新建项目” |
| 折叠置顶区 | 仅保留“置顶”标题和右向箭头 | 通过；`02-pinned-collapsed.png`，`aria-expanded=false` |
| 取消置顶 | 内容回到普通项目区；最后一项取消后标题消失 | 通过；两个本地集合均为空，console 错误为 0 |

## 完成状态

- `Code complete`
- `Tests pass`
- `Smoke passed`
- `Review passed`：已完成差异检查、真实浏览器截图和 console 检查。
