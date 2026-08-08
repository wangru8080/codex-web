# 同项目会话切换保留文件树执行计划

> **执行要求：** 按任务逐项实现和验证，使用复选框追踪状态。

**目标：** 同一项目下切换不同会话时保留右侧文件树内容和展开状态，仅在项目目录真正变化、用户手动刷新或收到文件变更通知时重新读取。

**架构：** `AppShell` 继续持有跨路由存活的 `workingDirectory`，会话详情页加载新会话时不再用空目录重置它。`FileTree` 现有的 `workingDirectory` 依赖负责跨项目刷新，现有手动刷新和 `fs/changed` watcher 负责项目内容变化，无需新增缓存层。

**技术栈：** Next.js 16、React 19、TypeScript、Vitest、Playwright/CDP。

## 全局约束

- 文件系统事实源保持为 Codex app-server `fs/readDirectory` 和 `fs/changed`。
- 不引入依赖，不改变预览、文件创建和附件行为。
- 浏览器验证使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 正例验证同项目切换不新增根目录读取；反例验证跨项目或手动刷新仍新增读取。

---

### 任务 1：锁定会话切换语义

**文件：**

- 修改：`src/codex-web/tests/app-server-file-tree-wiring.test.ts`
- 修改：`src/app/chat/[id]/page.tsx`

**接口：**

- 输入：`AppShell.PanelContext.setWorkingDirectory(path)`。
- 输出：会话加载只提交真实 cwd，不再提交过渡空值或额外刷新事件。

- [x] 添加失败测试，断言会话详情初始化不清空 cwd、不额外广播文件树刷新。
- [x] 运行定向测试并确认修复前失败。
- [x] 删除会话切换时的 `setWorkingDirectory('')` 和 `applySession` 中的 `refresh-file-tree` 广播。
- [x] 再次运行定向测试并确认通过。

### 任务 2：验证正例和反例

**文件：**

- 修改：`docs/exec-plans/active/2026-08-08-project-file-tree-session-persistence.md`

**接口：**

- 输入：真实浏览器中的同项目会话、不同项目会话和刷新按钮。
- 输出：浏览器观察记录与 `fs/readDirectory` 调用计数。

- [x] 运行 `npm run test` 和 `npm run build`。
- [x] 使用隔离 `CODEX_HOME` 启动开发服务。
- [x] 在真实浏览器中打开文件树并展开目录。
- [x] 切换同项目会话，确认树不闪空、展开状态保留、根目录读取计数不增加。
- [x] 切换不同项目或点击刷新，确认根目录读取计数增加且树内容更新。
- [x] 更新本计划状态和 Smoke Ledger。

## Smoke Ledger

| 场景 | 预期 | 结果 |
| --- | --- | --- |
| 同项目切换会话 | 文件树不重新读取，展开状态保留 | 通过：从 `019fe09e-...` 切换到 `019fd64f-...`，`docs` 的 `aria-expanded` 保持 `true`，新增 `fs/readDirectory` 0 次 |
| 不同项目切换会话 | 新项目根目录重新读取 | 通过：切换到 `/volume2/SSD/codex/Chat` 后新增根目录读取 1 次，文件树显示 `data`、`output` 和 `AGENTS.md` |
| 手动刷新 | 当前项目根目录重新读取 | 通过：点击“刷新”后新增 `/home/rrssnas/code/codex-web` 根目录读取 1 次 |

## 验证状态

- `Code complete`：会话切换不再提交过渡空 cwd 或重复刷新事件。
- `Tests pass`：`npm run test` 通过，179 个测试文件、859 项测试。
- `Smoke passed`：真实浏览器正例和反例均通过。
- `Review passed`：生产构建完成，改动仅涉及会话 cwd 接线、回归测试和本计划。
- 浏览器控制台仍有既存 `/api/settings/workspace` 404；与文件树改动无关，本轮未处理。
