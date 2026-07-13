# 生产入口、项目选择与官方过程流 UI 修复执行计划

> **执行要求：** 按任务逐项实现和验证；所有开发、单测与 smoke 必须使用隔离的 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

**目标：** 修复生产首页入口、项目目录选择、新建项目、联网配置接线、app-server 过程事件顺序与首次重复输出，并使聊天过程区符合用户提供的官方 Codex 截图。

**架构：** 浏览器仍只通过 Web bridge 连接 `codex app-server --stdio`。目录浏览使用 app-server `fs/readDirectory`，联网与权限使用 app-server generated schema 和 `config/read`，消息展示按 ThreadItem 原始顺序构建结构化过程块；不恢复旧 `/api/files/browse`，不引入第二 runtime。

**技术栈：** Next.js App Router、React 19、TypeScript、Vitest、Codex app-server v2 JSON-RPC。

## 全局约束

- 不修改 `/home/rrssnas/code/CodexWeb`。
- 不复制、移动或复用 CodexBrowser / CodePilot 代码。
- app-server notification、`config/read`、`fs/readDirectory` 是用户可见状态的事实源。
- 不修改真实 `CODEX_HOME` 内的凭据、历史或配置。
- 不执行删除命令；不自动提交或推送。
- UI 保持 CodexWeb 现有布局，只调整本次过程输出模块的结构与细节。
- 官方截图验收结构：无卡片外框的“已处理 + 耗时 + 箭头”折叠行，下方细分隔线；展开内容依次为中间正文、工具行、中间正文，最终回答在过程区下方独立显示。

---

## 任务 1：首页入口

**文件：**
- 修改：`src/app/page.tsx`
- 测试：生产/开发服务 HTTP 路由检查

- [x] 根路径 `/` 重定向到 `/chat`，不再构造或访问 `demo-session`。
- [x] 检查仓库默认生产路径无 `chat/demo-session` 引用。

## 任务 2：app-server 目录浏览与项目入口

**文件：**
- 新建：`src/codex-web/directory-browser-adapter.ts`
- 新建：`src/codex-web/directory-browser-adapter.test.ts`
- 修改：`src/codex-web/AppServerProvider.tsx`
- 修改：`src/components/chat/FolderPicker.tsx`
- 修改：`src/app/chat/page.tsx`
- 复查：`src/components/layout/ChatListPanel.tsx`

**接口：**
- 输入：`fs/readDirectory { path }`
- 输出：仅包含目录的 `FolderEntry[]`、当前路径和可导航父路径

- [x] 先写路径拼接、父目录、目录过滤和排序测试。
- [x] 在 AppServer actions 暴露 `readDirectory(path)`。
- [x] FolderPicker 使用 app-server action，显示请求错误且禁止空路径确认。
- [x] 最近项目从 `thread/list` 的真实 cwd 去重生成。
- [x] 首页“选择项目文件夹”和左侧“新建项目”都能选中目录并进入 `/chat`。

## 任务 3：联网与权限参数接线

**文件：**
- 新建：`src/codex-web/app-server-runtime-options.ts`
- 新建：`src/codex-web/app-server-runtime-options.test.ts`
- 修改：`src/codex-web/AppServerProvider.tsx`
- 修改：`src/codex-web/app-server-state.ts`
- 修改：`src/codex-web/resume-adapter.ts`
- 修改：`src/app/chat/page.tsx`
- 修改：`src/components/chat/ChatView.tsx`

**接口：**
- 输入：`config/read { cwd }`、Web `PermissionProfile`
- 输出：generated `thread/start` / `thread/resume` / `turn/start` 参数

- [x] 先写 `web_search`、请求批准、完全访问与 config 模式的参数测试。
- [x] 按 cwd 调用 `config/read`，只转发协议支持的有效字段。
- [x] `web_search` 与官方 TUI 一致进入 thread config override。
- [x] 权限选择器进入真实 app-server 参数；完全访问仍保留现有确认弹窗。
- [x] 不把无效或缺失配置伪装成已启用网络。

## 任务 4：按官方顺序构建过程时间线

**文件：**
- 修改：`src/codex-web/turn-reducer.ts`
- 修改：`src/codex-web/turn-reducer.test.ts`
- 修改：`src/codex-web/app-server-message-blocks.ts`
- 修改：`src/codex-web/app-server-message-blocks.test.ts`
- 修改：`src/codex-web/tool-item-adapter.ts`
- 修改：`src/codex-web/tool-item-adapter.test.ts`
- 修改：`src/codex-web/tool-adapter.test.ts`
- 修改：`src/codex-web/thread-history-adapter.ts`
- 修改：对应 history/page adapter 测试

**事件顺序：**

```text
agentMessage(commentary)
-> webSearch / command / MCP / fileChange
-> agentMessage(commentary)
-> agentMessage(final_answer)
```

- [x] reducer 按 itemId 更新流式 agent message，不把多条消息覆盖成一个字符串。
- [x] commentary 映射为 `codex_process_text`，`final_answer` 映射为最终正文。
- [x] `phase=null` 保留旧模型兼容：最后一条 agent message 作为 final。
- [x] `webSearch` 映射为搜索工具 cell，包含 action/query 与 source breadcrumb。
- [x] 未支持 item 继续计入 diagnostics/fallback，不静默丢弃。

## 任务 5：对齐官方过程区视觉并消除重复

**文件：**
- 修改：`src/components/ai-elements/tool-actions-group.tsx`
- 修改：`src/components/chat/StreamingMessage.tsx`
- 修改：`src/components/chat/MessageItem.tsx`
- 修改：`src/components/chat/ChatView.tsx`
- 复查：`src/components/chat/MessageList.tsx`

- [x] 折叠标题采用“已处理 + 耗时 + 箭头”，无卡片框，标题下显示分隔线。
- [x] 展开时按结构化 block 原序渲染过程正文和工具行。
- [x] final answer 始终位于过程区下方，不进入折叠内容。
- [x] 完成 turn 后切换为单一结构化历史消息，terminal streaming panel 不与它并存。
- [x] 普通 final-only turn 不显示虚假的“已处理”。

## 任务 6：验证与文档收口

**验证命令：**

```bash
export NODE_HOME=/volume2/SSD/node-v24.14.0
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run build
npm run test:smoke
```

- [x] targeted 单测覆盖首页、目录、权限、webSearch、顺序与去重。
- [x] 全量 tests 通过。
- [x] 生产 build 通过。
- [x] bridge smoke 通过。
- [x] 实际启动隔离 production 服务，检查 `/`、项目选择 RPC 和过程事件。
- [x] 反例：普通 final-only 没有过程区；webSearch turn 有过程区且 final 只出现一次。
- [x] 记录 Smoke Ledger、决策与剩余风险。
- [x] 用户已授权后，用 `codex-start-home` 启动生产模式做最终验收。
- [x] 完成后将本计划移动到 `docs/exec-plans/completed/`。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
|---|---|---|---|
| 2026-07-13 | 只读生产历史 | rollout 显示 `web_search_mode=null`、`network_access=false`，且多条 commentary 与 final 来自独立 agent message | 修复前证据 |
| 2026-07-13 | 代码审查 | `/` 硬编码到 `/chat/demo-session`，`/api/files/browse` 路由不存在，`webSearch` 未适配 | 修复前证据 |
| 2026-07-13 | 隔离单测 | `npm run test` | 36 files / 172 tests passed |
| 2026-07-13 | 隔离构建 | `npm run build` | 沙箱内因 Turbopack EPERM 失败；提权重跑成功，只有既有 NFT warning |
| 2026-07-13 | 隔离 bridge | `npm run test:smoke` | 通过，7 个模型，账号来源 `app-server.account/read` |
| 2026-07-13 | 隔离 production | `/`、`/chat`、`fs/readDirectory`、`config/read` | 307 到 `/chat`、200、24 个条目、`web_search=live` |
| 2026-07-13 | 触发 smoke | 默认 workspace-write + on-request 搜索 turn | completed，2 个 `webSearch` 生命周期 item，0 个 server request |
| 2026-07-13 | 反例 smoke | 普通 final-only turn | completed，0 个 `webSearch` item，仅 userMessage / agentMessage |
| 2026-07-13 | 真实生产只读验收 | `CODEX_HOME=codex-start-home npm run start` | `/` 到 `/chat`、聊天页 200、目录读取正常、`web_search=live` |

## 决策日志

- 2026-07-13：目录浏览采用 app-server `fs/readDirectory`，避免恢复旧 Web 私有 REST，并自然兼容未来 SSH remote 目录语义。
- 2026-07-13：不硬编码联网开启；`web_search` 来自 `config/read`，危险权限来自用户明确选择。
- 2026-07-13：以 app-server `ThreadItem[]` 顺序为过程 UI 顺序，不再按 UI 类型二次分组。
- 2026-07-13：用户提供的两张官方截图作为过程区视觉验收基准。

## 状态总览

- `Code complete`
- `Tests pass`
- `Smoke passed`
- 生产服务已运行在 `http://192.168.3.12:3000/`，等待用户视觉确认后再判断是否达到 `Review passed` / `Release ready`。

## 剩余风险

- 当前运行环境未安装 Playwright/Chromium，且给定 CDP 端口不可连接；已完成真实应用启动、HTTP、RPC、触发/反例 smoke 和组件结构审查，但官方截图的最终像素级一致性仍需用户在现有浏览器中确认。
- `codex-start-home/config.toml` 顶层 `network_access = "enabled"` 不是当前 Codex 的有效 workspace-write 网络格式；本次 native web search 已通过 `web_search=live` 验证，不自动修改用户配置。若需要 shell 命令直接联网，应使用当前 Codex 支持的 `[sandbox_workspace_write] network_access = true` 或在 UI 明确选择“完全访问权限”。
