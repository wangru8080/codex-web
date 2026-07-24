# 动态聊天路由冷路径服务端追踪实施计划

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline; do not modify product code without repeatable server call-stack evidence, and do not archive or commit without separate user confirmation.
>
> 性能复核：[2026-07-24-frontend-framework-reevaluation.md](../../insights/2026-07-24-frontend-framework-reevaluation.md)
>
> 技术交接：[2026-07-23-web-only-performance-refactor.md](../../handover/2026-07-23-web-only-performance-refactor.md)

**目标：** 将每个生产进程首次 `/chat/[id]` 请求的冷路径拆解为可验证的服务端 CPU、等待与路由模块成本，决定是否存在值得修改的单一服务端边界。

**架构：** 复用现有生产构建、隔离 `CODEX_HOME` 和固定普通历史 fixture。使用 Node 24 原生 Inspector `Profiler` 只包围单次 HTTP 请求，并记录 TTFB/total；每轮先预热 `/chat` 共享路径，再分别采集首次和二次 `/chat/[id]`，不在产品代码中增加临时埋点。

**技术栈：** Node.js 24.14.0、Node Inspector CDP、现有 Next.js 生产 server、HTTP Navigation Timing、JSON。

## 全局约束

- 不安装依赖，不修改 `package.json`、锁文件、认证逻辑或 app-server 协议。
- 临时采样器、日志和 `.cpuprofile` 写入 `/volume2/SSD/codex/Temp/codex-web-server-trace-<unique>/`，使用唯一目录和排他文件创建。
- 服务使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，生产端口固定为 3102，Inspector 只监听 `127.0.0.1`。
- 使用固定普通历史 Thread `e6f34d16-4bba-472d-b4af-d8dcd4322707`；不触发真实模型 Turn。
- 至少运行三轮独立生产进程；每轮记录 `/chat` 预热、首次 `/chat/[id]` 和二次 `/chat/[id]`。
- 只有同一调用边界在三轮首次请求中稳定占据主要 CPU 差值时才修改产品代码；否则只形成测量结论。
- 不远程推送；归档和 Git 提交另行确认。

---

### 任务 1：建立原生 Inspector 单请求采样器

**文件：**
- 生成但不入库：`/volume2/SSD/codex/Temp/codex-web-server-trace-<unique>/capture-server-request.mjs`

**接口：**
- 输入：`INSPECTOR_ENDPOINT`、`BASE_URL`、登录凭据、场景名称和目标 path。
- 输出：`<scenario>.cpuprofile`、`<scenario>.json`。

- [x] 连接 Node Inspector target，启用 `Profiler.setSamplingInterval({ interval: 1000 })`。
- [x] 通过 `/api/auth/login` 获取会话 Cookie，不把凭据或 Cookie 写入结果。
- [x] 在 `Profiler.start/stop` 之间只执行一次目标 HTTP 请求，记录 status、TTFB、total 和 `Server-Timing`。
- [x] 按 samples/timeDeltas 聚合 self time，并保留完整原始 profile。

### 任务 2：执行三轮独立生产冷/热对照

**文件：**
- 读取：`.next/`
- 生成但不入库：临时服务端 trace 目录。

- [x] 每轮使用 `node --inspect=127.0.0.1:<port>` 启动生产入口，确认隔离 `CODEX_HOME`。
- [x] 每轮先请求 `/chat` 作为共享路径预热，再采集首次 `/chat/[id]`。
- [x] 每轮继续采集同一路由二次 `/chat/[id]`，保存首次与二次 profile 和 HTTP 指标。
- [x] 停止每轮生产服务，确认 3102 与 Inspector 端口释放。
- [x] 汇总三轮首次/二次 TTFB、total、CPU sampled time 和 top frame。

### 任务 3：形成证据结论

**文件：**
- 修改：`docs/exec-plans/completed/2026-07-24-dynamic-chat-route-server-trace.md`
- 修改：`docs/insights/2026-07-24-frontend-framework-reevaluation.md`
- 修改：`docs/handover/2026-07-23-web-only-performance-refactor.md`

- [x] 判断冷路径差值属于 Next 路由模块执行、认证计算、自定义 server、CPU 外等待或混合成本。
- [x] 记录 Thread 数据不在服务端首个文档请求中读取的源码边界，不把客户端 app-server 恢复归入服务端 TTFB。
- [x] 只有三轮稳定单一热点才提出最小产品修改；否则停止在测量结论。
- [x] 运行文档相对链接扫描、`find docs -maxdepth 3 -type f | sort` 和 `git diff --check`。
- [x] 经用户确认后归档并提交；不远程推送。

## 状态总览

- 当前状态：三轮独立生产进程的首次/二次请求采样、无 Inspector 对照、文档自检和计划归档完成；没有稳定单一 CPU 热点，不修改产品代码。
- 已知基线：先前独立 HTTP 测量中，每个生产进程首次 `/chat/[id]` TTFB 约 565 ms，后续为 21 至 62 ms。
- HTTP 结果：三轮首次 TTFB 为 623.4 至 840.6 ms，中位数 717.5 ms；二次为 97.6 至 136.5 ms，中位数 103.8 ms，中位差值 613.6 ms。无 Inspector 对照为首次 841.9 ms、二次 138.4 ms，冷/热方向不变。
- CPU 结果：首次请求主线程 idle 中位数 93.05%，二次为 75.89%；非 idle sampled time 中位数只从 47.7 ms 增至 61.5 ms，差值 13.8 ms。三轮均没有认证、应用代码或 Next JS 单一 self-time 热点。
- 路由边界：预热 `/chat` 返回静态缓存 HIT；`/chat/[id]` 返回 `private, no-store`。动态路由 NFT 闭包相对 `/chat` 多 46 个文件、852650 bytes，但 profile 只能证明冷路径主要在主线程 CPU 外等待，不能把 613.6 ms 全部归因给文件 I/O。
- 成功标准：三轮均生成首次/二次请求 profile 和 HTTP 指标；本轮得到“冷路径稳定存在，但证据不足以支持修改单一服务端边界”的结论。

## 决策日志

- 2026-07-24：使用 Node 原生 Inspector，不引入 OpenTelemetry、APM 或 profiling 依赖。
- 2026-07-24：不先向生产 server/Proxy 写入临时 `Server-Timing` 埋点；原生单请求 CPU profile 足以验证是否存在 CPU 热点，HTTP TTFB 与 sampled time 的差值可保留为等待成本。
- 2026-07-24：先预热 `/chat`，避免把共享 Next runtime 首次加载全部误算为动态参数路由专属成本。
- 2026-07-24：profile 中 90.83% 至 93.33% 的首次采样为 `(idle)`；不把 idle 时间命名为 CPU 成本，也不根据 NFT 文件集合直接推断全部等待来自磁盘。
- 2026-07-24：`src/app/chat/[id]/page.tsx` 为客户端页面，`readThread`、`resumeThread` 和 `listThreadTurns` 位于连接后的 `useEffect`；这些 app-server 调用不属于服务端文档 TTFB。
- 2026-07-24：不为每进程一次的冷路径引入常驻埋点、预热请求或缓存改写；只有进一步系统级异步 I/O trace 证明可控瓶颈时再建立代码计划。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
|---|---|---|---|
| 2026-07-24 | 只读源码盘点 | 服务端请求链 | 自定义 server 直接调用 Next request handler；`/chat/[id]` 是客户端页面，Thread 恢复发生在浏览器连接 app-server 后，不属于服务端文档 TTFB |
| 2026-07-24 | 三轮生产、隔离 `CODEX_HOME`、Node Inspector | 首次 vs 二次 `/chat/[id]` | 首次 TTFB 中位数 717.5 ms，二次 103.8 ms；冷路径稳定复现 |
| 2026-07-24 | CPU 反例 | 首次 vs 二次非 idle sampled time | 中位数只相差 13.8 ms；首次 93.05% 为 idle，没有稳定单一 CPU 热点 |
| 2026-07-24 | 无 Inspector 生产对照 | `/chat` 预热后首次 vs 二次 `/chat/[id]` | TTFB 841.9 vs 138.4 ms；Inspector 没有制造冷/热方向 |
| 2026-07-24 | 缓存与路由反例 | 静态 `/chat` vs 动态 `/chat/[id]` | `/chat` 为缓存 HIT；动态路由为 `private, no-store`，但不能仅凭响应策略指定代码优化 |

## 采样产物

`/volume2/SSD/codex/Temp/codex-web-server-trace-qZHIxW/`

目录包含一次性采样器、三轮共六份原始 `.cpuprofile`、六份请求汇总和三份轮次汇总，未纳入 Git。生产服务与 Inspector 均已停止，3102、9231、9232、9233 端口已释放。
