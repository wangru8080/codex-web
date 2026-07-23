# Web 性能基线执行计划

> **执行要求：** 按任务逐项实现并更新复选框；测试、构建和浏览器采样显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`；不自动提交或推送。
>
> 技术交接：[2026-07-23-web-only-performance-refactor.md](../../handover/2026-07-23-web-only-performance-refactor.md)

**目标：** 建立可重复的开发与生产 Web 性能基线，证明启动、路由、长历史和流式交互分别慢在哪里，为后续状态订阅与聊天渲染重构提供前置数据。

**架构：** 浏览器端仅在显式启用性能采集时记录 User Timing、Long Task 和 React Profiler 数据，并通过只读全局快照供 CDP 基准脚本提取。Node 侧运行器复用隔离 `CODEX_HOME` 和现有长历史 fixture，分别驱动开发/生产入口，按场景保存 JSON，不改变 app-server reducer、协议来源或产品行为。

**技术栈：** Next.js 16、React 19 Profiler、TypeScript、Vitest、Chrome DevTools Protocol、Codex app-server Web bridge。

## 全局约束

- 只执行技术交接中的阶段 0，不实施状态 store、虚拟列表、依赖精简或 Electron 清理。
- 浏览器性能采集必须显式启用；普通用户路径不得持续创建 Observer 或全局采样数据。
- Thread、Turn、Item、Goal、Plan、Approval 和 diagnostics 继续来自 app-server。
- 不引入第三方依赖，不伪造产品状态，不修改 `/home/rrssnas/code/codex`。
- 所有运行产物写入 `/volume2/SSD/codex/Temp/codex-web-performance-baseline/`，不得写入仓库。
- 新文件使用排他创建或唯一运行目录；不得静默覆盖既有基准结果。
- 测试与浏览器采样使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### 任务 1：性能采集模型

**文件：**
- 新建：`src/lib/web-performance.ts`
- 新建：`src/lib/web-performance.test.ts`

**接口：**
- 输入：启用参数、User Timing、Long Task、React Profiler 回调。
- 输出：可序列化的 `WebPerformanceSnapshot`，包含 marks、measures、longTasks、profilerCommits 和场景元数据。

- [x] 先添加启用边界、固定容量、P95 和快照序列化测试。
- [x] 实现显式启用、记录、清空和只读快照函数。
- [x] 运行定向测试并确认通过。

### 任务 2：浏览器标记与 Profiler 接线

**文件：**
- 新建：`src/components/performance/WebPerformanceObserver.tsx`
- 新建：`src/components/performance/PerformanceProfiler.tsx`
- 修改：`src/components/layout/RootAppContent.tsx`
- 修改：`src/components/chat/ChatView.tsx`
- 修改：`src/components/chat/MessageList.tsx`
- 修改：`src/app/chat/page.tsx`

**接口：**
- 输入：`?codexPerformance=1`、app-server connection/initialize 状态、pathname、React commit。
- 输出：`navigation-start`、`bridge-ready`、`app-server-initialized`、`first-interactive`、`route-complete` 和指定组件 commit 记录。

- [x] 在应用根部建立显式启用与 Long Task Observer 生命周期。
- [x] 记录 app-server 与首屏 ready 标记，保持 source breadcrumb 不变。
- [x] 为 `AppShell`、`ChatView`、`MessageList`、`MessageItem`、`StreamingMessage` 和 `MessageInput` 建立命名 Profiler 边界。
- [x] 为 pathname 变化记录路由完成时间，避免普通模式采集。
- [x] 运行定向测试和 typecheck。

### 任务 3：固定场景与 CDP 基准运行器

**文件：**
- 新建：`server/web-performance-baseline.ts`
- 新建：`server/web-performance-baseline.test.ts`
- 新建：`scripts/web-performance-baseline.ts`
- 修改：`package.json`

**接口：**
- 输入：`dev|production`、CDP endpoint、可选 thread id、轮次和输出根目录。
- 输出：唯一运行目录中的原始场景 JSON 与汇总 JSON；失败场景明确标记，不伪装为通过。

- [x] 添加配置解析、唯一输出路径、P95 汇总和场景矩阵测试。
- [x] 复用 rollout 协议结构，定义空会话、普通/长历史、首次/二次设置路由和真实流式 Turn 场景。
- [x] 通过 CDP 采集 Navigation Timing、Long Task、Profiler commit、输入延迟和路由延迟。
- [x] 支持无 MCP 与显式 MCP-heavy `CODEX_HOME` 对照，不复制账号或凭据。
- [x] 在 `package.json` 增加开发/生产基准命令。

### 任务 4：完整验证与前置指标

**文件：**
- 修改：`docs/handover/2026-07-23-web-only-performance-refactor.md`
- 完成并归档：`docs/exec-plans/completed/2026-07-23-web-performance-baseline.md`

**接口：**
- 输入：前三项实现和真实采样结果。
- 输出：可复现命令、前置指标、正例/反例 Smoke Ledger 和剩余风险。

- [x] 运行性能模块与运行器定向测试。
- [x] 使用隔离环境运行 `npm run typecheck` 和 `npm run test`。
- [x] 使用隔离环境运行 `npm run build` 和 `npm run test:smoke`。
- [x] 启动开发模式，记录首次与二次访问及至少一个长历史路径。
- [x] 启动生产模式，记录相同路径并与开发数据分开保存。
- [x] 记录普通状态应该变化和无关状态不应该变化的反例；阶段 0 只记录，不宣称已经优化。
- [x] 更新本文决策日志、状态总览和 Smoke Ledger。
- [ ] 经用户再次确认后，将本计划移动到 `docs/exec-plans/completed/`。

## 决策日志

- 2026-07-23：遵循交接建议，本轮只建立阶段 0 基线；性能数据决定后续是否优先拆分 Context、虚拟化或延迟加载。
- 2026-07-23：采集默认关闭，通过查询参数显式启用，避免基准代码自身影响普通交互。
- 2026-07-23：不新增浏览器自动化依赖，复用环境提供的 CDP 与仓库已有 `ws`。
- 2026-07-23：标准 React 生产构建不产生 Profiler 回调；生产使用 Navigation/User Timing 和 Long Task，开发额外使用 Profiler，不把两者混为同一指标。
- 2026-07-23：开发长历史空闲窗口仍发生 207 次 commit，下一阶段优先拆分 app-server 状态订阅；阶段 0 不修改产品状态结构。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
|---|---|---|---|
| 2026-07-23 | 只读代码审查 | 性能采集与基准入口现状 | 已有 35-turn fixture；缺少 User Timing、Long Task、React Profiler 聚合及开发/生产对照命令 |
| 2026-07-23 | 隔离 `CODEX_HOME`，Vitest | 采集模型与基准配置定向测试 | 2 个文件、8 项通过 |
| 2026-07-23 | 隔离 `CODEX_HOME`，TypeScript | `npm run typecheck` | 通过 |
| 2026-07-23 | 隔离 `CODEX_HOME`，全量 | `npm run test` | 命令退出码 0；终端回传未保留用例数量，不虚报数量 |
| 2026-07-23 | 隔离 `CODEX_HOME`，生产构建 | `npm run build` | 构建成功并生成新 `.next/BUILD_ID` |
| 2026-07-23 | 隔离 `CODEX_HOME`，真实 app-server | `npm run test:smoke` | 通过；models=7，accountSource=`app-server.account/read` |
| 2026-07-23 | 隔离 `CODEX_HOME`，CDP，开发 | 7 场景含普通/长历史、设置首次/二次、真实流式 Turn | 7/7 成功；P95 可交互 3724 ms、输入 257 ms；最长长任务 696 ms |
| 2026-07-23 | 隔离 `CODEX_HOME`，CDP，生产 | 同一 7 场景 | 7/7 成功；P95 可交互 2967 ms、输入 75 ms；最长长任务 361 ms |
| 2026-07-23 | 独立空 `CODEX_HOME`，生产 | 无 MCP 冷启动，三次 | 可交互 1249/1378/1611 ms，中位数 1378 ms |
| 2026-07-23 | 独立空 `CODEX_HOME`，生产 | 8 个本地 MCP 冷启动，三次 | 可交互 1219/1332/1356 ms，中位数 1332 ms；差异在噪声内 |
| 2026-07-23 | 开发 Profiler 反例 | 长历史空闲与输入 | 空闲新增 207 次 commit（不应该变化）；输入新增 142 次（应该变化） |

## 状态总览

- `Code complete`
- `Tests pass`
- `Smoke passed`
- `Review passed`
- 2026-07-24：已移动到 `docs/exec-plans/completed/`
