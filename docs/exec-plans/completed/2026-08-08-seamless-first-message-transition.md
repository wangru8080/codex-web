# 新对话首条消息无闪烁交接执行计划

> **执行要求：** 按任务逐项实现和验证，使用复选框追踪状态。

**目标：** 新对话发送后立即展示用户问题，在 app-server 接受后无闪烁进入详情页，并让文件变更数量和右侧文件树继续由真实事件驱动。

**架构：** 复用现有临时用户消息、跨客户端消息状态和 app-server Turn reducer。新对话页保持同一个 `MessageInput` 实例，在请求前加入临时消息；详情页加载期间读取已发布的用户消息作为交接视图，历史加载后通过现有合并逻辑去重。

**技术栈：** Next.js 16、React 19、TypeScript、Vitest、Codex app-server。

## 全局约束

- 不新增依赖，不修改 app-server 协议。
- app-server notification 继续作为 Turn、文件变更和文件系统状态事实源。
- 服务端接受前保留 composer 草稿；刷新或发送失败时不得静默丢失，也不得自动重发。
- 使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 验证。

---

### 任务 1：锁定首条消息发送时序

**文件：**

- 修改：`src/codex-web/tests/chat-send-race-wiring.test.ts`
- 修改：`src/app/chat/page.tsx`

**接口：**

- 输入：`MessageInput.onSend(content, files, ...)`。
- 输出：请求前临时消息、接受后真实 Turn 信息、未接受失败时精确撤回并返回 `false`。

- [x] 添加新对话发送时序失败测试。
- [x] 运行定向测试并确认修复前失败。
- [x] 保持单一 composer 实例并提前加入临时消息。
- [x] 在接受回调中原位补充 Turn 信息，失败时撤回。
- [x] 运行定向测试并确认通过。

### 任务 2：消除详情路由加载闪烁

**文件：**

- 修改：`src/app/chat/[id]/page.tsx`
- 新增：`src/codex-web/tests/new-chat-route-handoff.test.ts`

**接口：**

- 输入：`crossClientUserMessagesByThreadId[id]`。
- 输出：详情数据加载期间仍展示已接受的用户问题，加载完成后由历史消息无重复接管。

- [x] 添加路由交接失败测试。
- [x] 运行定向测试并确认修复前失败。
- [x] 在详情加载状态渲染现有 `MessageList` 交接内容。
- [x] 运行定向测试并确认通过。

### 任务 3：回归与浏览器验证

**文件：**

- 修改：`docs/exec-plans/active/2026-08-08-seamless-first-message-transition.md`

**接口：**

- 输入：普通发送、发送失败、立即刷新、文件修改和无文件修改场景。
- 输出：测试结果、浏览器观察与反例 Smoke Ledger。

- [x] 运行相关定向测试。
- [x] 运行 `npm run test`。
- [x] 运行 `npm run build`。
- [x] 使用隔离环境启动应用并完成浏览器正反例验证。
- [x] 更新 Smoke Ledger 并归档计划。

## Smoke Ledger

| 场景 | 预期 | 结果 |
| --- | --- | --- |
| 新对话普通发送 | 点击后立即显示问题，详情页交接不闪空 | Playwright 完成新对话发送并进入真实 Thread 路由；源码时序测试确认临时问题先于请求，交接视图在历史加载前复用已接受消息 |
| 发送未接受即失败 | 临时问题撤回，输入与附件恢复 | 定向测试确认只撤回本次临时消息并返回 `false`，复用 `MessageInput` 既有恢复契约 |
| 发送后立即刷新 | 已接受则从 Thread 恢复；未接受不自动重发 | 已接受 Thread 强刷后问题与回答均恢复；待接受草稿模拟强刷后恢复到输入框，一次性标记被消费且未触发自动发送 |
| 有文件变更 | 真实 patch 事件到达后显示文件数量并刷新文件树 | 隔离临时项目显示“1 个文件已更改、+1/-0”，右侧文件树出现 `ux-handoff-validation-20260808.txt` |
| 无文件变更 | 不显示文件变更数量 | “只回复 OK”普通 Turn 完成并强刷后，`composer-file-changes` 保持不存在 |

## 验证结果

- **Code complete**：新对话即时问题、接受后路由交接和刷新草稿恢复均已实现。
- **Tests pass**：`npm run test` 通过，180 个测试文件、865 个测试全部通过。
- **Smoke passed**：隔离 `CODEX_HOME` 下完成桌面与 390×844 移动端浏览器验证；移动端无水平溢出。
- **Review passed**：`git diff --check` 通过；未新增依赖、协议或数据库改动。
- 浏览器 console 仅有既有 `/api/settings/workspace` 404，没有本次改动新增的 JavaScript 错误。
