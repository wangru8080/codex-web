# 无扩展 Headless Chromium 与 Source Map 长任务归因实施计划

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline; do not modify product components without stable mapped call-stack evidence, and do not archive or commit without separate user confirmation.
>
> 前次 CPU Profile：[2026-07-24-client-long-task-cpu-profile.md](2026-07-24-client-long-task-cpu-profile.md)
>
> 性能复核：[2026-07-24-frontend-framework-reevaluation.md](../../insights/2026-07-24-frontend-framework-reevaluation.md)
>
> 技术交接：[2026-07-23-web-only-performance-refactor.md](../../handover/2026-07-23-web-only-performance-refactor.md)

**目标：** 使用无扩展 Headless Chromium、仅诊断构建启用的浏览器 source map 和 Long Task 时间窗内 CPU samples，精确判断空聊天、普通历史、长历史与普通 Markdown 是否存在可重复的客户端源码热点。

**架构：** `next.config.mjs` 只在 `CODEX_WEB_PROFILE_SOURCE_MAPS=1` 时启用官方 `productionBrowserSourceMaps`，常规生产构建默认关闭。临时采样器复用 Chrome CDP 与现有性能 fixture，通过 `Performance.getMetrics` 的 `NavigationStart` 将浏览器 Long Task `startTime/duration` 对齐到 V8 CPU Profile 单调时间，再用 Node 24 内置 `SourceMap.findEntry()` 把第一方 chunk 帧映射到源码；三轮证据不满足门槛时不修改产品组件。

**技术栈：** Next.js 16.2.10、Chrome for Testing 149、Chrome CDP、Node.js 24.14.0 `node:module.SourceMap`、现有 Web Performance collector。

## 全局约束

- 不安装依赖，不修改锁文件，不使用远程带扩展 CDP。
- 浏览器固定使用 `/home/rrssnas/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`，启动参数必须包含 `--headless=new`、`--disable-extensions` 和唯一 `--user-data-dir`。
- app-server 固定使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，不触发真实模型 Turn。
- 临时采样器、Chrome profile、原始 `.cpuprofile`、source map 分析和日志统一写入 `/volume2/SSD/codex/Temp/codex-web-headless-sourcemap-profile-<unique>/`，使用排他文件创建。
- 只采集 `empty-chat`、`ordinary-history`、`long-history`、`plain-markdown`，每个场景三轮；每轮清理浏览器缓存并创建新 target。
- 稳定热点门槛：同一源码文件/函数在同一内容场景三轮都进入 Long Task mapped self-time 前五，并且三轮 Long Task sampled time 占比中位数至少 10%，或 mapped self time 中位数至少 50 ms。
- 只有达到门槛且能定位到项目 `src/` 的热点才修改产品组件；React、Next、浏览器内部或第三方依赖只能记录，不能冒充应用源码热点。
- 不远程推送；计划归档和 Git 提交另行确认。

---

### 任务 1：增加默认关闭的诊断 Source Map 开关

**文件：**
- 修改：`next.config.mjs`
- 创建：`server/production-source-map-config.test.ts`

**接口：**
- 输入：`CODEX_WEB_PROFILE_SOURCE_MAPS=1`。
- 输出：仅该环境下 `nextConfig.productionBrowserSourceMaps === true`；未设置、空值或其他值均为 `false`。

- [x] 先写配置测试，分别动态导入开启与默认环境的 `next.config.mjs`，确认旧配置失败。
- [x] 在 `next.config.mjs` 增加单行严格等于 `"1"` 的开关，不增加新脚本或依赖。
- [x] 运行定向测试和 `npm run typecheck`，确认默认构建配置仍关闭浏览器 source map。

### 任务 2：生成诊断构建并验证 Source Map 可用性

**文件：**
- 生成但不入库：`.next/static/**/*.js.map`
- 生成但不入库：临时目录中的 source map 清单与构建日志。

**接口：**
- 命令：`CODEX_WEB_PROFILE_SOURCE_MAPS=1 npm run build`。
- 验证：客户端 chunk 的 `sourceMappingURL` 能解析到存在的 `.map`，map 包含 `sources`、`mappings` 和项目 `src/` 来源；普通环境配置值仍为 `false`。

- [x] 使用诊断环境变量执行完整生产构建，记录 `.map` 数量与总大小。
- [x] 随机选择应用 chunk，用 Node `SourceMap.findEntry()` 验证生成位置可映射到项目源码。
- [x] 启动隔离生产服务，确认 `/login`、普通历史和长历史页面仍可访问。

### 任务 3：建立 Long Task 时间窗映射采样器

**文件：**
- 生成但不入库：`/volume2/SSD/codex/Temp/codex-web-headless-sourcemap-profile-<unique>/capture-long-task-profile.mjs`

**接口：**
- 输入：本地 CDP endpoint、`BASE_URL`、`.next` 根目录、固定 fixture ID、三轮场景。
- 输出：每轮每场景 `.cpuprofile`、Long Task 列表、mapped frame 汇总、浏览器环境信息和总 `summary.json`。

- [x] 复用最小 CDP 客户端，启动前记录 `Browser.getVersion`，断言 profile 中 `chrome-extension://` self time 为 0。
- [x] 在导航前启动 Profiler，场景就绪后读取 `window.__CODEX_WEB_PERFORMANCE__.snapshot().longTasks` 与 `Performance.getMetrics`。
- [x] 用 `NavigationStart + startTime/duration` 形成绝对单调时间窗，只聚合落入 Long Task 的 CPU samples。
- [x] 对 `/_next/static/*.js` 帧读取 chunk 声明的 `sourceMappingURL`，使用 `SourceMap.findEntry(lineNumber, columnNumber)` 输出原源码、行列、函数和 self time；保留未映射帧作为诊断。
- [x] 所有原始与汇总文件使用 `wx`，缺失 map、时间窗无法对齐或 profile 结构不完整时显式失败。

### 任务 4：执行三轮无扩展采样并判断热点

**文件：**
- 生成但不入库：三轮四场景共 12 份原始 profile 与分析结果。

**接口：**
- Headless Chrome：本地随机 CDP 端口、唯一 profile 目录、无扩展。
- 判定：按全局门槛汇总同一 mapped 源码 frame 的三轮出现次数、中位 self time 和中位占比。

- [x] 启动无扩展 Headless Chrome，验证 target 中没有扩展页面或 service worker。
- [x] 对四个场景各运行三轮，空聊天作为内容渲染反例，不触发真实 Turn。
- [x] 检查 12 份 profile 的 nodes/samples/timeDeltas 完整，Long Task 时间窗与 CPU sample 时间范围相交。
- [x] 汇总项目源码、第三方、React/Next、浏览器内部和 idle 分类，判断是否达到稳定热点门槛。
- [x] 停止 Chrome、生产服务和 app-server，确认 CDP、3102 端口释放。

### 任务 5：按证据收口

**条件 A：没有稳定项目源码热点**

- [x] 不修改产品组件，只保留默认关闭的诊断 source map 开关和证据文档，正式结束 Web-only 性能重构主线。

**条件 B：存在稳定项目源码热点（未触发）**

- [x] 不适用：没有热点达到修改门槛，因此不为假设热点增加测试或修改组件。
- [x] 不适用：没有产品组件修改，因此不执行修改后的三轮对照；原始三轮结果作为条件 A 的收口证据。

**文档：**
- 修改：`docs/exec-plans/completed/2026-07-25-headless-source-map-long-task-attribution.md`
- 修改：`docs/insights/2026-07-24-frontend-framework-reevaluation.md`
- 修改：`docs/handover/2026-07-23-web-only-performance-refactor.md`

- [x] 记录每轮 Long Task 数量、最大时长、mapped/未映射 sampled time、稳定 frame 和反例。
- [x] 明确区分“发现热点”“没有热点”和“环境仍无法归因”，不把依赖帧写成产品组件结论。
- [x] 运行全量验证、文档相对链接扫描、`find docs -maxdepth 3 -type f | sort` 和 `git diff --check`。
- [x] 经用户确认后归档并提交；不远程推送。

## 状态总览

- 当前状态：`Code complete`、`Tests pass`、`Smoke passed`。12 份 profile 完整且零扩展帧；未发现达到 self-time 门槛的项目源码热点，未修改产品组件；计划已归档，不远程推送。
- 前次限制：远程 Chrome 扩展 self time 为 0.96% 至 4.17%，生产 chunk 无 `.map`，无法把压缩帧可靠映射到源码。
- 成功标准：12 份结构完整的 profile、零扩展帧、Long Task 时间窗与 CPU samples 可对齐、第一方帧可映射；满足门槛才修改组件，否则以证据结束主线。

## 决策日志

- 2026-07-25：使用 Next 官方 `productionBrowserSourceMaps`，但只接受 `CODEX_WEB_PROFILE_SOURCE_MAPS=1`，避免常规发布暴露源码或增加构建成本。
- 2026-07-25：使用 Chrome for Testing 149 的独立无扩展 profile，不再复用远程 CDP。
- 2026-07-25：使用 Node 24 标准库 `SourceMap`，不安装 `playwright` 或 source map 解析依赖。
- 2026-07-25：按 Long Task 时间窗过滤 samples，而不是再次聚合完整导航 profile；空聊天是必需反例。
- 2026-07-25：Turbopack chunk 的 map 文件名独立哈希，采样器必须读取 JavaScript 尾部 `sourceMappingURL`，不能假设为 `<chunk>.js.map`；首次错误假设的 POC 结果不作为正式结论。
- 2026-07-25：普通历史和长历史 fixture 每条回答都含 TypeScript 代码块，纯 Markdown fixture 不含代码块。三轮 inclusive 栈稳定指向 `code-block.tsx` 调用 Shiki/Oniguruma 冷启动，但 CPU self time 位于第三方依赖，项目 frame 未达到预设 self-time 门槛，因此不修改组件。
- 2026-07-25：未映射时间主要来自 source map 稀疏的 `@shikijs/engine-oniguruma` WASM 初始化；对应 chunk 的 map 来源仅含第三方包，不存在被漏记的项目 `src/` 热点。

## 正式归因结果

三轮均使用 Chrome for Testing 149、独立新 target、清缓存、隔离 `CODEX_HOME` 和固定 fixture。表中为三轮中位数；`项目映射`、`依赖` 与 `未映射` 是 Long Task 时间窗内 sampled time 占比。

| 场景 | Long Task 数量 | 最长任务 | sampled time | 项目映射 | 依赖 | 未映射 |
|---|---:|---:|---:|---:|---:|---:|
| 空聊天 | 1 | 77 ms | 77.132 ms | 12.570 ms / 16.297% | 64.175% | 0% |
| 普通历史 | 4 | 166 ms | 423.870 ms | 33.218 ms / 7.837% | 43.617% | 14.079% |
| 长历史 | 5 | 162 ms | 465.616 ms | 31.415 ms / 6.747% | 46.217% | 14.717% |
| 普通 Markdown | 2 | 83 ms | 147.984 ms | 25.847 ms / 14.589% | 77.211% | 0% |

稳定项目 self frame 中最高的是普通 Markdown 的 `MessageItem.tsx:389`：三轮为 13.012、18.040、17.146 ms，占比分别为 8.793%、8.833%、11.996%，中位数 17.146 ms / 8.833%，低于 50 ms / 10% 门槛。其余稳定项目 self frame 中位数均不超过 8.898 ms。

普通历史和长历史存在稳定的 inclusive 归属：`code-block.tsx:360` 下的 Shiki 高亮子树中位数分别为 156.001 ms / 36.029% 和 150.152 ms / 32.971%。这是含 TypeScript 代码块夹具相对纯 Markdown 反例的预期冷启动差异；直接 self time 主要位于 React、Shiki、Oniguruma WASM 和 Streamdown，不能写成 `code-block.tsx` 自身执行了 150 ms。结论是“依赖冷启动已精确归因，但没有达到修改门槛的第一方 self hotspot”，不是“环境无法归因”。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
|---|---|---|---|
| 2026-07-25 | 只读盘点 | 浏览器、source map 与 fixture | Chrome for Testing 149 可执行；Node 24 提供 `SourceMap.findEntry()`；三个固定历史 fixture 存在；当前 `.next/static` 有 476 个 JS、0 个 `.map` |
| 2026-07-25 | 官方文档复核 | Next.js 生产浏览器 source map | `productionBrowserSourceMaps` 会生成并自动服务 `.map`，同时增加构建时间和内存，因此仅诊断环境开启 |
| 2026-07-25 | 定向 TDD | Source map 配置开关 | 测试先在 `CODEX_WEB_PROFILE_SOURCE_MAPS=1` 断言失败；单行接线后 1 个文件、1 项通过，`npm run typecheck` 通过；未设置与 `true` 均为 false，仅 `1` 为 true |
| 2026-07-25 | 诊断生产构建 | Source map 生成与解析 | `CODEX_WEB_PROFILE_SOURCE_MAPS=1 npm run build` 通过；生成 473 个 map、52,943,611 bytes，Node `SourceMap.findEntry()` 可映射到 `src/components/patterns/SettingsCard.tsx` |
| 2026-07-25 | Headless Chrome 149 | 三轮四场景 Long Task CPU Profile | 12/12 profile 结构完整，扩展 target 与扩展 self time 均为 0；42 份实际使用的 chunk map 可解析；`qualifyingHotspots=[]` |
| 2026-07-25 | 内容反例 | 含代码块历史 vs 纯 Markdown | 普通/长历史稳定进入 `code-block.tsx` 下的 Shiki/Oniguruma 冷启动；纯 Markdown 无该 inclusive 栈，项目最高稳定 self frame 仍低于门槛 |
| 2026-07-25 | 默认生产构建 | 关闭诊断 source map | `npm run build` 通过；配置值为 false，`.next/static` 恢复为 0 个 map、22 MiB；Chrome、生产服务和 app-server 已停止，3102/9224 端口释放 |
| 2026-07-25 | 全量验证 | Typecheck、Unit、Smoke、文档与差异 | `npm run test` 通过，129 个文件、597 项；`npm run test:smoke` 通过，隔离 app-server 读取 5 个模型；三份文档相对链接、文档清单和 `git diff --check` 通过 |
