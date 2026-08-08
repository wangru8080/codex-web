# 工具部分失败汇总优化 Implementation Plan

**Goal:** 避免工具组中任意一次调用失败时，聚合标题误导用户认为整轮处理全部失败。

**Architecture:** 保留 app-server 工具结果作为单项状态事实源，只在 Web 展示层统计失败项数量。单项工具继续展示具体成功或失败状态，工具组使用中性完成文案附带失败数量；Turn 整体失败仍由真实 Turn 错误状态表达。

**Tech Stack:** React、TypeScript、Vitest、Codex app-server。

## 约束

- 不修改 app-server 协议或工具状态映射。
- 不新增依赖。
- 单项工具失败继续显示 `运行失败`。
- 多项工具部分失败显示已处理总数和失败数量。
- 使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 验证。

## 完成项

- [x] 将多工具聚合标题从笼统的“处理遇到问题”改为 `已处理 N 项 · M 项失败`。
- [x] 保留单工具失败的具体动作状态。
- [x] 增加全部成功、部分失败、单项失败三个组件渲染测试。
- [x] 运行 targeted test、完整测试和 bridge smoke。
- [x] 使用真实 app-server 创建一次失败、一次成功的反例会话并检查展开明细。
- [x] 停止开发测试服务并归档浏览器验证产物。

## Smoke Ledger

- targeted test：`src/components/ai-elements/tests/tool-actions-group.test.ts`，4 项测试通过。
- `npm run test`：179 个测试文件、858 项测试通过。
- `npm run test:smoke`：隔离 `CODEX_HOME` 下 bridge、`model/list`、`account/read` 通过。
- 组件正例：两项工具全部成功时显示 `已处理 2 项`，不显示失败文案。
- 浏览器反例：真实 app-server 依次执行退出码 1 和退出码 0 的两次命令，工具组显示 `已处理 2 项 · 1 项失败`；展开后分别显示 `运行失败` 和 `已运行`，最终回答正常展示。
- 浏览器 console：3 条既有 `/api/settings/workspace` 404，未发现与本次改动相关的新增错误。
- 截图：`/volume2/SSD/codex/Temp/optimized-partial-tool-failure.png`。

## 自查

- [x] i18n：沿用组件内现有中文文案方式，未修改翻译资源。
- [x] 数据库：无 schema 或迁移改动。
- [x] 共享类型：仅复用现有 `ToolAction`，未改变协议类型。
- [x] 用户可见语义：单项来源仍为 app-server tool item；聚合标题只汇总真实工具结果。
- [x] 反例：部分失败不再等同于整组失败，单项失败仍清晰可见。
