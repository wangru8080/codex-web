# 文件片段引用 UI 实施计划

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** 把 Markdown 预览的“加入对话”从长文本填充改为带文件名与起止行的紧凑引用卡片，并在发送后的用户消息上方保持同样的引用展示。

**Architecture:** 新增纯函数协议统一处理源文本行号定位、模型提示词封装和用户消息元数据封装。`PreviewPanel` 只生产结构化片段，`MessageInput` 保存并展示待发送卡片，`MessageItem` 与 app-server 历史适配器共同消费可逆元数据；模型仍收到完整选区正文，用户界面只显示引用卡片。

**Tech Stack:** React 19、Next.js 16、TypeScript、Codex app-server、Vitest、CDP。

## Global Constraints

- 保持 CodexWeb 现有输入框和用户消息布局，只新增紧凑文件片段卡片。
- 卡片显示文件名、文件类型与 `起始行-结束行`，不在 textarea 展开选区正文。
- 模型上下文必须包含绝对路径、行号和完整选区正文。
- 历史会话恢复后必须能从 app-server 用户消息还原引用卡片。
- 行号只在源文本中能够确定选区位置时展示，不猜测不确定位置。
- 开发和测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### Task 1: 文件片段引用协议

**Files:**
- Create: `src/lib/file-excerpt-reference.ts`
- Create: `src/lib/file-excerpt-reference.test.ts`

**Interfaces:**
- Produces: `FileExcerptReference`、`locateExcerptLines(source, selectedText, lineOffset)`、`buildFileExcerptPrompt(request, refs)`、`encodeFileExcerptDisplay(request, refs)`、`parseFileExcerptDisplay(content)`、`parseFileExcerptPrompt(content)`。

- [x] **Step 1: 编写失败测试**

覆盖单行/跨行/前置 frontmatter 行号、重复文本不伪造行号、展示元数据往返、模型提示词保留完整片段和用户问题。

- [x] **Step 2: 运行红灯测试**

Run: `npm run test -- --run src/lib/file-excerpt-reference.test.ts`

Expected: FAIL，模块尚不存在。

- [x] **Step 3: 实现最小纯函数协议**

使用 JSON 编码的边界标记承载模型片段；用户展示元数据只保存路径、名称、类型和行号，不复制正文。

- [x] **Step 4: 运行定向测试**

Run: `npm run test -- --run src/lib/file-excerpt-reference.test.ts`

Expected: PASS。

### Task 2: 预览选区与输入框卡片

**Files:**
- Modify: `src/lib/add-to-chat-event.ts`
- Modify: `src/components/layout/panels/PreviewPanel.tsx`
- Modify: `src/components/chat/MessageInput.tsx`
- Modify: `src/components/chat/MessageInputParts.tsx`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Create: `src/codex-web/file-excerpt-composer-wiring.test.ts`

**Interfaces:**
- Consumes: `FileExcerptReference` 和 Task 1 纯函数。
- Produces: 带 `startLine/endLine` 的 `codepilot:add-to-chat` 事件、可移除的 `FileExcerptCapsules`、发送时分离的模型内容与展示内容。

- [x] **Step 1: 编写失败接线测试**

断言预览传入源 Markdown 与 frontmatter 偏移；输入框事件只追加片段状态、不调用 `setInputValue`；卡片显示文件名、类型和行号；发送失败恢复片段状态。

- [x] **Step 2: 实现行号计算与事件数据**

`AddToChatToolbar` 调用 `locateExcerptLines(body, selection.text, lineOffset)`，把确定的行号随选区正文和路径一起派发。

- [x] **Step 3: 实现输入框片段卡片**

监听事件后生成唯一片段引用；卡片位于 textarea 上方并可移除。发送时用 `buildFileExcerptPrompt` 生成模型内容，用 `encodeFileExcerptDisplay` 生成用户展示内容。

- [x] **Step 4: 运行定向测试**

Run: `npm run test -- --run src/lib/file-excerpt-reference.test.ts src/codex-web/file-excerpt-composer-wiring.test.ts`

Expected: PASS。

### Task 3: 发送后与历史消息展示

**Files:**
- Modify: `src/components/chat/MessageItem.tsx`
- Create: `src/components/chat/FileExcerptDisplay.tsx`
- Modify: `src/codex-web/thread-history-adapter.ts`
- Create: `src/codex-web/file-excerpt-message-wiring.test.ts`
- Modify: `docs/exec-plans/active/2026-07-16-file-excerpt-reference-ui.md`

**Interfaces:**
- Consumes: `parseFileExcerptDisplay`、`parseFileExcerptPrompt`。
- Produces: 用户问题上方的紧凑片段引用行；历史 app-server 用户消息恢复为同一展示协议。

- [x] **Step 1: 编写失败接线测试**

断言 `MessageItem` 先解析文件附件再解析片段元数据并在正文上方渲染；历史适配器剥离模型片段块、恢复展示元数据和原始问题。

- [x] **Step 2: 实现消息卡片和历史恢复**

消息卡片沿用输入框的文件图标和低噪声边框；历史适配器将 app-server 提示词转换为展示标记，正文不泄漏完整片段。

- [x] **Step 3: 运行全量验证**

Run: `npm run test && npm run build`

Expected: 全量类型检查、单元测试和生产构建通过。

- [x] **Step 4: 执行隔离真实 Chrome 验证**

在 Markdown 预览选中跨行片段并加入对话；断言 textarea 未出现正文、卡片显示准确行号；发送问题后断言卡片位于问题上方，并从 `turn/start` 请求确认模型内容包含路径、行号和完整选区。

- [x] **Step 5: 更新 Smoke Ledger**

记录正例、长片段反例、刷新恢复、模型请求内容、构建结果和测试服务收口。

## Smoke Ledger

- 根因：旧 `codepilot:add-to-chat` 监听器把来源行和完整选区转换为 Markdown blockquote 后直接写入 textarea，长片段同时污染输入框和用户消息。
- 协议正例：`buildFileExcerptPrompt` 将绝对路径、1-based 起止行、完整选区正文和用户问题写入模型文本；`encodeFileExcerptDisplay` 只保存不含正文的卡片元数据。
- 行号正例：纯文本跨行、CRLF、frontmatter 偏移和 Markdown 列表前缀均能映射回源文件行号；真实 Chromium 在 `AGENTS.md` 选择第 129-130 行后显示 `AGENTS.md / MD · 129-130`。
- 行号反例：相同选区正文在源文件出现多次时返回未知行号，不展示伪造范围。
- 输入框正例：真实 Chromium 点击 `Add to chat` 后出现片段卡片，textarea 保持空字符串，完整选区正文未出现在输入框。
- 消息正例：`MessageItem` 在问题正文前解析并渲染 `FileExcerptDisplay`；app-server 历史适配器把模型提示词恢复为相同展示元数据，刷新后不泄漏长片段正文。
- app-server 输入：`buildAppServerTurnInput` 定向测试确认片段提示词原样进入 `turn/start.input`，包含路径、行号、完整片段和问题。
- 真实模型 E2E：使用专用合成 fixture `scripts/fixtures/attachment-restart-e2e.md` 第 3-4 行，经真实 Chromium 和 app-server `turn/start` 发送；线程为 `019f693f-a9b7-7ec1-9482-7dd9203c3ed1`。
- 出站请求正例：捕获的 `turn/start.input` 同时包含绝对路径、`startLine: 3`、`endLine: 4`、完整片段 `ORCHID-4729 / medium` 和用户问题。
- 模型回答正例：模型返回 `ORCHID-4729，medium`；发送后片段卡片位于问题上方，textarea 和待发送卡片均已清空，Runtime exception 为 0。
- 历史恢复正例：重新打开线程后仍显示 `attachment-restart-e2e.md 3-4`，用户消息只显示问题与卡片，没有泄漏片段正文。
- 安全审查：文件片段、绝对本地路径和行号会随 `turn/start` 发送到当前登录的外部模型服务。真实业务文件必须按外发数据处理；本次只发送预先审阅的合成值，没有发送 `AGENTS.md`、业务代码、凭据或其他仓库内容。
- 定向验证：文件片段协议、输入框接线、消息接线、历史恢复和 turn input 共 30 项通过。
- 全量验证：`npm run test` 共 58 个测试文件、270 项通过。
- Bridge smoke：隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 下通过，模型 7 个，账号来源 `app-server.account/read`。
- 生产构建：`npm run build` 成功生成 22 个路由，仅保留既有 NFT trace 警告。
