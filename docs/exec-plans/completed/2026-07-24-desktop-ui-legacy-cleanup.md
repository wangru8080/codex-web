# 桌面 UI 遗留清理实施计划

> **执行要求：** 按任务逐项实现并更新复选框；测试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`；移动任何文件前必须再次展示源路径、Trash 目标路径和同名冲突检查；不执行删除命令，不自动提交或推送。
>
> 技术交接：[2026-07-23-web-only-performance-refactor.md](../../handover/2026-07-23-web-only-performance-refactor.md)

**目标：** 让浏览器 UI 不再读取或假设 Electron preload API，移除不可达的桌面组件与 shell 样式，同时保留 bridge、CLI、路径和 app-server 会话的跨平台服务端能力。

**架构：** 浏览器侧只保留真实可用的 app-server、HTTP 和 Web API 路径；没有 Web 实现的桌面安装、终端、原生长图和文件管理器入口从 UI 隐藏并移出源码树。About 保留禁用的 Web 更新扩展入口，但不连接旧 Electron updater。服务端 `process.platform`、Windows `npm.cmd`、浏览器打开命令和 app-server `platformOs` 独立保留，用静态边界测试防止清理越界。

**技术栈：** React 19、Next.js 16 App Router、Codex app-server bridge、Vitest、Playwright Smoke、Headless Chrome CDP。

## 全局约束

- 不改变 app-server request、notification、server request、Approval 或 source breadcrumb。
- 不新增 Electron 依赖、preload bridge、桌面打包入口或浏览器端凭据存储。
- 不为不存在的 `/api/files/open`、浏览器更新器或原生长图 IPC 制造替代状态。
- 文件选择继续使用现有 app-server 目录选择器；目录拖放缺少绝对路径时继续只使用浏览器提供的文件名。
- 无真实 Web 来源的桌面能力必须隐藏，不显示点击后静默失败或只报 unsupported 的主操作。
- `scripts/codex-web-cli.ts`、`scripts/start-next-with-bridge.ts`、`server/app-server-session.ts` 的跨平台服务端处理必须保留。
- 本阶段不实现新的 Web 长图引擎，不评估 Next/Vite，不调整阶段 2 长历史虚拟化。

## 调研结论

- 仓库已经没有 Electron 运行时目录、Electron npm 依赖或 Electron 构建脚本。
- `src/types/electron.d.ts` 仍声明完整 preload API，浏览器入口仍直接读取 `window.electronAPI`。
- `InstallWizard`、`TerminalDrawer`、`TerminalInstance` 和 `useTerminal` 没有生产入口；`terminalOpen` 只在 PanelContext 内自循环。
- `useUpdateChecker` 在 Web 模式是 no-op，但 About 页仍显示“检查更新”；UpdateBanner/UpdateDialog 只服务桌面 updater。
- `/api/files/open` 没有 route，当前“打开文件夹”浏览器 fallback 只会静默 404。
- `artifact-export.ts` 只调用不存在的 Electron `artifact.exportLongShot`，但 Preview 和 Diff 仍显示导出按钮。
- `layout.tsx`、`globals.css` 和 `UnifiedTopBar` 仍携带 Electron shell、traffic lights、drag region 和 vibrancy 逻辑。
- `theme/loader.ts` 仍优先解析 Electron `RESOURCES_PATH/standalone/themes`；Web 包已有 `CODEX_WEB_APP_ROOT/themes` 路径。

## 状态总览

- 当前状态：阶段 4 达到 `Code complete`、`Tests pass` 和 `Smoke passed`；执行计划已归档。
- 当前 Git：阶段 4 代码、测试和归档记录纳入同一 Git 提交，未远程推送。
- 已知残余：阶段 2 生产长历史初始置底仍为既有失败，不纳入阶段 4 修复。
- 临时验证产物：`/volume2/SSD/codex/Temp/codex-web-local-headless-stage4/`；生产服务与 Headless Chrome 均已停止。
- 补充修正：About 恢复禁用更新按钮并读取 `app-server.initialize.platformOs`；短对话取消底部对齐，首条问题从消息区域顶部开始。验证产物位于 `/volume2/SSD/codex/Temp/codex-web-local-headless-stage4-fixes/`。

---

### 任务 1：建立 Web-only renderer 边界测试

**文件：**
- 新建：`src/codex-web/web-only-renderer-boundary.test.ts`

**接口：**
- 读取明确的浏览器入口文件并断言不含 `electronAPI`、`data-shell=electron`、`WebkitAppRegion`、`/api/files/open` 或桌面 updater/terminal/artifact import。
- 断言已确认的桌面专属文件不再存在。
- 反例断言 CLI、Next 启动器和 app-server 会话仍保留跨平台分支。

- [x] 写失败测试，至少覆盖以下边界：

```ts
expect(browserSources).not.toMatch(/electronAPI|WebkitAppRegion|\/api\/files\/open/);
expect(existsSync(resolve(root, "src/types/electron.d.ts"))).toBe(false);
expect(cliSource).toContain('process.platform === "darwin"');
expect(cliSource).toContain('process.platform === "win32"');
expect(startSource).toContain('process.platform === "win32" ? "npm.cmd" : "npm"');
expect(initializeResponseSource).toContain("platformOs: string");
expect(sessionTestSource).toContain('platformOs: "linux"');
```

- [x] 运行 `npx vitest run src/codex-web/web-only-renderer-boundary.test.ts`，确认因现有 Electron 引用和文件存在而失败。
- [x] 每完成后续任务即重跑该测试，最终确认通过。

### 任务 2：收敛文件选择、平台识别与浏览器 shell

**文件：**
- 修改：`src/app/chat/page.tsx`
- 修改：`src/components/layout/ChatListPanel.tsx`
- 修改：`src/components/layout/UnifiedTopBar.tsx`
- 修改：`src/components/layout/ProjectGroupHeader.tsx`
- 修改：`src/components/chat/MessageInput.tsx`
- 修改：`src/components/ai-elements/prompt-input.tsx`
- 修改：`src/hooks/useClientPlatform.ts`
- 修改：`src/components/settings/AboutSection.tsx`
- 修改：`src/components/layout/SentryInit.tsx`
- 移动：`src/hooks/useNativeFolderPicker.ts`

**接口：**
- 新聊天与侧栏“新项目”统一打开现有 `FolderPickerDialog`。
- About 的 channel 固定为 `Web`，OS 只从浏览器 navigator 推断。
- 项目路径在 top bar 作为只读上下文显示；侧栏不再提供无实现的“打开文件夹”。
- 目录拖放继续用 `dir.name` 生成 directory mention。

- [x] 移动 `useNativeFolderPicker.ts` 后，让两个调用方直接执行 `setFolderPickerOpen(true)`。
- [x] 删除 UnifiedTopBar 和 ProjectGroupHeader 的 `electronAPI.shell.openPath` 与 `/api/files/open` 分支；保留项目名称、路径 tooltip、复制路径和移除项目。
- [x] 将目录拖放实现收敛为：

```ts
for (const dir of dirs) {
  const normalized = normalizeMentionPath(dir.name);
  if (!normalized) continue;
  window.dispatchEvent(new CustomEvent("insert-file-mention", {
    detail: { path: normalized, nodeType: "directory" },
  }));
}
```

- [x] `useClientPlatform` 仅使用 `navigator.platform`，About channel 固定为 `Web`，Sentry 不再发送 `electron` tag。
- [x] 运行边界测试和 `npm run typecheck`。

### 任务 3：移出不可达的安装、终端和桌面更新模块

**文件：**
- 修改：`src/components/layout/AppShell.tsx`
- 修改：`src/components/layout/ChatListPanel.tsx`
- 修改：`src/components/settings/AboutSection.tsx`
- 修改：`src/hooks/usePanel.ts`
- 修改：`src/i18n/en.ts`
- 修改：`src/i18n/zh.ts`
- 移动：`src/components/layout/InstallWizard.tsx`
- 移动：`src/components/layout/UpdateBanner.tsx`
- 移动：`src/components/layout/UpdateDialog.tsx`
- 移动：`src/components/terminal/TerminalDrawer.tsx`
- 移动：`src/components/terminal/TerminalInstance.tsx`
- 移动：`src/hooks/useTerminal.ts`
- 移动：`src/hooks/useUpdate.ts`
- 移动：`src/hooks/useUpdateChecker.ts`

**接口：**
- AppShell 不再创建 UpdateContext、update listener、banner 或 dialog。
- ChatListPanel props 回到 `{ open: boolean }`，不显示永远不会变化的更新圆点。
- About 继续显示版本、Web channel、OS 和 app-server 账号信息，不显示 no-op 更新操作。
- PanelContext 删除无入口的 `terminalOpen`/`setTerminalOpen`。

- [x] 先扩展边界测试，断言 AppShell 不含 `UpdateContext`、`useUpdateChecker`、`UpdateBanner`、`UpdateDialog`，PanelContext 不含 terminal state。
- [x] 移动 8 个桌面专属模块并清理所有导入、state、props 和 JSX。
- [x] 从中英文词典移除仅由本次移动模块消费的 `install.*`、`update.*` 和 About 更新检查键；用 `rg` 确认没有剩余调用。
- [x] 运行边界测试、i18n 相关测试和 `npm run typecheck`。

### 任务 4：隐藏无 Web 实现的原生长图导出

**文件：**
- 修改：`src/components/chat/DiffSummary.tsx`
- 修改：`src/components/chat/MessageItem.tsx`
- 修改：`src/components/layout/panels/PreviewPanel.tsx`
- 修改：`src/i18n/en.ts`
- 修改：`src/i18n/zh.ts`
- 移动：`src/lib/artifact-export.ts`

**接口：**
- DiffSummary 只保留预览操作，不再接受 `onExportLongShot`。
- PreviewPanel 保留 HTML/Markdown/Sandpack 预览，不显示只能调用 Electron IPC 的长图按钮。

- [x] 先扩展边界测试，断言 `artifact-export` 文件不存在，三处 UI 不含 `exportHtmlAsLongShot` 或 `onExportLongShot`。
- [x] 删除 DiffSummary 的 long-shot prop、扩展名 gate 和按钮；删除 MessageItem callback。
- [x] 删除 PreviewPanel 的 helper import、export state/callback/button，保留所有预览与保存逻辑。
- [x] 移除 `filePreview.exportLongScreenshot`、`diffSummary.exportLongShot` 中英文键。
- [x] 运行覆盖 Preview/Diff 的边界测试和 `npm run typecheck`。

### 任务 5：移出 Electron shell 样式与遗留纯工具

**文件：**
- 修改：`src/app/layout.tsx`
- 修改：`src/app/globals.css`
- 修改：`src/components/layout/UnifiedTopBar.tsx`
- 修改：`src/components/ui/dialog.tsx`
- 修改：`src/lib/theme/loader.ts`
- 修改：`src/lib/theme/loader.test.ts`
- 修改：`src/lib/clipboard.ts`
- 修改：`src/components/layout/SessionListItem.tsx`
- 修改：`src/components/ui/prompt-dialog.tsx`
- 移动：`src/types/electron.d.ts`
- 移动：`src/lib/bg-notify-parser.ts`
- 移动：`src/lib/tray-menu-labels.ts`
- 移动：`src/lib/logging/bounded-line-ring.ts`
- 移动：`src/lib/logging/main-log-rotation.ts`

**接口：**
- RootLayout 不再探测 Electron UA/preload 或设置 `data-shell`、`data-platform-style`。
- 保留默认 `--platform-*` 产品 token；删除只匹配 Electron shell 的 win32/macOS override、traffic-light 和 vibrancy 块。
- UnifiedTopBar 删除 drag/no-drag inline style，按钮布局使用普通 Web 间距。
- `resolveThemesDir` 只解析 `CODEX_WEB_APP_ROOT/themes`，未设置时回退启动目录。

- [x] 先扩展边界测试，断言 layout/globals/topbar/dialog 不含 `data-shell="electron"`、`WebkitAppRegion` 或 traffic-light token。
- [x] 删除 Electron anti-FOUC 脚本和专属 CSS 块，保留主题 anti-FOUC 与默认产品 token。
- [x] 将主题目录测试改为 Web 包根目录优先：

```ts
expect(resolveThemesDir({
  applicationRoot: "/opt/codex-web/app",
  workingDirectory: "/home/user/project",
})).toBe("/opt/codex-web/app/themes");
```

- [x] 移动 preload 类型和四个无引用 Electron main/tray/logging 工具。
- [x] 运行边界测试、`src/lib/theme/loader.test.ts` 和 `npm run typecheck`。

### 任务 6：完整验证、浏览器反例与交接

**文件：**
- 修改：`docs/handover/2026-07-23-web-only-performance-refactor.md`
- 修改：本执行计划的 checklist、状态总览、决策日志和 Smoke Ledger
- 完成后待确认移动：`docs/exec-plans/completed/2026-07-24-desktop-ui-legacy-cleanup.md`

- [x] 运行 `rg -n 'electronAPI|Electron|WebkitAppRegion|data-shell="electron"|/api/files/open' src`；只允许仍有产品意义的历史迁移说明，运行时代码必须为零。
- [x] 运行 `npm run test`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run test:smoke`。
- [x] 启动浏览器应用，在桌面与移动视口验证登录、设置 About 和聊天 FolderPicker；console 不出现因移除 Electron fallback 产生的新异常。
- [x] 反例验证：静态边界测试确认浏览器 UI 无更新圆点、安装向导、终端抽屉、长图按钮或“打开文件夹”假入口；完整测试和 bridge Smoke 确认既有 app-server 主链路未回归。
- [x] 运行边界测试确认 CLI 的 macOS `open`、Windows `cmd /c start`、Linux `xdg-open`，Next Windows `npm.cmd` 和 app-server `platformOs` 仍保留。
- [x] 更新交接文档、状态总览、决策日志和 Smoke Ledger。
- [x] 经用户再次确认后归档执行计划并提交；不远程推送。

### 补充任务 7：修正 About 更新入口、运行端平台与短对话对齐

**文件：**
- 修改：`src/components/settings/AboutSection.tsx`
- 修改：`src/components/chat/MessageList.tsx`
- 修改：`src/i18n/en.ts`
- 修改：`src/i18n/zh.ts`
- 修改：`src/codex-web/about-section-removal.test.ts`
- 修改：`src/codex-web/message-list-virtualization-wiring.test.ts`
- 新建：`src/codex-web/runtime-platform.ts`
- 新建：`src/codex-web/runtime-platform.test.ts`

**接口：**
- About 通过 `useAppServerSelector((state) => state.initialize?.data.platformOs)` 读取运行端操作系统，使用 `runtimePlatformLabel(platformOs: string | null | undefined): string` 归一化为 `Linux`、`Windows`、`macOS` 或 `Unknown`。
- About 恢复禁用的“检查更新”按钮，保留后续 Web 更新契约的稳定 UI 位置，但不调用不存在的更新 API、不恢复 Electron updater。
- `MessageList` 移除 `alignToBottom`，使短对话从消息区域顶部布局；保留 `initialTopMostItemIndex`、`followOutput` 和流式底部跟随。

- [x] 先扩展 About 和虚拟列表接线测试，并新增平台适配器测试；运行定向 Vitest，确认旧实现因缺少 app-server selector、更新按钮、平台适配器及仍有 `alignToBottom` 而失败。
- [x] 实现 `runtimePlatformLabel`，至少覆盖 `linux`、`windows`、`macos`、大小写、空值和未知值。
- [x] About 使用 app-server initialize 的 `platformOs`，恢复禁用更新按钮及中英文键；断言源码不再读取 `navigator.userAgent`。
- [x] 从 Virtuoso 移除 `alignToBottom`；保留长历史初始最新位置、`followOutput`、`atBottomStateChange` 和手动滚到底部按钮。
- [x] 运行 `npx vitest run src/codex-web/runtime-platform.test.ts src/codex-web/about-section-removal.test.ts src/codex-web/message-list-virtualization-wiring.test.ts`，预期全部通过。
- [x] 使用隔离 `CODEX_HOME` 运行 `npm run typecheck`、`npm run test`、`npm run build` 和 `npm run test:smoke`。
- [x] 启动生产 Web UI，在 1440x900 与 390x844 验证 About 显示 app-server 的 Linux、更新按钮存在且禁用；新聊天首条问题顶部对齐；console 无新增错误。
- [x] 将验证结果同步到状态总览、决策日志、Smoke Ledger 和技术交接；归档与 Git 提交仍等待用户再次确认。

## 决策日志

- 2026-07-24：阶段 4 采用“真实 Web 路径保留、无 Web 实现入口隐藏”的边界，不为已移除的 Electron preload 能力创建假 fallback。
- 2026-07-24：不实现新的 Web 长图引擎；渲染规则、分页、字体和大画布限制需要独立产品方案，不能混入遗留清理。
- 2026-07-24：服务端 `process.platform` 不是桌面 UI 遗留；CLI 打开浏览器、Windows `npm.cmd` 和 app-server `platformOs` 明确保留并作为反例测试。
- 2026-07-24：所有删除语义通过移动到 `/volume2/SSD/Trash/home/rrssnas/code/codex-web/` 原层级完成，不执行删除命令。
- 2026-07-24：项目选择统一使用 app-server `fs/readDirectory` 支撑的 `FolderPicker`；浏览器无法取得拖放目录绝对路径时只使用 `FileSystemEntry.name`，不伪造本地路径。
- 2026-07-24：About 页的发布渠道固定显示 `Web`，OS 来自 `app-server.initialize.data.platformOs`；浏览器 navigator 只用于浏览器本机交互，不再冒充运行端系统。
- 2026-07-24：静态反例测试显式保留 CLI 的 macOS、Windows、Linux 打开命令、Windows `npm.cmd` 和 generated `platformOs`，避免把服务端跨平台能力误判为桌面 UI 遗留。
- 2026-07-24：按用户确认恢复 About 更新按钮，但在 Web 更新后端尚未设计前保持禁用；不恢复旧 Electron updater 或 no-op Hook。
- 2026-07-24：短对话只取消 Virtuoso 的 `alignToBottom`；长历史初始最新位置、流式跟随和向上阅读保护保持原实现。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
|---|---|---|---|
| 2026-07-24 | 阶段 4 只读盘点 | Electron renderer 可达性与服务端反例 | 发现 preload 类型、文件选择、更新、长图和 shell 样式遗留；确认 CLI/bridge 跨平台分支需保留 |
| 2026-07-24 | Vitest 定向回归 | Web-only renderer 边界、主题目录、About | 3 个测试文件、11 项测试通过；边界测试先红后绿 |
| 2026-07-24 | 隔离 `CODEX_HOME` | `npm run typecheck`、`npm run test`、`npm run build` | 类型检查通过；126 个测试文件、585 项测试通过；Next 生产构建与 postbuild 通过 |
| 2026-07-24 | 隔离 `CODEX_HOME` | `npm run test:smoke` | bridge/app-server Smoke 通过，读取 7 个模型，账号来源为 `app-server.account/read` |
| 2026-07-24 | Headless Chrome 149，1440x900 | 登录、About、聊天项目选择器、console | 登录 200；About 显示 Web；“新建项目”打开 Web FolderPicker；无 console error 或 Electron/JS 异常；当时更新入口尚未按补充任务恢复 |
| 2026-07-24 | Headless Chrome 149，390x844 | About 响应式反例 | 页面宽度 390px，无横向溢出；Web 渠道可见；当时更新入口尚未按补充任务恢复 |
| 2026-07-24 | 静态运行时扫描 | Electron UI 遗留与服务端跨平台反例 | 生产源码无 `electronAPI`、Electron shell、`WebkitAppRegion`、`/api/files/open`；CLI/bridge/generated schema 跨平台分支仍由测试覆盖 |
| 2026-07-24 | Vitest 定向回归 | 运行端平台、About 更新入口、短对话布局 | 测试先红后绿；3 个测试文件、17 项通过 |
| 2026-07-24 | 隔离 `CODEX_HOME` | 补充修正全量验证 | `npm run typecheck`、127 个测试文件/594 项测试、生产构建、bridge Smoke 全部通过；模型 7 个，账号来源 `app-server.account/read` |
| 2026-07-24 | Headless Chrome 149，1440x900 | About 与首条真实 Turn | About 显示 app-server Linux，禁用更新按钮存在；首条问题 `topOffset=0`、`scrollTop=0`，回答紧随其下；console clean |
| 2026-07-24 | Headless Chrome 149，390x844 | About 移动反例 | Linux 与禁用更新按钮可见；页面宽度和视口均为 390px，无横向溢出；console clean |
