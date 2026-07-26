# app-server Git 历史与只读版本预览技术交接

关联计划：[app-server Git 历史与只读版本预览实施计划](../exec-plans/completed/2026-07-26-app-server-git-history.md)

## 结论

右侧 Git 固定标签新增“更改 / 历史”分段视图。历史页通过当前会话的 `app-server.command/exec` 分页读取提交，按需展开提交文件；点击文件打开该提交的只读 unified diff，眼睛图标打开该提交中的完整只读文本版本。

## 数据流

```text
GitPanel
  -> useGitWorkspace(cwd)
  -> app-server.command/exec (readOnly / networkAccess:false)
       -> git rev-parse --verify HEAD
       -> git log (31 条判断下一页)
       -> git diff-tree --root --first-parent (展开时)
       -> git show --root -- <literal paths> (历史 diff)
       -> git cat-file -s + git show <sha>:<path> (完整版本)
  -> GitHistorySection
       -> inline-diff 动态标签
       -> inline-code 只读动态标签
```

## 安全与语义边界

- SHA 必须是 40 位十六进制值；UI 只把历史查询返回的 SHA 传给后续命令。
- 所有 Git 调用使用 argv 数组、read-only sandbox、关闭网络、5 秒超时和 1 MiB 输出上限。
- diff 路径使用 `--literal-pathspecs`；重命名和复制同时保留新旧路径。
- 完整版本不是当前工作区文件，不走 `file` preview，也没有编辑、保存或自动保存入口。
- 删除文件读取 `<sha>^1:<path>`；普通、增加、重命名和复制文件读取 `<sha>:<path>`。
- 完整文件先通过 `git cat-file -s` 检查大小，超过 1 MiB 或包含 NUL 时拒绝文本预览。
- 空仓库先验证 `HEAD`，历史页显示空状态而不是 Git fatal 错误。

## UI 范围

- “更改”视图保持现有状态、diff 和选择文件提交能力。
- “历史”视图每页 30 条，显示短 SHA、提交信息、作者和时间。
- 展开提交后显示修改/新增/删除/重命名/复制状态；重命名显示来源路径。
- 点击文件名打开 diff；眼睛图标打开完整版本；两者动态标签标题明确区分。
- 从历史文件动态标签返回 Git 时保留最后选择的“历史”子视图。
- 延后：提交图谱、搜索、分支筛选、checkout、reset、revert、cherry-pick 和冲突处理。

## 验证

- targeted Vitest：2 个测试文件、14 项测试通过。
- 完整测试：135 个测试文件、625 项测试通过。
- 真实 Chrome/CDP：普通更改路径不预取历史；历史提交可展开；diff 与完整版本可打开且完整版本显示“只读”。
- 回归路径：单文件提交、剩余文件保留、文件变更汇总 `2 → 1 → 0`、Git 不可用回退均通过。
- 截图：`/volume2/SSD/codex/Temp/04-git-history.png`、`05-history-diff.png`、`06-history-file.png`。

## 剩余边界

生产构建未运行，因此当前状态不是 Release ready。历史 diff 受 app-server 1 MiB 输出上限约束；完整历史文件在读取前有明确大小检查。计划已归档到 `completed`。
