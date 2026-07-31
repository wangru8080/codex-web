# 续接任务剩余问题修复执行计划

**目标：** 不允许缺少真实 Turn 来源的助手消息发起续接，并让新任务标题序号基于同项目全部匹配任务计算。

**实现方式：** 消息操作栏直接以 `Message.turn_id` 作为续接资格条件。标题命名继续复用 `nextForkedThreadName`，仅增加一个通过 `app-server.thread/list` 按 `cwd`、标题候选分页收集任务的薄层；列表读取或命名失败继续由现有后处理降级逻辑收口，不阻止导航。

**技术栈：** React、TypeScript、Codex app-server、Vitest、Playwright。

## 全局约束

- 不新增依赖，不修改 generated schema 或 `~/code/codex`。
- 用户可见标题继续以 `app-server.thread/list` 和 `thread/name/set` 为事实源。
- 只修复无 `turn_id` 续接入口和标题列表上限，不扩展其他分叉能力。
- 使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 验证。

## 任务 1：限制续接按钮资格

**文件：**

- 修改：`src/components/chat/MessageItem.tsx`
- 测试：`src/codex-web/tests/chat-message-copy-wiring.test.ts`

**接口：**

- 输入：`Message.turn_id?: string` 与 `onContinueInNewTask`。
- 输出：仅同时具备回调和 `turn_id` 的助手消息显示续接按钮。

- [x] 增加缺少 `turn_id` 时不满足按钮渲染条件的失败测试。
- [x] 将按钮条件收紧为 `!isUser && message.turn_id && onContinueInNewTask`。
- [x] 运行目标测试并确认通过。

## 任务 2：分页计算标题序号

**文件：**

- 修改：`src/codex-web/thread-history-adapter.ts`
- 修改：`src/app/chat/[id]/page.tsx`
- 测试：`src/codex-web/tests/thread-history-adapter.test.ts`
- 测试：`src/codex-web/tests/message-list-virtualization-wiring.test.ts`

**接口：**

- 输入：父任务 `Thread` 和现有 `listThreads(params)` action。
- 输出：`nextForkedThreadNameFromList(sourceThread, listThreads): Promise<string>`。
- 请求：`thread/list { archived: false, cwd, searchTerm, cursor, limit: 100, sortKey: "recency_at", sortDirection: "desc" }`。

- [x] 增加多页结果生成后续序号的失败测试，并断言游标、`cwd` 和搜索词。
- [x] 增加重复游标停止分页的反例测试，避免异常服务响应造成死循环。
- [x] 实现最小分页收集函数，并复用现有纯函数计算标题。
- [x] 将新任务命名接到分页函数内，确保读取失败仍由现有后处理捕获并导航。
- [x] 运行目标测试并确认通过。

## 任务 3：回归验证

- [x] 运行相关 targeted tests。
- [x] 运行 `npm run test`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run test:smoke`。
- [x] 使用真实浏览器验证续接按钮、分叉导航、回链、标题查询参数和最终标题。
- [x] 记录普通路径和反例 Smoke Ledger。
- [x] 经用户确认后将计划移动到 `docs/exec-plans/completed/`。

## Smoke Ledger

- Targeted：2 个测试文件、30 项测试通过。
- `npm run test`：151 个测试文件、709 项测试通过。
- `npm run build`：生产构建和 TypeScript 检查通过。
- `npm run test:smoke`：隔离 `CODEX_HOME` 下 bridge、模型列表和账号来源验证通过。
- 标题上限触发路径：单元测试模拟首屏 50 个同名任务和第二页 `标题 (51)`，结果为 `标题 (52)`；断言请求使用基础标题、同一 `cwd` 和下一页游标。
- 分页反例：单元测试模拟 app-server 重复返回同一游标，读取两页后停止，没有无限循环。
- 按钮反例：接线测试确认没有 `turn_id` 的助手消息不满足续接按钮渲染条件。
- 降级路径：分页查询和命名仍位于 `completeContinuationFork.rename`，既有测试覆盖后处理失败仍导航。
- 真实浏览器普通路径：120 轮隔离历史任务在当前虚拟窗口渲染 11 条消息，其中 6 条带 `turn_id` 的助手消息显示续接按钮。
- 真实浏览器触发路径：点击 `msg-item-240` 的续接按钮后进入子任务 `019fb5ea-7f10-7813-8c33-76f6de4ee950`；`thread/fork` 携带父任务 ID 和真实 `lastTurnId`，页面显示“接续自任务”，回链精确指向父任务 `item-240`。
- 真实浏览器标题路径：WebSocket 实际发送 `thread/list { archived: false, cursor: null, cwd: "/home/rrssnas/code/codex-web", limit: 100, searchTerm: "perf-long-user-001", sortDirection: "desc", sortKey: "recency_at" }`；新子任务最终显示 `perf-long-user-001 (3)`，同列表已有 `(2)`，无错误提示。
- 浏览器清理：开发服务已停止，页面已恢复到验证前 URL；隔离环境中新建的验证子任务按规则保留，不执行删除。
