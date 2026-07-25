# 文件变更 Git 生命周期技术交接

关联计划：[文件变更 Git 生命周期实施计划](../exec-plans/completed/2026-07-25-turn-file-changes-git-lifecycle.md)

## 结论

输入框上方的文件变更汇总现在同时遵循 Turn 事实和 Git 提交生命周期：未提交时显示，部分提交后只保留相关未提交文件，全部提交后自动隐藏。非 Git 工作区或 Git 查询失败时仍展示 app-server 原始摘要。

## 数据流

```text
item/fileChange/patchUpdated
  -> deriveTurnFileChangeSummary
  -> useTurnFileChangeSummary
       -> app-server.command/exec: git rev-parse
       -> app-server.command/exec: git status --porcelain=v1 -z
  -> filterTurnFileChangeSummaryByGitStatus
  -> MessageInput / ComposerFileChanges
```

- 文件、增删行与 diff 来源：`app-server.item/fileChange/patchUpdated`。
- 提交生命周期来源：`app-server.command/exec:git-status`。
- Git 只过滤路径，不重写 Codex 产生的 diff。
- 查询运行在 app-server 所在 runtime 和会话 cwd；未来 SSH 连接不会读取浏览器机器的仓库。

## 行为

- 首次出现文件变更时立即查询 Git。
- 页面监听 `git-refresh`，Git UI 或其他入口提交后可立即刷新。
- 每 5 秒轮询一次，覆盖外部终端提交。
- 部分提交重新计算文件数和增删行。
- 全部相关路径 clean 时返回 `null`，汇总条退出。
- `git` 不存在、cwd 非仓库、命令超时、连接失败或非零 exit code 时回退原摘要。
- `--literal-pathspecs`、argv 数组、只读 sandbox、禁用网络、5 秒超时和 256 KiB 输出上限共同约束查询。

## 验证

- targeted Vitest：3 个文件、12 项测试通过。
- `npm run test`：133 个测试文件、611 项测试通过。
- `npm run test:smoke:user-input`：普通路径隐藏；两文件未提交显示；部分提交剩一文件；全部提交隐藏；Git 不可用回退；右侧 diff 可见。
- 真实 app-server POC：`codex-cli 0.145.0`、隔离 `CODEX_HOME`、只读 `command/exec` 成功执行 `git rev-parse --show-toplevel`。
- 开发服务：隔离 app-server 与页面 shell 正常启动，无 runtime exception；`/chat` 404 是既有路由行为。

## 边界

本功能没有修复旧 `/api/git/status`、`/api/git/commit` 或 Git 面板。它只接入文件变更汇总所需的只读 Git 生命周期；提交动作仍可来自 Codex、外部终端或后续 app-server Git UI。

生产构建本轮未执行，因此状态不是 Release ready。
