# PDF、Word 与 Excel 文件预览实施计划

**目标：** 右侧文件预览支持 PDF、DOC、DOCX、XLS、XLSX，继续以 `app-server fs/readFile` 为唯一文件内容来源。

**架构：** `PreviewPanel` 识别二进制文档后读取原始字节并交给按需加载的浏览器端查看器。PDF 使用浏览器原生查看器；DOCX 使用 `docx-preview`；XLS/XLSX 使用官方 SheetJS；DOC 使用审查通过后的旧版二进制 Word 解析器。所有格式保持只读、10 MB 上限和现有下载能力。

**技术栈：** React 19、Next.js 16、TypeScript、Codex app-server、docx-preview、SheetJS、Chrome CDP、Vitest。

## 全局约束

- 默认测试环境使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不修改 `~/code/codex`，不新增文件系统旁路，不通过外部在线 Office 服务上传文件。
- 解析器仅在打开对应格式时按需加载，不增加首屏主包负担。
- PDF、DOC、DOCX、XLS、XLSX 都执行 10 MB 原始文件限制。
- `.doc` 是实验性兼容：普通文字、表格和图片应可查看；复杂排版、宏、嵌入对象不承诺与 Word 完全一致。
- 依赖审查不通过时停止引入对应解析器并记录原因，不静默降低安全标准。
- 不自动提交或推送 Git。

## Task 1：审查并锁定解析依赖

**文件：**
- 修改：`package.json`
- 修改：`package-lock.json`
- 临时审查包：`/volume2/SSD/codex/Temp/`

- [x] 下载 `docx-preview`、官方 `xlsx@0.20.3` 和 `@file-viewer/doc@2.2.2` 包进行脚本、依赖、浏览器入口和外部请求审查。
- [x] 确认没有安装脚本、运行时上传、远程代码或 Node 专用硬依赖后锁定安装。
- [x] 运行依赖审计并记录结果。

## Task 2：建立二进制文档读取与格式分发

**文件：**
- 修改：`src/codex-web/app-server-files.ts`
- 修改：`src/components/layout/panels/PreviewPanel.tsx`
- 修改：`src/components/layout/panels/FileTreePanel.tsx`

- [x] 为原始二进制响应复用 10 MB 限制，避免绕过文本预览的大小约束。
- [x] 将 PDF、DOC、DOCX、XLS、XLSX 从不可预览集合移除。
- [x] 在 `PreviewPanel` 中区分媒体、二进制文档和文本，避免对文档字节执行 UTF-8 文本探测。
- [x] 保持加载、失败、切换文件和下载状态一致。

## Task 3：实现三个按需加载的查看器

**文件：**
- 新增：`src/components/editor/PdfViewer.tsx`
- 新增：`src/components/editor/WordDocumentViewer.tsx`
- 新增：`src/components/editor/SpreadsheetViewer.tsx`
- 修改：`src/i18n/zh.ts`
- 修改：`src/i18n/en.ts`

- [x] PDF 使用 Blob URL 加载浏览器原生查看器，并在切换或卸载时释放 URL。
- [x] DOCX 使用 `docx-preview` 渲染分页、表格和内嵌图片。
- [x] DOC 使用审查通过的旧格式解析器；显式显示实验性兼容提示，不执行宏或嵌入代码。
- [x] XLS/XLSX 解析工作簿，提供工作表切换、行列标题和可滚动表格。
- [x] 增加加载失败、空工作表、格式不支持等中英文状态。

## Task 4：测试与真实文件反例

**文件：**
- 修改或新增：`src/codex-web/tests/*file-preview*.test.ts`
- 真实样本：`/volume2/SSD/codex/Temp/codex-web-document-preview-fixtures/`

- [x] 先补失败测试，覆盖格式识别、大小限制、文件树开放和动态加载接线。
- [x] 生成或获取无宏的最小 PDF、DOC、DOCX、XLS、XLSX 样本并记录来源。
- [x] 正例：五种格式都能打开并显示实际内容，工作簿可切换工作表。
- [x] 反例：普通文本仍走原预览；超过 10 MB 的文档被拒绝；损坏文档显示错误且不影响下一文件；`.ppt/.pptx` 仍不可预览。

## Task 5：完整验证与归档

- [x] 运行 targeted Vitest。
- [x] 运行 `npm run test`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run test:smoke`。
- [x] 启动生产构建，通过 `http://192.168.3.12:45737` 的真实 Chrome 分别验证 PDF、DOC、DOCX、XLS、XLSX，检查 console 并保存截图到 `/volume2/SSD/codex/Temp/`。
- [x] 更新下方 Smoke Ledger。
- [x] 将本计划从 `docs/exec-plans/active/` 移至 `docs/exec-plans/completed/`。

## 决策记录

- DOCX 使用 `docx-preview@0.4.0`，关闭 altChunk HTML 渲染并清理非 HTTP、HTTPS、mailto 和页内锚点链接。
- XLS/XLSX 使用官方 SheetJS `xlsx@0.20.3`，关闭公式、HTML 和 VBA 读取，最多渲染 5000 行、200 列。
- DOC 使用 `@file-viewer/doc@2.2.2`，只传入本地字节并在无脚本 iframe 沙箱内展示；复杂排版明确标记为实验性。
- `npm audit` 报告 15 个仓库既有问题（1 个低危、14 个高危），新增三项依赖不在漏洞依赖链中，本次不扩大范围升级 Next.js 等既有依赖。

## Smoke Ledger

- Targeted Vitest：2 个文件、13 个测试通过；覆盖二进制大小限制、文件树扩展名和查看器接线。
- 全量测试：`npm run test` 通过，共 140 个测试文件、647 个测试。
- 生产构建：`npm run build` 完成编译、TypeScript 检查和 26 个静态页面生成。
- Bridge smoke：`npm run test:smoke` 通过；使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，读取 5 个模型，账号来源为 `app-server.account/read`。
- 正例：真实 Chrome 打开 PDF、DOC、DOCX、XLS、XLSX；PDF 页面可见，Word 内容与表格可见，XLS/XLSX 的“汇总/明细”可切换。
- 反例：损坏 DOCX 显示“无法解析该文档”，随后 XLSX 正常打开；TXT 保持原文本预览；超过 10 MB 被单元测试拒绝；PPT/PPTX 仍保留在不可预览集合。
- 控制台：最终生产构建验证为 0 错误、0 警告。
- 样本：PDF、DOCX、XLS、XLSX 在 `/volume2/SSD/codex/Temp/codex-web-document-preview-fixtures/` 生成；DOC 来自 `flyfish-dev/docjs` 的公开测试 fixture。
- 截图：`/volume2/SSD/codex/Temp/codex-web-document-preview-docx-fixed.png`、`/volume2/SSD/codex/Temp/codex-web-document-preview-pdf.png`、`/volume2/SSD/codex/Temp/codex-web-document-preview-xlsx.png`。
