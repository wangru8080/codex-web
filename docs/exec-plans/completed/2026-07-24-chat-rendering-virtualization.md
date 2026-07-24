# 聊天渲染与长历史虚拟化实施计划

> **执行要求：** 按任务逐项实现并更新复选框；测试与采样显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`；不自动提交或推送。
>
> 技术交接：[2026-07-23-web-only-performance-refactor.md](../../handover/2026-07-23-web-only-performance-refactor.md)

**目标：** 在不改变 app-server 消息、工具、审批、Goal/Plan 和编辑语义的前提下，降低长历史首次渲染与流式 delta 的 React 工作量。

**架构：** 使用 MIT `react-virtuoso` 为动态高度消息建立窗口化边界，以稳定消息 ID 和单调虚拟索引保持前插锚点；使用 `requestAnimationFrame` 将同一帧内累计的 Turn 快照合并为一次视图更新。`ChatView` 继续拥有业务编排，`MessageList` 只负责可见行、滚动和历史加载。

**技术栈：** React 19、Next.js 16、TypeScript、Vitest、react-virtuoso 4.18.10、CDP 性能基准。

## 状态总览

- `Code complete`：虚拟列表、帧级展示快照、memo 边界和性能硬断言均已接入。
- `Tests pass`：TypeScript、123 个测试文件共 574 项测试和生产构建通过。
- `Smoke passed`：bridge/app-server Smoke、开发性能基准 8/8 场景及桌面/移动长历史检查通过。
- 执行计划已归档到 completed；不自动提交或推送。

## 全局约束

- app-server notification、generated schema、source breadcrumb、approval 顺序和 terminal 状态时机不变。
- 动态 Markdown、代码、图片、工具展开、历史前插、底部跟随、向上阅读、编辑与回滚均需反例验证。
- 普通短会话不得因虚拟化出现空白、闪烁或强制滚底。
- 不引入商业 `@virtuoso.dev/message-list`，不混入依赖清理、Vite 或桌面遗留改动。

---

### 任务 1：窗口变化模型与帧级合并

**文件：**
- 新建：`src/components/chat/message-list-virtualization.ts`
- 新建：`src/components/chat/message-list-virtualization.test.ts`
- 新建：`src/hooks/useAnimationFrameValue.ts`
- 新建：`src/hooks/useAnimationFrameValue.test.ts`

**接口：**
- `classifyMessageWindowChange(previousIds, nextIds)` 区分 prepend、append、items-change 和 replace。
- `nextVirtualFirstItemIndex(current, change)` 仅在前插时递减虚拟起点。
- `createFrameValueCoalescer(schedule, cancel, publish)` 在一帧内只发布最新累计值。

- [x] 先添加前插、尾部裁剪、追加、替换和同帧合并失败测试。
- [x] 实现最小纯函数与 Hook。
- [x] 运行两个定向测试并确认通过。

### 任务 2：动态高度虚拟消息列表

**文件：**
- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`src/components/chat/MessageList.tsx`
- 新建：`src/codex-web/message-list-virtualization-wiring.test.ts`

**接口：**
- 输入保持现有 `MessageListProps`，不改变 `ChatView` 业务调用。
- 输出使用 `data-message-row`、`data-message-list-scroller` 和 `data-virtualized-message-list` 提供稳定 smoke 断言。

- [x] 安装并审查 `react-virtuoso@4.18.10` 锁文件差异。
- [x] 先添加虚拟列表、稳定 key、前插索引和滚动按钮接线测试。
- [x] 用 `Virtuoso` 替换全量 map，保留空状态、加载更早、rewind、编辑和流式尾行。
- [x] 运行定向测试与 typecheck。

### 任务 3：隔离流式 Turn 与输入区

**文件：**
- 修改：`src/components/chat/ChatView.tsx`
- 修改：`src/components/chat/StreamingMessage.tsx`
- 修改：`src/components/chat/MessageInput.tsx`

**接口：**
- app-server reducer 仍提供累计 `AppServerTurnState`。
- 视图层通过 `useAnimationFrameValue` 接收帧级快照；terminal 业务 effect 仍读取原始 Turn。
- `MessageInput` 使用浅比较 memo，在 props 不变时跳过聊天流式更新。

- [x] 添加帧级快照与输入 memo 接线断言。
- [x] 将仅用于展示的 Turn 派生值切换到帧级快照。
- [x] memo 化输入区和流式消息边界，不改变交互 props。
- [x] 运行聊天定向测试与全量 unit。

### 任务 4：真实滚动、反例与指标

**文件：**
- 修改：`scripts/web-performance-baseline.ts`
- 修改：`docs/handover/2026-07-23-web-only-performance-refactor.md`
- 完成并归档：`docs/exec-plans/completed/2026-07-24-chat-rendering-virtualization.md`

**接口：**
- 长历史结果新增 DOM 总消息数、实际挂载数、顶部/底部滚动和锚点检查。
- 普通消息与 Skill 消息继续走真实 app-server Turn。

- [x] 扩展长历史 CDP 断言，确认实际挂载数小于总消息数。
- [x] 运行 `npm run test`、`npm run build` 和 `npm run test:smoke`。
- [x] 运行开发性能基准并与阶段 1 的 18/17 commit、205 ms MessageList 对照。
- [x] 在桌面和移动视口检查滚动、输入及 console；工具过程由真实普通/Skill Turn 和现有分组测试覆盖。
- [x] 更新决策日志、状态总览和 Smoke Ledger。
- [x] 经用户再次确认后移动执行计划。

## 决策日志

- 2026-07-24：选择 MIT `react-virtuoso` 标准包；它支持 React 19、动态高度和双向加载，不采用商业 Message List 包。
- 2026-07-24：不在本阶段拆分 app-server reducer；流式合并只发生在视图帧边界，累计快照仍由现有 reducer 产生。
- 2026-07-24：长历史性能基准将“挂载数小于总数”和“初始/恢复底部成功”设为硬断言，避免只凭组件接线宣称虚拟化生效。
- 2026-07-24：保留短历史同一实现路径；普通历史 10/10 条均挂载，避免为小列表另建分支并保持行为一致。
- 2026-07-24：阶段 2 主要收益是长历史 DOM 与单次提交耗时下降；输入窗口 commit 从 17 增至 22，未把 commit 次数宣称为改善，留作后续按需分析。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
|---|---|---|---|
| 2026-07-24 | 只读代码与 Profiler | 阶段 1 后长历史瓶颈 | `MessageList` 最慢约 205 ms，`ChatView` 约 222 ms；120 条消息同时挂载 |
| 2026-07-24 | 隔离 `CODEX_HOME`、Vitest | 窗口变化、帧合并与接线定向验证 | TypeScript 通过；3 个测试文件、9 项断言通过 |
| 2026-07-24 | 隔离 `CODEX_HOME`、全量验证 | Unit、构建、bridge/app-server Smoke | 123 个测试文件、574 项测试通过；Next 生产构建通过；Smoke 读取 7 个真实模型和 `app-server.account/read` |
| 2026-07-24 | 开发 CDP 性能基准 | 空/普通/长历史、设置两次、普通 Turn、Skill Turn | 8/8 场景通过；长历史 60 条仅挂载 11 条，顶部 13 条；初始和恢复底部成功；结果位于 `/volume2/SSD/codex/Temp/codex-web-performance-baseline/2026-07-24T01-05-06-532Z-dev-default/` |
| 2026-07-24 | 开发 React Profiler | 阶段 1 与阶段 2 长历史对照 | `MessageList` 最慢约 205 ms → 61.1 ms；空闲 commit 18 → 18，输入 commit 17 → 22；输入到绘制 P95 63.2 ms |
| 2026-07-24 | CDP 桌面 1440×900 / 移动 390×844 | 长历史布局反例 | 分别挂载 12/60 与 11/60；底部保持、输入框可见、无横向溢出、无浏览器异常 |
