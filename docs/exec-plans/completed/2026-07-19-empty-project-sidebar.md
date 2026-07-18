# 空项目侧栏展示修复实施计划

> **执行要求：** 原建议使用 `executing-plans` 子技能逐项实施；当前环境未提供该子技能，因此在本任务内按下列检查项顺序执行并逐项验证。

**目标：** 新选择的项目目录即使还没有创建 app-server Thread，也立即显示在左侧“项目”列表中。

**架构：** 继续以 app-server Thread 作为历史会话事实源，同时把当前 `PanelContext.workingDirectory` 作为“正在使用的项目”事实源。项目分组函数只为这个真实当前目录补充一个空会话组，不引入项目数据库、占位会话或新的持久化状态。

**技术栈：** React、TypeScript、Vitest、Next.js、Playwright/CDP。

## 全局约束

- 不改变 CodexWeb 既有侧栏布局、样式、顶部标题和交互结构。
- 不伪造 app-server Thread；空项目组的 `sessions` 必须保持为空。
- 开发和测试固定使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 必须验证正例与反例：空项目显示、已有项目不重复、无当前目录时不生成项目。
- 不引入第三方依赖。

---

### 任务 1：为项目分组补充当前目录语义

**文件：**

- 修改：`src/components/layout/chat-list-utils.ts`
- 修改：`src/components/layout/ChatListPanel.tsx`
- 测试：`src/codex-web/chat-list-utils.test.ts`

**接口：**

- 输入：`groupSessionsByProject(sessions: ChatSession[], activeWorkingDirectory?: string)`。
- 输出：`ProjectGroup[]`；当前目录没有会话时包含一个 `sessions: []` 的项目组，当前目录已有会话时不重复。

- [x] **步骤 1：编写失败测试**

  新增三个测试：空项目优先显示、已有项目不重复、无当前目录不补组。

- [x] **步骤 2：验证测试在修复前失败**

  运行：

  ```bash
  npm exec vitest run -- src/codex-web/chat-list-utils.test.ts
  ```

  预期：空项目测试失败，证明测试能复现问题。

- [x] **步骤 3：实现最小修复**

  在 `groupSessionsByProject` 中仅补充非空的当前目录，并让当前目录在排序时优先；`ChatListPanel` 把 `workingDirectory` 传入该函数。

- [x] **步骤 4：运行定向与完整测试**

  运行：

  ```bash
  npm exec vitest run -- src/codex-web/chat-list-utils.test.ts
  npm run test
  ```

  预期：新增测试及完整测试全部通过。

- [x] **步骤 5：真实浏览器验证**

  使用隔离开发服务和 `http://192.168.3.12:45737` 浏览器 CDP，验证当前空项目显示在左侧；已有会话项目不重复且原有列表样式不变。

- [x] **步骤 6：完成计划归档**

  更新本计划的检查项和验证记录，然后移动到 `docs/exec-plans/completed/2026-07-19-empty-project-sidebar.md`。

## 验证记录

- 定向测试：修复前 3 条测试中 1 条按预期失败，缺失项目为 `/repo/Chat`；修复后 3 条全部通过。
- 完整测试：`npm run test` 通过，81 个测试文件、382 条测试全部通过。
- 浏览器正例：当前目录 `/home/rrssnas/code/codex/web/src/components/layout` 无 Thread 时，左侧出现 `layout` 且只出现 1 次。
- 浏览器反例：切换到已有项目 `/home/rrssnas/code/codex/web` 后，`web` 只出现 1 次。
- 临时产物：2 个控制台日志和 3 个页面快照已移动到 `/volume2/SSD/Trash/2026-07-19-empty-project-sidebar/`。
