# 官方附件与片段提示词对齐实施计划

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** 让图片附件、文档附件和文件片段的 app-server 用户输入与指定官方 Codex App session 的格式一致，同时兼容既有历史会话。

**Architecture:** 上传附件仍先通过 app-server 文件 API 持久化到 `CODEX_HOME/attachments`，模型输入只使用官方 `Files mentioned by the user` 文本信封引用路径。文件片段改用官方 `Selected text` 文本信封；历史适配器同时解析新官方格式和旧私有格式，UI 展示协议保持不变。

**Tech Stack:** TypeScript、Codex app-server v2 `UserInput`、React、Vitest、JSONL fixture analysis。

## Global Constraints

- 官方事实样本：`/home/rrssnas/CodexApp/sessions/2026/07/16/rollout-2026-07-16T10-25-51-019f68be-a1e1-7273-9d06-2bca246113d7.jsonl`。
- 图片与普通文档使用同一个 `# Files mentioned by the user:` 文本信封。
- 文件片段使用 `# Selected text:`、编号 `Selection` 和 `## My request for Codex:`。
- 不再为已经持久化并被文本信封引用的图片重复生成 `image` 或 `localImage` 用户输入块。
- 保留旧图片输入块和 `[CODEX_WEB_FILE_EXCERPTS_V1]` 历史消息的只读恢复能力。
- UI 继续使用现有附件卡片和文件片段卡片，不显示模型专用信封正文。
- 开发和测试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### Task 1: 官方附件文本信封

**Files:**
- Modify: `src/codex-web/turn-input.ts`
- Modify: `src/codex-web/turn-input.test.ts`

**Interfaces:**
- Produces: `buildAppServerTurnInput(content, files)`，附件只生成官方文本信封。
- Preserves: `buildFilesMentionedPrompt(content, files)`。

- [x] **Step 1: 编写失败测试**

断言持久化 PNG 和 CSV 都只生成一个 `text` block，内容逐字匹配官方 session；无持久化路径的图片不伪造附件引用。

- [x] **Step 2: 运行红灯测试**

Run: `npm run test -- --run src/codex-web/turn-input.test.ts`

Expected: PNG 用例因当前额外存在 `image/localImage` block 而失败。

- [x] **Step 3: 实现最小输入调整**

删除附件图片 block 组装，仅保留持久化路径文本信封；不修改附件持久化实现。

- [x] **Step 4: 运行定向测试**

Run: `npm run test -- --run src/codex-web/turn-input.test.ts`

Expected: PASS。

### Task 2: 官方 Selected text 信封与兼容解析

**Files:**
- Modify: `src/lib/file-excerpt-reference.ts`
- Modify: `src/lib/file-excerpt-reference.test.ts`

**Interfaces:**
- Produces: `buildFileExcerptPrompt(request, references)` 官方文本格式。
- Produces: `parseFileExcerptPrompt(content)`，优先解析官方格式并回退旧私有格式。
- Preserves: `encodeFileExcerptDisplay` 和 `parseFileExcerptDisplay` UI 元数据协议。

- [x] **Step 1: 编写失败测试**

覆盖官方单行样例、跨行与多片段编号、无行号降级，以及旧私有格式解析。

- [x] **Step 2: 运行红灯测试**

Run: `npm run test -- --run src/lib/file-excerpt-reference.test.ts`

Expected: 官方格式精确断言失败。

- [x] **Step 3: 实现官方构造器和双格式解析器**

单行输出 `(line N)`，跨行输出 `(lines N-M)`；解析时从路径恢复文件名并生成稳定的展示 ID。

- [x] **Step 4: 运行定向测试**

Run: `npm run test -- --run src/lib/file-excerpt-reference.test.ts`

Expected: PASS。

### Task 3: 官方历史附件恢复与综合验证

**Files:**
- Modify: `src/codex-web/thread-history-adapter.ts`
- Modify: `src/codex-web/thread-history-adapter.test.ts`
- Modify: `docs/exec-plans/active/2026-07-16-official-attachment-excerpt-prompts.md`

**Interfaces:**
- Consumes: 官方 `Files mentioned` 和 `Selected text` 信封。
- Produces: 现有 `<!--files:...-->` 与 `<!--file-excerpts:...-->` UI 展示元数据。

- [x] **Step 1: 编写失败历史用例**

使用 session 中的相对 CSV/PNG 路径和片段样例构造历史 `userMessage`，断言恢复附件/片段卡片与纯用户问题。

- [x] **Step 2: 放宽官方附件路径解析**

在完整官方信封内接受绝对路径和相对路径；仍要求每个条目符合 `## 文件名: 路径`。

- [x] **Step 3: 运行定向与全量测试**

Run: `npm run test -- --run src/codex-web/turn-input.test.ts src/lib/file-excerpt-reference.test.ts src/codex-web/thread-history-adapter.test.ts`

Run: `npm run test`

Expected: 全部 PASS。

- [x] **Step 4: 生产构建与安全审查**

Run: `npm run build`

Expected: 构建通过；确认附件仍先持久化、没有把浏览器本地路径当作 app-server 路径、没有扩大写权限或读取范围。

- [x] **Step 5: 更新 Smoke Ledger**

记录三类官方样例、旧格式反例、全量测试、构建和剩余兼容风险。

## Smoke Ledger

- 官方事实提取：指定 session 有 3 个 turn；文档片段使用 `# Selected text`，CSV 和 PNG 均使用单一 `# Files mentioned by the user` 文本块。
- 红灯：新增测试首次运行 6 项失败，分别命中旧 JSON 片段信封、图片重复 `image/localImage` block 和相对路径拒绝。
- 定向测试：附件、片段、历史恢复和 UI 接线共 6 个测试文件、52 项通过。
- 全量测试：隔离 `CODEX_HOME` 下 59 个测试文件、282 项通过。
- 生产构建：`npm run build` 通过；保留仓库既有 Turbopack NFT 动态路径追踪警告。
- 真实图片请求：rollout `019f69af-a6d4-7e62-8b48-1637fb3a5a96` 的用户输入只有官方文本信封，没有 `image/localImage`；模型调用内置 `view_image` 读取 `$CODEX_HOME/attachments/.../attachment-restart-e2e.png`，工具返回 `input_image`。
- 真实图片语义反例：fixture 是 `1×1、gray+alpha` 像素，不是可识别方形，最终回答为 `No readable words found`，因此不把 `BLACKSQUARE` 视为通过；该结果不影响路径读取与工具调用已验证。
- 兼容反例：无持久化路径的图片不伪造附件信封；旧 `image/localImage` 历史项和 `[CODEX_WEB_FILE_EXCERPTS_V1]` 片段仍可恢复。
- 安全审查：上传数据仍先经 app-server `fs/createDirectory`、`fs/writeFile` 写入对应运行主机的 `CODEX_HOME/attachments`；提示词解析只生成 UI 元数据，不主动读取路径或扩大文件权限；SSH 不复制本机路径或凭据。
- 收口：隔离生产服务已关闭；测试会话和附件保留在 `/volume2/SSD/codex/Temp/codex-dev-home/{sessions,attachments}`，未执行清理。
- E2E 作用域修复：消息根节点增加角色语义，历史和流式最终回答增加完成状态；脚本必须等待当前 marker 对应用户消息之后、下一条用户消息之前的已完成最终回答。
- E2E 正例：线程 `019f69af-a6d4-7e62-8b48-1637fb3a5a96` 期望 `No readable words found`，脚本返回同一 `assistantAnswer`。
- E2E 反例：同一页面和左侧历史包含多处 `BLACK`，当前最终回答不包含；脚本等待 30 秒后按预期超时失败，没有误判为通过。

### Task 4: 附件 E2E 最终回答作用域

**Files:**
- Modify: `src/components/ai-elements/message.tsx`
- Modify: `src/components/chat/MessageItem.tsx`
- Modify: `src/components/chat/StreamingMessage.tsx`
- Modify: `scripts/attachment-restart-cdp-e2e.ts`
- Create: `src/codex-web/attachment-e2e-answer-scope.test.ts`

**Interfaces:**
- Produces: `data-message-role` 和 `data-assistant-final-answer` 稳定测试语义。
- Produces: `waitForCurrentTurnAssistantAnswer(cdp, marker, expectedAnswer, timeoutMs)`。

- [x] **Step 1: 编写并运行失败接线测试**

断言脚本不再扫描整页答案，并且等待 marker 对应用户消息之后的助手最终回答。

- [x] **Step 2: 增加无视觉影响的 DOM 语义**

历史与流式最终回答统一标记，消息根节点公开角色属性。

- [x] **Step 3: 收紧 send 和 verify 等待条件**

有期望词时只匹配当前回答；无期望词时也等待当前最终回答非空。

- [x] **Step 4: 执行单元、全量和真实反例 E2E**

用已经出现在用户问题或左侧历史中的诱饵词验证不会提前通过，并记录实际等待结果。
