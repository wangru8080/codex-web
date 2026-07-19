# 跨客户端聊天实时同步交接

关联计划：[跨客户端聊天实时同步实施计划](../exec-plans/completed/2026-07-19-cross-client-live-sync.md)

## 结论

连接同一 Codex Web bridge 的浏览器客户端现在可以实时同步同一 thread 的用户消息、assistant 流式输出、thinking、计划、工具状态与输出、终态和 approval。覆盖同一浏览器多标签，以及局域网另一台机器通过同一页面地址连接的场景；不同 bridge 实例仍互不共享状态。

## 协议与所有权

- app-server notification：bridge 广播到全部已授权 WebSocket，前端继续使用现有 turn reducer；source breadcrumb 保持对应的 `app-server.*` notification。
- 普通 JSON-RPC response：只返回发起请求的 WebSocket，避免不同客户端相同 request id 串线。
- app-server server request：bridge 把原始 id 映射为 `bridge-server-request:*` 公共 id 后广播。任一客户端可响应，bridge 只接受首个响应，恢复原 id 并写回原 `JsonRpcClient`；迟到响应直接丢弃。
- approval resolved：首个响应后广播 `serverRequest/resolved`，全部客户端同步移除审批提示。
- 用户消息：发送端在 `turn/start` 接受后发布 `bridge/sync/userMessage`，source breadcrumb 为 `web-bridge.bridge/sync/userMessage`。消息使用 `temp-user-${turnId}` 稳定 id，接收端按 thread 和 id 去重，每个 thread 最多保留 50 条同步事件。

## 页面行为

- 两个空白 `/chat`：一端新建 thread 后，另一端自动跟随并显示相同消息与输出。
- 已绑定 thread 的 `/chat`：只合并当前 thread 的同步用户消息。
- 正在查看其它 thread 或设置页：不强制导航，不混入其它 thread 的消息或工具状态。
- bridge 不提供历史重放；客户端需要在事件发生时保持连接。刷新后的历史仍由 app-server thread read/list 接口恢复。

## 主要文件

- `server/bridge-message-routing.ts`：消息所有权判定和 server request 公共 ID 路由。
- `server/websocket-bridge.ts`：广播、response 隔离、approval 路由和私有用户消息转发。
- `src/codex-web/cross-client-sync.ts`：用户消息事件校验、分 thread 存储、去重和合并。
- `src/codex-web/AppServerProvider.tsx`：接收/发布同步事件并复用 app-server notification reducer。
- `src/app/chat/page.tsx`、`src/app/chat/[id]/page.tsx`、`src/components/chat/ChatView.tsx`：空白会话跟随、历史会话过滤和稳定乐观消息接线。

## 验证记录

- `npm run test`：85 个测试文件、403 项测试通过。
- `npm run build`：Next.js 生产构建通过，23 个路由生成完成；仅有既有 NFT trace warning。
- `npm run test:smoke`：隔离 `CODEX_HOME` 下 bridge、model/list、account/read 通过，models=7。
- 双标签普通消息：B 未刷新自动跟随 A 新建的 thread，并显示同一用户消息和最终回答。
- 双标签工具：B 展开工具块可见 `/bin/bash -lc 'sleep 5'`，并同步显示完成状态和最终回答；普通消息无工具块。
- 双标签 approval：A 发起受限命令，B 显示 approval 并点击 Deny；两端提示同步关闭，命令未执行，确认 `/root/codex-cross-client-approval-test` 不存在。
- 多 thread：B 停留在另一个 thread URL，A 的唯一消息未出现在 B，且 B 未被强制导航。

## 运行与剩余边界

- 验证服务运行于 `http://192.168.3.12:3001`，使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 浏览器控制台仍有项目既有 `/api/setup`、`/api/settings/*`、`/api/git/status` 等 404；本次未新增 WebSocket 或 React 错误。
- 当前为 bridge 实例内的在线事件同步，不是跨 bridge、跨主机 bridge 或离线消息总线。
