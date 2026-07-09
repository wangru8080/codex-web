# Phase 6A 历史分页加载设计

## 目标

Phase 6A 为 app-server 历史会话补齐 turn 分页加载能力。用户打开长历史会话时，Web 可以按需加载更早 turn，并避免同一个 turn 或 item 被重复渲染。

## 协议依据

当前项目已生成的稳定 TypeScript schema 不包含 experimental `thread/turns/list`。本机官方 `codex-rs` 协议中该方法存在，参数为 `threadId`、`cursor`、`limit`、`sortDirection`、`itemsView`，响应为 `data`、`nextCursor`、`backwardsCursor`。因此 Phase 6A 不重新生成整套 experimental schema，而是在当前项目中新增最小本地类型和 adapter，字段严格对齐官方 Rust protocol。

## 产品行为

历史页初始加载继续使用稳定 `thread/read { includeTurns: true }`。当需要分页时，Web 调用 experimental `thread/turns/list` 获取 turn page，并通过已有 `MessageList` 的“加载更早”入口呈现。分页返回的 turn 需要映射成 CodexWeb 历史消息结构，并按消息 id 去重，避免重复插入。

如果 app-server 返回 `thread/turns/list` unsupported、paginated thread unsupported、transport error 或缺少 cursor，UI 不伪造完整历史；只保持当前已加载消息，并显示可见 degraded 提示。

## 非目标

本阶段不重新生成 experimental TS schema，不实现 `thread/items/list` 深度 item 分页，不处理历史归档/删除/重命名，不使用真实本地 `CODEX_HOME` 验收。

## 验证

单元测试覆盖 turn page 到消息映射、顺序、去重、cursor 状态和 unsupported 降级。集成验证运行 `npm run test -- src/codex-web`、`npm run test`、`npm run build`、`npm run test:smoke`，均使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
