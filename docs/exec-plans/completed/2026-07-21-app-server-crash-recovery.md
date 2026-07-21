# App-Server 崩溃恢复实施计划

> 配套交接文档：[App-Server 崩溃恢复技术交接](../../handover/2026-07-21-app-server-crash-recovery.md)

> **For agentic workers:** REQUIRED SUB-SKILL: 按任务逐项实现并在每项后执行对应验证。步骤使用 checkbox 跟踪。

**目标：** `codex app-server` fatal exit 后，Web bridge 自动拉起新进程，浏览器通过既有断线重连重新 bootstrap 并恢复可用。

**架构：** `PersistentAppServer` 从固定进程改为受监督的运行时代际；transport 意外关闭时，旧代际的 JSON-RPC 路由和初始化状态全部失效，现有 WebSocket 以服务异常状态关闭，并按上限退避启动新进程。浏览器沿用现有 WebSocket 重连和 bootstrap 流程，不新增伪协议状态；`WebSocketBridge.appServerPid` 动态返回当前代际 PID。

**技术栈：** Node.js、TypeScript、`ws`、Vitest、Codex app-server JSON-RPC v2。

## 全局约束

- 开发和测试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不修改 `/home/rrssnas/code/CodexWeb`，不复制 `CodexBrowser` 或 `CodePilot` 代码。
- 不持久化凭据，不使用真实 `CODEX_HOME`，不修改 app-server 协议。
- fatal exit 会终止进程内正在运行的 Turn；恢复后只接受新 app-server 的真实状态，不伪造跨进程运行态。
- bridge 主动关闭不得触发自动拉起；重复崩溃必须有退避上限，避免紧密重启循环。

---

### Task 1：用失败测试定义崩溃恢复契约

**文件：**
- 修改：`server/websocket-bridge.test.ts`

**接口：**
- 消费：fake app-server child 的 `exit` 事件。
- 产出：旧 WebSocket 收到 `bridge/error` 后关闭，bridge 创建第二个 app-server，新连接重新发送 `initialize`，旧代际缓存不被复用。

- [x] **Step 1：写 fatal exit 恢复测试**

测试先初始化第一个 fake app-server，触发 `child.emit("exit", 1, null)`，断言旧 socket 关闭、fake 进程数量变为 2、动态 PID 改变，再连接并确认第二代收到新的 initialize request。

- [x] **Step 2：写主动关闭反例**

调用 `bridge.close()` 后推进时间，断言 fake app-server 数量保持不变，证明正常关闭不会触发 supervisor。

- [x] **Step 3：运行失败测试**

运行：

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm exec vitest run server/websocket-bridge.test.ts
```

预期：新增 fatal exit 用例失败，因为当前 bridge 不会创建第二个进程且旧 socket 不会关闭。

### Task 2：实现受监督的 app-server 运行时代际

**文件：**
- 修改：`server/persistent-app-server.ts`
- 修改：`server/websocket-bridge.ts`

**接口：**
- `PersistentAppServer.pid: number | undefined` 返回当前运行时代际 PID。
- `PersistentAppServer.close()` 永久停止 supervisor 和当前进程。
- transport close 后使用 `0ms, 250ms, 500ms, 1000ms, 2000ms, 5000ms` 上限退避重启。
- initialize 成功后将退避计数归零。

- [x] **Step 1：把 process/rpc 改为可替换代际**

保存 `CodexProcessOptions`，由 `startRuntime()` 创建 process 和 `JsonRpcClient`；所有事件回调捕获所属 rpc，旧代际迟到事件必须被忽略。

- [x] **Step 2：在异常关闭时清理协议状态**

清空 `requestRoutes`、`pendingServerRequests`、`initializeWaiters`、`initializeUpstreamId`、`initializeResponse` 和 `initializedSent`，替换 `BridgeServerRequestRouter`。

- [x] **Step 3：触发浏览器恢复并调度重启**

先广播含有限 stderr 摘要的 `bridge/error`，再以 WebSocket `1011` 关闭当前 sockets；若 bridge 未主动关闭，则按退避调度新代际。

- [x] **Step 4：暴露动态 PID**

`createWebSocketBridge()` 返回对象使用 getter 读取 `appServer.pid`，避免重启后继续暴露初始 PID。

- [x] **Step 5：运行 targeted test**

运行：

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm exec vitest run server/websocket-bridge.test.ts server/json-rpc-client.test.ts
```

预期：全部通过，崩溃正例与主动关闭反例均满足。

### Task 3：真实 app-server recovery smoke

**文件：**
- 新建：`scripts/app-server-recovery-smoke.ts`
- 修改：`package.json`

**接口：**
- 新增脚本 `npm run test:smoke:app-server-recovery`。
- smoke 只向 `createWebSocketBridge()` 返回的确切 `appServerPid` 发送 `SIGKILL`。

- [x] **Step 1：连接并初始化第一代 app-server**

断言 initialize 返回隔离 `codexHome`，并调用 `model/list` 证明第一代可用。

- [x] **Step 2：终止确切子进程并等待 socket 关闭**

记录旧 PID，调用 `process.kill(oldPid, "SIGKILL")`，等待 bridge 关闭旧 WebSocket。

- [x] **Step 3：重连并验证新代际**

等待 `bridge.appServerPid` 变为不同 PID，建立新 socket，重新 initialize 并调用 `model/list`；断言隔离 `codexHome` 不变且模型列表可用。

- [x] **Step 4：记录普通断线反例**

文档引用既有 reconnect smoke：仅关闭浏览器 WebSocket 时 PID 不应改变；app-server fatal exit 时 PID 必须改变。

### Task 4：验证、交接与计划归档

**文件：**
- 新建：`docs/handover/2026-07-21-app-server-crash-recovery.md`
- 更新并移动：`docs/exec-plans/active/2026-07-21-app-server-crash-recovery.md` 到 `docs/exec-plans/completed/2026-07-21-app-server-crash-recovery.md`

- [x] **Step 1：运行完整验证**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run build
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test:smoke
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test:smoke:reconnect
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test:smoke:app-server-recovery
```

- [x] **Step 2：完成改动自查**

检查 i18n、共享类型、文档、临时产物、凭据、source breadcrumb 和反例 smoke；确认无 UI 视觉改动，无需 CDP 截图。

- [x] **Step 3：写交接文档和 Smoke Ledger**

记录恢复流程、重启退避、运行中 Turn 边界、所有实际执行命令和结果，不把未运行验证写为通过。

- [x] **Step 4：归档计划**

所有必需验证通过后，把本计划移动至 `docs/exec-plans/completed/`；若存在失败或未完成项则保留在 active。

## 状态总览

- 当前状态：Code complete、Tests pass、Smoke passed、Review passed、Release ready。
- 用户影响：app-server fatal exit 后 bridge 会关闭旧浏览器 transport、拉起新进程，并由浏览器自动重新 bootstrap。
- 剩余风险：新进程不能恢复旧进程内存中的运行中 Turn；恢复后的历史和终态以新 app-server 事实源为准。

## 决策日志

- 2026-07-21：复用浏览器已有 WebSocket 重连与 bootstrap，不新增 `bridge/restarted` 私有协议。
- 2026-07-21：fatal exit 必须清空整个旧 JSON-RPC 代际，禁止复用 initialize response 或未决 approval。
- 2026-07-21：采用有上限退避，避免 app-server 启动即崩溃时形成紧密循环。
- 2026-07-21：既有 reconnect smoke 三次达到 30 秒超时；持久化会话显示其中一次在约 25 秒后才发起 shell，执行工具 10 秒 yield 后尚待续取，未发现 app-server fatal exit 或 bridge 通知丢失。
- 2026-07-21：进一步诊断发现模型也可能直接回复 `reconnect-ok` 而不调用 shell；reconnect smoke 改用官方 `thread/shellCommand` 创建真实 standalone Turn，消除模型时延和工具选择的不确定性。
- 2026-07-21：确定性 reconnect smoke 连续三次通过，每次均恢复同一 `inProgress` Turn 并收到 `completed`，解除 Release ready 阻塞。

## Smoke Ledger

| 日期 | 环境 | 场景 | 结果 | 说明 |
|---|---|---|---|---|
| 2026-07-21 | 隔离 CODEX_HOME，Vitest | fatal exit、重新 initialize、主动关闭与取消退避反例 | 通过 | 2 个文件、10 项；新增用例实现前按预期失败 |
| 2026-07-21 | 隔离 CODEX_HOME，真实 app-server | SIGKILL 后自动拉起与重新 bootstrap | 通过 | 最终复跑 PID 37 → 120，两代 models=7 |
| 2026-07-21 | 隔离 CODEX_HOME，真实 app-server | 仅关闭浏览器 WebSocket | 通过 | PID 保持 120，不误触发重启 |
| 2026-07-21 | 隔离 CODEX_HOME，全量 | `npm run test`、`npm run build`、`npm run test:smoke` | 通过 | typecheck/Vitest 无失败，生产产物生成，基础 smoke models=7 |
| 2026-07-21 | 隔离 CODEX_HOME，真实模型 | `npm run test:smoke:reconnect` | 未通过 | 三次达到既有 30 秒窗口；会话证据显示模型/工具续取时延，未见 fatal exit |
| 2026-07-21 | 隔离 CODEX_HOME，真实 app-server | `thread/shellCommand` 运行中断线重连 | 通过 | 连续 3 次独立 Thread/Turn；均恢复为 inProgress，终态 completed |
| 2026-07-21 | 隔离 CODEX_HOME，回归 | targeted、`npm run test`、fatal recovery smoke | 通过 | targeted 10/10；全量无失败；最终 recovery PID 32 → 118 |
