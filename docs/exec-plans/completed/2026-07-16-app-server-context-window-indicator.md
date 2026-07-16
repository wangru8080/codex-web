# App-Server 上下文窗口圆环实施计划

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** 移除输入框外部右下角 `RunCockpit`，在输入框内部模型选择器左侧展示由 Codex app-server 权威数据驱动的动态上下文窗口圆环。

**Architecture:** `AppServerProvider` 消费 `thread/tokenUsage/updated` 并按 thread 保存 `ThreadTokenUsage`。页面选择当前 thread 的最新用量传入 `MessageInput`；独立圆环组件只使用 `last.totalTokens / modelContextWindow`，悬停展示百分比、已用 Token 和总窗口，不使用累计的 `total.totalTokens` 或静态模型目录估算。

**Tech Stack:** React 19、TypeScript、Codex app-server generated schema、Radix Tooltip、Vitest、Chrome CDP。

## Global Constraints

- 数据源必须是 `app-server.thread/tokenUsage/updated`。
- 当前上下文使用量必须取 `tokenUsage.last.totalTokens`；`tokenUsage.total.totalTokens` 仅是线程累计量，不得用于圆环。
- `modelContextWindow` 为 `null` 或尚未收到 notification 时显示未知状态，不伪造百分比。
- 圆环位于输入框内部、模型选择器左侧，尺寸稳定，不改变输入框整体布局。
- 输入框外部不再渲染 `RunCockpit`；历史会话的 Runtime 选择器继续保留。
- 开发和验证使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

### Task 1: Token Usage 状态接线

**Files:**
- Create: `src/codex-web/thread-token-usage-adapter.ts`
- Create: `src/codex-web/thread-token-usage-adapter.test.ts`
- Modify: `src/codex-web/app-server-state.ts`
- Modify: `src/codex-web/AppServerProvider.tsx`

- [x] 补充 notification reducer 的失败测试，覆盖正确更新、无关事件和非法数据。
- [x] 增加 `threadTokenUsageByThreadId` 状态及 source breadcrumb。
- [x] 在 Provider notification 链路中保存线程级权威用量。

### Task 2: 圆环 UI 与页面接线

**Files:**
- Create: `src/lib/context-window-usage.ts`
- Create: `src/lib/context-window-usage.test.ts`
- Create: `src/components/chat/ContextWindowIndicator.tsx`
- Modify: `src/components/chat/MessageInput.tsx`
- Modify: `src/components/chat/ChatView.tsx`
- Modify: `src/app/chat/page.tsx`
- Modify: `src/app/chat/[id]/page.tsx`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Create: `src/codex-web/context-window-indicator-wiring.test.ts`

- [x] 补充比例、格式化、未知状态和累计量反例测试。
- [x] 实现动态圆环和悬停详情，放在模型选择器左侧。
- [x] 新对话和历史会话选择当前 thread 的 app-server token usage。
- [x] 移除所有页面对外部 `RunCockpit` 的渲染，保留历史会话 Runtime 选择器。

### Task 3: 验证与收口

- [x] 运行定向测试、全量测试和生产构建。
- [x] 使用真实 Chrome/CDP 验证圆环位置、悬停详情和外部控件移除。
- [x] 执行真实模型回合，确认 notification 后圆环百分比和 Token 数发生变化。
- [x] 更新 Smoke Ledger、状态总览与审查结论。

### Task 4: 自动上下文压缩过程提示

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/codex-web/turn-reducer.ts`
- Modify: `src/codex-web/app-server-message-blocks.ts`
- Modify: `src/codex-web/thread-history-adapter.ts`
- Create: `src/components/chat/ContextCompactionRow.tsx`
- Create: `src/components/chat/ContextCompactionRow.test.tsx`
- Modify: `src/components/chat/StreamingMessage.tsx`
- Modify: `src/components/chat/MessageItem.tsx`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Modify: `vitest.config.ts`
- Test: `src/codex-web/turn-reducer.test.ts`
- Test: `src/codex-web/app-server-message-blocks.test.ts`
- Test: `src/codex-web/thread-history-adapter.test.ts`
- Create: `src/codex-web/context-compaction-wiring.test.ts`

- [x] 用失败测试复现 `contextCompaction` item 被过程消息转换器和历史 adapter 丢弃。
- [x] 保存 `item/started` / `item/completed` 生命周期并生成带 source breadcrumb 的压缩过程块。
- [x] 实时显示“正在自动压缩上下文”，完成与历史回放显示“已自动压缩上下文”。
- [x] 验证普通回合不出现压缩提示，并执行全量测试、构建和最小 UI smoke。

## 状态总览

- `Code complete`：外部 `RunCockpit` 已移除，输入框模型选择器左侧新增上下文窗口动态圆环。
- `Tests pass`：最终全量测试通过。
- `Smoke passed`：最终生产构建通过真实 Chrome/CDP 悬停和真实模型回合动态更新验证。
- `Review passed`：数据只来自 `thread/tokenUsage/updated`，当前占用只使用 `last.totalTokens`，未知和非法窗口均不会显示假百分比。
- `Code complete`：官方 `contextCompaction` item 已接入过程区域，实时与历史状态均有明确提示。
- `Tests pass`：最终 65 个测试文件、307 项测试通过。
- `Smoke passed`：生产构建通过；隔离生产页经真实 Chrome/CDP 验证可加载且输入框正常。
- `Review passed`：压缩提示只由 `item/started` / `item/completed` 驱动，普通回合不显示假压缩状态。

## 决策日志

- 圆环使用原始 `last.totalTokens / modelContextWindow` 展示已用比例，线程累计 `total.totalTokens` 不参与计算。
- notification 按 thread 保存，并保留 `app-server.thread/tokenUsage/updated` source breadcrumb；resume/fork replay 与实时 turn 共用 reducer。
- 未收到用量或 `modelContextWindow` 为 `null` 时显示空环和“暂无上下文用量”。
- 输入框外历史状态栏只保留 Runtime 选择器；新对话不再渲染空的外部状态栏。
- 自动压缩使用官方 v2 `contextCompaction` item，不使用已弃用的 `thread/compacted` notification。
- 进行中状态保留 `app-server.item/started` source breadcrumb，完成与历史回放保留 `app-server.item/completed`。

## Smoke Ledger

- 红灯复现：首次定向测试因缺少 `thread-token-usage-adapter` 在 TypeScript 编译阶段失败。
- 定向测试：notification reducer、上下文计算和页面接线共 11 项通过。
- 语义反例：累计 `total.totalTokens=999k`、当前 `last.totalTokens=191k`、窗口 `353k` 时显示 54%，证明未误用累计量。
- 非法反例：`modelContextWindow=null`、负数或 token 字段非数字时不产生可见百分比或覆盖已有状态。
- 全量测试：隔离 `CODEX_HOME` 下 63 个测试文件、300 项测试通过。
- 生产构建：`npm run build` 通过；保留仓库既有 Turbopack NFT 动态路径追踪警告。
- Chrome/CDP：圆环位于输入框内部且紧邻模型选择器左侧；外部 `RunCockpit` aria 控件不存在。
- 初始悬停：显示“上下文窗口：6% 已用 / 已用 17k 标记，共 258k”。
- 真实模型回合：唯一标记 `context-ring-e2e-1784216173483`，当前回合 final answer 为 `CONTEXT-RING-OK`；notification 后圆环动态更新为 7%，悬停内容同步变化。
- 收口：本轮隔离服务与 CDP 标签页已关闭，端口已释放；未生成截图、日志或浏览器配置目录。
- 压缩红灯复现：类型检查因缺少 `contextCompactionStatusById` 与转换参数失败，证实现有链路没有生命周期状态。
- 压缩定向测试：reducer、消息转换、历史回放、页面接线及真实 React 状态行共 5 个测试文件、36 项通过。
- 压缩反例：普通 final-only turn 仍保持纯文本，不生成 `codex_context_compaction`；历史压缩 item 默认按 completed 展示且 unsupported 计数为 0。
- 压缩全量测试：隔离 `CODEX_HOME` 下 65 个测试文件、307 项测试通过。
- 压缩生产构建：`npm run build` 通过；保留仓库既有 Turbopack NFT 动态路径追踪警告。
- 压缩 Chrome smoke：隔离生产页 `http://192.168.3.12:43029/chat` 标题、输入框和主体正常，无 Runtime exception；存在与本改动无关的既有 `/api/setup`、`/api/settings/app`、`/api/git/status` 404。
