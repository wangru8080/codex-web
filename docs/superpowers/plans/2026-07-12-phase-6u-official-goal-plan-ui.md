# Phase 6U 官方 Goal / Plan UI 执行计划

> **给执行代理：** 必须按任务逐项执行；步骤使用 checkbox（`- [x]`）跟踪。

**设计文档：** `docs/superpowers/specs/2026-07-12-phase-6u-official-goal-plan-ui-design.md`

**目标：** 让 Web 的 Goal / Plan 展示与官方 Codex app 和 `codex-rs/tui` 语义一致。

**架构：** app-server notification 是事实源；`codex-rs/tui` 的转换逻辑是行为基准；CodexWeb 组件只承担 Web 等价呈现。新增纯 adapter 承接 `ThreadGoal`、`ThreadItem::Plan`、`TurnPlanUpdatedNotification` 和 plan implementation prompt gating，避免 UI 层直接散落协议判断。

**技术栈：** TypeScript、React、Next.js、Vitest、Playwright smoke、Codex app-server generated schema。

## 全局约束

- 默认开发、测试、smoke 必须设置 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- UI 保持官方 Codex app 语义一致：Goal 是 composer 上方 progress row，Plan 是消息时间线中的 plan cell，不做右侧常驻 GoalPanel / PlanPanel。
- 代码逻辑必须与 `codex-rs/tui` 的 Goal / Plan 分支一致。
- 所有用户可见字段必须有 source breadcrumb。
- 不直接修改 `/home/rrssnas/code/CodexWeb`。
- 不从 assistant 文本伪造 goal、plan、token usage 或 MCP 状态。
- 不使用本地真实 `CODEX_HOME` 做开发或普通验证。

---

## 文件结构

- 新增：`src/codex-web/goal-display-adapter.ts`  
  负责 `ThreadGoal` 到 progress row、summary lines、usage label 的纯转换。
- 新增：`src/codex-web/goal-display-adapter.test.ts`  
  覆盖官方 goal status、elapsed、token usage 文案。
- 新增：`src/codex-web/plan-display-adapter.ts`  
  负责 Proposed Plan 与 Updated Plan block 的纯转换。
- 新增：`src/codex-web/plan-display-adapter.test.ts`  
  覆盖 plan delta、completed plan、history plan、updated checklist 和空 steps。
- 新增：`src/codex-web/plan-implementation-adapter.ts`  
  负责 `Implement this plan?` 的显示条件与三种 action payload。
- 新增：`src/codex-web/plan-implementation-adapter.test.ts`  
  覆盖官方 prompt gating：Plan mode、live turn、proposed plan、queued message、history replay。
- 修改：`src/codex-web/app-server-state.ts`  
  增加 goal、plan blocks、last proposed plan、plan implementation prompt 的状态字段。
- 修改：`src/codex-web/AppServerProvider.tsx`  
  接收 `thread/goal/*`、`item/plan/delta`、`item/completed` 的 plan item、`turn/plan/updated`，并调用 adapter 更新状态。
- 修改：`src/codex-web/turn-reducer.ts`  
  将 plan delta / completed plan / updated plan 纳入 turn 状态，保持与 active turn 多线程隔离。
- 修改：`src/codex-web/thread-history-adapter.ts`  
  将历史 `ThreadItem::Plan` 映射为 Proposed Plan 消息块。
- 修改：`src/codex-web/app-server-message-blocks.ts`  
  增加 Proposed Plan / Updated Plan 结构化块编码和解析。
- 修改：`src/components/chat/MessageItem.tsx`、`src/components/chat/StreamingMessage.tsx`  
  渲染 Proposed Plan 和 Updated Plan，保持时间线 cell 语义。
- 修改：`src/components/chat/ChatView.tsx`、`src/components/chat/MessageInput.tsx`  
  在 composer 上方接入 Goal progress row 和 Plan implementation prompt。
- 修改：`src/app/chat/page.tsx`、`src/app/chat/[id]/page.tsx`  
  传入当前 thread 的 goal / plan 状态，按 route/resumed thread 过滤。
- 测试：现有 `src/codex-web/*test.ts` targeted tests，必要时补 `tests/smoke`。

## 任务 1：Goal 官方显示 adapter

**文件：**
- 新增：`src/codex-web/goal-display-adapter.ts`
- 新增：`src/codex-web/goal-display-adapter.test.ts`

**接口：**
- 产出：
  - `formatGoalElapsedSeconds(seconds: number): string`
  - `formatGoalTokensCompact(tokens: number): string`
  - `goalStatusLabel(status: ThreadGoalStatus): string`
  - `goalProgressLabel(goal: ThreadGoal): string`
  - `goalSummaryLines(goal: ThreadGoal): string[]`

- [x] 编写单元测试：覆盖 `0s`、`1m`、`1h 30m`、`2d 23h 42m`。
- [x] 编写单元测试：覆盖 `active` 有 token budget 时显示 `40K / 50K`，无 budget 时显示 elapsed。
- [x] 编写单元测试：覆盖 `paused/blocked/usageLimited/budgetLimited/complete` 文案。
- [x] 实现 adapter，逻辑逐条对齐 `codex-rs/tui/src/chatwidget/goal_status.rs` 和 `goal_menu.rs`。
- [x] 运行：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/goal-display-adapter.test.ts
```

## 任务 2：Plan 官方显示 adapter

**文件：**
- 新增：`src/codex-web/plan-display-adapter.ts`
- 新增：`src/codex-web/plan-display-adapter.test.ts`

**接口：**
- 产出：
  - `proposedPlanBlockFromText(text: string, source: string): MessageContentBlock | null`
  - `updatedPlanBlockFromNotification(notification: TurnPlanUpdatedNotification, source: string): MessageContentBlock`
  - `planProgressFromSteps(steps: TurnPlanStep[]): { completed: number; total: number } | null`

- [x] 编写测试：空 proposed plan 不产生块。
- [x] 编写测试：非空 `ThreadItem::Plan.text` 生成 `Proposed Plan` 块。
- [x] 编写测试：`turn/plan/updated` 生成 `Updated Plan` checklist。
- [x] 编写测试：空 steps 显示低优先级空态但不产生 `0/0` 进度。
- [x] 实现 adapter，状态映射对齐 `completed/inProgress/pending`。
- [x] 运行：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/plan-display-adapter.test.ts
```

## 任务 3：Plan implementation prompt adapter

**文件：**
- 新增：`src/codex-web/plan-implementation-adapter.ts`
- 新增：`src/codex-web/plan-implementation-adapter.test.ts`

**接口：**
- 产出：
  - `selectPlanImplementationPrompt(input): PlanImplementationPrompt | null`
  - `PLAN_IMPLEMENTATION_CODING_MESSAGE = "Implement the plan."`
  - `PLAN_IMPLEMENTATION_CLEAR_CONTEXT_PREFIX` 对齐 `codex-rs/tui/src/chatwidget/plan_implementation.rs`

- [x] 编写测试：非 Plan mode 不显示 prompt。
- [x] 编写测试：history replay 不显示 prompt。
- [x] 编写测试：没有 proposed plan 不显示 prompt。
- [x] 编写测试：有 queued message 不显示 prompt。
- [x] 编写测试：Plan mode live turn 完成且有 proposed plan 时显示三选项。
- [x] 编写测试：Default mode 不可用时禁用两个 implement 选项。
- [x] 实现 adapter。
- [x] 运行：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/plan-implementation-adapter.test.ts
```

## 任务 4：Reducer 和 provider 接线

**文件：**
- 修改：`src/codex-web/app-server-state.ts`
- 修改：`src/codex-web/AppServerProvider.tsx`
- 修改：`src/codex-web/turn-reducer.ts`
- 测试：`src/codex-web/turn-reducer.test.ts`

**接口：**
- 消费：任务 1-3 adapters。
- 产出：app-server state 中按 threadId 隔离的 goal、proposed plan、updated plan、implementation prompt。

- [x] 扩展 app-server state：按 threadId 保存 goal state。
- [x] 处理 `thread/goal/updated` 和 `thread/goal/cleared`，source breadcrumb 分别为 `app-server.thread/goal/updated` 和 `app-server.thread/goal/cleared`。
- [x] 处理 `item/plan/delta`：仅 Plan mode 可见；非 Plan mode 保留 diagnostics。
- [x] 处理 `item/completed` 中的 `ThreadItem::Plan`：以 completed text 替换流式 proposed plan。
- [x] 处理 `turn/plan/updated`：添加 Updated Plan block，并更新 task progress snapshot。
- [x] 补测试：多 active thread 的 goal / plan 不串线。
- [x] 运行：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/turn-reducer.test.ts src/codex-web/active-turns-adapter.test.ts
```

## 任务 5：历史 replay 接入 Proposed Plan

**文件：**
- 修改：`src/codex-web/thread-history-adapter.ts`
- 修改：`src/codex-web/app-server-message-blocks.ts`
- 测试：`src/codex-web/thread-history-adapter.test.ts`
- 测试：`src/codex-web/app-server-message-blocks.test.ts`

- [x] 将历史 `ThreadItem::Plan` 映射为 `Proposed Plan` 结构化块。
- [x] 保持刷新边界：只 replay app-server 历史 API 返回的真实 plan item。
- [x] 测试：历史 `ThreadItem::Plan` 显示 Proposed Plan。
- [x] 反例测试：agent final answer 中含 “plan” 文本不生成 Proposed Plan。
- [x] 运行：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/thread-history-adapter.test.ts src/codex-web/app-server-message-blocks.test.ts
```

## 任务 6：时间线 UI 渲染 Plan cells

**文件：**
- 修改：`src/components/chat/MessageItem.tsx`
- 修改：`src/components/chat/StreamingMessage.tsx`
- 可选修改：`src/components/chat/RunCheckpoint.tsx`

- [x] 渲染 `Proposed Plan` 标题和 Markdown body。
- [x] 渲染 `Updated Plan` checklist，completed / inProgress / pending 视觉可区分。
- [x] 保持 CodexWeb 工具过程区现有风格，不改整体布局。
- [x] 确认移动端不发生文字重叠。
- [x] 运行：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/plan-display-adapter.test.ts
npm run test
```

## 任务 7：Composer Goal progress row

**文件：**
- 修改：`src/components/chat/ChatView.tsx`
- 修改：`src/components/chat/MessageInput.tsx`
- 修改：`src/app/chat/page.tsx`
- 修改：`src/app/chat/[id]/page.tsx`

- [x] 在 composer 上方渲染 Goal progress row。
- [x] 无 goal 时不渲染。
- [x] pause/resume/edit/clear 使用 app-server 官方方法，不写 Web 私有状态。
- [x] 失败时显示可见错误并恢复 composer。
- [x] 测试或 smoke 覆盖 active、paused、complete、cleared。

## 任务 8：Plan implementation prompt UI

**文件：**
- 修改：`src/components/chat/ChatView.tsx`
- 修改：`src/app/chat/page.tsx`
- 修改：`src/app/chat/[id]/page.tsx`

- [x] 在 composer 附近渲染 `Implement this plan?`。
- [x] 三个选项语义对齐官方 TUI。
- [x] `Yes, implement this plan` 切到 Default mode 并发送 `Implement the plan.`
- [x] `Yes, clear context and implement` 新建上下文并带上完整 plan。
- [x] `No, stay in Plan mode` 只关闭提示。
- [x] 反例：history replay 不弹，queued message 不弹。

## 任务 9：Slash command 和 mode 入口复查

**文件：**
- 修改：`src/components/chat/MessageInput.tsx`
- 按需修改：slash command 相关模块

- [x] `/plan` 切换 Plan mode，不打开右侧面板。
- [x] `/goal` 无参数显示 goal summary。
- [x] `/goal pause/resume/clear/edit` 使用 app-server goal 方法。
- [x] 输入包含独立单词 `plan` 时可显示 nudge；包含 `planning` 不触发。
- [x] 不实现与官方冲突的 GoalPanel / PlanPanel。

## 任务 10：验证与 Smoke Ledger

**文件：**
- 修改：`docs/exec-plans/active/web-mvp-phase-0-4.md`
- 可选修改：`tests/smoke/*`

- [x] Targeted tests：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test -- src/codex-web/goal-display-adapter.test.ts src/codex-web/plan-display-adapter.test.ts src/codex-web/plan-implementation-adapter.test.ts
```

- [x] Full verification：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run build
npm run test:smoke
```

- [x] 真实浏览器 smoke：
  - 普通消息：无 Goal row、无 Proposed Plan、无 Updated Plan。
  - Plan mode：有 Proposed Plan，完成后出现 `Implement this plan?`。
  - `update_plan`：显示 Updated Plan checklist。
  - Goal：active 显示 progress row，pause/resume/clear 后 UI 跟随 app-server 状态。
  - 反例：无 token usage 不显示 `0`，无 MCP 状态不显示“正常”。

验证记录：

- 2026-07-12：`npm run test -- src/codex-web/goal-display-adapter.test.ts src/codex-web/plan-display-adapter.test.ts src/codex-web/plan-implementation-adapter.test.ts src/codex-web/turn-reducer.test.ts src/codex-web/app-server-message-blocks.test.ts src/codex-web/thread-history-adapter.test.ts` 通过，6 个测试文件、35 个测试。
- 2026-07-12：`npm run test` 通过，27 个测试文件、138 个测试。
- 2026-07-12：`npm run build` 初次沙箱内因 Turbopack 绑定端口被拒绝，提升权限后通过；仅保留既有 NFT tracing warning。
- 2026-07-12：`npm run test:smoke` 初次沙箱内因 `tsx` IPC pipe listen 被拒绝，提升权限后通过，隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 2026-07-12：真实浏览器打开 `http://192.168.3.12:3000/chat`，桌面和 390px 窄屏 console 0 errors / 0 warnings；普通新聊天页无 Goal row、无 Proposed Plan、无 Updated Plan。
- 2026-07-12：真实浏览器触发 `/plan`，确认 `thread/start` 与 `turn/start` 均携带 `collaborationMode.mode = "plan"`；真实模型返回 `Proposed Plan` 后显示 `Implement this plan?`。
- 2026-07-12：真实浏览器验证 `turn/plan/updated` 显示 `Updated Plan` checklist，source breadcrumb 来自 `app-server.turn/plan/updated`。
- 2026-07-12：真实浏览器验证 `/goal <objective>`、pause、resume、clear；Goal 只显示在 composer 上方 progress row，并跟随 `thread/goal/updated` / `thread/goal/cleared`。
- 2026-07-12：真实浏览器验证 `Yes, clear context and implement`：创建新 thread，退出 Plan mode，发送 clear-context prefix 和完整 plan markdown。

剩余风险：

- 真实模型路径依赖账号、网络、额度和当前 app-server 版本；失败时需先区分外部环境问题与 Web 实现问题。
- Goal / Plan 公开 app 文档对视觉细节描述有限；若官方 Codex app 后续补充截图或交互说明，需要复核 Web 等价层。

## 决策日志

- 2026-07-12：Phase 6U 不采用右侧 `GoalPanel` / `PlanPanel`。官方 Codex app 和 TUI 的等价 UI 是 composer 附近 Goal progress row、消息时间线 Plan cells、Plan implementation prompt。
- 2026-07-12：代码逻辑必须按 `codex-rs/tui` 的 adapter 等价重写，不在 React 组件中散落协议判断。
