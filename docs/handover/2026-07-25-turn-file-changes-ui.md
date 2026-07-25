# Turn 文件变更 UI 技术交接

关联计划：[Turn 文件变更 UI 实施计划](../exec-plans/completed/2026-07-25-turn-file-changes-ui.md)

## 结论

输入框上方现在会根据当前 Codex app-server Turn 的真实 `fileChange` 数据展示文件数及增删行。点击汇总可展开逐文件列表，点击文件会通过既有 `inline-diff -> Workspace Sidebar -> DiffViewer` 链路在右侧显示具体修改。

## 数据流

```text
turn/diff/updated ───────────────> AppServerTurnState.turnDiff
item/fileChange/patchUpdated ───> AppServerTurnState.filePatchChanges
                                         |
                                         v
                         deriveTurnFileChangeSummary
                                         |
                                         v
ChatView -> MessageInput -> ComposerFileChanges -> inline-diff -> DiffViewer
```

- source breadcrumb：`app-server.item/fileChange/patchUpdated`
- 失败或拒绝的 `fileChange` 不参与统计。
- 同一路径多次变更保留最新 patch。
- `+++`、`---` 文件头不计入增删行。
- 没有成功文件变更时隐藏汇总，不展示零值占位。

## Git 边界

本功能没有接入 Git。原因是 Git 工作区状态无法表达“本轮 Codex 修改”的归属，且会破坏非 Git 工作区和 SSH Remote 语义。现有 Git 面板继续负责仓库状态、暂存、提交和推送；未来若需要入口联动，可以从汇总条跳转 Git 固定标签，但数据源仍须分开。

## 验证

- `npm run typecheck`：通过。
- 全量 Vitest：282 个测试文件、605 项测试全部通过。
- targeted Vitest：统计、reducer、UI wiring 共 21 项通过。
- `npm run test:smoke`：通过，使用隔离 `CODEX_HOME`。
- `npm run test:smoke:user-input`：通过；普通路径不显示汇总，触发路径显示 2 文件 `+3/-1`，点击 `src/app.ts` 后右侧 diff 可见。
- CDP 桌面/移动检查：普通路径无横向溢出，汇总隐藏，console 无错误。

验证产物：

- `/volume2/SSD/codex/Temp/codex-web-vitest-20260725-1445.json`
- `/volume2/SSD/codex/Temp/codex-web-file-changes-desktop-20260725.png`
- `/volume2/SSD/codex/Temp/codex-web-file-changes-mobile-20260725.png`

## 剩余风险

`npm run build` 在沙箱内因 Turbopack 绑定内部端口被拒绝；沙箱外 Turbopack 与单 worker Webpack 均在生成 `BUILD_ID` 前被执行环境终止，没有得到完整构建结果。因此当前状态不是 `Release ready`。
