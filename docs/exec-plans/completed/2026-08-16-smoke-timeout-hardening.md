# Smoke 超时收口执行计划

> **执行要求：** 在当前会话内逐项实施并验证；步骤使用 checkbox 跟踪。

**目标：** 让基础中断和重连 smoke 不受外部模型服务波动影响，同时保留显式的真实模型流式重连验证。

**架构：** 基础 smoke 只使用 app-server 的 `thread/shellCommand` 验证确定性的 Turn 生命周期。需要模型采样的流式正文场景通过独立命令运行，并在 app-server 返回错误时快速报告真实原因。

**技术栈：** TypeScript、Codex app-server JSON-RPC、Vitest、npm scripts。

## 全局约束

- 使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- app-server notification 仍是状态事实源。
- 不修改 `/home/rrssnas/code/codex`。
- 不引入新依赖，不伪造模型正文或 Turn 终态。

---

### Task 1：稳定中断 smoke

**文件：**
- 修改：`scripts/interrupt-smoke.ts`

- [x] 用 `thread/shellCommand` 启动 `sleep 30`。
- [x] 保留 `item/started`、`turn/interrupt`、`turn/completed=interrupted` 断言。
- [x] 为等待阶段增加准确标签。

### Task 2：拆分重连 smoke 与模型 E2E

**文件：**
- 修改：`scripts/reconnect-smoke.ts`
- 修改：`package.json`
- 测试：`server/tests/test-codex-home.test.ts`

- [x] 默认命令只运行确定性的 shell Turn 重连场景。
- [x] `--streaming` 继续运行真实模型流式正文场景。
- [x] 新增 `test:smoke:reconnect:streaming` 命令。
- [x] 测试脚本接线，防止模型场景重新混入基础 smoke。

### Task 3：验证与记录

**文件：**
- 更新：`docs/exec-plans/active/2026-08-16-smoke-timeout-hardening.md`
- 创建：`docs/handover/2026-08-16-smoke-timeout-hardening.md`

- [x] 运行定向测试。
- [x] 运行基础、interrupt、reconnect smoke。
- [x] 运行 streaming smoke 并记录外部模型端点结果。
- [x] 运行完整测试、生产构建和 `git diff --check`。

## 状态总览

- 当前状态：Code complete；Tests pass；基础 Smoke passed；Build passed。

## 决策日志

- 2026-08-16：隔离环境日志确认自定义模型端点返回 HTTP 503；基础 bridge bootstrap 正常。
- 2026-08-16：基础 smoke 与真实模型 E2E 分层，避免把外部服务可用性误判为 bridge 生命周期回归。

## Smoke Ledger

| 场景 | 预期 | 状态 |
|---|---|---|
| 基础 bridge | bootstrap 成功 | 通过 |
| Turn 中断 | shell Turn 进入 interrupted | 通过 |
| Turn 重连 | shell Turn 恢复并 completed | 通过 |
| 模型流式正文重连 | 正文不回退，外部 503 快速报错 | 外部端点 503，约数秒内准确失败 |

## 验证记录

- `npx vitest run server/tests/test-codex-home.test.ts`：1 file / 5 tests 通过。
- `npm run test`：193 files / 935 tests 通过。
- `npm run build`：生产构建、TypeScript、28 个静态页面和 postbuild 通过。
- `npm run test:smoke`：通过，5 models，账号来源为 `app-server.account/read`。
- `npm run test:smoke:interrupt`：通过，真实 Turn 终态为 `interrupted`。
- `npm run test:smoke:reconnect`：通过，恢复状态为 `inProgress`，终态为 `completed`。
- `npm run test:smoke:reconnect:streaming`：基础重连阶段通过；模型采样快速报告 HTTP 503、请求地址、request id 和 `willRetry=true`。
