# 客户端长任务 CPU Profile 实施计划

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline; do not modify product code without call-stack evidence, and do not archive or commit without separate user confirmation.
>
> 性能复核：[2026-07-24-frontend-framework-reevaluation.md](../../insights/2026-07-24-frontend-framework-reevaluation.md)
>
> 技术交接：[2026-07-23-web-only-performance-refactor.md](../../handover/2026-07-23-web-only-performance-refactor.md)

**目标：** 使用 Chrome 原生 CPU Profiler 定位生产模式空聊天、普通历史、长历史和普通 Markdown 的客户端主线程成本，决定下一项代码优化是否有证据。

**架构：** 复用现有生产构建、隔离 `CODEX_HOME`、固定历史 fixture 和远程 CDP。一次性临时脚本直接调用 `Profiler.start/stop`，保存原始 `.cpuprofile`，并按 sample/timeDelta 聚合函数 self time；没有明确调用栈时只形成结论，不修改产品组件。

**技术栈：** Node.js 24.14.0、Chrome CDP Profiler、现有 `ws`、Next.js 生产服务、JSON。

## 全局约束

- 不安装依赖，不修改 `package.json` 或锁文件。
- 临时脚本、原始 profile 和分析 JSON 写入 `/volume2/SSD/codex/Temp/codex-web-cpu-profile-<unique>/`，使用排他文件创建。
- app-server 使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 只采集 `empty-chat`、`ordinary-history`、`long-history`、`plain-markdown`；不触发真实模型 Turn。
- 每个场景从导航前开始采样，到内容和 `codex.first-interactive` 出现后再保留 1 秒。
- 不把 `(idle)`、Chrome 内部函数、第三方库或应用函数混为同一归因；原始 profile 必须保留。
- 不远程推送；归档和 Git 提交另行确认。

---

### 任务 1：建立最小临时采样器

**文件：**
- 生成但不入库：`/volume2/SSD/codex/Temp/codex-web-cpu-profile-<unique>/capture-cpu-profile.mjs`

**接口：**
- 输入：`CDP_ENDPOINT`、`BASE_URL`、登录凭据和四个固定 route。
- 输出：`<scenario>.cpuprofile`、`<scenario>-summary.json`、`summary.json`。

- [x] 使用 CDP `Profiler.setSamplingInterval({ interval: 1000 })`、`Profiler.start()` 和 `Profiler.stop()` 采样。
- [x] 登录后分别导航四个场景，并等待 textarea、fixture marker 和 `codex.first-interactive`。
- [x] 按 profile `samples[index]` 对应的 `timeDeltas[index]` 聚合 node self time，输出前 30 个 frame。
- [x] 原始 profile 与汇总均使用排他写入，拒绝覆盖同名结果。

### 任务 2：运行隔离生产采样

**文件：**
- 读取：`.next/`
- 读取：最新通过基线 `2026-07-24T11-42-54-822Z-production-default/summary.json`
- 生成但不入库：临时 CPU Profile 目录。

- [x] 启动 `npm run start`，确认使用隔离 `CODEX_HOME` 和 3102 端口。
- [x] 连接 `http://192.168.3.12:45737`，完成四个场景采样。
- [x] 停止生产服务并确认 3102 端口释放。
- [x] 检查四份 profile 均包含 nodes、samples 和 timeDeltas，汇总总采样时间与 top frame。

### 任务 3：形成证据结论

**文件：**
- 修改：`docs/exec-plans/completed/2026-07-24-client-long-task-cpu-profile.md`
- 修改：`docs/insights/2026-07-24-frontend-framework-reevaluation.md`
- 修改：`docs/handover/2026-07-23-web-only-performance-refactor.md`

- [x] 比较四个场景的应用代码、React、Virtuoso、Markdown、Next runtime 和浏览器内部 self time。
- [x] 只有单一应用调用栈稳定占据主要非 idle 时间时，才提出最小代码修改；否则停止在测量结论。
- [x] 记录不能从采样证明的内容，不用 profile 猜测服务端或 app-server 成本。
- [x] 运行文档链接扫描和 `git diff --check`。
- [x] 经用户确认后归档并提交；不远程推送。

## 状态总览

- 当前状态：四场景生产采样、证据分析、文档自检和计划归档完成；未发现足以支持产品代码修改的单一热点。
- 基准来源：最终长历史修复三轮生产矩阵均为 12/12，但整体可交互 P95 为 11.0 至 15.1 秒、最长 Long Task 为 788 至 1106 ms。
- 采样结果：空聊天、普通历史、长历史和普通 Markdown 分别采集 5192、7823、8330 和 8471 ms；应用 origin self time 分别占 14.39%、43.05%、32.72% 和 29.85%。
- 归因结果：各场景最高独立应用帧仅占整段采样 0.86% 至 2.98%，调用父链分散在 Turbopack 模块执行、React 提交、DOM 测量、Virtuoso/Markdown chunk；生产浏览器 chunk 无 source map，且远程 Chrome 注入了扩展脚本，证据不足以把成本稳定归因到单一源码模块。
- 成功标准：四个原始 profile 结构完整，汇总能够按场景区分 top self-time frame；本轮得到“证据不足，不修改产品代码”的单一结论。

## 决策日志

- 2026-07-24：不引入 profiling 依赖；Chrome CDP 已原生提供所需采样能力。
- 2026-07-24：一次性采样器保存在临时目录，不为单次诊断扩展生产性能基线接口。
- 2026-07-24：不根据压缩函数名猜测 React、Virtuoso 或 Markdown 的源码热点；下一轮需要无扩展浏览器和可映射源码的 profile，或先以 Long Task 时间窗缩短采样范围。
- 2026-07-24：CPU profile 只证明客户端采样窗口内的主线程分布，不能解释 app-server 初始化、HTTP 等待或动态路由服务端冷路径。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
|---|---|---|---|
| 2026-07-24 | 只读盘点 | 现有 CPU Profile 能力 | 仓库无现成 Profiler 采样器；现有 CDP 客户端可作为临时脚本参考，固定 fixture 可复用 |
| 2026-07-24 | 生产、隔离 `CODEX_HOME`、远程 CDP | 空聊天 vs 普通历史 vs 长历史 vs 普通 Markdown | 四份 `.cpuprofile` 的 nodes、samples、timeDeltas 完整；应用 origin 占比有场景差异，但没有单一稳定热点 |
| 2026-07-24 | 反例 | 空聊天 vs 内容场景 | 空聊天应用 origin 仅 14.39%，内容场景为 29.85% 至 43.05%；说明内容渲染增加客户端成本，但不能据此指定某个组件修改 |
| 2026-07-24 | 环境污染检查 | 浏览器扩展与 source map | 扩展 self time 为 0.96% 至 4.17%；生产静态 chunk 无 `.map`，因此保留原始 profile，不做压缩函数名源码猜测 |

## 采样产物

`/volume2/SSD/codex/Temp/codex-web-cpu-profile-buqqiX/`

目录包含一次性采样器、四份原始 `.cpuprofile`、四份场景汇总和全局 `summary.json`，未纳入 Git。生产服务已停止，3102 端口已释放。
