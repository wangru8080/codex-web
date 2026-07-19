# 新对话项目选择条实施计划

> **执行要求：** 原建议使用 `executing-plans` 子技能逐项实施；当前环境未提供该子技能，因此在本任务内按下列检查项顺序执行并逐项验证。

**目标：** 在新对话输入框上方明确显示当前项目，并允许通过同一弹窗切换已有项目、清除项目或新建项目。

**架构：** 新增独立的 `NewChatProjectSelector` 展示组件，项目路径由新聊天页现有 `workingDir` 状态提供。已有项目来自 app-server `thread/list` 的全部唯一 cwd，当前真实目录在尚无 Thread 时补入首位；所有选择仍复用现有 `FolderPicker` 和本地 `workingDirectory` 状态，不新增远程项目或项目数据库。

**技术栈：** React、TypeScript、Radix Popover、Vitest、Next.js、Playwright/CDP。

## 全局约束

- 选择条仅显示在新对话，不改变历史对话输入框、消息区和其他侧栏 UI。
- 当前项目胶囊点击与“选择项目”点击打开同一项目弹窗；悬停叉号仅清除当前项目。
- 项目来源必须是当前真实 `workingDir` 或 app-server Thread cwd，不生成虚假远程项目。
- 开发和测试固定使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 所有新增用户文案同时维护中英文翻译。

---

### 任务 1：新对话项目选择器

**文件：**

- 新增：`src/components/chat/NewChatProjectSelector.tsx`
- 修改：`src/app/chat/page.tsx`
- 修改：`src/i18n/en.ts`
- 修改：`src/i18n/zh.ts`
- 测试：`src/codex-web/new-chat-project-selector.test.tsx`

**接口：**

- `NewChatProjectSelector({ currentProject, projects, onSelectProject, onClearProject, onCreateProject })`。
- `currentProject` 为空时显示“选择项目”，非空时显示目录名；两种状态的主按钮都打开同一个弹窗。
- 弹窗搜索 `projects` 的目录名和完整路径；选择后调用 `onSelectProject(path)`。

- [x] **步骤 1：编写失败测试**

  渲染有项目和无项目两种状态，断言项目名、选择项目文案和清除按钮可访问名称存在。

- [x] **步骤 2：验证测试在实现前失败**

  运行 `npm exec vitest run -- src/codex-web/new-chat-project-selector.test.tsx`，预期因组件不存在而失败。

- [x] **步骤 3：实现组件和页面接线**

  新对话页传入全部唯一 Thread cwd，并把当前 `workingDir` 放在首位；清除时移除 `codepilot:last-working-directory`，新建项目复用 `handleSelectFolder`。当前项目胶囊和空态入口均打开同一个弹窗。

- [x] **步骤 4：运行定向与完整测试**

  运行定向测试和 `npm run test`，预期全部通过。

- [x] **步骤 5：真实浏览器验证**

  使用 `192.168.3.12` CDP 验证项目胶囊、叉号清除、选择弹窗、搜索、已有项目切换、新建项目文件夹选择，以及历史对话反例和移动视口布局。

- [x] **步骤 6：归档计划**

  记录测试与浏览器结果，把本计划移动到 `docs/exec-plans/completed/2026-07-19-new-chat-project-selector.md`。

## 验证记录

- 定向测试：选择器测试 2 条通过；类型检查通过。
- 完整测试：`npm run test` 通过，82 个测试文件、384 条测试全部通过。
- 浏览器正例：桌面与移动视口均显示选择条；项目胶囊/选择项目入口打开同一弹窗，搜索 `web` 只保留 web，选择已有项目更新胶囊；“新建项目”打开“选择项目文件夹”对话框；悬停左侧图标切换为叉号；清除后回到“选择项目”。
- 浏览器反例：历史对话 `/chat/019f753f-3cfd-7061-8b02-2cc8c8e1bc58` 保留输入框但不显示新对话项目选择条；390px 移动视口无横向溢出。
- 临时产物：20 个浏览器快照/日志和 2 张视觉截图已移动到 `/volume2/SSD/Trash/2026-07-19-new-chat-project-selector/`。
