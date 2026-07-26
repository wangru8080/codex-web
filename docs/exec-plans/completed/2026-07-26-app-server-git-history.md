# app-server Git 历史与只读版本预览实施计划

> **执行要求：** 在当前会话内逐项实现并更新 checklist；所有 Git 数据只能来自当前 runtime 的 `app-server.command/exec`。

技术交接：[app-server Git 历史与只读版本预览技术交接](../../handover/2026-07-26-app-server-git-history.md)

**目标：** 在右侧 Git 面板增加历史提交列表，展示每次提交涉及的文件，并允许用户查看只读 diff 和该提交中的完整文件版本。

**架构：** 扩展现有 `git-workspace` 纯解析层和 `useGitWorkspace` app-server 命令层；Git 面板用“更改 / 历史”分段标签承载两个视图。历史 diff 继续使用 `inline-diff`，完整历史文件新增 `inline-code` 只读预览来源，避免读取或编辑当前工作区文件。

**技术栈：** TypeScript、React、Codex app-server `command/exec`、Git NUL 分隔输出、Vitest、真实 Chrome/CDP smoke。

## 全局约束

- 历史数据必须来自当前会话 app-server，禁止调用 `/api/git/*` 或浏览器机器上的 Git service。
- 所有命令使用 argv 数组、read-only sandbox、关闭网络和输出上限。
- commit SHA 只接受 40 位十六进制值；文件路径来自 Git 输出并使用 literal pathspec。
- 历史每页 30 条；提交文件按需加载，不在列表阶段制造 N+1 请求。
- 点击历史文件默认打开相对父提交的只读 diff；“查看版本”打开该提交中的完整只读文本。
- 删除文件读取父提交版本；二进制文件和空 diff 显示真实错误，空文本文件仍允许只读打开。
- 第一版不实现 checkout、reset、revert、提交图谱、历史搜索、分支筛选和写操作。
- 默认测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### 任务 1：历史提交与文件解析

**文件：**

- 修改：`src/types/index.ts`
- 修改：`src/codex-web/git-workspace.ts`
- 修改：`src/codex-web/git-workspace.test.ts`

**接口：**

- `parseGitHistory(stdout): GitHistoryEntry[]`
- `parseGitHistoryFiles(stdout): GitHistoryFile[]`
- `gitHistoryPathspecs(file): string[]`
- `assertGitCommitSha(sha): string`

- [x] 写失败测试，覆盖提交元数据、修改/新增/删除/重命名/复制、空格路径和非法 SHA。
- [x] 实现最小 NUL/记录分隔解析器与 literal pathspec 生成。
- [x] 运行 targeted Vitest：1 个测试文件、10 项测试通过。

### 任务 2：app-server 只读命令与历史 UI

**文件：**

- 修改：`src/hooks/useGitWorkspace.ts`
- 修改：`src/components/git/GitPanel.tsx`
- 修改：`src/components/git/GitHistorySection.tsx`
- 修改：`src/i18n/zh.ts`
- 修改：`src/i18n/en.ts`

**接口：**

- `readHistory(offset, limit)` 执行 `git log`，返回 `entries` 与 `hasMore`。
- `readHistoryFiles(sha)` 执行 `git diff-tree --root --first-parent`。
- `readHistoricalDiff(sha, file)` 执行只读 `git show`。
- `readHistoricalFile(sha, file)` 执行 `git show <sha>:<path>`；删除文件改读 `<sha>^:<path>`。

- [x] Hook 使用固定 argv、read-only sandbox、关闭网络和 5 秒超时。
- [x] Git 面板增加“更改 / 历史”分段标签，保留现有提交能力。
- [x] 历史列表分页加载；提交展开时才加载文件，并显示 loading/error/empty 状态。
- [x] 文件行显示状态和重命名来源；点击打开 diff，独立图标打开完整历史版本。
- [x] `git-refresh` 时刷新已挂载的历史列表。

### 任务 3：完整历史版本只读预览与验收

**文件：**

- 修改：`src/hooks/usePanel.ts`
- 修改：`src/lib/workspace-sidebar.ts`
- 修改：`src/components/layout/WorkspaceSidebar/TabPanel.tsx`
- 修改：`src/components/layout/panels/PreviewPanel.tsx`
- 修改：`src/codex-web/git-panel-wiring.test.ts`
- 修改：`scripts/user-input-server-request-smoke.ts`
- 新增：`docs/handover/2026-07-26-app-server-git-history.md`

**接口：**

- `PreviewSource` 新增 `{ kind: "inline-code"; text; language; virtualName }`。
- `PreviewPanel` 用现有 `SourceView` 渲染 inline code，不提供编辑或保存入口。

- [x] 工作区动态标签支持 `inline-code` 的持久化、去重、标题和恢复。
- [x] 接线测试断言历史命令全部走 app-server，且可见路径不含 `/api/git/*`。
- [x] smoke 反例同时断言“更改”不显示历史、“历史”可展开文件、点击文件打开只读 diff、查看版本打开只读源码。
- [x] 运行 targeted tests、`npm run test` 和真实 Chrome/CDP；目视检查桌面截图并停止测试服务。
- [x] 新增技术交接，更新状态总览、决策日志和 Smoke Ledger。
- [x] 移动计划到 `docs/exec-plans/completed/`。

## 状态总览

- 当前状态：已完成归档；Code complete / Tests pass / Smoke passed。
- 用户影响：Git 面板可切换历史视图，展开提交文件，并打开只读 diff 或完整历史版本。
- 剩余风险：未运行生产构建，因此不是 Release ready；提交图谱、历史搜索和 Git 写操作不在本阶段范围。

## 决策日志

- 2026-07-26：官方 TUI/app-server 没有专用 Git history method，沿用 `app-server.command/exec` 作为事实源。
- 2026-07-26：列表只加载提交元数据，展开时再读取文件，避免默认 N+1。
- 2026-07-26：历史版本使用 inline 内容而非 `file` source，避免误读或编辑当前工作区文件。
- 2026-07-26：完整文件先用 `git cat-file -s` 检查对象大小，超过 1 MiB 拒绝预览，避免静默截断。
- 2026-07-26：历史 diff 与完整版本使用不同动态标签标题，避免同时打开时混淆。
- 2026-07-26：运行期保留最后选择的“更改 / 历史”子视图，从历史文件标签返回 Git 时不跳回“更改”。

## Smoke Ledger

- 通过：普通“更改”路径不渲染或请求历史；点击“历史”后才读取提交列表。
- 通过：历史提交可展开 `src/history.ts`，点击文件打开只读 diff，查看版本图标打开带“只读”标识的源码。
- 通过：解析测试覆盖根提交所需的 `--root` 命令、重命名/复制双路径、删除文件和非法 SHA。
- 通过：原有文件变更与部分提交反例保持通过，提交后汇总仍按 `2 → 1 → 0` 退出。
- 通过：targeted 2 个测试文件、14 项测试；完整 135 个测试文件、625 项测试。
- 通过：真实 Chrome/CDP smoke 和三张 1600×1000 截图目视检查；测试服务已停止。
- 通过：从历史 diff 动态标签返回 Git 后仍保持“历史”视图，并可继续展开提交与查看完整版本。
