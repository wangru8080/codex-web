# 输入框任务进度 UI 技术交接

关联计划：[输入框任务进度 UI 实施计划](../exec-plans/completed/2026-07-26-composer-turn-task-progress.md)

## 结论

只有任务进度时，输入框上方使用默认展开的独立任务面板，标题显示完成数并可点击展开或收起。任务执行中出现文件变更时，UI 自动切换为文件在左、任务在右的双胶囊布局；文件变更消失而任务仍在继续时，恢复独立任务面板。已完成步骤显示勾选和删除线，进行中步骤显示旋转图标，待执行步骤显示空心圆。全部步骤完成，或 Turn 进入完成、失败、中断状态后，任务 UI 自动退出。

消息流中的 Updated Plan 不再渲染；执行任务只在输入框上方展示。文件列表与任务列表使用互斥展开状态，不会同时打开并发生遮挡。

## 数据流

```text
app-server.turn/plan/updated
            |
            v
AppServerTurnState.planBlocks
            |
            v
deriveComposerTurnPlan
            |
            v
ChatView -> MessageInput -> ComposerTurnPlan -> TurnTaskChecklist
                                      |
                                      +-> 任务全部完成或 Turn 终态：隐藏
```

- source breadcrumb：`app-server.turn/plan/updated`
- Proposed Plan、空计划和普通消息不会触发任务胶囊。
- 输入框只读取运行中 Turn 的最新 Updated Plan。
- 实时与历史消息会忽略 Updated Plan 的可见渲染，但协议数据仍保留供输入框消费。
- 文件变更继续来自既有 app-server 文件变更链路，Git 不参与任务进度事实构建。

## 验证

- targeted Vitest：5 个文件、29 项通过；最终 UI targeted：3 个文件、10 项通过。
- `npm run test`：137 个测试文件、632 项测试通过。
- `npm run build`：通过；Next.js 生产构建、TypeScript、26 个静态页面和 postbuild 均完成。
- `npm run test:smoke:user-input`：通过。
- CDP 桌面验证：1600x1000，折叠态和展开态布局正常。
- CDP 移动验证：390x844，无横向溢出。

验证截图：

- `/volume2/SSD/codex/Temp/10-turn-task-standalone.png`
- `/volume2/SSD/codex/Temp/11-turn-task-with-files.png`
- `/volume2/SSD/codex/Temp/12-turn-task-with-files-expanded.png`
- `/volume2/SSD/codex/Temp/13-turn-task-mobile.png`

## 反例

- 没有 `turn/plan/updated` 时不显示任务 UI。
- Proposed Plan 和空 Updated Plan 不显示任务 UI。
- 执行任务展开时，页面只有输入框浮层中的一个任务清单，消息流中为零。
- 任务执行中文件变更出现时切换为双胶囊；文件变更消失后恢复默认展开的独立任务面板。
- 文件列表已展开时点击任务胶囊，文件列表会自动关闭。
- 全部步骤完成后任务 UI 消失，但尚未提交的文件变更 UI 继续保留。
- Turn 进入 failed 或 interrupted 时，纯派生函数返回空值。

## 剩余风险

视觉基准来自用户提供的官方 Codex App 截图，而官方 TUI 没有完全相同的输入框任务胶囊。任务协议语义已严格对齐 app-server；不同字体与系统缩放下可能存在少量视觉差异。
