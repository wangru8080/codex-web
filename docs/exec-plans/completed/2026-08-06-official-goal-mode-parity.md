# 官方目标模式对齐执行计划

**目标：** 让 Codex Web 的目标消息标志、目标控制条、编辑、暂停、中断、恢复和耗时展示对齐官方 Codex App 截图及 `codex-rs/tui` 语义。

**架构：** `thread/goal/*` 与 `thread/goal/updated|cleared` 继续作为目标事实源，`turn/interrupt` 与 turn terminal notification 继续作为执行停止事实源。UI 只组合用户明确触发的“暂停目标”动作，不从文本推断目标或 turn 状态。

**技术栈：** Next.js、React、TypeScript、Vitest、Playwright、Codex app-server JSON-RPC。

## 全局约束

- 不修改 `/home/rrssnas/code/codex`。
- 不新增依赖。
- 所有目标状态来自 app-server。
- 运行中暂停目标时同时请求 `thread/goal/set(status=paused)` 与 `turn/interrupt`；空闲暂停不发送 interrupt。
- 恢复目标只发送 `thread/goal/set(status=active)`，由 app-server 决定后续执行。
- 普通消息不得显示目标标志。
- 验证使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

## 文件范围

- 修改 `src/components/chat/GoalProgressRow.tsx`：官方风格目标控制条与实时耗时。
- 修改 `src/components/chat/ChatView.tsx`：目标编辑模态框、暂停/中断组合、目标消息关联。
- 修改 `src/components/chat/MessageItem.tsx`：用户消息下方目标标志。
- 修改 `src/components/chat/MessageList.tsx`：传递目标消息标识。
- 修改 `src/codex-web/goal-display-adapter.ts`：目标状态和耗时纯逻辑。
- 修改相关 `src/codex-web/tests/*.test.ts`：行为和接线回归。
- 必要时修改 `scripts/goal-plan-plus-smoke.ts`：协议反例 smoke。

## 执行清单

- [x] 补充失败测试：普通消息无目标标志，目标消息有标志。
- [x] 补充失败测试：active goal 的当前 turn 耗时实时递增，paused goal 停止递增。
- [x] 补充失败测试：运行中暂停会中断 turn，空闲暂停不会中断。
- [x] 实现官方单行目标控制条，并允许运行中点击暂停。
- [x] 实现目标编辑模态框，保存沿用官方 edited status 规则。
- [x] 实现目标用户消息标志，不从 assistant 文本推断。
- [x] 实现 interrupted turn 的“你在 N 秒后停止了”展示。
- [x] 历史会话和分屏会话重新打开后调用 `thread/goal/get`，恢复 route/resumed thread 的目标状态。
- [x] 补充目标更新失败、interrupt 部分失败、六状态目标条和多窗口广播测试。
- [x] 运行 targeted tests、`npm run test`、`npm run build`、`npm run test:smoke`。
- [x] 启动 dev server，验证桌面和窄屏目标流程并保存截图。
- [x] 更新 Smoke Ledger、状态和决策记录。

## Smoke Ledger

| 场景 | 预期 | 结果 |
|---|---|---|
| 普通消息 | 不显示目标标志和目标控制条 | 浏览器反例通过：新会话初始 DOM 无 `data-goal-message-marker`；接线测试覆盖普通消息路径 |
| 设置目标 | 用户问题下显示目标标志，输入框上方显示 active 目标条 | 浏览器通过：显示“设为目标”、active 目标条和实时秒数；目标条 720px、输入框 768px，左右各内缩 24px；目标标志位于消息气泡外且在其下方 |
| 运行中暂停 | goal 变 paused，当前 turn 变 interrupted，发送按钮恢复 | 浏览器通过：显示“你在 20秒 后停止了”，停止按钮恢复为发送按钮 |
| 空闲暂停 | goal 变 paused，不发送无效 interrupt | 单元测试通过：非 running turn 不触发 interrupt |
| 恢复目标 | goal 变 active，由 app-server 恢复后续处理 | 浏览器通过：恢复后重新进入 active，再次暂停显示新的停止记录 |
| 编辑目标 | 模态框保存后 objective 更新，取消不变 | 浏览器通过：弹窗显示原目标“对齐目标栏和消息标志”；保存后目标条更新为“对齐目标栏和消息标志（已修改）”，弹窗关闭 |
| 清除目标 | 当前目标条消失；历史目标消息标志保留 | 浏览器通过：`goalRow=false`、`markerCount=1`，截图为 `/volume2/SSD/codex/Temp/goal-ui-clear-result.png` |
| 重新打开会话 | 目标条从 app-server 恢复，不依赖 notification 重放 | 浏览器通过：历史路由恢复“重新打开后恢复目标状态”；目标消息标志因协议无关联字段为 0 |
| 双窗口同步 | 两个真实浏览器窗口共享同一线程，目标操作跨窗口同步 | 生产浏览器 E2E 通过：创建、暂停、恢复、编辑、清除均在相反窗口观察到一致状态；线程 `019fd521-cd09-74b3-84d1-ba8b0d82f1e8`；截图 `/volume2/SSD/codex/Temp/goal-two-window-1785987189859-active-window-a.png`、`/volume2/SSD/codex/Temp/goal-two-window-1785987189859-active-window-b.png`、`/volume2/SSD/codex/Temp/goal-two-window-1785987189859-edit-dialog-window-a.png`、`/volume2/SSD/codex/Temp/goal-two-window-1785987189859-edited-window-a.png`、`/volume2/SSD/codex/Temp/goal-two-window-1785987189859-edited-window-b.png`；另有 5 个静态资源 404 控制台告警，不影响目标断言 |
| 目标更新失败 | goal set 失败时不发送 turn interrupt，UI 解除 pending 并显示错误 | 单元测试与两入口接线测试通过 |
| 暂停部分成功 | goal paused 成功、interrupt 失败时保持调用顺序并把错误交给 UI 收口 | 单元测试通过：调用顺序为 `goal:paused` → `interrupt`，不伪造回滚 |
| 多窗口目标同步 | goal updated/cleared notification 广播给所有 Web 客户端 | bridge routing 单元测试通过 |
| 少见目标状态 | 六种协议状态均稳定渲染相应文案和操作 | SSR 组件测试通过：6 组状态全部覆盖 |

## 决策日志

- 2026-08-06：官方 TUI 的中断 active goal 会额外发送 paused 状态；app-server 的 `thread/goal/set` 不等于 `turn/interrupt`。Web 的暂停按钮在运行中组合两个官方方法，空闲时只更新目标状态。
- 2026-08-06：source breadcrumb 保留在 DOM/无障碍诊断信息中，不作为目标条主视觉文本。
- 2026-08-06：目标消息标志记录“这条用户消息曾用于设置目标”的历史事实；清除当前目标只移除目标控制条，不回写或伪造历史消息。
- 2026-08-06：浏览器验证使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`；桌面与 390x844 窄屏均无横向溢出。
- 2026-08-06：按官方截图二次收紧视觉关系：桌面目标条固定比 48rem 输入框窄 3rem，窄屏保留左右各 1rem；“设为目标”作为消息气泡外的独立历史标记。此前开发页 CDP 布局走查控制台错误为 0；本次生产双窗口走查目标断言通过，但记录到 5 个静态资源 404 告警。
- 2026-08-06：目标状态更新与 turn interrupt 的顺序收敛到共享编排函数。该函数不伪造事务性：goal 更新成功但 interrupt 失败时向上抛错，由 UI 显示失败；app-server notification 仍是最终状态事实源。
