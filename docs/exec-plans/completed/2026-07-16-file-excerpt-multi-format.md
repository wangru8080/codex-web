# 多格式文件片段引用实施计划

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** 修复 Markdown 片段缺失行号，并让代码、JSON、配置和普通文本文件都能把带准确行号的选区加入对话。

**Architecture:** 把选区监听与“加入对话”工具栏从 Markdown 渲染组件中抽成共享组件。Markdown 渲染使用增强后的源文本映射；`SourceView` 为每个高亮行添加 `data-source-line`；CodeMirror 直接从编辑器 selection 读取文本和行号，三条路径最终派发同一个 `codepilot:add-to-chat` 事件。

**Tech Stack:** React 19、Next.js 16、TypeScript、CodeMirror 6、react-syntax-highlighter、Vitest、CDP。

## Global Constraints

- 文本型文件支持片段引用；图片、视频、音频和其他二进制文件不显示该操作。
- 卡片必须显示文件类型和 1-based 起止行；无法定位时不得伪造行号。
- 不改变 JSON 树、HTML、CSV 等渲染预览的既有交互；它们可切到 Source 使用片段引用。
- 模型上下文继续包含路径、行号和完整片段正文。
- 开发和测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### Task 1: Markdown 行号映射修复

**Files:**
- Modify: `src/lib/file-excerpt-reference.ts`
- Modify: `src/lib/file-excerpt-reference.test.ts`

**Interfaces:**
- Produces: 能处理行首列表标记、内联代码、强调、链接和折行空白的 `locateExcerptLines`。

- [x] **Step 1: 编写失败测试**

覆盖 `` `inline code` ``、`**bold**`、Markdown 链接以及渲染后合并空白的选区。

- [x] **Step 2: 运行红灯测试**

Run: `npm run test -- --run src/lib/file-excerpt-reference.test.ts`

Expected: 新增用例 FAIL，现有映射保留 Markdown 内联标记。

- [x] **Step 3: 实现最小规范化**

仅在回退搜索文本中去掉 Markdown 展示标记；原始片段正文和模型输入保持逐字不变。

- [x] **Step 4: 运行定向测试**

Run: `npm run test -- --run src/lib/file-excerpt-reference.test.ts`

Expected: PASS。

### Task 2: 共享选区工具栏与源码视图

**Files:**
- Create: `src/components/editor/FileSelectionToolbar.tsx`
- Modify: `src/components/layout/panels/PreviewPanel.tsx`
- Modify: `src/codex-web/file-excerpt-composer-wiring.test.ts`

**Interfaces:**
- Produces: `FileTextSelection`、`FileSelectionToolbar`、`useDomFileSelection`；`SourceView` 每行输出 `data-source-line`。

- [x] **Step 1: 编写失败接线测试**

断言 Markdown 和 SourceView 都使用共享工具栏；SyntaxHighlighter 开启 `wrapLines` 并通过 `lineProps` 写入源行号。

- [x] **Step 2: 实现共享工具栏**

共享组件只负责显示字符数、派发结构化事件和 DOM selection 生命周期；文件类型分支负责提供准确选区行号。

- [x] **Step 3: 接入 Markdown 和 SourceView**

Markdown 使用源文本回退映射；SourceView 优先读取选区两端最近的 `data-source-line`，因此 `.ts/.tsx/.js/.json/.toml/.yaml` 等源码文件不依赖文本匹配。

- [x] **Step 4: 运行定向测试**

Run: `npm run test -- --run src/lib/file-excerpt-reference.test.ts src/codex-web/file-excerpt-composer-wiring.test.ts`

Expected: PASS。

### Task 3: CodeMirror 文本选区与端到端验证

**Files:**
- Modify: `src/components/editor/MarkdownEditor.tsx`
- Modify: `src/components/layout/panels/PreviewPanel.tsx`
- Create: `src/codex-web/file-excerpt-multi-format-wiring.test.ts`
- Modify: `docs/exec-plans/active/2026-07-16-file-excerpt-multi-format.md`

**Interfaces:**
- Consumes: `FileTextSelection` 和 `FileSelectionToolbar`。
- Produces: `MarkdownEditorProps.onSelectionChange(selection)`，支持 `.md/.mdx/.txt` 源码或编辑模式。

- [x] **Step 1: 编写失败接线测试**

断言 CodeMirror update listener 在 `selectionSet/docChanged` 时报告文本和 `doc.lineAt(...).number`，PreviewPanel 在编辑器上方渲染共享工具栏。

- [x] **Step 2: 实现 CodeMirror 选区回调**

空选区报告 `null`；非空选区报告完整正文与准确起止行，回调通过 ref 保持最新。

- [x] **Step 3: 运行全量测试和构建**

Run: `npm run test && npm run build`

Expected: 全量类型检查、单元测试和生产构建通过。

- [x] **Step 4: 执行真实 Chromium 反例 E2E**

分别从 Markdown 渲染、TypeScript Source、JSON Source 和 TXT CodeMirror 选择跨行片段；断言卡片都显示行号、textarea 不包含片段正文。普通未选择状态不显示工具栏。

- [x] **Step 5: 更新 Smoke Ledger**

记录各文件类型、缺失行号复现、反例、测试和服务收口。

## Smoke Ledger

- 定向测试：`src/lib/file-excerpt-reference.test.ts`、`file-excerpt-composer-wiring.test.ts`、`file-excerpt-multi-format-wiring.test.ts`，共 17 项通过。
- 全量测试：隔离 `CODEX_HOME` 下 59 个测试文件、276 项测试通过。沙箱内首次运行仅因 `127.0.0.1` 监听被拒绝而失败；允许本机监听后同一命令通过。
- 生产构建：`npm run build` 通过；保留仓库既有的 Turbopack NFT 动态路径追踪警告。
- Chromium/CDP：Markdown 渲染选取含内联代码的第 112 行，卡片显示 `MD · 112-112`；输入框正文为空。
- Chromium/CDP：MJS 第 2-3 行、JSON 第 1-2 行、TypeScript 第 2-3 行均生成对应文件类型与准确行号卡片。
- Chromium/CDP：CodeMirror 使用真实鼠标拖选第 2-3 行，卡片显示 `MD · 2-3`；`.txt` 与 Markdown 源码共用该实现分支。
- 反例：无文本选区时不显示“加入对话”工具栏；移除片段后卡片消失且输入框仍为空。
- 收口：Chrome 测试标签页和隔离生产服务均已关闭，未产生截图、临时日志或浏览器配置目录。
