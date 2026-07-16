# 文件树下载功能实施计划

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** 移除文件右键菜单中的“打开所在目录”，新增可下载任意文本或二进制文件的“下载”操作。

**Architecture:** 文件内容继续由 Codex app-server `fs/readFile` 提供，浏览器把返回的 Base64 解码为 Blob，并通过临时 `<a download>` 触发保存。文件树基础组件只派发路径，产品组件负责读取文件、下载反馈和错误收口，不新增或恢复旧 `/api/files/*` 路由。

**Tech Stack:** React 19、TypeScript、Codex app-server、Vitest、Chrome CDP。

## Global Constraints

- 下载必须支持文本和二进制文件，并保留原文件名。
- 不允许通过缺失的 `/api/files/raw` 或其他旧 HTTP 文件路由读取文件。
- 本地和 SSH 远程文件统一使用当前 app-server 连接的 `fs/readFile`。
- 下载失败必须显示本地化错误反馈，不产生未处理 Promise rejection。
- 开发和验证使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

### Task 1: 文件字节与菜单接线

**Files:**
- Modify: `src/codex-web/app-server-files.ts`
- Modify: `src/codex-web/app-server-files.test.ts`
- Modify: `src/components/ai-elements/file-tree.tsx`
- Modify: `src/components/project/FileTree.tsx`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/codex-web/app-server-file-tree-wiring.test.ts`

- [x] 补充二进制 Base64 解码和下载菜单接线失败测试。
- [x] 导出不受预览 10 MB 限制影响的文件字节解码函数，同时保留预览限制。
- [x] 删除 `onOpenContainingDirectory` 菜单接线和仅为该操作存在的定位状态。
- [x] 新增 `onDownload`，通过 `readFile`、Blob URL 和 `<a download>` 下载原文件名。
- [x] 增加中英文下载、成功和失败文案。

### Task 2: 验证与收口

- [x] 运行定向测试、全量测试和生产构建。
- [x] 使用真实 Chrome/CDP 右键文件并点击“下载”，断言下载事件的建议文件名和菜单项变化。
- [x] 使用取消下载策略验证，确保不产生临时下载文件。
- [x] 更新 Smoke Ledger、状态总览与审查结论。

## 状态总览

- `Code complete`：文件右键菜单已移除“打开所在目录”，新增“下载”。
- `Tests pass`：最终全量测试通过。
- `Smoke passed`：最终生产构建通过真实 Chrome/CDP 下载事件验证。
- `Review passed`：下载统一使用 app-server `fs/readFile`，保留原文件名，错误已收口；未新增 HTTP 文件读取路径。

## 决策日志

- 下载和预览共享 `fs/readFile` 事实源，但下载字节不继承 10 MB 预览上限。
- 下载在浏览器端生成 Blob，适用于本地和 SSH 远程 app-server 返回的文本或二进制内容。
- Chrome 验证使用 `Browser.setDownloadBehavior(deny)`，以下载事件验证交互而不产生需要清理的测试文件。

## Smoke Ledger

- 红灯复现：定向测试先因缺少 `fileBytesFromResponse` 在 TypeScript 编译阶段失败。
- 定向测试：`app-server-files.test.ts` 与 `app-server-file-tree-wiring.test.ts` 共 10 项通过。
- 二进制反例：`00 01 02 7f 80 ff` 经 Base64 往返后字节完全一致；二进制预览仍按原规则拒绝。
- 全量测试：隔离 `CODEX_HOME` 下 60 个测试文件、289 项测试通过。
- 生产构建：`npm run build` 通过；保留仓库既有 Turbopack NFT 动态路径追踪警告。
- Chrome/CDP：`AGENTS.md` 右键菜单为“复制路径 / 下载 / 插入引用”，不存在“打开所在目录”。
- 下载事件：点击“下载”后收到 `Browser.downloadWillBegin`，URL 为 `blob:`，建议文件名为 `AGENTS.md`。
- 反例与收口：Chrome 下载策略设为拒绝，确认未生成测试文件；本轮和遗留隔离服务均已终止，端口已释放。
