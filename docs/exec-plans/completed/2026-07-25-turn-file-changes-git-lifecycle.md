# 文件变更 Git 生命周期实施计划

> **执行要求：** 按本计划逐项实现并更新 checklist；提交操作需用户另行授权。

技术交接：[文件变更 Git 生命周期技术交接](../../handover/2026-07-25-turn-file-changes-git-lifecycle.md)

**目标：** 本轮文件变更汇总只展示仍未提交的相关文件，全部提交后自动隐藏，同时保持非 Git 与 SSH runtime 语义正确。

**架构：** `item/fileChange/patchUpdated` 继续提供文件、增删行和 diff；新增 Hook 通过同一 app-server 连接调用只读 `command/exec`，用 Git porcelain 状态过滤摘要。Git 不可用、目录不是仓库或查询失败时回退到原始 app-server 摘要，避免丢失真实 Turn 信息。

**技术栈：** TypeScript、React、Codex app-server `command/exec`、Git porcelain v1、Vitest、CDP smoke。

## 全局约束

- 文件变更事实源仍为 `app-server.item/fileChange/patchUpdated`。
- Git 仅决定相关文件是否仍未提交，不替代 Turn diff。
- Git 命令必须由同一 app-server runtime 在会话 cwd 执行，不调用旧 `/api/git/*`。
- Git 查询使用只读 sandbox、关闭网络并设置超时和输出上限。
- 非 Git、Git 不可用和查询失败时保留原摘要。
- 不安装第三方依赖，不修改 `~/code/codex`。
- 默认测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### 任务 1：Git 状态过滤器

**文件：**

- 新增：`src/codex-web/turn-file-change-git.ts`
- 新增：`src/codex-web/turn-file-change-git.test.ts`

**接口：**

- 输入：`TurnFileChangeSummary`、Git porcelain v1 `-z` 输出、仓库根目录、会话 cwd。
- 输出：只包含仍未提交文件的 `TurnFileChangeSummary | null`。

- [x] 先写失败测试：空状态返回 `null`。
- [x] 覆盖部分提交后文件数和增删行重新计算。
- [x] 覆盖仓库子目录、绝对路径、未跟踪文件和 rename 双路径记录。
- [x] 实现最小 NUL 分隔 porcelain 解析和路径归一化。
- [x] 运行 targeted Vitest。

### 任务 2：app-server Git 查询与 Hook

**文件：**

- 修改：`src/codex-web/AppServerProvider.tsx`
- 新增：`src/hooks/useTurnFileChangeSummary.ts`
- 修改：`src/components/chat/ChatView.tsx`
- 修改：`src/codex-web/turn-file-changes-ui-wiring.test.ts`

**接口：**

- `AppServerActions.execCommand(params: CommandExecParams): Promise<CommandExecResponse>`。
- `useTurnFileChangeSummary(summary, cwd): TurnFileChangeSummary | null`。

- [x] 公开类型化 `command/exec` action。
- [x] Hook 并发读取 `git rev-parse --show-toplevel` 与相关路径的 porcelain 状态。
- [x] 使用 `{ type: "readOnly", networkAccess: false }`、5 秒超时和有限输出。
- [x] 首次加载、`git-refresh` 和低频轮询刷新；避免请求竞态覆盖新 Turn。
- [x] Git exit code 非零或响应异常时保留原摘要。
- [x] ChatView 用过滤后摘要驱动两个 MessageInput 分支。
- [x] 更新 wiring 测试并运行 targeted Vitest。

### 任务 3：浏览器反例与交接

**文件：**

- 修改：`scripts/user-input-server-request-smoke.ts`
- 新增：`docs/handover/2026-07-25-turn-file-changes-git-lifecycle.md`
- 更新并归档：本计划。

- [x] fake app-server 实现 `command/exec` 的 Git 响应状态切换。
- [x] smoke 断言普通路径隐藏、两文件未提交时 `+3/-1`。
- [x] smoke 触发部分提交后只剩一文件且数字变化。
- [x] smoke 触发全部提交后汇总自动隐藏。
- [x] smoke 断言 Git 查询失败时仍保留 app-server 摘要。
- [x] 运行 `npm run test` 和 `npm run test:smoke:user-input`。
- [x] 启动开发应用验证交互和 console。
- [x] 更新状态总览、决策日志和 Smoke Ledger。
- [x] 移动计划到 `docs/exec-plans/completed/`。

## 状态总览

- 当前状态：Code complete / Tests pass / Smoke passed。
- 用户影响：相关文件全部提交后汇总自动隐藏，部分提交后只显示剩余文件。
- 剩余风险：未运行生产构建，因此不是 Release ready；旧 `/api/git/*` 面板仍不在本功能范围。

## 决策日志

- 2026-07-25：采用 app-server Turn 数据与 Git 状态混合模型；Turn diff 保留归属，Git 只管理提交生命周期。
- 2026-07-25：不修复旧 `/api/git/*`；`command/exec` 能保持本地与 SSH 使用同一 runtime。
- 2026-07-25：Git 查询失败时回退原摘要，而不是隐藏；避免非 Git、旧 Git 或 runtime 故障造成事实丢失。
- 2026-07-25：使用 `--literal-pathspecs` 与 argv 数组，文件路径不会被解释成 shell 或 Git pathspec magic。

## Smoke Ledger

- 通过：普通消息无汇总。
- 通过：两项未提交文件显示 `2 个文件已更改 +3/-1`。
- 通过：部分提交后只剩 `src/new.ts`，显示 `1 个文件已更改 +1/-0`。
- 通过：全部提交后汇总隐藏。
- 通过：Git 查询返回 exit code 128 时恢复原始两文件摘要。
- 通过：真实 `codex-cli 0.145.0` app-server `command/exec` 在只读 sandbox 中返回仓库根目录。
