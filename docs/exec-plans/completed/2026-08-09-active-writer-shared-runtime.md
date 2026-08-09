# Active Writer 共享运行时执行计划

**目标：** 官方 Codex Desktop 已持有 session writer 时，Codex Web 复用同一个 app-server，能够恢复并继续向原 Thread 提交 Turn；无法共享时提供真实只读回放，不再显示误导性状态。

**架构：** 单用户和 runtime broker 继续复用 `PersistentAppServer`。启动 runtime 时，若当前 `CODEX_HOME/app-server-control/app-server-control.sock` 可访问，则通过 Unix Domain Socket 上的 WebSocket transport 连接官方 app-server；否则保留现有 `codex app-server --stdio` 子进程。浏览器到 bridge 的协议和路由保持不变。

## 约束

- app-server 是 Thread、Turn、approval 和插件状态的唯一事实源。
- 不删除 writer lock，不重写 session JSONL，不绕过 app-server 写入保护。
- 默认测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 真实 `CODEX_HOME=/home/rrssnas/CodexApp` 只用于用户已确认的浏览器验证。

## 实施清单

### 1. 共享 transport

- [x] 新增 Unix WebSocket runtime，禁用服务端不支持的 per-message deflate。
- [x] socket 可访问时优先共享官方 app-server，无 socket 时使用 stdio。
- [x] Web bridge 关闭只断开共享连接，不关闭官方 app-server。
- [x] socket 断开后沿用现有 supervisor 重连行为。

### 2. Active writer 兜底

- [x] `thread/resume` 仍冲突时使用 `thread/read(includeTurns: true)` 水合历史。
- [x] 回放状态禁用原 Thread 提交，并显示准确说明。
- [x] 删除“实时状态将继续同步”的误导文案。

### 3. 验证

- [x] targeted Vitest 覆盖 transport 选择、消息收发、关闭和回放状态。
- [x] 运行 `npm run test`：184 个测试文件、878 项测试通过。
- [x] 运行 `npm run build`。
- [x] 隔离环境验证 stdio 反例路径。
- [x] 真实浏览器打开冲突 session，并完成测试 session 的真实提交。
- [x] 核对提交后的 JSONL 存在对应 user message 和 completed Turn。

## Smoke Ledger

| 场景 | 预期 | 结果 |
|---|---|---|
| 无 control socket | 启动独立 stdio app-server | 单元测试通过 |
| 有 control socket，打开 Desktop session | 共享 app-server 并成功 resume | 浏览器打开 `019fe534-742b-7eb0-bb6f-a1a9c1969e41`，历史完整、输入启用、无 writer 错误 |
| 共享 session 提交问题 | 原 Thread 完成新 Turn | 新 Thread `019fe6e2-bf3d-7802-a3af-946808d8e07a` 返回 `ACTIVE_WRITER_E2E_OK` |
| 无法共享且 writer 冲突 | 历史可读、输入禁用、提示准确 | targeted 测试通过 |

真实提交记录：`/home/rrssnas/CodexApp/sessions/2026/08/09/rollout-2026-08-09T22-17-27-019fe6e2-bf3d-7802-a3af-946808d8e07a.jsonl`，包含 `user_message`、assistant `response_item` 和 `task_complete`。
