# 当前前端框架性能复核实施计划

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Execute this plan inline and stop before any dependency installation or framework POC.
>
> 技术交接：[2026-07-23-web-only-performance-refactor.md](../../handover/2026-07-23-web-only-performance-refactor.md)
>
> 后续修复：[2026-07-24-long-history-bottom-lock.md](./2026-07-24-long-history-bottom-lock.md)

**目标：** 在默认保留 Next.js 16 的前提下，用重复生产数据评估当前框架性能、剩余瓶颈与运行成本，并给出是否需要框架迁移 POC 的证据结论。

**架构：** 复用阶段 0 的固定 fixture、CDP 采集器和隔离 `CODEX_HOME`，把 HTTP/Next 服务、app-server 初始化、客户端路由和 React 渲染分层记录。阶段 5 不实现 Vite 版本；只有数据推翻“保留 Next.js”的默认假设时，才停止并另建 POC 计划。

**技术栈：** Next.js 16.2.10、React 19.2.3、Node.js 24.14.0、Codex app-server bridge、Chrome CDP、Navigation Timing、Long Task API、React Profiler。

## 全局约束

- 默认决策倾向：不迁移前端框架，先评估当前 Next.js 生产性能。
- 不安装 Vite、路由器或新的性能依赖，不修改 `package.json`、`package-lock.json` 或产品源码。
- 不改变 Web 登录、Proxy、Route Handler、CLI、同端口 HTTP/WebSocket bridge、app-server 协议或 source breadcrumb。
- 所有会触发 app-server 的命令显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 新基准输出使用排他时间戳目录写入 `/volume2/SSD/codex/Temp/codex-web-performance-baseline/`，不得覆盖已有结果。
- 不把开发首次编译、客户端渲染、app-server 初始化或网络等待合并归因给 Next.js。
- 阶段 2 的长历史初始最新位置必须保留；阶段 4 的短对话顶部对齐作为反例同时验证。
- 本阶段只修改计划、insight 和 handover 文档；归档与 Git 提交需要用户再次确认，不远程推送。

---

### 任务 1：冻结评估口径和当前架构边界

**文件：**
- 修改：`docs/exec-plans/completed/2026-07-24-frontend-framework-reevaluation.md`
- 新建：`docs/insights/2026-07-24-frontend-framework-reevaluation.md`

**接口：**
- 输入：阶段 0 至 4 的 summary JSON、当前 `.next` 生产构建、Next/Vite 官方文档和源码引用扫描。
- 输出：按 HTTP 服务、app-server、客户端路由、React 渲染和迁移成本拆分的判断表。

- [x] 记录当前框架版本、生产入口、23 个静态 HTML 页面、5 个动态 API、认证 Proxy、同端口 bridge 和 CLI 打包职责。
- [x] 记录 Next 依赖面：47 个直接导入 Next 的文件、40 个 router/link/dynamic 调用点。
- [x] 在 insight 中写明 POC 触发条件：三次生产基线均显示 Next 可归因开销占主要延迟，并且现有架构内优化无法满足预算。
- [x] 写明非触发条件：单次冷启动波动、长历史滚动条件失败、app-server 初始化等待、React 长任务或依赖包数量不能单独触发迁移。

### 任务 2：连续运行三次当前 Next.js 生产基线

**文件：**
- 读取：`scripts/web-performance-baseline.ts`
- 读取：`server/web-performance-baseline.ts`
- 生成但不入库：`/volume2/SSD/codex/Temp/codex-web-performance-baseline/<timestamp>-production-default/`

**接口：**
- 输入：同一机器、Chrome CDP、隔离 `CODEX_HOME`、相同 ordinary/long/optional Markdown fixture。
- 输出：三个互不覆盖的 `summary.json` 和场景明细。

- [x] 第一次运行：

```bash
export NODE_HOME=/volume2/SSD/node-v24.14.0
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run performance:baseline:production -- default
```

- [x] 第二次使用完全相同的命令运行，确认输出目录时间戳不同。
- [x] 第三次使用完全相同的命令运行，确认输出目录时间戳不同。
- [x] 汇总每次成功场景数、可交互 P95、路由 P95、输入 P95、长任务数和最长长任务。
- [x] 单独汇总 `empty-chat-cold`、`empty-chat-warm`、`ordinary-history`、`long-history`、`settings-first`、`settings-second`。
- [x] 反例记录普通 Turn 与 Skill Turn 是否都完成，普通 Markdown 是否仍不加载可选 Math/Mermaid/Shiki 能力。

### 任务 3：测量当前生产服务和构建产物

**文件：**
- 读取：`.next/static/`
- 读取：`.next/server/`
- 读取：`scripts/start-next-with-bridge.ts`
- 生成但不入库：`/volume2/SSD/codex/Temp/codex-web-framework-reevaluation-<unique>/`

**接口：**
- 输入：阶段 4 后的 Next 生产构建和隔离运行环境。
- 输出：静态资源体积、服务端产物体积、启动时间、稳定 RSS、页面 TTFB 和进程归属。

- [x] 记录 `.next/static`、`.next/server`、JS chunk 总大小和最大 10 个 chunk；明确 `.next` 总目录包含构建缓存，不能当作发布体积。
- [x] 运行 `npm pack --dry-run --json --ignore-scripts`，只读取发布清单和预估大小，不生成 tarball。
- [x] 启动 `npm run start`，分别记录 Next/bridge 组合进程和 app-server 启动层/native 子进程的 PID/RSS；同一 Node 内的 Next 与 bridge 不做虚假拆分。
- [x] 对 `/login`、已认证 `/chat` 和 `/chat/[id]` 各记录 10 次本机 HTTP TTFB；页面 Navigation Timing 继续作为浏览器口径。
- [x] 停止生产服务并确认 3102 监听端口释放，不遗留 app-server 进程。

### 任务 4：定位剩余性能成本而不先归因框架

**文件：**
- 读取：三个新生产基准目录中的场景 JSON
- 读取：`src/components/chat/MessageList.tsx`
- 读取：`src/lib/web-performance.ts`

**接口：**
- 输入：Navigation Timing、`codex.bridge-ready`、`codex.app-server-initialized`、`codex.first-interactive`、route measure、Long Task 和虚拟列表状态。
- 输出：每项延迟的最可能归属及证据强度。

- [x] 对每个核心场景拆分 `responseStart`、`domComplete`、bridge ready、app-server initialized 和 first interactive。
- [x] 长历史失败时记录 HTTP 与首屏时间后单独检查 `initialAtBottom`；三轮中一次完成顶部阅读与恢复底部，两次在初始置底条件失败，不把失败记为 Next 服务端失败。
- [x] 复核阶段 4 的短对话顶部实测和当前虚拟列表接线；长历史初始最新位置一次通过、两次暴露竞态，两种语义没有互相覆盖。
- [x] 对超过 50ms 的 Long Task 记录发生阶段；没有 CPU profile 证据时只标记为客户端主线程，不猜测具体库。

### 任务 5：形成框架决策并同步交接

**文件：**
- 修改：`docs/insights/2026-07-24-frontend-framework-reevaluation.md`
- 修改：`docs/handover/2026-07-23-web-only-performance-refactor.md`
- 修改：`docs/exec-plans/completed/2026-07-24-frontend-framework-reevaluation.md`
- 完成后待确认移动：`docs/exec-plans/completed/2026-07-24-frontend-framework-reevaluation.md`

**接口：**
- 输入：任务 1 至 4 的量化结果和官方框架边界。
- 输出：`保留 Next.js` 或 `需要独立 Vite POC` 的单一结论、理由和剩余风险。

- [x] 对照 Next 官方 Custom Server/Proxy 文档和 Vite Backend Integration/Production Build 文档，记录当前能力替代成本。
- [x] 未触发 POC 门槛，明确结论为“保留 Next.js”，并列出下一轮只针对实测瓶颈的优化项。
- [x] 未触发门槛，本条件分支不适用；未安装依赖或创建 Vite 代码。
- [x] 更新状态总览、决策日志和 Smoke Ledger，区分 `Code complete`、`Tests pass`、`Smoke passed` 与纯测量结论。
- [x] 运行文档自检：

```bash
find docs -maxdepth 3 -type f | sort
rg -n "阶段 5|Next.js|Vite|POC|frontend-framework-reevaluation" docs/exec-plans docs/handover docs/insights
git diff --check
```

- [x] 经用户确认后归档执行计划并提交；不远程推送。

## 状态总览

- 当前状态：阶段 5 性能复核、文档同步和文档自检完成；长历史残余已由后续底部锁计划完成修复；已确认归档和提交。
- 框架决策：保留 Next.js，不创建 Vite POC。
- 关键证据：静态与认证入口本机 TTFB 均在 23 ms 内；动态 `/chat/[id]` 首次约 565 ms、随后 21 至 62 ms；空聊天冷启动主要等待 app-server；后续底部锁修复三轮生产矩阵均为 12/12。

## 决策日志

- 2026-07-24：阶段 5 从“Next/Vite POC 对比”收敛为“当前 Next.js 性能复核”；先验证是否存在需要 POC 的问题。
- 2026-07-24：Next 当前拥有认证、动态 API、静态页面、同端口 bridge 和 CLI 分发职责；迁移成本必须作为性能收益的必要对照。
- 2026-07-24：官方文档表明 Vite 默认输出静态产物，生产服务和后端集成需由现有 Node server 承担；不能把 `vite build` 本身当作完整替代架构。
- 2026-07-24：三轮生产基线和独立 HTTP 测量没有达到 POC 触发门槛；阶段 5 决定保留 Next.js，优先处理动态路由首次冷路径、客户端 Long Task 和长历史置底竞态。
- 2026-07-24：Next 与 WebSocket bridge 共享同一 Node 进程，RSS 只能记录组合成本；app-server 的 Node 启动层与 native 子进程单独记录，不把总内存归因给前端框架。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
|---|---|---|---|
| 2026-07-24 | 阶段 5 只读盘点 | 当前框架职责、既有生产数据、迁移引用面 | 23 个静态 HTML、5 个动态 API、认证 Proxy、同端口 bridge；47 个 Next import 文件、40 个路由/动态加载调用；既有失败位于客户端长历史滚动条件 |
| 2026-07-24 | 隔离 `CODEX_HOME`，三轮生产基线 | 12 个固定场景、普通/Skill Turn、按需 Markdown 反例 | 12/12、11/12、11/12；输入 P95 9.7/16.6/20.6 ms；两次失败均为长历史初始置底条件，普通 Turn、Skill Turn 和按需加载反例三轮通过 |
| 2026-07-24 | 本机生产服务，3102 | 启动、RSS、`/login`、认证 `/chat`、动态 `/chat/[id]` | 启动到首次页面约 2015 ms；静态入口 TTFB 5 至 23 ms；动态路由首次 565 ms、随后 21 至 62 ms；服务停止后端口释放 |
| 2026-07-24 | 构建与发布只读盘点 | `.next` 产物和 `npm pack --dry-run` | static 21.28 MB、server 53.76 MB；发布包预估 17.06 MB/解包 74.62 MB/1632 项，未生成 tarball |
