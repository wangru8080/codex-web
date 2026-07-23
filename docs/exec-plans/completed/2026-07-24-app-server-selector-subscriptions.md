# App-server selector subscriptions

> 技术交接：[2026-07-23-web-only-performance-refactor.md](../../handover/2026-07-23-web-only-performance-refactor.md)

**目标：** 将 Web UI 从 AppServerProvider 的单体状态订阅迁移到稳定的外部 Store 和细粒度 selector，减少 Token Usage、diagnostics、Turn delta 等高频通知对无关组件的 React 重渲染。

**约束：** 不改变 app-server method、generated response、notification reducer、approval 顺序、未知通知 diagnostics 或 source breadcrumb；不引入第三方状态库；验证使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

## 执行任务

- [x] 建立轻量 Store 契约和 no-op/切片引用测试。
- [x] 将 AppServerProvider 状态发布改为稳定 Store，并保持 action 的最新状态读取。
- [x] 迁移低风险状态消费者，再迁移 AppShell、会话列表、聊天详情和设置模块。
- [x] 移除内部消费者对全量 `useAppServerState()` 的依赖，保留必要的 selector API。
- [x] 增加普通消息与 Skill 消息对照验证，并记录无关状态不触发 selector 更新的反例。
- [x] 运行 typecheck、unit、build、smoke 和开发性能基准，比较阶段 0 前置指标。
- [x] 更新交接文档、决策日志和 Smoke Ledger。
- [x] 经用户确认后移动到 `docs/exec-plans/completed/`。

## 决策日志

- 2026-07-24：采用 React `useSyncExternalStore` 与仓库内轻量 Store，不引入 Zustand；协议状态仍由现有 reducer 生成。
- 2026-07-24：Store Context 的 value 保持稳定；action 调用时读取最新 Store 快照，避免为追踪状态而重建 action Context。
- 2026-07-24：所有产品消费者均迁移到 selector，移除完整状态 Hook，防止后续组件重新引入全量订阅。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
|---|---|---|---|
| 2026-07-24 | 只读代码审查 | 确认 Provider 单体 Context 及 15 个消费者 | 已确认并全部迁移到 selector |
| 2026-07-24 | 隔离 `CODEX_HOME`，Vitest | Store 与接线定向测试 | 4 个文件、11 项通过 |
| 2026-07-24 | 隔离 `CODEX_HOME`，全量 | `npm run test` | 120 个文件、565 项通过 |
| 2026-07-24 | 隔离 `CODEX_HOME`，生产构建 | `npm run build` | 通过；26 个静态页面生成成功 |
| 2026-07-24 | 隔离 `CODEX_HOME`，真实 app-server | `npm run test:smoke` | 通过；models=7，accountSource=`app-server.account/read` |
| 2026-07-24 | Store 反例 | 仅更新 diagnostics | connection/threads selector 快照引用不变，connection commit 计数为 0 |
| 2026-07-24 | 隔离 `CODEX_HOME`，CDP，开发 | 普通历史与长历史空闲/输入 | 普通 5/25 次，长历史 18/17 次；阶段 0 分别为 54/42、207/142 |
| 2026-07-24 | 隔离 `CODEX_HOME`，真实 Turn | 普通消息与固定测试 Skill 消息 | 两条路径均成功回显唯一标记；开发基准 8/8 通过 |

## 状态总览

- `Code complete`
- `Tests pass`
- `Smoke passed`
- `Review passed`
- 2026-07-24：已移动到 `docs/exec-plans/completed/`；未提交、未推送。
