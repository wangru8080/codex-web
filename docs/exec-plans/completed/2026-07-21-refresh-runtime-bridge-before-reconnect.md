# Runtime Bridge 重连刷新实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** production bridge 重启并轮换 token 后，已有浏览器标签复用同一个 app-server client，自动解析最新 runtime bridge URL 并恢复连接。

**架构：** `AppServerProvider` 不再只在首次挂载解析 bridge URL，而是在每次 initial bootstrap 和 reconnect bootstrap 前调用 `resolveCodexBridgeUrl()`。`AppServerBrowserClient.connect(url)` 仅在底层 socket 已失效时接受新 URL，保留 notification、server request 和 close listener。

**技术栈：** React、TypeScript、WebSocket、Vitest、Next.js production server、Chrome CDP。

## 全局约束

- 所有开发、测试和浏览器验证显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不修改 app-server 协议，不持久化 bridge token，不切换到真实 `CODEX_HOME`。
- 保留当前尚未提交的最终回答缓冲修复，不执行 Git commit。

---

## Task 1：同一 client 使用最新 endpoint

**文件：**
- 修改：`src/codex-web/app-server-browser-client.ts`
- 测试：`src/codex-web/app-server-browser-client.test.ts`

**接口：**
- 输入：`connect(url?: string): Promise<void>`。
- 输出：断线后新 WebSocket 使用最新 URL；listener 集合保持不变。

- [x] 写失败测试：断线后传入新 URL，创建新 socket 且原 notification listener 继续收到事件。
- [x] 写失败测试：socket 已连接时传入不同 URL，拒绝静默替换活动连接。
- [x] 实现 `connect(url?)` 的最小 endpoint 更新逻辑。
- [x] 运行 client targeted Vitest。

## Task 2：每次 bootstrap 重新解析 runtime URL

**文件：**
- 修改：`src/codex-web/AppServerProvider.tsx`
- 测试：`src/codex-web/app-server-reconnect-wiring.test.ts`

**接口：**
- 消费：`resolveCodexBridgeUrl(publicBridgeUrl)`。
- 产出：`client.connect(latestBridgeUrl)`，Provider 生命周期内只创建一个 client。

- [x] 写失败接线测试：bootstrap 内先解析 bridge URL，再连接同一个 client。
- [x] 移除一次性 bridge URL state/effect，把解析动作收口到 bootstrap。
- [x] 运行 Provider reconnect targeted Vitest。

## Task 3：全量和真实浏览器验证

**文件：**
- 更新：`docs/exec-plans/active/2026-07-21-refresh-runtime-bridge-before-reconnect.md`

- [x] 运行 targeted Vitest、`npm run test`、`npm run build`、`npm run test:smoke`。
- [x] 浏览器连接 production 服务 A，随后同端口启动服务 B，断言旧标签使用新 token 恢复 `101` 和可用输入框。
- [x] 发送中文短回答，断言完成前存在非空 `data-answer-complete="false"` 最终回答节点。
- [x] 记录普通连接与服务重启反例，将计划移入 `docs/exec-plans/completed/`。

## 验证结果

- targeted Vitest：3 个文件、17 项通过；实现前新增的 3 项断言按预期失败，实现后全部通过。
- `npm run test`：typecheck 通过；101 个测试文件、489 项测试通过。
- `npm run build`：生产构建通过；仅有既存 Turbopack NFT tracing warning。
- `npm run test:smoke`：通过；隔离 `CODEX_HOME`，models=7，账号来源为 `app-server.account/read`。
- 真实 Chrome/CDP：同一旧标签在 production 服务同端口重启后，首次和重连 WebSocket 握手均为 `101`，bridge token 已轮换，输入框恢复可用。
- 流式反例：发送中文短回答后，完成前观察到非空 `data-answer-complete="false"` 节点，随后完成态文本为“你好，流式验证完成。”，证明首轮回答不再等到完成后一次性出现。
- 断线反例：重启空窗期出现预期的 `ERR_CONNECTION_REFUSED`；服务恢复后连接成功。浏览器还记录到 4 条未影响本次流程的 404 资源日志。
