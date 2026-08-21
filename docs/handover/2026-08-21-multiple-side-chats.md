# 多侧边聊天技术交接

配套计划：[2026-08-21-multiple-side-chats.md](../exec-plans/completed/2026-08-21-multiple-side-chats.md)

## 结论

工作区侧栏已对齐官方 Codex App 的多侧聊标签交互。同一主会话可连续创建多个临时侧聊，第一个显示“侧边聊天”，后续显示“侧边聊天 2、3…”。每个标签拥有独立的 app-server ephemeral fork、运行状态、审批、设置和 token usage。

## 状态与协议

- `SideChatTab` 使用唯一字符串 ID，不再使用固定 `side-chat` ID。
- `createSideChatTab` 负责生成标签 ID 和顺序标题；侧聊仍在 `serialize` 中统一过滤，刷新后不会恢复。
- `WorkspaceSidebarProvider` 使用 `Record<string, SideChatState>` 保存每个标签状态，并以标签 ID 保存异步操作号。
- 创建仍调用 `thread/fork { ephemeral: true }` 和 `thread/inject_items`，每次点击侧聊入口都会创建新的子线程。
- `SideChatPanel` 接收 `sideChatId`，通过该 ID 找到子线程并选择 Turn、审批、线程设置和 token usage。
- 重试只重建原标签对应的 fork；关闭只处理目标标签，先调用 `turn/interrupt`，再调用 `thread/unsubscribe`，不调用 `thread/delete`。
- 切换主会话或卸载时，全部未完成创建都会失效，已创建子线程逐一取消订阅。

## UI 行为

- 加号菜单和工作区总览中的“侧边聊天”入口每次都新增标签，不再聚焦单例。
- 标签沿用现有浏览器式收缩布局、键盘左右切换和关闭确认。
- 关闭确认记录目标标签 ID；关闭失败时保留该标签并展示真实错误，不影响其他侧聊。

## 验证

- targeted Vitest：2 个文件、8 条测试通过。
- `npm run test`：197 个测试文件、964 条测试通过。
- `npm run build`：生产构建通过，30 个页面完成生成。
- `npm run test:smoke`：通过，使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- `npm run test:smoke:interrupt`：通过，真实 Turn 状态变为 `interrupted`。
- 反例：三个侧聊共存时关闭中间标签，另外两个标签仍保留；普通主聊天测试和 smoke 未受影响；序列化不会保留任何侧聊。

## 2026-08-22 缺陷修复验证

- `TabPanel` 保持全部侧聊组件挂载，仅隐藏非活动标签；真实浏览器发送 `SIDE_CHAT_RETAIN_20260822` 后切换 Git 再切回，消息仍保留。
- `ChatView` 将 app-server `running` 状态纳入 `isStreaming`；真实浏览器运行 Turn 时按钮 aria 为“停止生成”，完成或中断后恢复“发送消息”。
- 反例：未运行的主聊天按钮仍为“发送消息”；820px 窄屏 `document.documentElement.scrollWidth` 不超过 viewport。
- 本轮截图：[side-chat-fix-browser-20260822-0106.png](/volume2/SSD/codex/Temp/side-chat-fix-browser-20260822-0106.png)。
- 浏览器走查期间出现的 `/api/settings/workspace` 404 是现有接口缺失日志，与本次侧聊修复无关；页面功能和 console 检查未发现本次改动导致的错误。

## 剩余风险

开发服务已实际启动并确认 HTTP 可访问，但 Playwright MCP 无法连接宿主 `3001` 端口并连续超时。按项目浏览器验证规则已停止自动化、关闭测试页并停止服务，因此未声明视觉走查通过。多标签在极窄侧栏中的截断效果仍需一次人工确认。
