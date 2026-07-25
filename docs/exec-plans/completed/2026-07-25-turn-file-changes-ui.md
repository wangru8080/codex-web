# Turn 文件变更 UI 实施计划

技术交接：[Turn 文件变更 UI 技术交接](../../handover/2026-07-25-turn-file-changes-ui.md)

> **执行方式：** 当前会话内逐项实现并在每个阶段完成后更新本清单。

**目标：** 使用 Codex app-server 的真实文件变更事件，在输入框上方展示本轮文件数与增删行统计，并允许用户从逐文件列表打开右侧 diff。

**架构：** `turn/diff/updated` 与 `item/fileChange/patchUpdated` 进入 Turn reducer；纯函数从逐文件 unified diff 计算汇总；ChatView 将当前 Turn 的摘要传给 MessageInput；点击文件复用现有 `inline-diff -> PreviewPanel -> DiffViewer`。Git 面板保持独立，不参与本轮变更事实构建。

**技术栈：** TypeScript、React、Vitest、现有 Workspace Sidebar / PreviewPanel。

## 全局约束

- 用户可见统计只能来自 `app-server.turn/diff/updated` 或 `app-server.item/fileChange/patchUpdated`。
- 不安装第三方依赖，不修改官方 `~/code/codex`。
- 不以 Git 状态代替本轮 Codex 文件变更；非 Git 和 SSH Remote 会话必须保持可用。
- 所有新增文案进入中英文 i18n。
- 默认测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### 阶段 1：状态与统计

**文件：**

- 修改：`src/codex-web/turn-reducer.ts`
- 新增：`src/codex-web/file-change-summary.ts`
- 测试：`src/codex-web/turn-reducer.test.ts`
- 测试：`src/codex-web/file-change-summary.test.ts`

- [x] reducer 保存 `turn/diff/updated` 的聚合 diff。
- [x] 从最新 `filePatchChanges`/完成 item 收集逐文件变更并去重。
- [x] 统计 unified diff 的新增、删除行，排除文件头。
- [x] 覆盖 add/update/delete、空 diff 和重复路径反例。

### 阶段 2：输入框汇总和右侧 diff

**文件：**

- 新增：`src/components/chat/ComposerFileChanges.tsx`
- 修改：`src/components/chat/MessageInput.tsx`
- 修改：`src/components/chat/ChatView.tsx`
- 修改：`src/i18n/zh.ts`
- 修改：`src/i18n/en.ts`

- [x] 非空变更在输入框上方展示“文件数、+新增、-删除”。
- [x] 点击汇总展开逐文件列表，各行展示路径和独立统计。
- [x] 点击文件调用 `setPreviewSource({ kind: 'inline-diff' })` 打开右侧标签。
- [x] 空 diff、普通消息不展示汇总，失败文件变更不计入。
- [x] 控件具备按钮语义、键盘操作、可访问名称和窄屏约束。

### 阶段 3：验证和交接

**文件：**

- 测试：`src/codex-web/turn-file-changes-ui-wiring.test.ts`
- 新增：`docs/handover/2026-07-25-turn-file-changes-ui.md`

- [x] 运行 targeted Vitest，确认统计、reducer 和 UI 接线测试通过。
- [x] 运行 `npm run test` 的等价完整验证：typecheck 与全量 Vitest。
- [ ] 运行 `npm run build`。当前环境在生成 `BUILD_ID` 前终止，未通过。
- [x] 运行 `npm run test:smoke`，记录普通消息与文件变更触发路径的差异。
- [x] 启动开发应用，检查桌面/移动布局、点击交互和 console。
- [x] 更新本计划的状态总览、决策日志和 Smoke Ledger。

## 状态总览

- 当前状态：Code complete / Tests pass / Smoke passed
- 用户影响：本轮有真实文件变更时，输入框上方显示汇总并可打开右侧 diff。
- 剩余风险：生产构建在当前执行环境未完成，因此不是 Release ready。

## 决策日志

- 2026-07-25：文件变更事实源选择 app-server，而不是 Git；原因是需要保持 Turn 归属、非 Git 和 SSH Remote 语义。
- 2026-07-25：首版复用 unified diff 视图，不实现全文件逐行 patch 对齐器；现有视图能准确展示修改块及上下文，避免重复构建编辑器级 diff 引擎。

## Smoke Ledger

- 通过：普通消息且没有文件变更时，输入框上方不显示汇总。
- 通过：推送两项文件变更后显示 `2 个文件已更改 +3/-1`。
- 通过：逐文件显示 `src/app.ts +2/-1` 与 `src/new.ts +1/-0`，数字随真实 diff 变化。
- 通过：点击 `src/app.ts` 后，右侧 `DiffViewer` 显示 `+const nextValue = 2;`。
- 通过：普通路径桌面和移动视口没有横向溢出，console 无错误。
