# 在新任务中继续回归修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复续接任务后的重复输出、分支标记漂移和消息操作按钮间距问题。

**Architecture:** 继续以 app-server `thread/fork(lastTurnId)` 为事实源。消息合并按 assistant `turn_id` 去重；分支标记作为虚拟消息列表中的固定合成行插入继承边界之后；消息操作按钮使用紧凑图标组。

**Tech Stack:** Next.js、React、TypeScript、React Virtuoso、Vitest、Playwright MCP。

## Global Constraints

- 不修改生成协议文件和 `codex-core`。
- 不增加第三方依赖。
- UI 状态继续来自 app-server thread/turn 数据。
- 使用隔离环境 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 验证。

---

### Task 1: 消息按 Turn 去重

**Files:**
- Modify: `src/codex-web/thread-turns-page-adapter.ts`
- Modify: `src/components/chat/ChatView.tsx`
- Test: `src/codex-web/tests/thread-turns-page-adapter.test.ts`

- [x] 增加同一 assistant turn 不重复合并的失败测试。
- [x] 让 `mergeThreadTurnMessages` 优先使用 `session_id + turn_id + role` 作为 assistant 消息键。
- [x] terminal turn 完成时复用该合并函数。
- [x] 运行 targeted test。

### Task 2: 固定分支边界标记

**Files:**
- Modify: `src/app/chat/[id]/page.tsx`
- Modify: `src/components/chat/ChatView.tsx`
- Modify: `src/components/chat/MessageList.tsx`
- Modify: `src/components/chat/message-list-virtualization.ts`
- Test: `src/components/chat/tests/message-list-virtualization.test.ts`

- [x] 增加后续消息追加后边界索引保持不变的失败测试。
- [x] 将“接续自任务”改为插入继承消息后的合成行。
- [x] 删除 Virtuoso Footer 接线。
- [x] 验证回链仍指向父任务对应消息锚点。

### Task 3: 对齐消息操作栏

**Files:**
- Modify: `src/components/chat/MessageItem.tsx`

- [x] 将 assistant 操作顺序调整为复制、续接、时间。
- [x] 使用 `icon-xs` 和紧凑间距对齐官方布局。
- [x] 运行完整测试、构建和真实浏览器多轮反例验证。

## 决策记录

- app-server `Thread` 只提供 `forkedFromId`，不保留分叉时的 `lastTurnId`；父子任务后续还可能产生相同序号的 `item-*`。因此在 `thread/fork` 成功时，以新子任务 ID 保存父任务 ID、真实 `lastTurnId` 和父消息锚点，供重新进入子任务时恢复固定边界。
- 旧子任务没有保存的导航引用时，继续使用父子任务 Turn 交集作为兼容回退。

## Smoke Ledger

- 普通路径：父任务继续到第五轮，消息正常显示，操作栏顺序为复制、续接、时间。
- 触发路径：从父任务第三轮输出分叉，新子任务连续发送第四、第五轮；两条助手输出各出现一次。
- 反例：新增两轮后，“接续自任务”仍位于第三轮输出 `msg-item-6` 之后，没有移动到列表底部。
- 回链：点击“接续自任务”跳回父任务 `#msg-item-6`，目标“第三轮输出”在视口内可见。
- 浏览器控制台：功能请求无新增错误；保留既有 `/api/settings/workspace` 404。
