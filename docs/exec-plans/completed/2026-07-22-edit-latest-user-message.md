# 最近用户问题编辑功能实施计划

关联交接文档：[最近用户问题编辑功能交接](../../handover/2026-07-22-edit-latest-user-message.md)

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** 为最后一个已完成回答对应的用户问题增加就地编辑功能，并严格复现官方 Codex 0.144.6 的 `thread/rollback` 后 `turn/start` 会话语义。

**Architecture:** 浏览器只对最后一个已完成 turn 的用户消息暴露编辑入口。确认发送后，Provider 先向同一 thread 请求 `thread/rollback { numTurns: 1 }`，ChatView 使用响应中的剩余 turns 裁剪本地消息，再复用现有 `turn/start` 链路发送编辑后的文本和原附件；不创建新 thread，也不伪造本地历史。

**Tech Stack:** React 19、TypeScript、Next.js 16、Codex app-server JSON-RPC、Vitest、Playwright smoke。

## Global Constraints

- 开发、测试、smoke 和浏览器验证显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 以 `/volume2/SSD/codex/Temp/codex-session/` 中官方 Codex 0.144.6 的 rollout 为行为基准。
- 只允许编辑最后一个已完成回答对应的用户问题；较早问题、运行中 turn 和没有完整回答的用户问题不显示编辑入口。
- `thread/rollback` 只修改会话历史，不撤销旧回答产生的本地文件改动；UI 和文档不得暗示文件已恢复。
- 不修改 `/home/rrssnas/code/CodexWeb`，不引入第三方依赖，不使用真实本地 `CODEX_HOME`。
- 当前协议把 `thread/rollback` 标记为 deprecated，但官方 Codex 0.144.6 仍实际使用；本次保持版本行为一致并记录升级风险。

---

### Task 1: 回滚协议与纯状态裁剪

**Files:**
- Create: `src/codex-web/thread-rollback.ts`
- Test: `src/codex-web/thread-rollback.test.ts`
- Modify: `src/codex-web/AppServerProvider.tsx`

**Interfaces:**
- Consumes: `ThreadRollbackParams { threadId, numTurns }`、`ThreadRollbackResponse`。
- Produces: `rollbackThread(params): Promise<ThreadRollbackResponse>`、只保留回滚响应中有效 turns 对应消息的纯函数。

- [x] **Step 1: 编写失败测试**

覆盖请求 method/params 精确为 `thread/rollback` 与 `{ threadId, numTurns: 1 }`；消息裁剪保留较早 turns，移除最后一轮用户消息和回答；未知 message id 不误删。

- [x] **Step 2: 运行红灯测试**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npx vitest run src/codex-web/thread-rollback.test.ts
```

Expected: FAIL，因为纯裁剪模块和 Provider action 尚不存在。

- [x] **Step 3: 实现最小协议动作**

Provider 使用已生成的参数和响应类型调用 `client.request("thread/rollback", params)`；连接缺失时快速失败。纯函数按 rollback response 的 turn item ids 构建有效消息集合，不依赖字符串猜测。

- [x] **Step 4: 运行定向测试**

运行步骤 2 命令，Expected: PASS。

### Task 2: 最近问题编辑 UI

**Files:**
- Modify: `src/components/chat/MessageList.tsx`
- Modify: `src/components/chat/MessageItem.tsx`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Test: `src/codex-web/latest-user-message-edit.test.tsx`

**Interfaces:**
- Consumes: 最后一个已完成回答的位置、当前 streaming 状态、用户消息解析后的正文与附件。
- Produces: `onEditMessage(message, content, files)` 回调；就地编辑框的取消、发送和提交中状态。

- [x] **Step 1: 编写失败 UI 测试**

断言最后一轮用户消息有“编辑”按钮，较早消息和运行中 turn 没有；点击后原气泡替换为预填 textarea；取消恢复；空文本且无附件不能发送；提交中按钮禁用。

- [x] **Step 2: 实现截图对应交互**

在现有用户消息宽度和颜色体系内渲染编辑框，使用项目现有 `NotePencil` 图标、`Textarea` 和 `Button`；保留原附件，仅编辑问题正文；支持 `Escape` 取消和 `Ctrl/Cmd+Enter` 发送。

- [x] **Step 3: 运行 UI 定向测试**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npx vitest run src/codex-web/latest-user-message-edit.test.tsx
```

Expected: PASS。

### Task 3: rollback 后重新发送

**Files:**
- Modify: `src/app/chat/[id]/page.tsx`
- Modify: `src/components/chat/ChatView.tsx`
- Test: `src/codex-web/app-server-message-edit-wiring.test.ts`

**Interfaces:**
- Consumes: `rollbackThread({ threadId, numTurns: 1 })`、编辑正文、原附件、现有 `sendMessage`。
- Produces: 同 thread 的官方顺序 `thread/rollback` → 本地历史裁剪 → `turn/start`。

- [x] **Step 1: 编写失败接线测试**

断言历史页向 ChatView 传递 rollback action；ChatView 只在 rollback 成功后裁剪旧轮并调用现有 send；rollback 失败时旧历史保持且不调用 send；新 turn 失败时不恢复已被 app-server 回滚的旧轮。

- [x] **Step 2: 实现最小编排**

编辑回调拒绝运行中和 pending approval 状态；成功回滚后以响应 thread 为事实源替换消息，再调用现有发送链路，从而复用模型、effort、mode、permission profile、附件持久化和 optimistic message 行为。

- [x] **Step 3: 运行定向回归**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npx vitest run src/codex-web/thread-rollback.test.ts src/codex-web/latest-user-message-edit.test.tsx src/codex-web/app-server-message-edit-wiring.test.ts
```

Expected: PASS。

### Task 4: 完整验证与交接

**Files:**
- Create: `docs/handover/2026-07-22-edit-latest-user-message.md`
- Modify: `docs/exec-plans/active/2026-07-22-edit-latest-user-message.md`
- Move: `docs/exec-plans/active/2026-07-22-edit-latest-user-message.md` → `docs/exec-plans/completed/2026-07-22-edit-latest-user-message.md`

**Interfaces:**
- Consumes: 隔离 app-server、Web 应用、官方 rollout 对照。
- Produces: 测试记录、反例 Smoke Ledger、协议升级风险说明。

- [x] **Step 1: 运行完整测试和构建**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run build
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test:smoke
```

Expected: typecheck、Vitest、生产构建和基础 app-server smoke 全部通过。

- [x] **Step 2: 浏览器交互验证**

启动隔离 dev server，验证最后一轮铅笔按钮、编辑框布局、取消、编辑发送和 console；在桌面及移动宽度检查文本和按钮无重叠。

- [x] **Step 3: 反例 smoke**

验证较早问题无按钮、生成中无按钮、取消不产生 `thread/rollback`、rollback 失败不产生 `turn/start`，并确认编辑后 URL/thread id 不变、旧最后一轮从 UI 消失。

- [x] **Step 4: 更新文档并归档**

交接文档记录 session 证据、source breadcrumb、弃用风险和文件副作用边界；Smoke Ledger 写入实际命令与结果后，将计划移动到 completed。

## Smoke Ledger

| 路径 | 预期 | 状态 | 证据 |
|---|---|---|---|
| 官方协议顺序 | rollback 成功后才裁剪并发送 | 通过 | 定向接线测试按源码索引断言 `rollback -> replace -> sendMessage` |
| 较早/未回答/生成中消息 | 不显示编辑入口 | 通过 | `latestEditableUserMessageId` 正反例测试 |
| rollback 失败 | 不裁剪、不发送新 turn | 通过 | await 顺序与异常分支接线测试 |
| 跨客户端 | 第二客户端移除旧最后一轮 | 通过 | bridge 白名单、payload 校验、消息裁剪和 WebSocket 集成测试 |
| 全量回归 | typecheck 和 unit 全部通过 | 通过 | 107 个文件、520 项测试 |
| 生产构建 | 生成全部路由 | 通过 | 22 个路由；仅既有 NFT trace warning |
| 基础 app-server smoke | 隔离 home 初始化、模型、账号来源正常 | 通过 | models=7，accountSource=`app-server.account/read` |
| 完成态编辑入口 | 只在最后一条已完成用户消息显示 | 通过 | 隔离 31 回合 fixture；当前可见 30 条用户消息，`editCount=1`，入口属于 `user-31`，较早消息均无入口 |
| 生成中反例 | 流式回答期间不显示编辑入口 | 通过 | 旧 `browser-thread` 页面处于“组织回复中”，`editCount=0` |
| 桌面视觉点击 | 原气泡替换为预填编辑框，取消和 Escape 恢复原文 | 通过 | 1440x1000 直接 CDP；textarea 自动聚焦，取消后原文不变，console 无新增异常 |
| 移动端响应式 | 编辑框与按钮无重叠、页面无横向溢出 | 通过 | 390x844 CDP emulation；编辑框宽 346px，textarea 与按钮不重叠，`pageHorizontalOverflow=false` |
| 编辑发送链路 | rollback 后在同 thread 重新发送 | 通过（自动化） | 定向接线测试覆盖 `rollback -> replace -> turn/start`；隔离环境未登录，CDP 不使用真实账户执行实际生成 |

## 状态总览

- 当前状态：代码、测试和功能级视觉 smoke 完成
- 完成状态词：`Code complete`、`Tests pass`、`Smoke passed`

## 决策日志

- 2026-07-22：采用官方 Codex 0.144.6 实际使用的 `thread/rollback { numTurns: 1 }`，不创建 fork 或新 thread。
- 2026-07-22：编辑入口只绑定最后一个已有助手回答的用户消息，避免把尚未形成完整 turn 的输入误判为可回滚轮次。
- 2026-07-22：rollback 成功即以响应 thread 为事实源；若随后 `turn/start` 失败，不在前端伪造恢复旧轮。
- 2026-07-22：playwright-mcp 因复用的 CDP profile 积累旧 target 而初始化超时；按项目规则停止重试，改用单 target 原始 CDP 完成桌面、移动端、交互和 console 验证。
