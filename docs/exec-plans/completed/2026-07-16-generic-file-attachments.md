# 普通文件附件持久化实施计划

> **For agentic workers:** 按任务逐项实施并更新复选框；本会话内联执行，不自动提交 Git。

**Goal:** 让 Codex Web 的普通上传文件与官方 Codex App 一样持久化到 `$CODEX_HOME/attachments/<UUID>/<原文件名>`，并在请求和历史 UI 中保留文件上下文。

**Architecture:** 浏览器把上传文件转换为 Base64 后，由 `AppServerProvider` 通过 app-server `fs/createDirectory`、`fs/writeFile` 写入 `initialize.codexHome`。由于 generated `UserInput` 没有通用 `file` block，普通文件按官方 App 的真实 rollout 语义包装成 `# Files mentioned by the user` 文本信封；图片同时继续发送 `UserInput.image`。历史适配器解析信封、恢复附件胶囊并只向用户显示原始请求正文。

**Tech Stack:** React 19、TypeScript、Codex app-server JSON-RPC v2、Vitest、CDP E2E。

## Global Constraints

- app-server generated `UserInput` schema 是协议事实源，不新增私有 `file` block。
- 官方 App 的真实 rollout 文本信封是普通文件请求格式基准。
- 上传文件只通过 app-server `fs/*` 写入 app-server 主机的 `CODEX_HOME`，兼容未来 SSH。
- 每个上传文件使用独立 UUID 目录并保留净化后的原文件名，不覆盖现有附件。
- 项目文件 `@路径` 保持原路径引用，不复制为上传附件，不改变 Codex 对工作区文件的读写目标。
- 图片保持 `UserInput.image`，同时进入统一附件信封；普通文件只进入文本信封。
- 开发和真实验证只使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不执行删除；计划归档和测试产物清理必须另行确认。

---

### Task 1: 通用附件持久化

**Files:**
- Modify: `src/codex-web/attachment-persistence.ts`
- Modify: `src/codex-web/attachment-persistence.test.ts`

**Interfaces:**
- Consumes: `FileAttachment[]`、`initialize.codexHome/platformFamily`、app-server request。
- Produces: `persistAttachments(params): Promise<FileAttachment[]>`，为上传图片和普通文件补充 `filePath`。

- [x] **Step 1: 写失败测试**

新增 Markdown 文件用例，断言生成：

```ts
await request("fs/writeFile", {
  path: "/codex-home/attachments/file-uuid/notes.md",
  dataBase64: "IyBOb3Rlcw==",
});
```

同时断言带 `originPath` 的项目文件不复制、已持久化文件不重复写入。

- [x] **Step 2: 运行红灯测试**

Run: `npm run test -- --run src/codex-web/attachment-persistence.test.ts`

Expected: FAIL，现有实现过滤非图片。

- [x] **Step 3: 实现最小通用持久化**

把 `persistImageAttachments` 重命名为 `persistAttachments`，持久化条件改为：有 Base64 data、没有 `filePath`、没有 `originPath`。文件名为空时回退为 `attachment`，路径净化和 Windows 分隔符逻辑保持不变。

- [x] **Step 4: 运行定向测试**

Run: `npm run test -- --run src/codex-web/attachment-persistence.test.ts`

Expected: PASS。

### Task 2: 官方文件信封与 turn/start 输入

**Files:**
- Modify: `src/codex-web/turn-input.ts`
- Modify: `src/codex-web/turn-input.test.ts`
- Modify: `src/codex-web/AppServerProvider.tsx`
- Modify: `src/codex-web/app-server-image-attachment-wiring.test.ts`

**Interfaces:**
- Consumes: 已持久化的 `FileAttachment.filePath` 和原始请求正文。
- Produces: `buildAppServerTurnInput` 输出官方附件文本信封；图片仍输出 `image` block。

- [x] **Step 1: 写失败测试**

普通文件预期仅生成文本：

```ts
expect(buildAppServerTurnInput("总结文件", [markdown])).toEqual([{
  type: "text",
  text: "\n# Files mentioned by the user:\n\n## notes.md: /codex-home/attachments/id/notes.md\n\n## My request for Codex:\n总结文件\n",
  text_elements: [],
}]);
```

图片预期为 `image + 带路径信封的 text`；`originPath` 项目文件不进入信封。

- [x] **Step 2: 运行红灯测试**

Run: `npm run test -- --run src/codex-web/turn-input.test.ts src/codex-web/app-server-image-attachment-wiring.test.ts`

Expected: FAIL，普通文件仍被过滤且 Provider 只持久化图片。

- [x] **Step 3: 实现信封和 Provider 接线**

新增纯函数 `buildFilesMentionedPrompt(content, files)`；只读取带 `filePath` 且无 `originPath` 的附件。Provider 对所有上传文件调用 `persistAttachments`，新会话转交已有会话时利用 `filePath` 防止重复写入。

- [x] **Step 4: 运行定向测试**

Run: `npm run test -- --run src/codex-web/attachment-persistence.test.ts src/codex-web/turn-input.test.ts src/codex-web/app-server-image-attachment-wiring.test.ts`

Expected: PASS。

### Task 3: 文件选择 UI 与历史恢复

**Files:**
- Modify: `src/components/chat/MessageInput.tsx`
- Modify: `src/components/chat/ChatView.tsx`
- Modify: `src/codex-web/thread-history-adapter.ts`
- Modify: `src/codex-web/thread-history-adapter.test.ts`
- Modify: `src/codex-web/app-server-image-attachment-wiring.test.ts`

**Interfaces:**
- Consumes: 官方附件信封和现有 `FileAttachmentDisplay`。
- Produces: Codex 输入框允许普通文件；历史消息恢复普通文件胶囊并隐藏内部信封。

- [x] **Step 1: 写失败测试**

覆盖单个 Markdown、多文件、文件加图片、Windows 路径和无信封普通文本。断言历史 UI 内容为原始请求，附件包含原文件名、类型和 `filePath`。

- [x] **Step 2: 放开上传选择但保持项目文件语义**

Codex 输入框 accept 改为空字符串，菜单显示“文件和文件夹”；`FileTreeAttachmentBridge` 在 Codex 模式继续把普通项目文件转为 `@路径`，避免复制和编辑目标漂移。

- [x] **Step 3: 解析历史信封**

新增 `parseFilesMentionedPrompt(text)`，返回 `{ content, files }`。将信封路径恢复为 `FileAttachment`；图片 block 按顺序为对应图片附件补充 Base64 data，避免重复胶囊；路径不可读取时显示文件项而不是破图。

- [x] **Step 4: 运行定向测试**

Run: `npm run test -- --run src/codex-web/thread-history-adapter.test.ts src/codex-web/thread-turns-page-adapter.test.ts src/codex-web/app-server-image-attachment-wiring.test.ts`

Expected: PASS。

### Task 4: 全量验证与普通文件重启 E2E

**Files:**
- Modify: `scripts/attachment-restart-cdp-e2e.ts`
- Create: `scripts/fixtures/attachment-restart-e2e.md`
- Modify: `docs/exec-plans/active/2026-07-16-generic-file-attachments.md`

- [x] **Step 1: 扩展 E2E 脚本**

增加 `CODEX_WEB_E2E_EXPECT=file|image`。文件模式发送 Markdown fixture，验证历史页面包含文件名附件项且不要求 `data:image/*`。

- [x] **Step 2: 运行完整验证**

Run: `npm run test && npm run build`

Expected: 全量 typecheck/unit tests 和生产构建通过。

- [x] **Step 3: 执行普通文件真实 E2E**

在隔离生产服务上传 `attachment-restart-e2e.md`，验证：落盘路径位于隔离 `CODEX_HOME/attachments/<UUID>/`；SHA-256 一致；rollout 用户文本含官方文件信封且没有伪造 `input_file`。

- [x] **Step 4: 重启与反例验证**

重启相同隔离环境并打开事实源线程 ID，断言请求正文和文件名胶囊恢复。反例断言项目 `@文件` 不复制到 attachments，无附件消息保持普通 text-only。

- [x] **Step 5: 更新 Smoke Ledger**

记录文件路径、哈希、rollout 输入类型、重启结果、普通消息和项目文件反例。计划保持 active，归档另行确认。

### Task 5: 模型读取并分析文档内容 E2E

**Files:**
- Modify: `scripts/attachment-restart-cdp-e2e.ts`
- Modify: `scripts/fixtures/attachment-restart-e2e.md`
- Modify: `docs/exec-plans/active/2026-07-16-generic-file-attachments.md`

- [x] **Step 1: 设置不可从提示词猜测的文档答案**

在 Markdown fixture 中写入项目代号 `ORCHID-4729` 和风险等级 `medium`；发送提示只描述问题和输出格式，不包含答案。

- [x] **Step 2: 扩展 CDP 最终回答断言**

支持 `CODEX_WEB_E2E_PROMPT` 和 `CODEX_WEB_E2E_EXPECTED_ANSWER`。发送阶段等待页面出现精确预期答案后才成功，避免只验证消息已提交。

- [x] **Step 3: 执行真实模型分析**

上传 Markdown 并要求模型读取后只输出 `<项目代号> | <风险等级>`。Expected: 最终回答包含 `ORCHID-4729 | medium`。

- [x] **Step 4: 核对读取工具调用**

检查事实源 rollout，断言存在包含本轮 `$CODEX_HOME/attachments/<UUID>/attachment-restart-e2e.md` 路径的读取命令，并断言助手 final answer 为预期答案。

- [x] **Step 5: 记录模型分析 Smoke Ledger**

记录线程 ID、附件路径、读取命令、最终回答和服务收口状态。

## Smoke Ledger

- 官方事实：本机官方 App 将 `OpenClaw-记忆系统的设计方案.md` 保存为 `$CODEX_HOME/attachments/<UUID>/原文件名`。
- 官方请求事实：同一轮 rollout 将文件作为 `# Files mentioned by the user` 文本信封中的绝对路径传入，没有通用 `file` block。
- 协议事实：generated `UserInput` 仅包含 `text/image/localImage/skill/mention`。
- 在线 Codex manual：代理环境仍因 `developers.openai.com` DNS `EAI_AGAIN` 无法获取；实现依据本机官方 App 真实 rollout 和本地官方 generated schema。
- TDD：通用持久化、官方信封、历史恢复和 UI 接线共 6 个定向测试文件、41 项通过。
- 全量验证：`npm run test` 共 48 个测试文件、230 项通过；`npm run build` 成功生成 22 个页面，仅保留既有 Turbopack NFT 警告。
- 普通文件正例：`attachment-restart-e2e.md` 保存到 `/volume2/SSD/codex/Temp/codex-dev-home/attachments/31385bfc-d12c-4160-b5e5-b83f07eb08ad/attachment-restart-e2e.md`。
- 哈希正例：fixture 与落盘文件 SHA-256 均为 `7ce78a343a1d153e267083c59c59270a864563f823b132063ccb4f6c1b72d263`。
- 协议正例：线程 `019f66a5-fa4c-77c0-a76d-e3f57fabea1d` 的用户输入只有 `input_text`；文本包含官方 `Files mentioned` 信封和上述绝对路径，没有伪造 `input_file`。
- 重启正例：停止并使用同一隔离 `CODEX_HOME` 重启后，CDP 打开事实源线程，恢复 marker 和 `attachment-restart-e2e.md` 文件胶囊，`imageCount=0`。
- 项目文件反例：Codex 模式的文件树普通文件继续走 `@路径`；隔离 attachments 中没有生成 `README.md` 副本。
- 普通消息反例：无附件消息保持原始 text-only；信封解析仅接受绝对路径条目，避免误解析用户自行书写的同名 Markdown 标题。
- 模型分析正例：线程 `019f66be-bca3-7d01-9456-42e7774ce387` 上传附件到 `/volume2/SSD/codex/Temp/codex-dev-home/attachments/4105a410-fc09-4344-91f8-f92ef2ff87fc/attachment-restart-e2e.md`；用户提示未包含文档答案。
- 工具调用正例：模型通过 `exec_command` 读取上述持久化附件，工具输出包含唯一事实 `ORCHID-4729` 和 `medium`，最终回答精确为 `ORCHID-4729 | medium`，任务正常完成。
- 环境收口：三次隔离生产服务均已停止，没有保留测试监听端口。
