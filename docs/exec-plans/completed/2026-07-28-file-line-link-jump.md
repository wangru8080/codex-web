# 文件行号链接跳转实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 当前环境未提供上述子技能，且本任务未授权子代理；由当前会话按本计划内联执行。

**Goal:** 对齐官方 Codex 的文件链接体验：显示 `文件名 (line N)`，点击后在右侧源码预览定位到第 N 行开头。

**Architecture:** 继续使用现有 `PreviewSource.anchor` 和 `parseAnchor()` 作为唯一行号事实源。聊天 Markdown 链接和裸文件引用只负责保留 anchor、展示官方行号标签并请求源码模式；`PreviewPanel` 将解析后的行号分别交给普通 `SourceView` 和 CodeMirror `MarkdownEditor` 完成滚动与定位。

**Tech Stack:** React 19、TypeScript、Streamdown、react-syntax-highlighter、CodeMirror 6、Vitest、Codex app-server、Chrome CDP。

## Global Constraints

- 默认使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不修改 `~/code/codex`。
- 不新增依赖，不改变文件授权、路径解析或外链安全策略。
- 不自动提交或推送 Git。
- 用户可见行号必须来自现有文件链接 anchor，不伪造 app-server 状态。
- 普通文件链接和 Markdown 标题 anchor 是反例：不得追加错误行号或强制切换源码模式。

---

### Task 1: 文件链接显示官方行号并请求源码模式

**Files:**
- Modify: `src/components/chat/markdown-components.tsx`
- Modify: `src/components/chat/DevOutputChips.tsx`
- Test: `src/lib/markdown/tests/message-response.test.ts`

**Interfaces:**
- Consumes: `parseAnchor(raw): ParsedAnchor`、`PanelContextValue.setPreviewSource()`、`setPreviewViewMode(mode)`。
- Produces: 带 `(line N)` 的链接，以及行号链接点击时的 `source` 视图请求。

- [x] **Step 1: 写入失败的渲染测试**

  在现有 `MessageResponse` 测试中断言 `#L42` 渲染为 `websocket-bridge.ts (line 42)`，已经包含 `(line 42)` 的标签不重复追加，无行号文件链接不追加标签。

- [x] **Step 2: 运行 targeted test 并确认失败**

  Run: `npm exec -- vitest run src/lib/markdown/tests/message-response.test.ts`

  Expected: FAIL，缺少 `(line 42)`。

- [x] **Step 3: 实现最小链接展示与点击接线**

  `ChatLink` 使用 `parseAnchor(target.anchor)` 得到行号；仅当子文本未包含同一行号时追加：

  ```tsx
  <span>{children}</span>
  {lineNumber && !hasLineLabel(children, lineNumber) ? (
    <span className="text-blue-500/80">(line {lineNumber})</span>
  ) : null}
  ```

  点击行号链接时先保留现有 `setPreviewSource()`，随后调用 `setPreviewViewMode("source")`。`DevOutputChips` 对裸路径复用同一 `parseAnchor()` 语义，将 `#L12` / `:12` 展示为 `(line 12)` 并请求源码模式。

- [x] **Step 4: 运行 targeted test 并确认通过**

  Run: `npm exec -- vitest run src/lib/markdown/tests/message-response.test.ts`

  Expected: PASS。

---

### Task 2: 普通源码预览滚动并高亮目标行

**Files:**
- Modify: `src/components/layout/panels/PreviewPanel.tsx`
- Test: `src/codex-web/tests/file-excerpt-multi-format-wiring.test.ts`

**Interfaces:**
- Consumes: `PreviewSource.anchor`、`parseAnchor()`、现有 `[data-source-line]` DOM 标记。
- Produces: `SourceView` 的 `targetLine?: number` 属性和真实行滚动。

- [x] **Step 1: 写入失败的接线测试**

  断言 `PreviewPanel` 将行号传给 `SourceView`，并查询 `[data-source-line="N"]` 后调用 `scrollIntoView({ block: "start" })`；无行号时不生成目标行。

- [x] **Step 2: 运行 targeted test 并确认失败**

  Run: `npm exec -- vitest run src/codex-web/tests/file-excerpt-multi-format-wiring.test.ts`

  Expected: FAIL，`SourceView` 尚无 `targetLine`。

- [x] **Step 3: 实现源码行滚动与高亮**

  在 `PreviewPanel` 中只解析一次当前文件 anchor：

  ```ts
  const parsedAnchor = parseAnchor(previewSource?.kind === "file" ? previewSource.anchor : undefined);
  const targetLine = parsedAnchor.kind === "line" ? parsedAnchor.line : undefined;
  ```

  `SourceView` 在内容渲染后的动画帧查询目标行并直接滚动到顶部；`sourceLineProps()` 给目标行增加稳定的蓝色弱高亮。目标行不存在时保持当前位置。

- [x] **Step 4: 运行 targeted test 并确认通过**

  Run: `npm exec -- vitest run src/codex-web/tests/file-excerpt-multi-format-wiring.test.ts`

  Expected: PASS。

---

### Task 3: Markdown/TXT CodeMirror 定位目标行开头

**Files:**
- Modify: `src/components/editor/MarkdownEditor.tsx`
- Modify: `src/components/layout/panels/PreviewPanel.tsx`
- Test: `src/codex-web/tests/file-excerpt-multi-format-wiring.test.ts`

**Interfaces:**
- Consumes: Task 2 产出的 `targetLine?: number`。
- Produces: `MarkdownEditor.targetLine?: number`，将光标与视口定位到目标行开头。

- [x] **Step 1: 扩展失败测试**

  断言 `MarkdownEditor` 接收 `targetLine`，使用 `state.doc.line(line).from` 与 `EditorView.scrollIntoView(position, { y: "start" })`；`PreviewPanel` 传入同一目标行。

- [x] **Step 2: 运行 targeted test 并确认失败**

  Run: `npm exec -- vitest run src/codex-web/tests/file-excerpt-multi-format-wiring.test.ts`

  Expected: FAIL，编辑器尚无定位属性。

- [x] **Step 3: 实现 CodeMirror 定位**

  在外部 `value` 同步 effect 之后增加定位 effect：

  ```ts
  const line = Math.min(targetLine, view.state.doc.lines);
  const position = view.state.doc.line(line).from;
  view.dispatch({
    selection: { anchor: position },
    effects: EditorView.scrollIntoView(position, { y: "start", yMargin: 12 }),
  });
  ```

  无行号、空文档或非法行号保持现状。

- [x] **Step 4: 运行 targeted test 并确认通过**

  Run: `npm exec -- vitest run src/codex-web/tests/file-excerpt-multi-format-wiring.test.ts`

  Expected: PASS。

---

### Task 4: 全量验证与真实浏览器验收

**Files:**
- Modify: `docs/exec-plans/active/2026-07-28-file-line-link-jump.md`
- Move after completion: `docs/exec-plans/active/2026-07-28-file-line-link-jump.md` → `docs/exec-plans/completed/2026-07-28-file-line-link-jump.md`

**Interfaces:**
- Consumes: Tasks 1-3 的完整用户路径。
- Produces: Tests pass、Smoke passed、真实浏览器截图和已完成执行计划。

- [x] **Step 1: 运行完整测试**

  Run: `npm run test`

  Expected: typecheck 和全部 Vitest 测试通过。

- [x] **Step 2: 运行 bridge smoke**

  Run: `npm run test:smoke`

  Expected: 隔离 app-server initialize、model/list、account/read 通过。

- [x] **Step 3: 启动开发应用并使用真实 Chrome 验证**

  使用隔离 `CODEX_HOME` 和仅当前进程有效的临时 Web 登录配置启动 `npm run dev`，通过 `http://192.168.3.12:45737` 的 Chrome CDP 登录并验证：

  1. `PreviewPanel.tsx#L556` 显示为 `PreviewPanel.tsx (line 556)`。
  2. 点击后右侧打开源码视图并使第 556 行进入视口顶部附近且带高亮。
  3. `AGENTS.md#L22` 显示为 `AGENTS.md (line 22)`，点击后 CodeMirror 光标位于第 22 行开头。
  4. 普通文件链接不显示 `(line N)`；Markdown `#heading` 仍走渲染标题跳转。

- [x] **Step 4: 保存截图并检查 console**

  截图保存到 `/volume2/SSD/codex/Temp/`，目标文件写入前确认不存在；浏览器 console 不得有本功能引入的错误。

- [x] **Step 5: 更新计划与 Smoke Ledger**

  记录测试命令、正例与反例结果，将本计划移动到 `docs/exec-plans/completed/`。

## Smoke Ledger

- Tests pass：`npm run test` 通过，共 139 个测试文件、642 项测试；typecheck 同步通过。
- Smoke passed：`npm run test:smoke` 在 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 下通过，真实 app-server 完成 initialize、`model/list`（5 个模型）与 `account/read`。
- 正例：真实 Chrome 中 `PreviewPanel.tsx#L556` 显示一次 `(line 556)`；点击后右侧源码第 556 行位于可视区并带弱高亮。
- Markdown 正例：真实 Chrome 中 `AGENTS.md#L22` 显示一次 `(line 22)`；点击后 CodeMirror 活动行号为 22，光标位于该行开头且该行可见。
- 反例：自带 `(line 22)` / `(line 10)` 的链接未重复追加；无行号的 `README.md` / `package.json` 未显示行号。Markdown 标题 anchor 继续由既有 heading 分支处理，不请求源码行定位。
- 浏览器：通过 `http://192.168.3.12:45737` 的真实 Chrome CDP 验证，截图保存至 `/volume2/SSD/codex/Temp/codex-web-line-link-browser-20260728.png` 与 `/volume2/SSD/codex/Temp/codex-web-markdown-line-browser-20260728.png`。
- Console：未发现本功能引入的运行时异常；页面仍有既存 `/api/settings/workspace` 404 请求，与文件行号链接路径无关。
