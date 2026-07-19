# 跨客户端聊天实时同步实施计划

> **供自动化执行者使用：** 本计划按任务逐项执行；项目规则未授权子代理，本次在当前会话内直接实施并逐项验证。

**目标：** 连接同一 Codex Web bridge 的多个浏览器标签页或局域网客户端实时同步用户消息、app-server 流式输出、工具状态和 approval，不依赖刷新。

**架构：** Web bridge 保留“每个 WebSocket 一个 app-server 进程”的现有隔离方式，但把 app-server notification 广播给同一 bridge 的全部授权客户端。普通 JSON-RPC response 仍只返回请求方；app-server server request 改用 bridge 级公共 ID 广播，任一客户端响应后路由回原进程。用户乐观消息通过 bridge 私有 notification 同步，前端复用同一 app-server reducer 渲染流式正文、thinking、计划和工具过程。

**技术栈：** TypeScript、React、Next.js、Node.js、ws、Codex app-server JSON-RPC、Vitest、CDP。

## 全局约束

- 所有开发和测试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- app-server notification 继续作为 Thread、Turn、Item、Goal、Plan 和工具状态事实源。
- 普通 response 不得广播，避免不同客户端相同 request id 串线。
- server request response 必须保持原 app-server request id 和响应 schema。
- 只同步连接同一 Web bridge 实例的授权客户端；不同 bridge 实例不共享状态。
- 空白 `/chat` 可以跟随另一客户端新建的 thread；正在查看其它 thread 或设置页时不得强制跳转。
- 不修改 `/home/rrssnas/code/CodexWeb`，不执行删除命令，不使用真实本地 `CODEX_HOME`。

关联交接文档：[跨客户端聊天实时同步交接](../../handover/2026-07-19-cross-client-live-sync.md)

---

### 任务 1：Bridge 消息所有权与广播路由

**文件：**
- 新建：`server/bridge-message-routing.ts`
- 新建：`server/bridge-message-routing.test.ts`
- 修改：`server/websocket-bridge.ts`

**接口：**
- `appServerMessageDelivery(message): "broadcast" | "server-request" | "owner"`
- `isBridgeSyncNotification(message): boolean`
- `BridgeServerRequestRouter<TOwner>.register(owner, originalId): string`
- `BridgeServerRequestRouter<TOwner>.take(publicId): { owner: TOwner; originalId: JsonRpcId } | null`

- [x] **步骤 1：编写失败测试**

测试 notification 返回 `broadcast`，response 返回 `owner`，带 id/method 的 server request 返回 `server-request`；bridge 私有用户消息只被识别为客户端同步事件；公共 server request id 只能消费一次且保留原 id/owner。

- [x] **步骤 2：运行定向测试确认失败**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npx vitest run server/bridge-message-routing.test.ts
```

预期：失败，因为路由模块尚不存在。

- [x] **步骤 3：实现路由模块并接入 bridge**

app-server notification 序列化一次并广播到 `sockets`；response 只发送原 WebSocket；server request 替换为 bridge 公共 id 后广播。浏览器 response 命中公共 id 时改回原 id并写入原 `JsonRpcClient`；`bridge/sync/userMessage` 广播给除发送方以外的客户端，不转发给 app-server。

- [x] **步骤 4：运行定向测试确认通过**

运行步骤 2 命令，预期路由测试全部通过。

### 任务 2：前端同步事件状态与发布接口

**文件：**
- 新建：`src/codex-web/cross-client-sync.ts`
- 新建：`src/codex-web/cross-client-sync.test.ts`
- 修改：`src/codex-web/app-server-state.ts`
- 修改：`src/codex-web/AppServerProvider.tsx`

**接口：**
- `CROSS_CLIENT_USER_MESSAGE_METHOD = "bridge/sync/userMessage"`
- `CrossClientUserMessage = { threadId; turnId; isNewThread; message }`
- `reduceCrossClientUserMessage(current, notification)` 按 thread 保存、按 message id 去重并限制每个 thread 最近 50 条。
- `publishCrossClientUserMessage(event): void` 通过当前 bridge WebSocket 发布。

- [x] **步骤 1：编写 reducer 失败测试**

覆盖合法事件、非法 payload、同 id 去重、不同 thread 隔离、每 thread 上限和 latest 事件。

- [x] **步骤 2：实现同步适配器与 Provider 状态**

Provider 收到 bridge 私有事件时只更新 `crossClientUserMessagesByThreadId` 和 `latestCrossClientUserMessage`，不进入 app-server unknown notification diagnostics；其它 notification 继续走现有 reducer。

- [x] **步骤 3：运行定向测试**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npx vitest run src/codex-web/cross-client-sync.test.ts src/codex-web/turn-reducer.test.ts
```

预期：同步 reducer 与既有 turn reducer 全部通过。

### 任务 3：聊天消息与流式状态接线

**文件：**
- 修改：`src/components/chat/ChatView.tsx`
- 修改：`src/app/chat/page.tsx`
- 修改：`src/app/chat/[id]/page.tsx`
- 修改：`src/codex-web/cross-client-sync.test.ts`

**接口：**
- `appServerSend.onAccepted(threadId, turnId)` 暴露已接受 turn id。
- `ChatView.appServerSyncedUserMessages` 接收本 thread 的同步用户消息。
- `ChatView.onAppServerUserMessageAccepted(event)` 发布本地用户消息。
- `mergeCrossClientUserMessages(current, incoming)` 按 message id 合并。

- [x] **步骤 1：为消息合并和页面接线编写失败测试**

断言相同 message id 不重复、不同 id 保持顺序；历史页按 route/resumed thread 过滤；空白新会话只跟随 `isNewThread=true` 的最新事件。

- [x] **步骤 2：接入历史会话**

发送接受后用 `temp-user-${turnId}` 生成稳定消息 id，先写本地消息，再发布 bridge 事件；另一客户端按 thread 合并消息。流式正文、工具、计划和终态继续直接消费 bridge 广播的 app-server notification。

- [x] **步骤 3：接入新会话**

本地发送时发布 `isNewThread`；空白 `/chat` 收到远端新 thread 事件时设置 `createdSessionId` 并合并用户消息，随后由相同 thread 的 notification 驱动输出。已有本地会话只消费匹配 thread，不被其它 thread 强制切换。

- [x] **步骤 4：运行定向测试**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npx vitest run server/bridge-message-routing.test.ts src/codex-web/cross-client-sync.test.ts src/codex-web/active-turns-adapter.test.ts
```

预期：路由、用户消息去重和多 thread 隔离反例全部通过。

### 任务 4：完整验证、反例 Smoke 与交接

**文件：**
- 新建：`docs/handover/2026-07-19-cross-client-live-sync.md`
- 更新：`docs/exec-plans/active/2026-07-19-cross-client-live-sync.md`
- 移动至：`docs/exec-plans/completed/2026-07-19-cross-client-live-sync.md`

- [x] **步骤 1：运行标准测试与生产构建**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run build
```

预期：typecheck、全部 Vitest 和 23 个 Next.js 路由构建通过；仅记录既有 NFT trace warning。

- [x] **步骤 2：运行隔离 smoke**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test:smoke
```

预期：bridge initialize、model/list、account/read 基础链路通过。

- [x] **步骤 3：双客户端普通消息反例**

两个浏览器标签连接同一网络 URL；客户端 A 在空白 `/chat` 发送带唯一标记的普通消息。客户端 B 无刷新显示相同用户消息、流式正文和 completed 终态；B 不在其它 thread 页面时才自动跟随。

- [x] **步骤 4：双客户端工具执行反例**

客户端 A 触发读取/命令工具；客户端 B 的工具 cell 必须从 running 变化为 completed/failed，且输出内容变化。普通消息不得凭空出现工具 cell。

- [x] **步骤 5：approval 与多 thread 反例**

客户端 A 触发 approval，客户端 B 可见相同请求并响应；响应只路由原 app-server。另一个 thread 的消息不得混入当前页面。

- [x] **步骤 6：更新文档并归档**

交接文档记录协议、所有权、安全边界、验证结果和剩余风险；计划 Smoke Ledger 写明普通/工具/approval/多 thread 反例后移动到 completed。

## Smoke Ledger

| 路径 | 预期 | 状态 | 证据 |
|---|---|---|---|
| 同 thread 普通消息 | 两客户端实时显示用户消息与流式回答 | 通过 | B 未刷新自动跟随并显示 `跨客户端同步验证-1651` 与最终回答 |
| 工具执行 | 第二客户端工具状态和输出实时变化 | 通过 | B 展开可见 `/bin/bash -lc 'sleep 5'`，完成后显示最终回答；普通消息无工具块 |
| approval | 任一客户端响应，原 app-server 收到正确 schema | 通过 | 双 WebSocket 集成测试还原原 id；浏览器 B 拒绝 A 的受限命令且未创建文件 |
| 多 thread | 不强制跳转、不串消息和工具状态 | 通过 | B 保持其它 thread URL，未出现 `多会话隔离验证-1657` |
| 不同 bridge | 不同步，明确为架构边界 | 已定义 | 交接文档 |

## 状态总览

- 当前状态：已完成
- 完成状态词：`Smoke passed`

## 决策日志

- 2026-07-19：不使用 `BroadcastChannel` 作为主链路，因为它无法覆盖局域网另一台机器。
- 2026-07-19：不把所有客户端复用到单一 app-server stdio 会话，避免重写普通 request id 多路复用；只在 bridge 层广播 notification，并单独路由 server request。
- 2026-07-19：用户消息使用 bridge 私有 notification，同步真实 Web 展示内容；assistant/tool/plan 等仍以 app-server notification 为事实源。
- 2026-07-19：双标签真实浏览器验证覆盖普通消息、工具、approval 和多 thread 反例；服务端集成测试覆盖 response 所有权与首次响应胜出。
