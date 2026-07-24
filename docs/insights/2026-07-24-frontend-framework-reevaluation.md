# 前端框架性能复核结论

> 执行计划：[2026-07-24-frontend-framework-reevaluation.md](../exec-plans/completed/2026-07-24-frontend-framework-reevaluation.md)
>
> 技术交接：[2026-07-23-web-only-performance-refactor.md](../handover/2026-07-23-web-only-performance-refactor.md)
>
> 生产入口预编译计划：[2026-07-24-production-entry-precompile-evaluation.md](../exec-plans/completed/2026-07-24-production-entry-precompile-evaluation.md)

## 结论

保留 Next.js 16，当前不创建 Vite POC。

三轮同机生产基线和独立 HTTP 测量没有证明 Next.js 生产运行时是剩余性能的主要来源：静态 `/login` 与已认证 `/chat` 的本机 TTFB 均稳定在 23 ms 内，动态 `/chat/[id]` 只有每个服务进程第一次请求约 565 ms，随后为 21 至 62 ms。空聊天冷启动中，HTTP `responseStart` 为 28 至 80 ms，而 app-server 初始化和首个可交互标记延后到 1.33 至 2.33 秒，主要等待不在页面 HTTP 响应。

阶段 5 当时需要继续验证的是动态路由首次执行成本、客户端主线程长任务和长历史虚拟列表初始置底竞态；后续底部锁已修复，两项 profile 也已完成，但均未发现支持进一步产品代码修改的单一热点。迁移框架不能直接消除 app-server 初始化或 React/Virtuoso 客户端问题，却需要重建认证 Proxy、5 个 Route Handler、23 个静态页面、路由、同端口 WebSocket bridge 和 CLI 生产分发边界。

## 评估边界

当前生产架构由 Next.js 16.2.10、React 19.2.3 和自定义 Node HTTP server 组成：

- 23 个生成的静态 HTML 页面。
- 5 个动态 API：认证配置、登录、登出、bridge URL 和安全设置。
- `src/proxy.ts` 负责会话重定向和认证前置判断。
- `scripts/start-next-with-bridge.ts` 在同一端口承载 Next HTTP 与 WebSocket bridge，并启动 `codex app-server --stdio`。
- CLI 发布包携带 `.next` 生产产物，能够从非源码目录启动。
- 现有盘点发现 47 个文件直接导入 Next，40 个 router/link/dynamic 调用点；迁移不是单纯替换构建命令。

POC 触发门槛为：至少三次同口径生产基线均显示可归因给 Next 的持续开销占主要延迟，并且 Next 架构内优化无法满足预算。本次没有达到门槛。单次冷启动波动、app-server 初始化等待、React 长任务、依赖数量或虚拟列表断言失败均不能单独触发迁移。

## 生产基线

三轮基线均使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`、相同 CDP 和固定 fixture：

| 运行 | 成功场景 | 可交互 P95 | 路由 P95 | 输入 P95 | 长任务 | 最长长任务 |
|---|---:|---:|---:|---:|---:|---:|
| 第 1 次 | 12/12 | 1665.6 ms | 1044.2 ms | 9.7 ms | 53 | 139 ms |
| 第 2 次 | 11/12 | 1596.5 ms | 1041.4 ms | 16.6 ms | 63 | 224 ms |
| 第 3 次 | 11/12 | 2334.2 ms | 1089.6 ms | 20.6 ms | 85 | 336 ms |

普通历史、空聊天、设置页、普通 Turn、Skill Turn 和四种 Markdown 能力场景三次均通过。普通 Markdown 三次均没有加载 Math、Mermaid、代码插件或 Shiki；Math、Mermaid 和代码场景只加载各自需要的能力。

两次失败均为长历史 `initialAtBottom` 条件：失败页面的 HTTP `responseStart` 分别为 50.5 ms 和 45.8 ms，`domComplete` 分别为 203.5 ms 和 188.8 ms。第一次运行中相同场景 60 条消息只挂载 11 条，初始位于底部，向上阅读后能恢复底部。因此它是可复现但非必现的客户端虚拟列表时序问题，不能记为 Next 服务端失败。

阶段 4 已单独验证真实短 Turn 的首条问题 `topOffset=0`、`scrollTop=0`。当前源码继续保留长历史 `initialTopMostItemIndex`，并移除了短对话 `alignToBottom`；两种语义没有通过本阶段改动互相覆盖。

## 延迟归属

核心 Navigation Timing 显示：

| 场景 | HTTP `responseStart` | `domComplete` | app-server 初始化 | 首次可交互 | 判断 |
|---|---:|---:|---:|---:|---|
| 空聊天冷启动，第 1 次 | 28.1 ms | 1043.5 ms | 1590.5 ms | 1665.6 ms | 初始化等待占主要部分 |
| 空聊天冷启动，第 3 次 | 79.7 ms | 1089.0 ms | 1884.6 ms | 2334.2 ms | HTTP 不是主要等待 |
| 普通历史，三次范围 | 532.7 至 565.5 ms | 794.8 至 909.4 ms | 1098.4 至 1294.2 ms | 1286.4 至 1596.5 ms | 每进程首个动态路由存在冷路径 |
| 随后的长历史，三次范围 | 31.8 至 50.5 ms | 135.2 至 203.5 ms | 453.6 至 939.6 ms | 678.5 至 1180.7 ms | 同动态路由热后 HTTP 明显下降 |
| 设置页第二次，三次范围 | 9.4 至 18.3 ms | 70.6 至 117.3 ms | 309.4 至 505.1 ms | 319.3 至 526.4 ms | 客户端与 app-server 状态仍影响可交互标记 |

输入 P95 为 9.7 至 20.6 ms，满足 50 ms 建议预算。最长 Long Task 为 139 至 336 ms，仍超过 50 ms 预算；阶段 5 形成该判断时只有 Long Task 时间和场景归属，故当时只标记为客户端主线程成本，不猜测具体依赖。后续 CPU Profile 结论见下文。

## 服务与发布成本

独立启动和 HTTP 测量结果：

- 从启动命令到 `/login` 首次成功响应约 2015 ms。
- `/login` 10 次 TTFB 为 7.0 至 18.8 ms，平均 11.5 ms。
- 已认证 `/chat` 10 次 TTFB 为 5.5 至 22.6 ms，平均 8.7 ms。
- `/chat/[id]` 第一次 TTFB 为 565.4 ms，后续 9 次为 21.1 至 61.9 ms。
- 阶段 5 记录的请求后 `tsx` 启动层约 55 MiB RSS，承载 Next 与 bridge 的 Node 进程约 193 MiB RSS；app-server Node 启动层约 48 MiB，native app-server 约 64 MiB。后续生产入口预编译已移除常驻 `tsx` launcher/loader，正式 `npm run start` 的入口进程树 RSS 中位数由 272.78 MiB 降到 166.82 MiB；该收益不代表 Next 本身只占剩余内存。
- `.next/static` 为 21,277,802 bytes，`.next/server` 为 53,759,000 bytes；476 个 JS 文件合计 21,073,385 bytes，最大单文件 779,988 bytes。`.next` 总目录包含构建缓存，不能作为发布大小。
- `npm pack --dry-run --json --ignore-scripts` 预估发布包压缩后 17,057,552 bytes，解包后 74,617,395 bytes，共 1632 个条目；dry-run 没有生成 tarball。

这些数据说明运行和发布成本仍有优化空间，但缺少等功能 Vite 服务端对照，不能把全部内存或包体积标记为 Next 成本。更直接的下一步是评估生产入口是否需要运行 `tsx`，并对首个 `/chat/[id]` 请求做服务端 trace。

## 替代成本

[Next.js Custom Server 官方文档](https://nextjs.org/docs/app/guides/custom-server)说明自定义 server 只应在集成路由无法满足需求时使用，并会放弃部分框架优化；当前项目确实需要在同一 HTTP server 上处理 WebSocket upgrade，因此该边界应先在 Next 内优化，而不是假设 Vite 自动替代。

[Next.js Proxy 官方文档](https://nextjs.org/docs/app/getting-started/proxy)定义了请求完成前的重写、重定向和响应能力；迁移需要为现有认证和会话失效重新建立等价前置边界。

[Vite Backend Integration 官方文档](https://vite.dev/guide/backend-integration.html)要求传统后端在开发期注入客户端脚本，并在生产期读取构建 manifest；[Vite Production Build](https://vite.dev/guide/build)默认生成适合静态托管的产物，[Static Deploy](https://vite.dev/guide/static-deploy.html)也明确 `vite preview` 只用于本地预览而非生产 server。因此 Vite POC 仍需保留或重写 Node 后端、认证 API、路由 fallback、WebSocket bridge 和 CLI 分发，不能只比较 `next build` 与 `vite build`。

## 后续工作

1. 若继续深挖首次 `/chat/[id]`，先使用系统级异步 I/O/worker trace 证明可控等待来源；本轮服务端 profile 不支持修改认证、Proxy 或应用函数。
2. 在禁用浏览器扩展并提供可映射源码的环境中复测客户端 Long Task；现有 CPU profile 没有支持修改单一组件的证据。
3. 生产 TypeScript 入口预编译已经完成；后续只需在入口或构建链变化时保持 pack 与跨目录安装回归。
4. 只有其余工作出现新的三轮证据满足 POC 门槛，才另建 Vite POC 计划。

## 长历史滚动残余修复

阶段 5 复核暴露的 `initialAtBottom` 非确定性已在后续计划 [长历史初始底部锁](../exec-plans/completed/2026-07-24-long-history-bottom-lock.md) 中修复。`MessageList` 在每个会话首次提交非空历史后启用初始底部锁，以 Virtuoso 高度/状态回调和真实 scroller 位置共同保持最新消息；wheel、touch、pointer 或向上导航键会先解除锁，因此用户向上阅读不会被抢夺。短对话继续不使用 `alignToBottom`。

最终三轮生产矩阵均为 12/12。长历史每轮 60 条消息只挂载 11 至 13 条；`initialAtBottom`、`lateHeightMaintainedBottom`、`userScrollPreserved` 和 `returnedToBottom` 三轮均为 true。普通 Turn、Skill Turn 和四种 Markdown 按需加载反例同时通过。

三轮整体可交互 P95 为 11.0 至 15.1 秒，最长 Long Task 为 788 至 1106 ms，不能据此宣称整体性能改善。滚动正确性已稳定；后续客户端 CPU Profile 和动态路由服务端追踪均已完成，未发现单一代码热点，不改变“保留 Next.js”的框架结论。

## 客户端 CPU Profile 复核

2026-07-24 使用隔离 `CODEX_HOME`、现有生产构建和远程 Chrome CDP，对空聊天、普通历史、长历史和普通 Markdown 从导航前采样到 `codex.first-interactive` 与内容就绪后 1 秒。四个场景分别采集 5192、7823、8330 和 8471 ms，原始 profile 均包含 nodes、samples 和 timeDeltas。

| 场景 | Idle | 应用 origin | 浏览器原生或 eval | 扩展 | 最高独立应用帧 |
|---|---:|---:|---:|---:|---:|
| 空聊天 | 58.74% | 14.39% | 25.70% | 1.17% | 0.86% |
| 普通历史 | 23.48% | 43.05% | 28.87% | 0.96% | 2.98% |
| 长历史 | 34.07% | 32.72% | 29.04% | 4.17% | 1.76% |
| 普通 Markdown | 43.60% | 29.85% | 25.56% | 0.99% | 1.88% |

内容场景的应用 origin self time 高于空聊天，证明内容渲染确实增加客户端执行成本；但各场景的最高独立应用帧只占整段采样 0.86% 至 2.98%。父链同时涉及 Turbopack 模块执行、React 提交、DOM 测量、Virtuoso/Markdown chunk，没有单一调用栈稳定占据主要非 idle 时间。

本轮还有两个归因限制：远程 Chrome 注入了浏览器扩展脚本，长历史中扩展 self time 达 4.17%；当前生产静态 chunk 没有浏览器 source map，压缩函数名不能可靠映射回具体组件。因此本轮不修改产品代码，也不能用结果解释 app-server 初始化或服务端动态路由冷路径。下一次客户端采样应使用无扩展 Headless Chrome，并提供可映射源码或只围绕已定位的 Long Task 时间窗采样。

## 动态聊天路由服务端追踪

2026-07-24 使用三个独立生产进程、隔离 `CODEX_HOME` 和 Node Inspector 单请求 CPU Profiler 复核 `/chat/[id]`。每轮先登录并请求缓存 HIT 的 `/chat`，再分别只包围首次和二次 `/chat/[id]` 请求采样；固定 Thread 只用于 route 参数，未触发模型 Turn。

| 轮次 | 首次 TTFB | 二次 TTFB | 首次 total | 二次 total | 首次 idle | 二次 idle |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 717.5 ms | 136.5 ms | 837.4 ms | 180.8 ms | 93.33% | 79.99% |
| 2 | 623.4 ms | 103.8 ms | 821.2 ms | 128.9 ms | 93.05% | 73.07% |
| 3 | 840.6 ms | 97.6 ms | 930.2 ms | 191.2 ms | 90.83% | 75.89% |
| 中位数 | 717.5 ms | 103.8 ms | 837.4 ms | 180.8 ms | 93.05% | 75.89% |

首次与二次 TTFB 中位差为 613.6 ms，但主线程非 idle sampled time 中位数只从 47.7 ms 增至 61.5 ms，差值 13.8 ms。三轮 top frame 均以 `(idle)` 和 `(program)` 为主，没有认证、Proxy、应用代码或 Next JS 函数稳定占据主要 self time。另一次不启用 Inspector 的生产对照为首次 841.9 ms、二次 138.4 ms，确认 profiler 没有制造冷/热方向。

响应边界也不同：`/chat` 是静态缓存 HIT，`/chat/[id]` 返回 `private, no-store`；动态路由 NFT 闭包相对 `/chat` 多 46 个文件、852650 bytes。这些证据说明冷路径主要位于主线程 CPU 外等待，可能包含异步模块装载、动态渲染或 worker 工作，但不能只凭 NFT 集合把 613.6 ms 全归因给磁盘 I/O。

`src/app/chat/[id]/page.tsx` 是客户端页面，Thread 的 `readThread`、`resumeThread` 和 `listThreadTurns` 在浏览器连接 app-server 后由 effect 执行，不属于服务端文档 TTFB。因此本轮不修改产品代码，也不增加常驻预热或追踪逻辑；若继续，应先取得系统级异步 I/O/worker 证据。

## 产物

- 三轮基线：`/volume2/SSD/codex/Temp/codex-web-performance-baseline/2026-07-24T08-18-36-729Z-production-default/`
- 三轮基线：`/volume2/SSD/codex/Temp/codex-web-performance-baseline/2026-07-24T08-20-07-897Z-production-default/`
- 三轮基线：`/volume2/SSD/codex/Temp/codex-web-performance-baseline/2026-07-24T08-21-48-459Z-production-default/`
- 服务测量：`/volume2/SSD/codex/Temp/codex-web-framework-reevaluation-DJz2tJ/`
- 长历史修复基线：`/volume2/SSD/codex/Temp/codex-web-performance-baseline/2026-07-24T11-33-42-349Z-production-default/`
- 长历史修复基线：`/volume2/SSD/codex/Temp/codex-web-performance-baseline/2026-07-24T11-36-01-903Z-production-default/`
- 长历史修复基线：`/volume2/SSD/codex/Temp/codex-web-performance-baseline/2026-07-24T11-42-54-822Z-production-default/`
- 客户端 CPU Profile：`/volume2/SSD/codex/Temp/codex-web-cpu-profile-buqqiX/`
- 动态聊天路由服务端 trace：`/volume2/SSD/codex/Temp/codex-web-server-trace-qZHIxW/`
- 生产入口 POC、九轮测量、tgz 与临时安装：`/volume2/SSD/codex/Temp/codex-web-production-entry-CPU62v/`

阶段 5 及其两项 profile 后续只修改文档，没有修改产品代码、依赖或构建配置。其后独立完成的生产入口预编译达到 `Code complete`、`Tests pass` 和 `Smoke passed`：全量 128 个测试文件、596 项通过，生产构建、CLI 构建、pack dry-run、全新安装及仓库外 cwd 启动均通过。该改动优化进程启动层，不改变“保留 Next.js”的框架结论，也没有证明动态路由或客户端 Long Task 已改善。
