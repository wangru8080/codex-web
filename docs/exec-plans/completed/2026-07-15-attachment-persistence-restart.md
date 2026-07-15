# 附件持久化与重启恢复实施计划

> **For agentic workers:** 按任务逐项实施并更新复选框；本会话内联执行，不自动提交 Git。

**Goal:** 图片发送前持久化到 app-server 的 `$CODEX_HOME/attachments/<UUID>/<原文件名>`，并确保服务重启后历史消息仍显示图片附件。

**Architecture:** `AppServerProvider` 使用 `initialize.codexHome` 和 app-server `fs/createDirectory`、`fs/writeFile` 保存浏览器图片，不直接访问 Web 主机文件系统。`turn/start` 继续发送官方 `UserInput.image` 数据 URL，保证本地与 SSH app-server 语义一致；历史适配器从 `image` 和 `localImage` 重建现有 `FileAttachment` 展示元数据。

**Tech Stack:** React 19、TypeScript、Codex app-server JSON-RPC v2、Vitest、Playwright。

## Global Constraints

- app-server `initialize.codexHome` 是附件根目录事实源，不读取浏览器或 Next.js 进程的环境变量猜测路径。
- 文件写入只调用 app-server `fs/*`，因此未来 SSH 模式写入远端 app-server 主机。
- 每次发送使用 UUID 子目录，保留经过路径净化的原始文件名，不覆盖现有附件。
- `turn/start` 保持 `image` 数据 URL，避免浏览器路径与远端路径混淆。
- 历史恢复兼容 `image` 数据 URL和 `localImage` 路径；没有附件的普通消息保持 text-only。
- 真实验证只使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不执行删除；计划归档移动需另行列出操作清单并取得确认。

---

### Task 1: 附件持久化纯函数与单元测试

**Files:**
- Create: `src/codex-web/attachment-persistence.ts`
- Create: `src/codex-web/attachment-persistence.test.ts`

**Interfaces:**
- Consumes: `FileAttachment[]`、`codexHome`、可注入的 app-server request 函数。
- Produces: `persistImageAttachments(params): Promise<FileAttachment[]>`，返回带 `filePath` 的附件副本。

- [x] **Step 1: 写失败测试**

断言 PNG 会依次请求：

```ts
request("fs/createDirectory", {
  path: "/codex-home/attachments/<uuid>",
  recursive: true,
});
request("fs/writeFile", {
  path: "/codex-home/attachments/<uuid>/screen.png",
  dataBase64: "AAAA",
});
```

同时覆盖文件名路径穿越净化、非图片过滤、空数据过滤和 Windows 路径连接。

- [x] **Step 2: 运行红灯测试**

Run: `npm run test -- --run src/codex-web/attachment-persistence.test.ts`

Expected: FAIL，模块尚不存在。

- [x] **Step 3: 实现最小持久化函数**

使用 `platformFamily` 选择 `/` 或 `\\` 路径分隔符；目录名使用 `crypto.randomUUID()`；文件名仅保留 basename，并将空名称回退为 `image.<扩展名>`。创建目录成功后逐个调用 `fs/writeFile`，返回的附件保留原 data 并增加 app-server 绝对 `filePath`。

- [x] **Step 4: 运行定向测试**

Run: `npm run test -- --run src/codex-web/attachment-persistence.test.ts`

Expected: PASS。

### Task 2: 发送链路接入 app-server 持久化

**Files:**
- Modify: `src/codex-web/AppServerProvider.tsx`
- Modify: `src/codex-web/app-server-image-attachment-wiring.test.ts`

**Interfaces:**
- Consumes: `state.initialize.data.codexHome/platformFamily`、`persistImageAttachments`。
- Produces: 新会话和已有会话发送前完成附件落盘，再构造 `turn/start.input`。

- [x] **Step 1: 扩展失败测试**

断言 `sendTurnInThread` 在 `buildAppServerTurnInput` 之前调用持久化函数，且落盘失败会拒绝 `turn/start`，从而保留输入框内容。

- [x] **Step 2: 接入发送链路**

在 `sendTurnInThread` 中读取已初始化的 `codexHome/platformFamily`，对图片执行持久化，然后将返回附件传给：

```ts
input: buildAppServerTurnInput(trimmed, persistedFiles)
```

持久化失败直接抛出带文件名的错误，不发送半成功消息。

- [x] **Step 3: 运行接线测试**

Run: `npm run test -- --run src/codex-web/attachment-persistence.test.ts src/codex-web/app-server-image-attachment-wiring.test.ts src/codex-web/turn-input.test.ts`

Expected: PASS，普通消息反例不调用 `fs/*`。

### Task 3: 历史附件恢复

**Files:**
- Modify: `src/codex-web/thread-history-adapter.ts`
- Modify: `src/codex-web/thread-history-adapter.test.ts`

**Interfaces:**
- Consumes: generated `UserInput.image/localImage/text`。
- Produces: 现有 `<!--files:[...]-->正文` 消息内容，供 `MessageItem` 和 `FileAttachmentDisplay` 渲染。

- [x] **Step 1: 写失败测试**

覆盖 data URL 图片、`localImage`、纯图片消息、多图片消息和无附件普通文本；断言 data URL 被拆成 MIME 与 base64 data，`localImage` 被映射为 `filePath`。

- [x] **Step 2: 实现最小历史映射**

保留文本拼接逻辑，并将图片构造成：

```ts
{
  id: `${item.id}-image-${index}`,
  name: inferredName,
  type: inferredMime,
  size: decodedSize,
  data: base64Data,
  filePath: localPath,
}
```

纯图片消息不得因文本为空而被过滤。

- [x] **Step 3: 运行历史适配器测试**

Run: `npm run test -- --run src/codex-web/thread-history-adapter.test.ts src/codex-web/thread-turns-page-adapter.test.ts`

Expected: PASS。

### Task 4: 完整验证与真实重启 E2E

**Files:**
- Modify: `docs/exec-plans/active/2026-07-15-attachment-persistence-restart.md`

- [x] **Step 1: 运行静态与单元验证**

Run: `npm run typecheck && npm run test && npm run build`

Expected: typecheck、全部单元测试和生产构建通过。

- [x] **Step 2: 在隔离目录执行真实附件 E2E**

使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 启动应用，上传小 PNG 并发送；验证生成：

```text
/volume2/SSD/codex/Temp/codex-dev-home/attachments/<UUID>/<原文件名>
```

核对内容哈希与上传数据一致，rollout 包含 `input_image`。

- [x] **Step 3: 重启并验证历史恢复**

停止测试服务后重新启动同一隔离环境，打开原线程并确认图片缩略图仍显示、可打开；同时验证无附件消息没有伪造附件，缺失 `localImage` 只显示降级文件项且页面不崩溃。

- [x] **Step 4: 更新 Smoke Ledger**

记录普通消息与附件消息反例、附件路径、重启前后结果、console 状态及剩余风险。计划完成后不自动移动，等待用户确认归档。

## Smoke Ledger

- 诊断基线：当前发送链路仅把图片作为 data URL 放入 rollout，没有创建 `$CODEX_HOME/attachments`。
- 重启失败原因：`thread-history-adapter` 只提取 `text`，丢弃 `image/localImage`。
- 定向验证：5 个测试文件、31 项通过，覆盖普通消息反例、附件写入、data URL、`localImage` 和纯图片历史消息。
- 真实 E2E 首轮发现局域网 HTTP 环境没有 `crypto.randomUUID()`，改用项目既有 `uuid` 后目录创建正常。
- 真实 E2E 第二轮发现 CDP 文件输入产生 `blob:` URL，旧转换会把地址误当 Base64；补充 `blob:` 二进制读取和单元测试，并禁止附件转换失败后静默发送纯文本。
- SVG 反例：附件成功落盘，但 app-server 将不支持的 SVG 图像转换为 `image content omitted because it could not be processed`；`event_msg.images=1`，没有冒充可用图片。
- PNG 正例：附件保存到 `/volume2/SSD/codex/Temp/codex-dev-home/attachments/5072bb3c-dbfd-434b-8131-9efd1c9e60e7/attachment-restart-e2e.png`，落盘文件与 fixture SHA-256 均为 `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`。
- rollout 正例：线程 `019f664c-f249-7583-81c5-19e2f313b64b` 的用户消息包含 `input_image + input_text`，`event_msg.images=1`。
- 重启正例：停止并使用同一隔离 `CODEX_HOME` 重启生产服务后，CDP 打开上述线程，marker 恢复且检测到 `imageCount=1` 的 `data:image/*` 缩略图。
- 普通消息反例：历史适配器无附件文本保持原始 text-only 内容；非图片和空数据不会调用 `fs/*`。
- 完整验证：`npm run test` 共 48 个测试文件、223 项通过；`npm run build` 成功生成 22 个页面，仅保留既有 Turbopack NFT 警告。
- 环境收口：附件 E2E 启动的隔离生产服务已停止，没有保留测试监听端口。
