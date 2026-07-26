# 最小 app-server Git 面板实施计划

> **执行要求：** 按本计划逐项实现并更新 checklist；提交操作需用户另行授权。

技术交接：[最小 app-server Git 面板技术交接](../../handover/2026-07-26-minimal-app-server-git-panel.md)

**目标：** 让右侧 Git 固定标签通过当前会话的 Codex app-server runtime 展示真实仓库状态、预览单文件 diff，并安全提交用户明确勾选的文件。

**架构：** 新增纯 TypeScript Git porcelain/diff 适配器；React Hook 只通过 `AppServerActions.execCommand` 读取状态和 diff。提交使用固定 argv、用户选择的 literal pathspec 与无网络 workspace-write sandbox，成功后广播 `git-refresh`，同步刷新 Git 面板和输入框上方文件变更汇总。

**技术栈：** TypeScript、React、Codex app-server `command/exec`、Git porcelain v1 `-z`、Vitest、CDP smoke。

## 全局约束

- Git 数据和命令必须来自当前连接的 app-server runtime，禁止调用旧 `/api/git/*`。
- 本地与 SSH Remote 使用同一实现；cwd 来自当前 Session。
- 不使用 shell 字符串；所有命令使用 argv 数组与 `--literal-pathspecs`。
- 只提交用户明确勾选的文件，不提交其他 staged、unstaged 或 untracked 文件。
- 读操作使用 read-only sandbox；提交操作使用关闭网络的 workspace-write sandbox。
- 第一版不实现 push、pull、fetch、分支操作、历史、worktree、stash、discard/reset、amend 或冲突处理。
- Git 不可用、非仓库和命令失败必须显示真实状态，不得伪造成功。
- 默认测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### 任务 1：Git 状态与路径适配器

**文件：**

- 新增：`src/codex-web/git-workspace.ts`
- 新增：`src/codex-web/git-workspace.test.ts`
- 修改：`src/types/index.ts`

**接口：**

- `parseGitWorkspaceStatus(stdout, repoRoot): GitStatus`
- `parseGitNumstat(stdout): Map<string, { additions: number; deletions: number }>`
- `gitCommitPathspecs(files): string[]`

- [x] 先写失败测试，覆盖 clean、modified、untracked、staged、rename、空格路径和 branch/upstream。
- [x] 实现最小 NUL 分隔 porcelain 解析，合并同一路径的 index/worktree 状态。
- [x] 解析 numstat 并给文件附加增删行；二进制文件使用 `null`。
- [x] rename 同时保留新旧路径，提交 pathspec 包含两者且去重。
- [x] 运行 targeted Vitest。

### 任务 2：真实 app-server 状态、diff 与提交 Hook

**文件：**

- 新增：`src/hooks/useGitWorkspace.ts`
- 修改：`src/codex-web/AppServerProvider.tsx`（仅复用现有 `execCommand`，若无需改动则保持不变）
- 测试：`src/codex-web/git-workspace.test.ts`

**接口：**

- `useGitWorkspace(cwd)` 返回 `status`、`loading`、`error`、`refresh`、`readDiff`、`commitSelected`。
- `readDiff(file)` 返回可交给 `PreviewSource.inline-diff` 的 unified diff。
- `commitSelected(files, message)` 仅提交所选路径，并返回最终 `CommandExecResponse`。

- [x] 状态刷新并发执行 `rev-parse`、porcelain status 和 numstat，读操作使用 read-only sandbox。
- [x] 监听 `git-refresh`、页面重新可见和 10 秒低频轮询，避免陈旧请求覆盖新 cwd。
- [x] 单文件 diff 使用 `git diff HEAD -- <path>`；未跟踪文件使用 Git no-index diff。
- [x] 提交先 `git add -A -- <paths>`，再用同一组 literal pathspec 执行 `git commit --only -m <message> -- <paths>`。
- [x] 提交使用无网络 workspace-write sandbox；真实 Git 目录作为 app-server writable roots，任一步非零退出都显示 stderr/stdout。
- [x] 成功后广播 `git-refresh`，验证文件变更汇总可复用现有监听退出。

### 任务 3：精简右侧 Git UI 与浏览器验收

**文件：**

- 修改：`src/components/git/GitPanel.tsx`
- 修改：`src/components/git/GitStatusSection.tsx`
- 修改：`src/components/git/CommitDialog.tsx`
- 修改：`src/i18n/zh.ts`
- 修改：`src/i18n/en.ts`
- 新增或修改：Git 面板 targeted UI 接线测试
- 修改：`scripts/user-input-server-request-smoke.ts` 或新增最小 Git panel smoke fixture
- 新增：`docs/handover/2026-07-26-minimal-app-server-git-panel.md`

**接口：**

- 面板显示 branch、变更文件、每文件/总计增删行、选中状态和刷新按钮。
- 点击文件调用 `readDiff` 并通过 `setPreviewSource({ kind: "inline-diff" })` 打开动态预览标签。
- 提交弹窗显示所选文件数，只接受提交信息，不提供 push。

- [x] 删除可见 Git 路径对 `/api/git/*`、branch/history/worktree/push UI 的调用。
- [x] 实现 loading、非仓库、clean、dirty、error、committing 状态。
- [x] 文件选择默认全不选；全选和逐项选择不改变 Git index，只有确认提交时执行 Git。
- [x] 点击文件显示真实 diff；diff 失败时显示 toast，不能打开空预览。
- [x] 提交按钮在无选择或空提交信息时禁用，成功后关闭弹窗并显示成功提示。
- [x] targeted 测试断言状态解析、部分选择、安全 argv、可见接线和 Git 不可用反例。
- [x] 运行 `npm run test`、`npm run test:smoke:user-input`，并通过真实浏览器/CDP 验证。
- [x] 更新状态总览、决策日志和 Smoke Ledger。
- [x] 移动计划到 `docs/exec-plans/completed/`。

## 状态总览

- 当前状态：已完成归档；Code complete / Tests pass / Smoke passed。
- 用户影响：右侧 Git 标签可查看真实状态和 diff，并只提交用户勾选的文件；提交后文件变更汇总同步刷新。
- 剩余风险：未运行生产构建，因此不是 Release ready；未跟踪文件增删统计最多探测 20 个，超出部分仍展示文件但不计入总行数。

## 决策日志

- 2026-07-26：只实现状态、diff 和提交选中文件；旧完整 Git 客户端能力延后。
- 2026-07-26：不复用本机 `src/lib/git/service.ts`，避免 SSH Remote 读取或修改错误机器。
- 2026-07-26：文件选择是 UI 临时状态，不提前改变 Git index，降低取消提交时的副作用。
- 2026-07-26：legacy workspace-write 默认保护 `.git`；提交前由 app-server 查询 repo root、absolute git dir 和 common dir，将三者显式加入 writable roots，网络保持关闭。
- 2026-07-26：常驻顶部栏使用轻量 Git 状态，不逐文件统计未跟踪文件；打开 Git 面板后才计算最多 20 个未跟踪文件的 numstat。

## Smoke Ledger

- 通过：可见 Git 路径不再调用 `/api/git/*`；非 Git 与 Git 错误状态由 app-server 结果驱动。
- 通过：真实 Chrome/CDP 显示两文件和 `+3/-1`，点击 `src/app.ts` 打开 unified diff。
- 通过：真实 Chrome/CDP 只选择 `src/app.ts` 提交后，面板仅保留 `src/new.ts`。
- 通过：同轮 smoke 验证输入框汇总 `2 → 1 → 0`，全部提交后退出，Git 不可用时回退。
- 通过：真实 app-server + 隔离真实仓库提交 `e2b69fe` 只包含所选文件，未选文件仍为 `??`。
- 通过：`npm run test` 在允许 localhost 的环境中为 135 个测试文件、621 项测试通过。
