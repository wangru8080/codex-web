# 聊天消息复制按钮修复实施计划

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** 修复聊天消息复制按钮在局域网 HTTP 等 Clipboard API 不可用场景下无法复制的问题，并把按钮文案从 `Copy` 改为“复制”。

**Architecture:** 在现有 `src/lib/clipboard.ts` 中增加统一的文本写入函数：优先调用异步 Clipboard API，缺失或拒绝时回退到临时 textarea + `document.execCommand("copy")`。聊天消息按钮复用该函数并保留成功状态；双重失败时显示现有中文失败提示。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library。

## Global Constraints

- 不改变聊天消息布局和 CodexWeb 现有视觉风格。
- 不引入第三方依赖。
- 按钮可访问名称和 tooltip 均使用“复制”。
- 开发测试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### Task 1: 剪贴板兼容回退

**Files:**
- Modify: `src/lib/clipboard.ts`
- Test: `src/lib/clipboard.test.ts`

**Interfaces:**
- Consumes: 待复制字符串、浏览器 Clipboard API 和 DOM。
- Produces: `writeTextToClipboard(text: string): Promise<void>`。

- [x] **Step 1: 编写失败测试**

覆盖 Clipboard API 成功、API 缺失时 DOM 回退、API 拒绝时 DOM 回退以及双重失败。

- [x] **Step 2: 运行红灯测试**

Run: `npm run test -- --run src/lib/clipboard.test.ts`

Expected: FAIL，当前没有 `writeTextToClipboard`。

- [x] **Step 3: 实现最小回退逻辑**

优先 await `navigator.clipboard.writeText`；失败后创建只读 textarea、选择文本并调用 `document.execCommand("copy")`，最终恢复焦点并清理临时节点。两条路径均失败时抛错。

- [x] **Step 4: 运行定向测试**

Run: `npm run test -- --run src/lib/clipboard.test.ts`

Expected: PASS。

### Task 2: 聊天消息按钮接线与中文文案

**Files:**
- Modify: `src/components/chat/MessageItem.tsx`
- Test: `src/codex-web/chat-message-copy-wiring.test.ts`
- Modify: `docs/exec-plans/active/2026-07-16-chat-message-copy.md`

**Interfaces:**
- Consumes: `writeTextToClipboard`、消息显示文本。
- Produces: 可用的消息复制按钮及“复制”可访问名称。

- [x] **Step 1: 编写失败接线测试**

断言 `MessageItem` 使用统一剪贴板函数，不再直接调用 `navigator.clipboard.writeText`，并包含 `title="复制"` 与 `aria-label="复制"`。

- [x] **Step 2: 修复按钮**

按钮成功时显示现有勾选状态；失败时调用现有 toast 显示“复制失败，可以手动复制：”及原文。

- [x] **Step 3: 运行定向与全量验证**

Run: `npm run test -- --run src/lib/clipboard.test.ts src/codex-web/chat-message-copy-wiring.test.ts`

Run: `npm run test && npm run build`

Expected: 定向测试、全量测试和生产构建通过。

- [x] **Step 4: 更新 Smoke Ledger**

记录正常路径、HTTP 回退路径、失败反例和构建结果；计划保持 active，归档需另行确认。

## Smoke Ledger

- 红灯验证：新增 6 项测试在实现前全部失败，原因分别为统一函数、中文 `title/aria-label` 尚不存在。
- 定向验证：`src/lib/clipboard.test.ts` 与 `src/codex-web/chat-message-copy-wiring.test.ts` 共 6 项通过。
- Clipboard API 正例：`navigator.clipboard.writeText` 可用时直接写入原始消息文本。
- HTTP 回退正例：Clipboard API 缺失或抛出 `NotAllowedError` 时，临时 textarea + `document.execCommand("copy")` 成功写入并清理节点。
- 失败反例：Clipboard API 和 DOM 回退均失败时抛出错误，聊天按钮显示包含原文的“复制失败，可以手动复制”警告，不再静默失败。
- 全量验证：允许回环监听后 `npm run test` 共 50 个测试文件、236 项通过；首次沙箱运行唯一失败为 websocket 测试 `listen EPERM`。
- 生产构建：允许 Turbopack 临时本地端口后 `npm run build` 成功生成 22 个路由，仅保留既有 NFT trace 警告；首次沙箱构建失败原因为 `binding to a port: Operation not permitted`。
- CDP 交互：隔离生产页面强制禁用 Clipboard API，检测到 2 个 `aria-label="复制"` 按钮；点击助手消息按钮后 DOM 回退复制出完整正文 `ORCHID-4729 | medium`，按钮 `title` 为“复制”。
