# Smoke 超时收口技术交接

关联计划：[Smoke 超时收口执行计划](../exec-plans/active/2026-08-16-smoke-timeout-hardening.md)

## 结论

`test:smoke:interrupt` 和 `test:smoke:reconnect` 现在只依赖真实 app-server 与确定性的 shell Turn，不再因外部模型端点波动产生假失败。真实模型流式正文重连保留在独立的 `test:smoke:reconnect:streaming` 命令中。

## 根因

隔离 `CODEX_HOME` 的自定义模型端点 `https://api.rrssnas.cc.cd/responses` 返回 HTTP 503。原中断 smoke 先要求模型决定执行 `sleep 30`，原重连 smoke 也包含模型流式正文，因此外部服务异常被误报为等待 notification 超时。

## 改动

- `scripts/interrupt-smoke.ts` 使用 `thread/shellCommand` 启动 `sleep 30`，仍断言 `item/started`、`turn/interrupt` 和 `turn/completed=interrupted`。
- `scripts/reconnect-smoke.ts` 默认完成 shell Turn 的断线、resume 和 completed 断言；传入 `--streaming` 时继续验证模型流式正文合并。
- 流式模式收到同一 Thread 的 app-server `error` 后立即输出 `message`、`additionalDetails` 和 `willRetry`，不再等待 90 秒。
- `package.json` 新增 `test:smoke:reconnect:streaming`。

## 验证

- `npm run test:smoke`：通过。
- `npm run test:smoke:interrupt`：通过，终态 `interrupted`。
- `npm run test:smoke:reconnect`：通过，恢复态 `inProgress`，终态 `completed`。
- `npm run test:smoke:reconnect:streaming`：快速、准确报告外部端点 HTTP 503；没有将失败伪装成通过。
- `npm run test`：193 files / 935 tests 通过。
- `npm run build`：通过。

## 边界

基础 smoke 通过只证明 bridge 与 app-server 生命周期链路正常，不证明外部模型服务可用。发布前需要模型流式能力时，应单独运行 `npm run test:smoke:reconnect:streaming`，其失败应按模型端点或账号链路问题处理。
