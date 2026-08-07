# 聊天 Turn 乱序恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复弱网下终态被迟到事件重新激活，以及用户消息晚于思考内容显示的问题。

**Architecture:** app-server notification 继续作为 Turn 状态事实源，在 reducer 中保证同一 Turn 的终态不可逆。用户输入属于本地已发起事实，在调用 `turn/start` 前立即显示；请求接受后原位补充真实 Turn 信息，请求明确失败时只撤回本次临时消息。

**Tech Stack:** React、TypeScript、Codex app-server、Vitest。

## Global Constraints

- 不新增依赖，不改变 app-server 协议。
- 只修改聊天发送与 Turn 状态边界。
- 用户消息必须先于任何思考或工具通知展示。
- 同一 Turn 的终态不可被迟到的 `turn/started` 覆盖，下一 Turn 不受影响。
- 使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 验证。

---

### Task 1: Turn 终态单调性

**Files:**
- Modify: `src/codex-web/turn-reducer.ts`
- Test: `src/codex-web/tests/turn-reducer.test.ts`

**Interfaces:**
- Consumes: `reduceAppServerTurnNotification(state, notification)`。
- Produces: 同一 Turn 进入终态后忽略迟到 `turn/started` 的 reducer 行为。

- [x] 写入终态后迟到 `turn/started` 的失败测试。
- [x] 运行 targeted test，确认测试失败。
- [x] 增加同一 Turn 终态保护。
- [x] 运行 targeted test，确认同一 Turn 保持终态且下一 Turn 正常开始。

### Task 2: 用户消息即时展示

**Files:**
- Modify: `src/components/chat/ChatView.tsx`
- Test: `src/codex-web/tests/chat-send-race-wiring.test.ts`

**Interfaces:**
- Consumes: `appServerSend` 的 `onAccepted(threadId, turnId, acceptedFiles)` 回调。
- Produces: 请求前可见、接受后补全、失败后精确撤回的单条用户消息。

- [x] 写入发送时序与失败撤回的接线测试。
- [x] 运行 targeted test，确认测试失败。
- [x] 在等待 `turn/start` 前插入临时用户消息。
- [x] 在 `onAccepted` 中原位补充 `threadId`、`turnId` 和持久化附件。
- [x] 请求未接受即失败时，仅按本次临时消息 ID 撤回。
- [x] 运行 targeted test，确认通过。

### Task 3: 回归验证

**Files:**
- Modify: `docs/exec-plans/active/2026-08-07-chat-turn-race-recovery.md`

**Interfaces:**
- Consumes: Task 1、Task 2 的完成实现。
- Produces: 完整测试、构建与正反例 Smoke Ledger。

- [x] 运行 `npm run test`。
- [x] 运行 `npm run build`。
- [x] 启动应用并验证服务响应；使用行为测试覆盖正常顺序与模拟弱网顺序。
- [x] 更新 Smoke Ledger 和自查。

## Smoke Ledger

- targeted RED：新增 3 个断言按预期失败，分别命中终态回退、发送前未展示、失败未精确撤回。
- targeted GREEN：4 个相关测试文件、31 个测试全部通过。
- `npm run test`：TypeScript 类型检查通过；178 个测试文件、844 个测试全部通过。
- `npm run build`：Next.js 生产构建通过，28 个静态页面生成完成。
- `npm run test:smoke`：隔离 `CODEX_HOME` 下 bridge、`model/list`、`account/read` 通过。
- 生产服务：隔离 `CODEX_HOME` 下执行 `npm run start`，真实浏览器进入已有会话并完成发送。
- Playwright MCP：桌面和 390×844 移动端确认用户问题先于回答显示；完成后等待 10 秒，停止按钮没有复活，旧流式内容没有重复出现。
- 附件弱网反例：图片发送后 300ms 内问题和附件各显示 1 份；浏览器离线 3 秒再恢复后仍各 1 份，回答正常到达，停止按钮最终归零。
- 附件持久化反例：刷新会话后问题、回答和附件仍各 1 份；点击附件可从 app-server 持久化路径打开只读图片预览。
- 浏览器 console 只有既有 `/api/settings/workspace` 404，没有本次改动新增的 JavaScript 错误。
- 正例：新 Turn 的 `turn/started` 仍清空上一轮并进入 running。
- 反例：同一 Turn 完成后迟到 `turn/started` 不再恢复 streaming；请求未接受即失败时仅撤回本次用户消息。

## 自查

- [x] i18n：未新增用户可见文案。
- [x] 数据库：无 schema 或迁移改动。
- [x] 协议：不修改 app-server method、params 或 response。
- [x] 反例：下一 Turn 仍可进入 running；请求失败不留下幽灵消息。
