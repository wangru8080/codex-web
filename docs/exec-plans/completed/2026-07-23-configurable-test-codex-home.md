# 可配置测试 CODEX_HOME 实施计划

> **执行要求：** 在当前会话内逐项执行；步骤使用复选框跟踪，不派发子代理。

**目标：** 将固定测试隔离路径改为默认值，所有 smoke 和回归脚本优先使用用户显式设置的 `CODEX_HOME`，包括真实环境。

**架构：** 新增共享纯函数解析测试环境：空值回退默认目录，非空值原样保留。各 TypeScript smoke 在启动 app-server 前把解析结果写回 `process.env.CODEX_HOME`，并继续断言 initialize 返回相同目录；历史分页命令使用同一解析结果。

**技术栈：** TypeScript、Node.js、Vitest、Codex app-server smoke。

**状态：** Smoke passed

## 全局约束

- 默认值为 `/volume2/SSD/codex/Temp/codex-dev-home`。
- 显式 `CODEX_HOME` 不做路径类别限制，包括真实 `CODEX_HOME`。
- 本轮自动验证不读取真实 `CODEX_HOME`。
- 不改写历史执行记录中的既有验证路径。

---

### 任务 1：共享解析语义

- [x] 新增默认值、自定义值、真实路径和空白值测试。
- [x] 实现 `resolveTestCodexHome(env)`。
- [x] 定向测试通过。

### 任务 2：Smoke 与回归接线

- [x] 改造基础、中断、重连、权限、Goal/Plan、恢复、用户输入 smoke。
- [x] 改造历史分页回归命令和断言。
- [x] 移除旧 `isolatedCodexHome` 固定常量。
- [x] 扫描确认不存在精确默认路径拒绝逻辑。

### 任务 3：规则和文档

- [x] 更新 `AGENTS.md` 默认值与显式覆盖规则。
- [x] 更新 `README.md` 验证示例和风险提示。

### 任务 4：验证

- [x] 运行定向测试。
- [x] 运行 `npm run test`。
- [x] 使用默认目录运行基础 smoke。
- [x] 使用自定义测试目录运行基础 smoke，确认不会因路径不同提前退出。
- [x] 更新 Smoke Ledger 并移动到 completed。

## Smoke Ledger

- 解析单测：未设置和空白值回退默认目录；自定义 `/tmp/codex-smoke-a` 与真实路径形式 `/home/tester/.codex` 原样接受。
- 回归计划反例：自定义和真实路径形式均进入生成命令，不再抛出固定路径错误。
- 默认 smoke：移除 `CODEX_HOME` 后，app-server initialize 返回 `/volume2/SSD/codex/Temp/codex-dev-home`。
- 自定义 smoke：显式设置 `/volume2/SSD/codex/Temp/codex-configurable-smoke-home` 后，app-server initialize 返回同一路径。
- 本轮未使用真实 `CODEX_HOME` 启动 app-server。
