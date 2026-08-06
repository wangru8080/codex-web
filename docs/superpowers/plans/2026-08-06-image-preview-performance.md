# 图片预览性能与失败修复实施计划

> **For agentic workers:** 本计划按任务逐项执行，每项完成后运行对应的定向测试。

**目标：** 修复 `view_image` 大图最终加载失败/等待过长的问题，并降低右侧文件预览的重复读取开销。

**架构：** 保留 app-server 作为文件事实源，在浏览器端增加按绝对路径去重的图片资源缓存：一次 `fs/readFile` 响应解码为 Blob URL，聊天工具结果和右侧预览复用同一 URL。文件树只保留一次刷新监听，并避免同一路径的并发目录请求；过期请求不得覆盖新工作区状态。

**技术栈：** Next.js、React、TypeScript、Vitest、app-server JSON-RPC。

## 全局约束

- 用户可见图片和预览数据必须来自 app-server `fs/readFile` 或真实工具结果，不得伪造占位状态。
- 不在浏览器持久化 OAuth token、API key 或 `CODEX_HOME` 凭据。
- 所有代码注释、测试说明和文档使用简体中文。
- 默认测试环境使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### 任务 1：建立可复用的图片资源缓存

**文件：**
- 新建：`src/lib/media-resource-cache.ts`
- 修改：`src/codex-web/app-server-files.ts`
- 测试：`src/lib/tests/media-resource-cache.test.ts`

**接口：** `getCachedMediaObjectUrl(path, readFile)` 接收文件路径和 app-server 读取函数，返回可复用的 Blob URL；同一路径并发调用必须共享同一个 Promise。

- [x] 编写测试：断言并发读取只调用一次、生成 `blob:` URL，失败后可重试。
- [x] 实现 Base64 解码到 `Blob`，按路径缓存 Promise，并在失败时移除缓存。
- [x] 运行 `npx vitest run src/lib/tests/media-resource-cache.test.ts`，确认通过。

### 任务 2：让聊天工具图片与右侧预览共用缓存

**文件：**
- 修改：`src/components/chat/MediaPreview.tsx`
- 修改：`src/components/layout/panels/PreviewPanel.tsx`
- 修改：`src/codex-web/tests/app-server-output-media-wiring.test.ts`
- 修改：`src/codex-web/tests/app-server-file-preview-wiring.test.ts`

**接口：** 两个组件都通过 `getCachedMediaObjectUrl` 读取本地媒体；组件卸载或路径切换只取消状态提交，不撤销仍可能被另一组件使用的 URL。

- [x] 将 `data:` URL 构造改为缓存 Blob URL，并保留 loading、失败和取消过期请求状态。
- [x] 右侧媒体预览复用同一路径缓存，避免聊天区和侧栏分别传输同一张图片。
- [x] 更新 wiring 测试，断言两处使用缓存入口而不是直接构造 `data:` URL。
- [x] 运行相关 Vitest 测试并检查 TypeScript 类型。

### 任务 3：修复文件树重复刷新与并发目录请求

**文件：**
- 修改：`src/components/project/FileTree.tsx`
- 测试：`src/codex-web/tests/app-server-file-tree-wiring.test.ts`

**接口：** 文件树刷新事件只注册一次；相同目录在加载中时不重复请求，工作区切换时旧请求不能写回新树。

- [x] 复核文件树刷新监听和目录请求去重；当前实现已只注册一次监听，并用 `loadingDirectoriesRef` 阻止重复目录请求，无需业务代码修改。
- [x] 保持现有工作区切换清空逻辑，并确认刷新请求在取消后安静结束。
- [x] 保留现有 wiring 测试覆盖。
- [x] 运行 `npm run test`，并确认已有 `npm run dev` 实例可响应页面请求。

### 任务 4：收尾检查

- [x] 检查 `git diff` 仅包含本任务相关文件，不覆盖用户已有改动。
- [x] 记录实际运行的测试命令和剩余风险；不声称未运行的验证已通过。
