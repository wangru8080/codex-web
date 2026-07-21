# App-Server 崩溃恢复技术交接

> 配套执行计划：[App-Server 崩溃恢复实施计划](../exec-plans/completed/2026-07-21-app-server-crash-recovery.md)

## 结论

Web bridge 现在监督 `codex app-server` 运行时代际。app-server transport 意外关闭后，bridge 会使旧 JSON-RPC 状态失效、向浏览器发送 `bridge/error`、以 WebSocket `1011` 关闭旧连接，并按 `0ms、250ms、500ms、1000ms、2000ms、5000ms` 上限退避拉起新进程。

浏览器不需要新增私有恢复协议。旧 WebSocket 关闭会触发现有 reconnect policy；连接新进程后，`AppServerProvider` 重新执行 `initialize`、`initialized`、`model/list`、`account/read`、`thread/list` 和配置读取。`WebSocketBridge.appServerPid` 是动态 getter，重启后返回当前进程 PID。

运行中断线 smoke 使用官方 `thread/shellCommand` 创建执行 `sleep 8` 的真实 standalone Turn。该路径发出真实 `turn/started`、`item/started(commandExecution)` 和 `turn/completed`，但不依赖模型何时开始推理或是否选择 shell 工具。超时时 smoke 会附带 `thread/resume` 快照和最近 20 条 notification 摘要。

## 状态边界

- fatal exit 会销毁旧进程内存中的运行中 Turn，Web UI 不得把它伪装成跨进程继续运行。
- 新进程中的 Thread、Turn 和 Item 状态仍以 app-server response/notification 为事实源；历史是否可恢复取决于新 app-server 的持久化事实。
- 旧代际的 initialize response、client request route、未决 approval/server request 全部清空，禁止转发给新代际。
- 仅浏览器 WebSocket 断线不会重启 app-server，PID 保持不变。
- bridge 主动关闭会取消等待中的重启计时器，并停止当前进程，不会自动拉起。

## 实现位置

- `server/persistent-app-server.ts`：持有可替换的 process/rpc 代际，处理 fatal close、协议状态清理、诊断摘要和重启退避。
- `server/websocket-bridge.ts`：动态暴露当前 app-server PID。
- `server/websocket-bridge.test.ts`：覆盖 fatal exit、重新 initialize、主动关闭和取消延迟重启。
- `scripts/app-server-recovery-smoke.ts`：在隔离环境中精确终止 bridge 返回的 app-server PID，验证真实进程恢复。
- `package.json`：提供 `npm run test:smoke:app-server-recovery`。

## 验证记录

所有命令均显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

| 验证 | 结果 | 说明 |
|---|---|---|
| targeted Vitest | 通过 | 2 个文件、10 项测试通过；实现前新增 fatal exit 用例按预期失败 |
| `npm run test` | 通过 | typecheck 和全量 Vitest 未出现失败项 |
| `npm run build` | 通过 | 生成本次 `.next/BUILD_ID` 和生产构建产物 |
| `npm run test:smoke` | 通过 | models=7，账号来源 `app-server.account/read` |
| `npm run test:smoke:app-server-recovery` | 通过 | 最终复跑旧 PID 32、新 PID 118，两代 models=7，普通断线 PID 不变 |
| `npm run test:smoke:reconnect` | 通过 | 改用 `thread/shellCommand` 后连续 3 次独立 Thread/Turn 通过；均恢复为 `inProgress` 并收到 `completed` |
| 最终回归 | 通过 | targeted 10/10；全量 typecheck/Vitest 无失败；fatal recovery smoke PID 32 → 118 |

## 剩余风险

fatal exit 会终止旧进程内存中的运行中 Turn，这是进程级故障的固有边界；自动拉起只保证 bridge 恢复可用和新 app-server 事实源重新接管。原 live-model smoke 的三次超时记录保留为测试设计证据：模型时延与工具选择不应作为 bridge 发布门禁。当前确定性 reconnect、普通断线 PID 反例、fatal exit 单元测试和真实进程 recovery smoke 均已通过。
