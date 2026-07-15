# Markdown 完成态与链接展示修复实施计划

> **执行要求：** 在当前会话按任务逐项实施并更新复选框；使用隔离 `CODEX_HOME` 验证，不自动提交 Git。

**目标：** 完成态 final answer 不再被流式 Markdown 修补器追加字符；本地文件和远程 URL 链接以可识别、可点击且安全的聊天链接样式展示。

**架构：** `MessageResponse` 默认切换为 Streamdown 静态模式，新增仅供 `StreamingMessage` 使用的流式包装器。链接 href 通过纯分类器区分本地文件、远程 URL、普通相对链接和危险协议；聊天 Markdown anchor 统一渲染图标、颜色和 hover 状态，本地文件继续通过 `PreviewPanel` 打开。

**技术栈：** React 19、TypeScript、Streamdown 2.1、Vitest、Playwright MCP。

## 全局约束

- 原始 app-server final answer 是事实源，不得修改或静默补写内容。
- 只有生成中的 `StreamingMessage` 可以启用 `parseIncompleteMarkdown`。
- 本地文件点击继续使用现有 `setPreviewSource`、`classifyPath` 和工作目录解析逻辑。
- HTTP(S)、mailto、tel 可导航；javascript、data、blob 等危险协议必须降级为不可点击文本。
- 保持 CodexWeb 现有消息排版，只增强链接这个小模块的视觉和交互。
- 测试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

### Task 1：完成态 Markdown 不再追加星号

**文件：**
- 修改：`src/components/ai-elements/message.tsx`
- 修改：`src/components/chat/StreamingMessage.tsx`
- 修改：`vitest.config.ts`
- 新增：`src/lib/markdown/message-response.test.ts`

- [x] 编写失败测试：包含已闭合粗体和句末行内代码的完整 final answer，渲染文本不得多出 `*`。
- [x] `MessageResponse` 默认使用 `mode="static"` 且关闭不完整 Markdown 修补。
- [x] 新增流式包装器，只有 `StreamingMessage` 使用 `mode="streaming"` 和不完整 Markdown 修补。
- [x] 验证静态与流式组件分别保持预期模式。

### Task 2：本地文件与 URL 链接样式

**文件：**
- 新增：`src/lib/markdown/chat-link.ts`
- 新增：`src/lib/markdown/chat-link.test.ts`
- 修改：`src/components/chat/markdown-components.tsx`
- 修改：`src/components/chat/DevOutputChips.tsx`

- [x] 编写失败测试：绝对/相对本地文件、HTTP(S)、普通相对链接和危险协议分类正确。
- [x] 本地文件链接显示 `file_code` 图标和蓝色紧凑标签，点击打开现有文件预览。
- [x] 远程 URL 显示 Web/外链图标和蓝色标签，在新窗口安全打开。
- [x] 普通相对链接保持可导航；危险协议只显示文本。
- [x] 移除 `DevOutputSegment` 重复的局部 anchor renderer，统一使用聊天 Markdown renderer。

### Task 3：回归与视觉验证

- [x] 运行定向测试、`npm run test` 和 `npm run build`。
- [x] 使用隔离 app-server 生成包含闭合粗体、本地文件链接和远程 URL 的真实消息。
- [x] 验证完成态末尾无额外 `*`，本地文件与 URL 均生成可识别 DOM 链接。
- [x] 点击本地文件链接验证应用拦截浏览器导航，并核对现有 `setPreviewSource` 工作区预览接线；通过 DOM 测试验证远程 URL 安全属性。
- [x] 记录普通文本与危险协议反例，确认没有被错误链接化。
- [x] 输出 Playwright 产物清理与计划归档拟执行操作清单，取得用户明确同意后执行移动。

## Smoke Ledger

- 诊断基线：指定 rollout 三类 final answer 原始字段结尾均为“下。”，没有 `*`；对完整文本直接调用 `remend()` 会唯一追加一个 `*`，长度由 1826 变为 1827。
- 链接基线：Streamdown 默认 link safety 将链接渲染成普通按钮；项目的本地文件预览接线只存在于 `DevOutputSegment` 局部 renderer，未形成统一、带图标的聊天链接视觉。
- TDD：完成态 DOM 红灯明确包含 `下。*</p>`；流式包装器与链接分类模块最初不存在。实现后两个定向测试文件共 8 项通过。
- 流式策略：保留 bold/link/inline-code 等不完整 Markdown 修补，仅关闭会误判已闭合行内代码中 `*` 的单星号 italic 修补。
- 自动化验证：`npm run test` 共 44 个测试文件、205 项通过；`npm run build` 成功生成 22 个页面，仅保留既有 Turbopack NFT 警告。
- 真实消息：隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 的生产构建会话中，`/settings/*` 保持完整行内代码，句末显示“下。”且无额外 `*`；本地文件和 HTTPS URL 均成为可识别链接。
- 视觉检查：Playwright 截图中本地文件带文件图标、远程 URL 带 Web 图标，并与普通正文区分；危险链接显示 `[blocked]`，消息区域无文字重叠。
- 交互边界：在 `/chat` 新会话页点击本地文件链接后 URL 保持不变，说明浏览器导航已被拦截并进入 `setPreviewSource`；该路由按既有设计不挂载右侧工作区，只有 `/chat/<会话>` 详情路由显示预览面板。
- 反例：`javascript:` 链接在真实消息中降级为不可点击文本，普通正文未被链接化；远程链接的 DOM 测试确认 `target="_blank"` 与 `rel="noopener noreferrer"`。
- 环境收口：Playwright 临时目录与截图已按原层级移入 `/volume2/SSD/Trash/2026-07-15-markdown-link-rendering/`；39861 端口复查时已无监听进程。CDP 样式读取曾因自动审批服务返回 502 未执行，但已通过截图和可访问性快照完成视觉检查。
