# 长历史初始底部锁实施计划

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline; do not install dependencies, move files, archive this plan, or commit without separate user confirmation.
>
> 技术交接：[2026-07-23-web-only-performance-refactor.md](../../handover/2026-07-23-web-only-performance-refactor.md)
>
> 性能复核：[2026-07-24-frontend-framework-reevaluation.md](../../insights/2026-07-24-frontend-framework-reevaluation.md)

**目标：** 消除长历史在异步高度变化后偶发离开最新消息的竞态，同时保持短对话顶部对齐和用户向上阅读不被抢夺。

**架构：** `MessageList` 在每个会话第一次提交非空历史窗口后启用初始底部锁；Virtuoso 总高度、at-bottom 状态和真实 scroller 的非用户滚动共同触发下一帧置底。用户通过滚轮、触摸、指针或导航键主动操作消息区后永久解除当前会话的初始锁，既有流式 `followOutput` 和 `isAtBottomRef` 继续处理后续消息。

**技术栈：** React 19、react-virtuoso 4.18.10、TypeScript、Vitest、Chrome CDP、现有生产性能基线。

## 全局约束

- 不恢复 `alignToBottom`，短对话首条问题继续从顶部开始。
- 不用固定延时猜测布局稳定时间，不增大阈值掩盖位置漂移。
- 用户主动向上阅读后不得自动拉回底部。
- 不改变 app-server reducer、协议、消息顺序、分页或流式完成语义。
- 不安装依赖，不修改 `package.json` 或锁文件。
- 所有 app-server 验证使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### 任务 1：先建立底部锁接线反例

**文件：**
- 修改：`src/codex-web/message-list-virtualization-wiring.test.ts`
- 修改：`scripts/web-performance-baseline.ts`

**接口：**
- 接线测试要求 `MessageList` 使用 `totalListHeightChanged`、`scrollerRef` 和用户交互取消逻辑，同时继续禁止 `alignToBottom`。
- CDP 探针输出 `lateHeightMaintainedBottom` 和 `userScrollPreserved`，并继续输出 `initialAtBottom`、顶部挂载数和 `returnedToBottom`。

- [x] 在接线测试中增加上述源码边界断言。
- [x] 运行 `npx vitest run src/codex-web/message-list-virtualization-wiring.test.ts`，确认旧实现因缺少底部锁而失败。
- [x] 在长历史探针中先确认底部，再给最后一个已挂载消息增加临时高度，断言高度变化后仍在底部。
- [x] 主动滚到顶部并派发用户滚轮事件，再改变消息高度，断言阅读位置没有被拉到底部。
- [x] 普通历史继续记录全部挂载；阶段 4 的真实短 Turn `topOffset=0` 作为顶部反例保留。

### 任务 2：实现每会话初始底部锁

**文件：**
- 修改：`src/components/chat/MessageList.tsx`

**接口：**
- `pinInitialBottom(): void`：锁有效时同时请求 Virtuoso 对齐最后一项并校正真实 scroller。
- `handleTotalListHeightChanged(height: number): void`：锁有效且列表溢出时安排下一帧置底。
- `handleInitialBottomLockUserInteraction(): void`：解除当前会话的初始底部锁。
- `handleInitialBottomLockScroll(): void`：真实 scroller 发生非用户滚动且离底超过 48px 时纠正位置。
- `handleScrollerRef(ref: HTMLElement | Window | null): void`：保存滚动容器并注册/清理用户意图及 scroll 事件。

- [x] 第一次提交当前 `sessionId` 的非空历史行时启用锁；会话切换时重置。
- [x] 列表未溢出时不发生滚动，保证短对话顶部对齐。
- [x] 高度、at-bottom 或真实 scroll 变化且锁有效时无动画置底，不修改 `followOutput` 和流式 effect。
- [x] `wheel`、`touchstart`、`pointerdown` 以及 PageUp/Home/ArrowUp 解除锁。
- [x] 组件卸载或 scroller 替换时清理原生事件监听和待执行动画帧。
- [x] 运行定向 Vitest，确认接线测试通过。

### 任务 3：全量验证与三轮稳定性复核

**文件：**
- 修改：`docs/exec-plans/completed/2026-07-24-long-history-bottom-lock.md`
- 修改：`docs/insights/2026-07-24-frontend-framework-reevaluation.md`
- 修改：`docs/handover/2026-07-23-web-only-performance-refactor.md`

- [x] 使用 Node 24.14.0 和隔离 `CODEX_HOME` 运行 `npm run test`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run test:smoke`。
- [x] 连续运行三次 `npm run performance:baseline:production -- default`，每次使用排他时间戳目录。
- [x] 三次均断言长历史初始置底、延迟高度变化保持底部、向上阅读不被抢夺且恢复底部。
- [x] 普通 Turn、Skill Turn 和普通/Math/Mermaid/代码 Markdown 反例继续通过。
- [x] 更新状态总览、决策日志和 Smoke Ledger，明确实际通过数量和残余风险。
- [x] 运行 `git diff --check`、文档链接与临时产物扫描。
- [x] 经用户确认后归档并提交；不远程推送。

## 状态总览

- 当前状态：代码、测试、构建、Smoke 和三轮生产稳定性验证完成；已确认归档和提交。
- 修复结果：初始锁在消息提交后启用，以真实 scroller 为最终位置事实；明确用户意图解除锁，异步高度和内部锚点校正不会再把历史会话推离最新消息。
- 成功标准：三轮生产基线均为 12/12，新增高度变化与用户阅读反例通过；短对话继续不使用 `alignToBottom`。

## 决策日志

- 2026-07-24：不恢复 `alignToBottom`，因为它会改变短对话顶部布局。
- 2026-07-24：不通过增大 `atBottomThreshold` 或固定延时掩盖竞态；使用 Virtuoso 的实际总高度变化作为事实源。
- 2026-07-24：底部锁由明确用户意图解除，而不是由异步高度导致的 `atBottomStateChange(false)` 解除。
- 2026-07-24：单靠 Virtuoso 总高度和 at-bottom 回调仍存在无事件位置漂移；最终增加真实 scroller `scroll` 监听，并只在锁有效且离底超过 48px 时纠正。
- 2026-07-24：顶部高度探针允许 Virtuoso 为保持阅读锚点调整绝对 `scrollTop`；反例断言用户仍远离底部，而不是错误要求停在 0 至 64px。
- 2026-07-24：恢复底部使用用户真实可见的“滚动到底部”按钮，不再由测试直接写 `scrollTop` 冒充产品交互。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
|---|---|---|---|
| 2026-07-24 | 阶段 5 三轮生产基线 | 长历史初始底部 | 1 次通过、2 次失败；确认是客户端高度/滚动时序残余 |
| 2026-07-24 | 定向 Vitest | 底部锁、用户意图、真实 scroll 接线 | 旧实现先失败；最终 1 个文件、4 项通过 |
| 2026-07-24 | 隔离 `CODEX_HOME` | `npm run test`、`npm run build`、`npm run test:smoke` | 127 个测试文件、594 项通过；生产构建通过；Smoke models=7、账号来源 `app-server.account/read` |
| 2026-07-24 | 生产基线第一轮 | 全部 12 场景与长历史动态反例 | 12/12；长历史 60 条挂载 11 条，初始/延迟高度/用户阅读/恢复底部全部通过 |
| 2026-07-24 | 生产基线第二轮 | 全部 12 场景与长历史动态反例 | 12/12；长历史 60 条挂载 11 条，全部滚动字段通过 |
| 2026-07-24 | 生产基线第三轮 | 全部 12 场景与真实底部按钮 | 12/12；长历史 60 条挂载 13 条，全部滚动字段通过 |

三轮结果目录：

- `/volume2/SSD/codex/Temp/codex-web-performance-baseline/2026-07-24T11-33-42-349Z-production-default/`
- `/volume2/SSD/codex/Temp/codex-web-performance-baseline/2026-07-24T11-36-01-903Z-production-default/`
- `/volume2/SSD/codex/Temp/codex-web-performance-baseline/2026-07-24T11-42-54-822Z-production-default/`

三轮整体可交互 P95 为 11.0 至 15.1 秒，最长 Long Task 为 788 至 1106 ms，明显受长时间共享 CDP/真实 Turn 波动影响且没有性能改善证据。本修复只声明滚动正确性完成，不声明整体性能预算改善。
