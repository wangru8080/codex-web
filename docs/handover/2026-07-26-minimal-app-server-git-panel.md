# 最小 app-server Git 面板技术交接

关联计划：[最小 app-server Git 面板实施计划](../exec-plans/completed/2026-07-26-minimal-app-server-git-panel.md)

## 结论

右侧 Git 固定标签已从失效的 `/api/git/*` REST 接线切换到当前 Codex app-server runtime。用户可以查看分支、工作区文件和增删行，点击文件打开 unified diff，勾选明确路径并提交；成功后 `git-refresh` 同步刷新 Git 面板、顶部栏和输入框上方文件变更汇总。

## 数据流

```text
AppShell / GitPanel
  -> useGitWorkspace(cwd)
  -> app-server.command/exec
       -> git rev-parse
       -> git status --porcelain=v1 -z --branch
       -> git diff --numstat / --no-index
  -> parseGitWorkspaceStatus / applyGitNumstat
  -> GitStatusSection
       -> inline-diff PreviewPanel
       -> CommitDialog
       -> git add selected paths
       -> git commit --only selected paths
       -> git-refresh
```

## 安全边界

- 所有命令使用 argv 数组和 `--literal-pathspecs`，提交信息不会进入 shell。
- 读操作使用 read-only sandbox、关闭网络、5 秒超时和 1 MiB 输出上限。
- legacy workspace-write 会保护 `.git`；提交前读取 `--show-toplevel`、`--absolute-git-dir`、`--git-common-dir`，将这些真实路径显式加入 writable roots。
- 提交 sandbox 保持 `networkAccess:false`，并设置 `GIT_TERMINAL_PROMPT=0`，不会等待交互凭据。
- `git add` 和 `git commit --only` 只接收用户勾选路径；rename 同时包含新旧路径，其他 staged/unstaged/untracked 文件不进入提交。
- app-server 在 SSH Remote 时返回远端 cwd 和 Git 目录，因此不会操作浏览器机器的仓库。

## UI 范围

- 保留：分支、变更文件、staged 标识、增删行、全选/逐项选择、diff、提交信息和提交反馈。
- 状态：loading、非 Git、clean、dirty、error、committing。
- 延后：push/pull/fetch、checkout、分支管理、历史、worktree、stash、discard/reset、amend 和冲突处理。
- 旧 Git 组件文件暂时保留但不再从可见 Git 面板加载；本轮不扩大范围删除历史代码。

## 验证

- targeted Vitest：5 个相关测试文件、23 项测试通过。
- 完整测试：135 个测试文件、621 项测试通过。
- 真实 Chrome/CDP：两文件 `+3/-1`、点击 diff、单文件提交、剩余文件保留、汇总条 `2 → 1 → 0` 和 Git 不可用回退均通过。
- 真实 app-server + 真实隔离 Git 仓库：提交 `e2b69fe` 只包含 `panel-selected-20260726.txt`，未选文件保持 `?? panel-unselected-20260726.txt`。

## 剩余边界

未跟踪文件不出现在普通 `git diff --numstat HEAD` 中，面板最多额外探测 20 个未跟踪文件；超过 20 个时文件仍完整展示，但总增删行不包含超出部分。生产构建未运行，因此当前状态不是 Release ready。
