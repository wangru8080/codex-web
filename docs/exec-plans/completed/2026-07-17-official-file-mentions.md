# 官方 Codex 文件 Mention 对齐执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `@` 文件选择脱离 textarea 文本，并按官方 Codex App 的 Markdown 链接格式发送给 app-server。

**Architecture:** 文件选择器把已选工作区文件存入独立 `fileReferencePaths`，composer 仅展示文件胶囊，textarea 只保留用户请求。提交时由纯函数按选择顺序生成 `[文件名](相对路径)`，再与用户正文拼接成 app-server text input；普通上传、目录引用和文件片段保持现有协议。

**Tech Stack:** Next.js 16、React 19、TypeScript、Vitest、Codex app-server JSON-RPC、CDP。

## Global Constraints

- 官方 `codex-rs/tui` 和用户提供的 Codex Desktop session 是行为事实源。
- 官方 session `/home/rrssnas/CodexApp/sessions/2026/07/17/rollout-2026-07-17T17-53-43-019f6f7f-06e3-7052-9c41-34f53766d5f6.jsonl` 中用户输入为 `[AGENTS.md](AGENTS.md) 描述这个文件的主要内容\n`。
- `@` 选择文件后 textarea 不得保留 `@AGENTS.md`。
- 工作区文件不得使用 `[Referenced Files]` 或 `# Files mentioned by the user` 包装。
- 普通手输 `@foo`、目录引用、普通上传附件和文件片段行为不变。
- 不修改 `/home/rrssnas/code/CodexWeb`。
- 不执行文件删除命令。
- 所有测试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### Task 1: 锁定官方文件选择与提示词契约

**Files:**
- Modify: `src/lib/message-input-logic.test.ts`
- Modify: `src/codex-web/file-reference-composer-wiring.test.ts`
- Modify: `src/codex-web/turn-input.test.ts`

**Interfaces:**
- Consumes: `resolveItemSelection(...)`、`buildAppServerTurnInput(...)`。
- Produces: `buildFileReferencePrompt(content, paths): string` 的测试契约。

- [x] **Step 1: 写文件选择失败测试**

```ts
const result = resolveItemSelection(
  { label: "AGENTS.md", value: "AGENTS.md", nodeType: "file" },
  "file",
  0,
  "@AGE 描述这个文件的主要内容",
  "AGE",
);
expect(result).toMatchObject({
  action: "select_file_reference",
  newInputValue: "描述这个文件的主要内容",
  reference: { path: "AGENTS.md", display: "AGENTS.md", nodeType: "file" },
});
```

- [x] **Step 2: 写官方 Markdown 提示词失败测试**

```ts
expect(buildFileReferencePrompt("描述这个文件的主要内容", ["AGENTS.md"]))
  .toBe("[AGENTS.md](AGENTS.md) 描述这个文件的主要内容");
expect(buildFileReferencePrompt("", ["docs/guide.md", "AGENTS.md"]))
  .toBe("[guide.md](docs/guide.md) [AGENTS.md](AGENTS.md)");
```

- [x] **Step 3: 写反例测试**

断言目录选择仍返回 `insert_file_mention`，普通手输 `@AGENTS.md` 不经选择器时不自动转换；最终 app-server text 不含 `@AGENTS.md`、`[Referenced Files]` 和 `# Files mentioned by the user`。

- [x] **Step 4: 运行失败测试**

Run: `NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm exec vitest run src/lib/message-input-logic.test.ts src/codex-web/file-reference-composer-wiring.test.ts src/codex-web/turn-input.test.ts`

Expected: FAIL，指出 `select_file_reference` 和 `buildFileReferencePrompt` 尚未实现。

### Task 2: 让文件选择进入独立引用状态

**Files:**
- Modify: `src/lib/message-input-logic.ts`
- Modify: `src/hooks/useSlashCommands.ts`
- Modify: `src/components/chat/MessageInput.tsx`

**Interfaces:**
- Consumes: `PopoverItem.nodeType`、`fileReferencePaths`。
- Produces: `InsertResult.action = "select_file_reference"`、`onFileReferenceSelected(reference)`。

- [x] **Step 1: 扩展选择结果类型**

为 `InsertResult` 增加 `select_file_reference` 和以下结构：

```ts
reference?: {
  path: string;
  nodeType: "file";
  display: string;
};
```

- [x] **Step 2: 文件选择移除查询 token**

文件项返回 `select_file_reference`，从 textarea 删除 `@`、过滤文字及相邻重复空格；目录项继续插入 `@目录` 文本。

- [x] **Step 3: 接入文件引用胶囊**

`useSlashCommands` 新增 `onFileReferenceSelected` 回调。`MessageInput` 将文件路径去重后加入 `fileReferencePaths`，不写入 `mentionNodeTypes`；删除、发送失败恢复继续复用现有状态逻辑。

### Task 3: 按官方 Markdown 链接构造 app-server text

**Files:**
- Modify: `src/lib/message-input-logic.ts`
- Modify: `src/components/chat/MessageInput.tsx`
- Test: `src/lib/message-input-logic.test.ts`
- Test: `src/codex-web/turn-input.test.ts`

**Interfaces:**
- Produces: `buildFileReferencePrompt(content: string, paths: ReadonlyArray<string>): string`。
- Consumes: `composeSubmitPayload({ ..., fileReferencePaths })`。

- [x] **Step 1: 实现 Markdown 链接构造器**

按首次出现顺序去重路径，标签使用 basename，格式为 `[basename](path)`；有用户正文时使用单个空格连接。

- [x] **Step 2: 移除旧文件提示词**

删除 `fileNotes` 和 `[Referenced Files]` 生成分支。目录说明与 mention 限制说明保持不变。

- [x] **Step 3: 接入统一提交函数**

`composeSubmitPayload` 接收 `fileReferencePaths`，让 `finalContent` 和 `displayOverride` 都包含 Markdown 文件链接。badge 路径和普通路径均复用该结果；只选择文件、正文为空时也允许发送。

- [x] **Step 4: 验证 app-server 输入**

`buildAppServerTurnInput("[AGENTS.md](AGENTS.md) 描述这个文件的主要内容")` 必须只产生一个 text input，且 `text_elements: []`。

### Task 4: 完整验证和归档

**Files:**
- Modify: `docs/exec-plans/active/2026-07-17-official-file-mentions.md`
- Move after completion: `docs/exec-plans/active/2026-07-17-official-file-mentions.md` → `docs/exec-plans/completed/2026-07-17-official-file-mentions.md`

**Interfaces:**
- Consumes: Task 1-3 的实现。
- Produces: 测试记录、反例和 UI 验收结果。

- [x] **Step 1: 运行 targeted tests**

Run: `NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm exec vitest run src/lib/message-input-logic.test.ts src/codex-web/file-reference-composer-wiring.test.ts src/codex-web/turn-input.test.ts`

- [x] **Step 2: 运行完整测试**

Run: `NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test`

- [x] **Step 3: 运行生产构建**

Run: `NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run build`

- [x] **Step 4: 运行基础 smoke**

Run: `NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test:smoke`

- [x] **Step 5: CDP 轻量验证**

启动隔离 dev server，验证选择 `@AGENTS.md` 后 textarea 只保留请求正文、文件胶囊存在、发送后的用户消息渲染本地文件链接、console 无新增错误。

- [x] **Step 6: 更新 Smoke Ledger 并归档**

记录每条实际执行命令、结果和反例，然后移动到 `docs/exec-plans/completed/`。

## 决策日志

- 2026-07-17：以用户提供的 Codex Desktop session 为事实源；`[AGENTS.md](AGENTS.md)` 是客户端由 `@` 文件选择自动生成，后续中文是用户正文。
- 2026-07-17：app-server `UserInput.mention` 用于 plugin/app mention，不用于工作区文件；工作区文件按官方 session 使用普通 Markdown link text。

## Smoke Ledger

- 失败基线：三组 targeted tests 首次共 6 项失败，分别捕获 textarea 中残留 `@AGENTS.md`、缺少 `select_file_reference`、缺少官方 Markdown 构造器和旧 `fileNotes.push` 分支。
- Targeted：`message-input-logic.test.ts`、`file-reference-composer-wiring.test.ts`、`turn-input.test.ts` 共 31 项通过。
- `npm run test`：74 个测试文件、342 项测试通过，包含 TypeScript 类型检查。
- `npm run build`：生产构建通过；保留仓库既有 NFT 动态路径追踪警告。
- `npm run test:smoke`：隔离 bridge 通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，模型和账号来源来自 app-server。
- CDP 选择验证：输入 `@AGE 描述这个文件的主要内容` 并点击 `AGENTS.md` 后，textarea 为 `描述这个文件的主要内容`，`data-file-reference-path=AGENTS.md` 胶囊存在，textarea 不含 `@AGENTS.md`。
- CDP app-server 输入验证：拦截且不实际发送的 `turn/start` text 精确为 `[AGENTS.md](AGENTS.md) 描述这个文件的主要内容`，`text_elements=[]`，不含旧 `[Referenced Files]` 或附件信封。
- CDP console：观察到仓库既有 `/api/*` 404 资源噪声；没有出现与文件选择、胶囊或 turn input 构造相关的新错误。
- 反例：目录选择继续生成 `@docs` mention；未通过选择器的普通 `@AGENTS.md` 文本不自动转换；普通上传附件和文件片段测试保持通过。
