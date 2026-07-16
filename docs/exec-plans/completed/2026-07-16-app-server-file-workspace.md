# App-Server 文件工作区修复实施计划

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** 修复文件链接预览、右侧文件树与新对话右侧面板，使浏览器工作区完全使用 Codex app-server 文件协议。

**Architecture:** `AppServerProvider` 作为唯一文件系统入口，公开 `fs/readDirectory`、`fs/readFile`、`fs/writeFile`。文件树按目录展开懒加载，预览适配器把 Base64 内容转换为现有 `FilePreview`；新对话将项目目录同步到 AppShell，并与历史会话共用右侧面板。

**Tech Stack:** React 19、Next.js 16、TypeScript、Codex app-server JSON-RPC v2、Radix ContextMenu、Vitest、CDP。

## Global Constraints

- 文件系统事实源只能是 Codex app-server `fs/*`，不得补本地 `/api/files` 伪后端。
- 保持 CodexWeb 现有文件树、工作区和输入框视觉结构。
- 目录采用懒加载，禁止启动时递归扫描 `.git`、`node_modules` 等大型目录。
- “打开所在目录”在浏览器中展开并选中当前文件树父目录，不执行未经认证的系统 shell 命令。
- “插入引用”使用独立 `insert-file-reference` 事件，在输入框显示文件引用卡片且不写入文本区。
- 开发和测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### Task 1: App-Server 文件读取与预览适配器

**Files:**
- Modify: `src/codex-web/AppServerProvider.tsx`
- Create: `src/codex-web/app-server-files.ts`
- Create: `src/codex-web/app-server-files.test.ts`
- Modify: `src/components/layout/panels/PreviewPanel.tsx`
- Create: `src/codex-web/app-server-file-preview-wiring.test.ts`

**Interfaces:**
- Produces: `readFile(path)`、`writeFile(path, dataBase64)`、`filePreviewFromResponse(path, response)`、`fileDataUrlFromResponse(path, response)`。

- [x] **Step 1: 编写失败测试**

覆盖 UTF-8 Markdown 解码、语言和行数、二进制拒绝、10 MB 上限、媒体 data URL，以及 Provider/PreviewPanel 不再调用 `/api/files/preview` 和 `/api/files/write`。

- [x] **Step 2: 运行红灯测试**

Run: `npm run test -- --run src/codex-web/app-server-files.test.ts src/codex-web/app-server-file-preview-wiring.test.ts`

Expected: FAIL，适配器和 Provider 文件方法尚不存在。

- [x] **Step 3: 实现读取、保存和预览接线**

Provider 转发 generated schema 的 `fs/readFile`、`fs/writeFile`；预览面板解码 Base64，保留外部文件确认与 readonly 语义，Markdown 编辑保存改走 `fs/writeFile`，媒体使用 data URL。

- [x] **Step 4: 运行定向测试**

Run: `npm run test -- --run src/codex-web/app-server-files.test.ts src/codex-web/app-server-file-preview-wiring.test.ts`

Expected: PASS。

### Task 2: App-Server 懒加载文件树与右键菜单

**Files:**
- Modify: `src/components/project/FileTree.tsx`
- Modify: `src/components/ai-elements/file-tree.tsx`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`
- Create: `src/codex-web/app-server-file-tree-wiring.test.ts`

**Interfaces:**
- Consumes: `readDirectory(path)`、`insert-file-reference`、共享剪贴板函数。
- Produces: 根目录列表、展开懒加载、文件右键菜单和父目录定位。

- [x] **Step 1: 编写失败接线测试**

断言文件树调用 `readDirectory`，不请求 `/api/files`；右键菜单包含三项中文文案，并向输入框派发文件引用事件。

- [x] **Step 2: 实现目录适配与懒加载**

把 `FsReadDirectoryEntry[]` 映射为 `FileTreeNode[]`，目录优先且名称排序；初次只读根目录，新展开目录才读取子项，刷新清空缓存后重载根目录。

- [x] **Step 3: 实现右键菜单**

使用 Radix ContextMenu；复制路径走 `copyWithToast`，打开所在目录展开并选中父目录，插入引用派发绝对路径供 MessageInput 展示独立文件卡片并在提交时构造引用上下文。

- [x] **Step 4: 运行定向测试**

Run: `npm run test -- --run src/codex-web/app-server-files.test.ts src/codex-web/app-server-file-tree-wiring.test.ts`

Expected: PASS。

### Task 3: 新对话右侧区域与端到端验证

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/UnifiedTopBar.tsx`
- Modify: `src/app/chat/page.tsx`
- Create: `src/codex-web/new-chat-workspace-wiring.test.ts`
- Modify: `docs/exec-plans/active/2026-07-16-app-server-file-workspace.md`

**Interfaces:**
- Consumes: 新对话 `workingDir`、PanelContext、WorkspaceSidebarProvider。
- Produces: `/chat` 与 `/chat/[id]` 一致的文件树和工作区入口。

- [x] **Step 1: 编写失败接线测试**

断言 AppShell/TopBar 把 `/chat` 视为可挂载右侧面板的聊天路由，并断言新对话将 `workingDir` 同步给 `setWorkingDirectory`。

- [x] **Step 2: 修复路由与目录同步**

右侧面板 gate 改为整个聊天路由；新对话目录初始化、项目选择和事件更新后都通过 effect 同步到 PanelContext，离开/切换时避免遗留旧目录。

- [x] **Step 3: 运行全量验证**

Run: `npm run test && npm run build`

Expected: 全量类型检查、单元测试和生产构建通过。

- [x] **Step 4: 执行隔离 CDP E2E**

在 `/chat` 选择现有项目后打开文件树；断言根文件出现、右键菜单三项出现、“插入引用”生成输入框胶囊；点击 Markdown 文件和聊天文件链接后，工作区显示内容且控制台没有 JSON/HTML 解析错误。

- [x] **Step 5: 更新 Smoke Ledger**

记录 app-server 请求、普通路径与反例、页面交互、构建结果和服务收口；计划保持 active，归档需另行确认。

## Smoke Ledger

- 根因：生产 App Router 只有 `/api/codex/bridge-url`；文件树与预览仍请求 CodexWeb mock 的 `/api/files*`，Next 返回 HTML 404 后被当作 JSON 解析。
- 协议事实：generated app-server schema 提供 `fs/readDirectory`、`fs/readFile`、`fs/writeFile`；实现未新增私有文件 HTTP API。
- 红灯验证：首次定向运行因 `app-server-files` 不存在在类型检查阶段失败。
- 定向验证：文件适配、预览接线、文件树接线和新对话工作区共 4 个测试文件、12 项通过。
- 文件预览正例：UTF-8 Markdown/JSON 由 `fs/readFile.dataBase64` 解码为现有 `FilePreview`；媒体生成 data URL；Markdown 保存使用 `fs/writeFile`。
- 预览反例：二进制文件和超过 10 MB 文件返回现有友好错误，不渲染乱码；外部 agent 文件继续保留确认和 readonly gate。
- 文件树正例：`/chat` 在 `/home/rrssnas/code/codex/web` 加载 23 个根节点，展开 `src` 后才请求并显示子目录，未递归扫描大型目录。
- 右键菜单初次验证：CDP 检测到“复制路径 / 打开所在目录 / 插入引用”；其后的 Task 4 回归修复已将 `@路径` 文本改为独立文件卡片。
- 工作区正例：新对话点击 `components.json` 后右侧预览显示真实字段 `radix-luma`；页面没有 `Unexpected token`，Runtime exception 数为 0。
- 全量验证：`npm run test` 共 54 个测试文件、248 项通过。
- 生产构建：`npm run build` 成功生成 22 个路由，仅保留既有 Turbopack NFT trace 警告。
- 环境收口：隔离生产服务已停止，CDP 临时 target 已关闭。

### Task 4: 真实浏览器回归修复

**Files:**
- Modify: `src/lib/markdown/chat-link.ts`
- Modify: `src/lib/markdown/chat-link.test.ts`
- Modify: `src/components/ai-elements/file-tree.tsx`
- Modify: `src/components/project/FileTree.tsx`
- Modify: `src/components/chat/MessageInput.tsx`
- Modify: `src/components/chat/MessageInputParts.tsx`
- Modify: `src/codex-web/app-server-file-tree-wiring.test.ts`
- Modify: `docs/exec-plans/active/2026-07-16-app-server-file-workspace.md`

**Interfaces:**
- Produces: 解码后的本地文件路径、真实剪贴板复制、独立文件引用胶囊、可见的父目录定位反馈。

- [x] **Step 1: 补充四项失败测试**

覆盖百分号编码中文路径解码；复制在 pointer 用户激活阶段触发；插入引用使用独立 `insert-file-reference` 事件且不写 textarea；打开所在目录设置 reveal path 并滚动闪烁。

- [x] **Step 2: 修复外部文件路径**

`classifyChatLinkHref` 对本地文件 path 执行容错 `decodeURIComponent`，保持远程 URL 和原始 href 不变。

- [x] **Step 3: 修复右键复制与目录定位**

复制在 `pointerdown` 阶段执行并为键盘 `select` 保留一次回退；目录定位展开父级、设置内部 reveal path、触发现有 `file-tree-flash` 和滚动逻辑。

- [x] **Step 4: 实现独立文件引用胶囊**

新增 `fileReferencePaths` 状态和 `FileReferenceCapsules`；右键插入只增加文件卡片，不改 textarea。提交时把这些路径合并进结构化 mention payload，成功后清空、发送失败时恢复。

- [x] **Step 5: 真实 Chrome 验证**

使用 session `019f66ca-7a04-74e0-ab2f-dd9c01a479dc` 点击中文附件链接并确认正文；读取系统剪贴板核对完整路径；断言引用卡片出现且 textarea 为空；断言目录定位产生闪烁目标。

## Task 4 Smoke Ledger

- 外部文件根因：rollout 与磁盘均使用 `OpenClaw-记忆系统的设计方案.md`，浏览器 href 将中文编码为 `%E8...`；修复后本地路径容错解码，远程 URL 和原始 href 保持不变。
- 外部文件正例：真实 Chrome 打开线程 `019f66ca-7a04-74e0-ab2f-dd9c01a479dc`，点击链接并只读确认后加载到正文“本文提出一套面向长期运行 Agent”；无 `No such file`、无 `Unexpected token`、Runtime exception 为 0。
- 复制根因：textarea 回退在 Radix pointer 阶段没有形成有效选区，Chrome 原生 copy 返回 true 但选中文本为空；改为 DOM Range 显式选区并在 pointerdown 用户激活阶段执行。
- 复制正例：可信鼠标点击 `globals.css` 的“复制路径”，Range 文本精确为 `/home/rrssnas/code/codex/web/src/app/globals.css`，Chrome 原生 `execCommand("copy")` 被调用且返回 true。
- 引用正例：右键 `components.json` 后输入框 textarea 保持空字符串，出现独立文件卡片 `components.json / JSON`，卡片不包含 `@/`；提交路径通过内部 `[Referenced Files]` 传给模型。
- 目录定位正例：右键 `globals.css` 选择“打开所在目录”后，`app` 目录成为 `file-tree-highlight` 且带 `file-tree-flash`，已展开并滚动到可见区域。
- 定向回归：4 个测试文件、18 项通过；覆盖 Range 剪贴板、编码路径、菜单动作和独立引用状态。
- 最终全量验证：`npm run test` 共 55 个测试文件、254 项通过；最终 `npm run build` 成功生成 22 个路由，仅保留既有 NFT trace 警告。
