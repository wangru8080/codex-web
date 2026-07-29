# 长文本粘贴附件实施计划

> **For agentic workers:** 在当前会话内按任务逐项实施并更新复选框；不自动提交或推送 Git。

**Goal:** 对齐官方 Codex App：粘贴超过 1000 个 Unicode 字符的纯文本时自动生成 `pasted-text.txt` 附件，发送后可从用户消息打开右侧只读文件预览。

**Architecture:** 输入层只负责把长文本转换为浏览器原生 `File`，继续走现有 `FileAttachment`、app-server `fs/writeFile`、`Files mentioned by the user` 信封和历史恢复链路。发送回调携带已持久化附件，以便乐观消息立即拥有 app-server 文件路径；附件点击复用现有 `PreviewSource` 和右侧工作区标签页。

**Tech Stack:** React 19、TypeScript、Codex app-server JSON-RPC v2、Vitest、Playwright smoke。

## Global Constraints

- 官方 TUI 阈值为超过 1000 个 Unicode 字符，并先把 `CRLF/CR` 统一为 `LF`。
- 仅 Codex Web 的 Codex composer 启用长粘贴附件化；短粘贴保持浏览器原生文本输入。
- 不新增第三方依赖，不新增私有 app-server 输入类型。
- 附件继续保存到 app-server 事实源 `$CODEX_HOME/attachments/<UUID>/pasted-text.txt`。
- 附件预览通过 app-server `fs/readFile`，外部于工作区的附件只读打开。
- 验证使用默认隔离环境 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不删除文件；仅在完成后把本计划从 active 移到 completed。

---

### Task 1: 长粘贴识别与输入附件化

**Files:**
- Modify: `src/lib/message-input-logic.ts`
- Modify: `src/lib/tests/message-input-logic.test.ts`
- Modify: `src/components/ai-elements/prompt-input.tsx`
- Modify: `src/components/chat/MessageInput.tsx`

**Interfaces:**
- Produces: `normalizePastedText(text)` 与 `shouldAttachPastedText(text)`。
- Consumes: `PromptInputTextarea` 的 `pasteLongTextAsFile` 开关。

- [x] 增加阈值边界、Unicode 字符和换行归一化失败测试。
- [x] 实现纯函数并让定向测试通过。
- [x] 在 Codex composer 中把命中阈值的文本转为 `text/plain` 的 `pasted-text.txt`。
- [x] 断言短文本、恰好 1000 字符及文件粘贴路径不变。

### Task 2: 已持久化路径回传与右侧预览

**Files:**
- Modify: `src/codex-web/AppServerProvider.tsx`
- Modify: `src/components/chat/ChatView.tsx`
- Modify: `src/components/chat/FileAttachmentDisplay.tsx`
- Modify: `src/codex-web/tests/app-server-image-attachment-wiring.test.ts`
- Create: `src/codex-web/tests/long-paste-attachment-wiring.test.ts`

**Interfaces:**
- Produces: `onAccepted(threadId, turnId, persistedFiles)`。
- Consumes: `FileAttachment.filePath` 和 `usePanel().setPreviewSource`。

- [x] 先写接线测试，证明当前回调不回传持久化路径且非图片附件不可点击。
- [x] 让发送回调把持久化附件交给乐观消息。
- [x] 仅对带 `filePath` 的普通文件提供点击行为，以 `user-selected`、`readonly` 打开右侧预览。
- [x] 验证历史恢复附件继续使用相同点击路径。

### Task 3: 全量验证与收口

**Files:**
- Modify: `docs/exec-plans/active/2026-07-29-long-paste-text-attachment.md`
- Move after completion: `docs/exec-plans/active/2026-07-29-long-paste-text-attachment.md` → `docs/exec-plans/completed/2026-07-29-long-paste-text-attachment.md`

- [x] 运行定向 Vitest，覆盖长粘贴正例与短粘贴反例。
- [x] 运行 `npm run test`。
- [x] 运行 `npm run build`。
- [x] 使用隔离 `CODEX_HOME` 运行 `npm run test:smoke`。
- [x] 启动应用做一次长粘贴、发送、点击右侧预览的 UI 验证。
- [x] 更新本文件的状态、决策日志和 Smoke Ledger，随后归档。

## 状态总览

- 当前状态：Code complete、Tests pass、Smoke passed、Review passed。
- 已补齐缺口：长文本粘贴生成附件；发送后普通文件附件可从消息打开右侧只读预览。

## 决策日志

- 2026-07-29：采用官方 TUI 的 `> 1000` Unicode 字符阈值和换行归一化规则。
- 2026-07-29：复用已有普通附件协议与持久化，不引入新的 `UserInput` 类型。
- 2026-07-29：附件路径由发送回调返回给乐观消息，避免等待历史刷新后才能预览。
- 2026-07-30：实际 UI 验证使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 和临时 Web 登录配置；未读取或修改真实 Codex 账号环境。

## Smoke Ledger

- 正例：定向 Vitest 与 Playwright 实测 1001 个 Unicode 字符粘贴会阻止原生输入并生成 `pasted-text.txt`。
- 反例：定向 Vitest 与 Playwright 实测恰好 1000 个 Unicode 字符不会生成附件，粘贴事件保持浏览器默认处理。
- 发送链路：附件独立发送成功，app-server 持久化到隔离 `$CODEX_HOME/attachments/<UUID>/pasted-text.txt`，消息附件带真实 `filePath`。
- 预览链路：点击消息附件后，右侧工作区以“外部 · 只读”打开文本预览，文件名、路径、行号和内容与粘贴内容一致。
- 定向测试：3 个测试文件、30 个测试全部通过。
- 全量测试：150 个测试文件、689 个测试全部通过。
- 构建：`npm run build` 通过，26 个静态页面生成完成。
- Bridge smoke：`npm run test:smoke` 通过，模型 5 个，账号来源为 `app-server.account/read`。
- 浏览器控制台：业务交互无新增应用错误；观察到开发环境 HMR WebSocket 和浏览器扩展注入错误，与本功能无关。
