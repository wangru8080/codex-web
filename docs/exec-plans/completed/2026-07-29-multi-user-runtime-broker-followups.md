# 多用户 Runtime Broker 后续事项

> 状态：Code complete、Tests pass、Smoke passed（2026-08-01）。文件暂留 deferred 目录，待用户确认后再移动到 completed。

关联已完成计划：[多用户 Runtime Broker 实施计划](../completed/2026-07-29-multi-user-runtime-broker.md)

## 已完成事项

- 诊断 UI 展示 app-server initialize 返回的真实 `CODEX_HOME`，并通过 `/api/auth/me` 展示认证用户、OS 用户、认证用户 CODEX_HOME 与 cwd；所有字段带 `app-server.initialize` 或 `web-auth.session` 来源。
- 使用 legacy 单用户入口运行隔离实机 smoke，验证 HTTP `/login`、WebSocket bridge、`initialize`、`model/list`、`account/read` 和 `thread/list`。
- 使用真实 Codex Home 和账号的验证由部署者自行执行，避免自动化测试读取或修改真实账号、配置和会话。

验证环境：`/volume2/SSD/codex/Temp/codex-web-legacy-smoke-ph2KsR`；app-server 返回的 `initialize.codexHome` 与该隔离目录一致。该目录为 smoke 产物，未执行删除。

这些事项不影响已通过的多用户浏览器隔离、Linux UID 降权、跨用户目录隔离和 runtime 回收验证。
