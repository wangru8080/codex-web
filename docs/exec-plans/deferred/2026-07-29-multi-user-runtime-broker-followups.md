# 多用户 Runtime Broker 后续事项

关联已完成计划：[多用户 Runtime Broker 实施计划](../completed/2026-07-29-multi-user-runtime-broker.md)

## 延期范围

- 在诊断 UI 展示 app-server initialize 返回的真实 `CODEX_HOME`，并补充 broker 认证用户与 OS 用户 breadcrumb。
- 使用 legacy 单用户入口运行一次实机 smoke，确认未启用 broker 时行为不变。
- 使用真实 Codex Home 和账号的验证由部署者自行执行，避免自动化测试读取或修改真实账号、配置和会话。

这些事项不影响已通过的多用户浏览器隔离、Linux UID 降权、跨用户目录隔离和 runtime 回收验证。
