# 用户输入类 Server Request 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Codex Web 完整处理 `item/tool/requestUserInput` 与 `mcpServer/elicitation/request`，提供真实表单、精确响应、统一排队和正反例 smoke。

**Architecture:** 保留现有 app-server server request 接收链路，把 approval adapter 的队列元素扩展为五类可交互请求，并让响应构造按 method 判别输入与官方 response schema。聊天区在既有 PermissionPrompt 位置渲染专用用户输入表单；队列继续按 JSON-RPC requestId 防重、按 thread 选择可见项，并由响应成功或 `serverRequest/resolved` 推进。

**Tech Stack:** TypeScript、React 19、Next.js、Vitest、Codex app-server generated v2 schema、WebSocket bridge、CDP smoke。

## Global Constraints

- 开发、测试和 smoke 必须显式设置 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- Node 命令使用 `NODE_HOME=/volume2/SSD/node-v24.14.0`。
- 不修改 `/home/rrssnas/code/CodexWeb`。
- 不修改 generated protocol 文件，不猜测 response shape。
- 保持 CodexWeb 现有布局和聊天区视觉结构。
- 用户可见文案同步维护中英文 i18n。
- 不执行删除命令，不复制 CodexBrowser 或 CodePilot 代码。

---

### Task 1: Server Request 协议适配与队列

**Files:**
- Modify: `src/codex-web/approval-adapter.ts`
- Modify: `src/codex-web/approval-adapter.test.ts`
- Modify: `src/codex-web/approval-queue-adapter.ts`
- Modify: `src/codex-web/approval-queue-adapter.test.ts`

**Interfaces:**
- Produces: `AppServerPendingRequest` 五分支联合类型。
- Produces: `AppServerRequestResponseInput` 按请求 method 约束的 UI 响应输入。
- Produces: `mapServerRequestToPendingRequest(request)`。
- Produces: `buildServerRequestResponse(request, input)`。

- [x] **Step 1: 写失败测试**

覆盖 `requestUserInput` 的 question id/secret/options 映射和 `{answers}`；覆盖 MCP accept/decline/cancel 的 `{action, content, _meta}`；断言错误 method/input 组合会抛错。

- [x] **Step 2: 运行 targeted test 并确认失败**

Run: `npm run test -- src/codex-web/approval-adapter.test.ts src/codex-web/approval-queue-adapter.test.ts`

Expected: FAIL，缺少新类型、映射或响应构造。

- [x] **Step 3: 最小实现协议适配器与通用队列类型**

使用 generated `ToolRequestUserInput*`、`McpServerElicitationRequest*` 类型；现有 command/file/permissions response 保持逐字节等价。

- [x] **Step 4: 运行 targeted test**

Expected: PASS。

### Task 2: Provider 与页面响应链路

**Files:**
- Modify: `src/codex-web/app-server-state.ts`
- Modify: `src/codex-web/AppServerProvider.tsx`
- Modify: `src/components/chat/ChatView.tsx`
- Modify: `src/app/chat/page.tsx`
- Modify: `src/app/chat/[id]/page.tsx`

**Interfaces:**
- Changes: `pendingApprovals` 的元素类型扩展为 `AppServerPendingRequest`，保留字段名兼容现有消费者。
- Produces: `respondToServerRequest(input, requestId?)`，成功后移除，失败后允许重试。
- Consumes: `serverRequest/resolved` notification 的 `requestId`。

- [x] **Step 1: 更新 Provider 类型并让五类 request 入队**

未知 request 继续 `respondError` 并记录 diagnostics；已支持 request 统一进入 FIFO。

- [x] **Step 2: 用通用响应输入替换页面 approval-only 回调**

当前 route 只选择属于当前 thread/resumed thread 的第一个请求；新聊天只在 thread 已确定后展示请求。

- [x] **Step 3: 验证 guard、resolved 与跨 thread 行为**

Run: `npm run test -- src/codex-web`

Expected: PASS，stale/duplicate 不发送 response。

### Task 3: 用户输入与 MCP 表单

**Files:**
- Create: `src/codex-web/server-request-form-adapter.ts`
- Create: `src/codex-web/server-request-form-adapter.test.ts`
- Create: `src/components/chat/AppServerRequestPrompt.tsx`
- Modify: `src/components/chat/PermissionPrompt.tsx`
- Modify: `src/components/chat/ChatView.tsx`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`

**Interfaces:**
- Produces: requestUserInput 表单状态校验和 response input 构造。
- Produces: MCP typed form 字段归一化、默认值、必填/范围/长度校验和 content 构造。
- Produces: `AppServerRequestPrompt({request, onRespond})`。

- [x] **Step 1: 写表单纯函数失败测试**

覆盖单选、自由输入、secret、多问题完整性；MCP string/number/boolean/single-select/multi-select、required、默认值、min/max；空值和类型错误为反例。

- [x] **Step 2: 实现纯表单适配器**

`requestUserInput` 仅以 question id 作为 response key；MCP content 保留 boolean/number/array 的 JSON 类型。

- [x] **Step 3: 实现 UI**

使用现有 Button/Input/Checkbox/Select/Textarea 风格；MCP URL 用外链按钮及 accept/decline/cancel；`openai/form` 明确 unsupported，只允许 decline/cancel。

- [x] **Step 4: 接入聊天底部并禁用 composer**

app-server 用户输入请求不再通过旧 `PermissionRequestEvent` 冒充 approval；旧 Claude `AskUserQuestion` 路径保持不变。

### Task 4: 正反例 Smoke 与完整验证

**Files:**
- Create: `scripts/user-input-server-request-smoke.ts`
- Modify: `package.json`
- Modify: `docs/exec-plans/active/2026-07-19-user-input-server-requests.md`

**Interfaces:**
- Produces: `npm run test:smoke:user-input`。

- [x] **Step 1: 构造隔离 fake app-server/bridge UI smoke**

依次发送 requestUserInput、MCP form、普通 approval、跨 thread 请求，捕获浏览器返回的 JSON-RPC result。

- [x] **Step 2: 断言正例**

填写用户问题和 MCP typed form 后，断言响应严格等于 generated schema 所需形状，且队列推进。

- [x] **Step 3: 断言反例**

未答完时提交禁用；普通 approval 不显示用户输入字段；MCP decline/cancel 的 `content` 为 `null`；其他 thread 和后入队请求不抢占当前项。

- [x] **Step 4: 完整验证**

Run:

```bash
export NODE_HOME=/volume2/SSD/node-v24.14.0
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run build
npm run test:smoke:user-input
```

Expected: 全部退出码为 0。

### Task 5: requestUserInput 自动处理与 TUI 对齐

**Files:**
- Modify: `src/codex-web/server-request-form-adapter.ts`
- Modify: `src/codex-web/server-request-form-adapter.test.ts`
- Modify: `src/components/chat/AppServerRequestPrompt.tsx`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`
- Modify: `scripts/user-input-server-request-smoke.ts`

- [x] **Step 1: 用纯函数测试锁定 TUI 计时语义**

`autoResolutionMs` 仅作为启用信号；固定静默 60 秒、显示倒计时 60 秒，并覆盖 60 秒与 120 秒边界。

- [x] **Step 2: 接入 requestUserInput 表单**

到期提交 `{ answers: {} }`；指针、键盘、粘贴、选项和输入框交互暂停当前请求的自动处理；MCP 和普通 approval 不启用计时。

- [x] **Step 3: 扩展真实浏览器正反例 smoke**

使用 CDP 可控浏览器时钟验证静默期、可见倒计时、自动空响应、交互暂停和队列重置。

- [x] **Step 4: 完整验证**

Run:

```bash
export NODE_HOME=/volume2/SSD/node-v24.14.0
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run build
npm run test:smoke:user-input
```

Expected: 全部退出码为 0。

## 状态总览

- 当前状态：`Code complete`、`Tests pass`、`Smoke passed`、`Review passed`。
- Source breadcrumb：`app-server.serverRequest`。
- 生成协议依据：`src/codex/protocol/generated/ServerRequest.ts` 及对应 v2 params/response。
- UI 基准：CodexWeb `PermissionPrompt` 与聊天底部阻塞交互。
- TUI 基准：`tui/src/chatwidget/tool_requests.rs`、`tui/src/bottom_pane/request_user_input.rs`、`tui/src/bottom_pane/mcp_server_elicitation.rs`。

## 决策日志

- 2026-07-19：不复用旧 `AskUserQuestionUI` 的按问题文本字符串响应，因为 app-server 要求 question id 到 string array 的映射。
- 2026-07-19：`openai/form` 遵循官方 TUI 的保守行为，不猜测任意 schema；UI 提供明确的拒绝/取消出口。
- 2026-07-19：不重命名历史 `pendingApprovals` 字段，以减少无关改动；其元素语义扩展为所有用户可处理 server request。
- 2026-07-19：浏览器 smoke 发现空历史 thread 的欢迎态只禁用 composer、不渲染 prompt；已把两类 prompt 同步接入欢迎态和消息态。
- 2026-07-19：CDP smoke 使用语言无关的语义定位器，不依赖中英文显示文案。
- 2026-07-19：对齐当前官方 TUI：`autoResolutionMs` 只表示启用，实际采用固定 60 秒静默期和 60 秒可见倒计时；任意用户表单交互暂停自动处理，到期返回空 `answers`。

## Smoke Ledger

- 正例：`item/tool/requestUserInput` 选择选项并填写 secret 后，收到以 question id 为 key、答案为 string array 的 response。
- 正例：MCP typed form 保留 string、boolean 和 `_meta` 的 JSON 类型，accept response 与 generated schema 一致。
- 反例：零回答及只回答部分问题时提交按钮保持禁用。
- 反例：MCP decline/cancel 的 `content` 和 `_meta` 均为 `null`，不泄漏已填表单值或请求 metadata。
- 反例：普通 command approval 不渲染用户输入表单，仍返回 `{ decision: "decline" }`。
- 反例：其他 thread 的请求即使更早入队，也不抢占当前 thread 表单；当前 thread 清空后 composer 恢复可用。
- 正例：计时纯函数在静默期、可见倒计时和 120 秒到期边界与官方 TUI 一致。
- 反例：`autoResolutionMs` 的 60 秒与 240 秒具体值不改变固定 120 秒策略；用户交互后到期不自动响应。
- `npx vitest run src/codex-web/server-request-form-adapter.test.ts src/codex-web/approval-adapter.test.ts src/codex-web/approval-queue-adapter.test.ts`：3 个文件、23 项通过。
- `npx tsc --noEmit`：通过。
- 正例：真实浏览器在静默期后显示倒计时，下一请求重新计时，并在到期时返回 `{ answers: {} }`。
- 反例：真实浏览器选择选项后倒计时消失；推进浏览器时钟超过 120 秒仍不自动响应，手动提交保持原答案。
- `npm run test -- src/codex-web`：67 个文件、310 项通过。
- `npm run test`：87 个文件、420 项通过；沙箱内 bridge 监听因 `EPERM` 失败后，按规则在沙箱外原样重跑通过。
- `npm run test:smoke:user-input`：通过；使用隔离 fake app-server、Next dev 与 CDP 浏览器。
- `npm run build`：通过，23 个路由完成构建；保留既有 `next.config.mjs` NFT 动态追踪 warning。
