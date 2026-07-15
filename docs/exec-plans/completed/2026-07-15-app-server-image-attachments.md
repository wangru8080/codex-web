# App-Server 图片附件接线实施计划

> **For agentic workers:** 按任务逐项实施并更新复选框；本会话内联执行，不自动提交 Git。

**Goal:** 让输入框选择的图片在新会话和历史会话中都以官方 `UserInput.image/localImage` 语义进入 `turn/start.input`，同时阻止 Codex 模式选择无法由 app-server 承载的普通上传文件。

**Architecture:** 新增一个纯函数，把消息文本和 `FileAttachment[]` 转换为 generated schema 的 `UserInput[]`。`AppServerProvider` 成为唯一调用点，新会话页和历史会话页只负责把附件透传；Codex 输入框把文件对话框限制为 `image/*`，项目文件继续使用现有 `@路径` 工作流。

**Tech Stack:** React 19、TypeScript、Codex app-server JSON-RPC v2、Vitest、Playwright。

## Global Constraints

- app-server generated schema 是请求字段事实源，不发明通用 `file` input block。
- 官方 TUI 只把图片附件映射为 `image` 或 `localImage`；普通项目文件继续通过路径让 Codex 工具读取。
- 浏览器上传图片优先使用内存 data URL，避免 SSH 模式把 Web 主机路径冒充远端路径；只有缺少 data 且已有 `filePath` 时才退回 `localImage`。
- 新会话和历史会话必须共用同一附件转换函数。
- 不支持的普通上传文件必须在选择阶段被过滤，不能显示为已发送。
- 所有测试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### Task 1: 官方 UserInput 图片构造器

**Files:**
- Create: `src/codex-web/turn-input.ts`
- Create: `src/codex-web/turn-input.test.ts`

**Interfaces:**
- Consumes: `FileAttachment`、generated `UserInput`。
- Produces: `buildAppServerTurnInput(content: string, files?: readonly FileAttachment[]): UserInput[]`。

- [x] **Step 1: 写失败测试**

覆盖无附件文本、base64 图片、绝对本地图片、多张图片和普通文件过滤：

```ts
expect(buildAppServerTurnInput("检查图片", [png])).toEqual([
  { type: "image", url: "data:image/png;base64,AAAA" },
  { type: "text", text: "检查图片", text_elements: [] },
]);
```

- [x] **Step 2: 运行红灯测试**

Run: `npm run test -- --run src/codex-web/turn-input.test.ts`

Expected: FAIL，模块或函数尚不存在。

- [x] **Step 3: 实现最小转换函数**

```ts
export function buildAppServerTurnInput(content: string, files: readonly FileAttachment[] = []): UserInput[] {
  const input: UserInput[] = [];
  for (const file of files) {
    if (!isImageFile(file.type)) continue;
    if (file.data) input.push({ type: "image", url: `data:${file.type};base64,${file.data}` });
    else if (file.filePath) input.push({ type: "localImage", path: file.filePath });
  }
  if (content) input.push({ type: "text", text: content, text_elements: [] });
  return input;
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `npm run test -- --run src/codex-web/turn-input.test.ts`

Expected: PASS。

### Task 2: 新会话和历史会话透传图片

**Files:**
- Modify: `src/codex-web/AppServerProvider.tsx`
- Modify: `src/app/chat/page.tsx`
- Modify: `src/components/chat/ChatView.tsx`
- Test: `src/codex-web/app-server-image-attachment-wiring.test.ts`

**Interfaces:**
- Consumes: `buildAppServerTurnInput`、`FileAttachment[]`。
- Produces: `SendOneTurnParams.files`、`SendTurnInThreadParams.files`，以及真实多模态 `turn/start.input`。

- [x] **Step 1: 写接线失败测试**

读取三个生产源文件并断言：Provider 使用 `buildAppServerTurnInput(trimmed, files)`；新会话调用两种发送函数时传 `files`；历史会话不再用“暂不支持附件”提前返回并向 `appServerSend` 传 `files`。

- [x] **Step 2: 运行红灯测试**

Run: `npm run test -- --run src/codex-web/app-server-image-attachment-wiring.test.ts`

Expected: FAIL，现有生产链路仍是 text-only。

- [x] **Step 3: 扩展 Provider 请求参数并复用构造器**

```ts
export type SendTurnInThreadParams = {
  threadId: string;
  content: string;
  files?: readonly FileAttachment[];
  // existing runtime fields unchanged
};

input: buildAppServerTurnInput(trimmed, files),
```

`sendOneTurn` 创建 thread 后把同一 `files` 继续传给 `sendTurnInThread`。

- [x] **Step 4: 透传页面附件并保留附件气泡**

新会话的 `sendOneTurn/sendTurnInThread` 和历史会话的 `appServerSend` 均传入 `files`；历史会话乐观消息继续使用现有附件元数据格式显示图片。

- [x] **Step 5: 运行接线和构造器测试**

Run: `npm run test -- --run src/codex-web/turn-input.test.ts src/codex-web/app-server-image-attachment-wiring.test.ts`

Expected: PASS。

### Task 3: Codex 输入框限制为官方支持的图片附件

**Files:**
- Modify: `src/components/chat/MessageInput.tsx`
- Test: `src/codex-web/app-server-image-attachment-wiring.test.ts`

**Interfaces:**
- Consumes: `codexOnly` 与 `appServerSend` 存在性。
- Produces: Codex 模式 `accept="image/*"`；其他兼容界面保持现有 accept 行为。

- [x] **Step 1: 扩展失败测试**

断言 Codex 新会话和 app-server 历史会话输入框都使用图片 accept，普通文件不会进入附件列表；项目树 `@路径` 行为不变。

- [x] **Step 2: 实现最小 UI 边界**

给 `MessageInput` 增加可选 `attachmentsAccept`，默认由 `codexOnly` 得出 `image/*`；ChatView 在 `appServerSend` 路径显式传 `image/*`。加号菜单在 Codex 图片模式显示“图片”，不改变整体布局；文件树桥接器遇到普通项目文件时回退到现有 `insert-file-mention` 路径。

- [x] **Step 3: 运行定向测试**

Run: `npm run test -- --run src/codex-web/app-server-image-attachment-wiring.test.ts src/lib/message-input-logic.test.ts`

Expected: PASS，普通文件反例被过滤。

### Task 4: 回归、真实 E2E 与归档

**Files:**
- Modify: `docs/exec-plans/active/2026-07-15-app-server-image-attachments.md`

- [x] **Step 1: 运行完整验证**

Run: `npm run typecheck && npm run test && npm run build`

Expected: typecheck、全部单元测试和生产构建通过。

- [x] **Step 2: 运行隔离 app-server 图片 E2E**

使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 启动生产应用，附加一张小 PNG 后发送。检查浏览器请求和生成的 rollout，确认用户输入包含 `image` 或 `localImage`，并确认模型响应能够识别图片。

- [x] **Step 3: 验证反例**

确认文件对话框过滤普通文本/PDF；不带附件的普通消息仍只发送 text；历史会话图片发送不再被提前拒绝。

- [x] **Step 4: 清理与归档**

若 Playwright 产生临时目录或截图，先输出拟执行操作清单并取得用户同意，再移动到 `/volume2/SSD/Trash/`；计划完成后同样经用户同意移至 `docs/exec-plans/completed/`。

## Smoke Ledger

- 诊断基线：输入框能生成 `FileAttachment[]`，但当前 `AppServerProvider` 固定发送单个 text block；新会话只在乐观气泡显示附件，历史会话检测到附件后直接拒绝发送。
- 运行时基线：`codex-start-home/sessions` 未找到任何 `image` 或 `localImage` 用户输入块。
- 官方基线：generated `UserInput` 支持 `text/image/localImage/skill/mention`；官方 TUI 只把本地或远程图片加入附件列表，没有通用二进制文件附件。
- TDD：构造器缺失时 typecheck 红灯；实现后构造器、生产接线和输入逻辑共 3 个测试文件、15 项通过。
- 反例接线：Codex 文件对话框限制为 `image/*`；文件树普通项目文件回退为 `@路径`，不进入图片附件数组。
- 完整验证：最终 `npm run test` 共 46 个测试文件、214 项通过；最新 `npm run build` 成功生成 22 个页面，仅有既有 Turbopack NFT 警告。
- 新会话 E2E：隔离 rollout `019f652a-809e-7391-9ef0-452d715bb105` 的用户输入包含 `input_image(data:image/png;base64)` 与 `input_text`，模型从截图正确回答“新对话”。
- 历史会话反例：首次复测时模型虽回答“搜索会话...”，rollout 却只有 text，暴露 `[id]/page.tsx` 包装层漏传 `files`；新增红灯测试并修复后再次复测，rollout 明确包含本轮 `input_image`，模型正确回答“插件”。
- 控制台：没有附件或 `turn/start` 错误；仅见生产版既有 `/api/settings/*`、`/api/git/status` 等 404。
- 环境收口：33739、36877、36023 测试端口均已关闭；`.playwright-mcp/` 与测试 PNG 已按原层级移入 `/volume2/SSD/Trash/2026-07-15-app-server-image-attachments/`。
