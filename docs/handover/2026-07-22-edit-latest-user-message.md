# 最近用户问题编辑功能交接

关联计划：[最近用户问题编辑功能实施计划](../exec-plans/completed/2026-07-22-edit-latest-user-message.md)

## 结论

最近一个已完成回答对应的用户问题现在可以就地编辑。发送编辑内容时严格按官方 Codex 0.144.6 的顺序执行：

```text
app-server.thread/rollback { threadId, numTurns: 1 }
  -> 使用 response.thread 重建有效历史
  -> app-server.turn/start（同一 thread）
```

不会创建 fork 或新 thread。`thread/rollback` 只回滚会话历史，不恢复旧回答已经修改的本地文件。

## 官方 Session 证据

对照文件：

- `/volume2/SSD/codex/Temp/codex-session/rollout-2026-07-22T16-46-34-019f8901-564e-7e53-a319-bdbf9734dfc0.jsonl`
- `/volume2/SSD/codex/Temp/codex-session/rollout-2026-07-22T16-46-34-019f8901-564e-7e53-a319-bdbf9734dfc0.new.jsonl`

编辑后的 `.new.jsonl` 在原第二轮完成事件之后新增：

1. `token_count`
2. `thread_rolled_back { num_turns: 1 }`
3. `thread_settings_applied`
4. 新的 `task_started` / user message / assistant message / `task_complete`

session id 保持 `019f8901-564e-7e53-a319-bdbf9734dfc0` 不变。

## 实现边界

- `AppServerProvider.rollbackThread` 直接调用生成协议中的 `thread/rollback`。
- 页面将 rollback response 标记为 `app-server.thread/rollback` 来源，并从 response thread 重建历史。
- ChatView 只在 rollback 成功后替换消息，再复用已有 `sendMessage`，因此模型、effort、mode、permission profile 和附件持久化保持原链路。
- 最后一个已有助手回答的用户消息才可编辑；生成中、未回答和更早消息没有入口。
- bridge 增加 `bridge/sync/threadRollback` 白名单事件，避免其它浏览器保留已回滚的旧轮；该事件不会转发给 app-server。
- 普通文件和图片附件会保留并重新发送；历史文件摘录只保存展示元数据，缺少原摘录正文，因此带文件摘录的消息不显示编辑入口，避免静默丢失上下文。

## 升级风险

当前生成 schema 将 `thread/rollback` 标为 deprecated，但用户提供的官方 Codex 0.144.6 session 仍实际使用该 method。升级 Codex CLI 时应先检查替代 method，再更新 Provider 和 session 对照测试。

## 验证记录

- 定向回归：6 个相关测试文件、27 项通过，包括 WebSocket bridge 集成。
- 全量测试：107 个测试文件、520 项通过，包含 TypeScript typecheck。
- 生产构建：22 个路由构建成功；保留既有 `next.config.mjs` NFT trace warning。
- 基础 smoke：隔离 bridge、7 个模型和 `app-server.account/read` 通过。
- 生产页面：`http://192.168.3.12:3001/chat` 返回 HTTP 200，使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 视觉自动化：playwright-mcp 连接项目指定 CDP 时在初始化阶段超时，随后按项目规则停止重试；原始 CDP 单 target 连接正常，并完成 1440x1000 桌面和 390x844 移动端验证。
- 完成态正例：隔离 31 回合 fixture 的当前可见 30 条用户消息中只有 `user-31` 有编辑入口；编辑框预填原文并自动聚焦，取消和 Escape 均恢复原文。
- 生成中反例：停留在“组织回复中”的会话没有编辑入口。
- 布局：桌面和移动端 textarea 均不与取消/发送按钮重叠，页面无横向溢出；操作期间 console 无新增异常。
- 截图：`/volume2/SSD/codex/Temp/codex-web-edit-message-cdp.png`。
- 隔离 fixture：`/volume2/SSD/codex/Temp/codex-dev-home/sessions/2026/07/11/rollout-2026-07-11T15-30-00-199cf227-4c3d-4c0a-ab8a-79d90d2667b8.jsonl`。
- 编辑发送的 `rollback -> turn/start` 由定向自动化覆盖；隔离环境未登录，因此 CDP 没有切换到真实 `CODEX_HOME` 执行实际回答生成。

## 当前状态

- `Code complete`
- `Tests pass`
- `Smoke passed`
- 未使用真实 `CODEX_HOME`；真实账户端到端回答生成仍属于最终验收范围
