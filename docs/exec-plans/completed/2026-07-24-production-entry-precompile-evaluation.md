# 生产入口预编译评估实施计划

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline; do not retain product changes without repeatable startup or RSS benefit, and do not archive or commit without separate user confirmation.
>
> 性能复核：[2026-07-24-frontend-framework-reevaluation.md](../../insights/2026-07-24-frontend-framework-reevaluation.md)
>
> CLI 交接：[2026-07-23-codex-web-cli-package.md](../../handover/2026-07-23-codex-web-cli-package.md)
>
> 性能交接：[2026-07-23-web-only-performance-refactor.md](../../handover/2026-07-23-web-only-performance-refactor.md)

**目标：** 评估将源码仓库的 `npm run start` 从运行时 `tsx` 改为预编译 JavaScript 是否能稳定降低生产启动时间或常驻内存，并且不破坏现有 CLI、同端口 bridge 和跨目录运行边界。

**架构：** 先使用已安装的 esbuild 在临时目录生成 `scripts/start-next-with-bridge.ts` 的外部依赖 ESM bundle，不修改产品入口。以三个独立进程分别测量当前 `npm run start` 和临时预编译入口的 `/login` 就绪时间及进程树 RSS；只有收益达到门槛才增加最小构建脚本和启动器，否则丢弃 POC 并只记录结论。

**技术栈：** Node.js 24.14.0、现有 esbuild 0.28.1、Next.js 16.2.10、TypeScript、Vitest、npm pack。

## 全局约束

- 不新增或更新仓库依赖，不修改 app-server 协议、认证、WebSocket bridge 或 Next 页面代码；仅在用户单独确认后把实际 tgz 安装到临时目录做发布验证。
- 临时 bundle、测量器和结果写入 `/volume2/SSD/codex/Temp/codex-web-production-entry-<unique>/`，使用唯一目录和排他文件创建。
- 使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，每轮独立进程固定端口 3102。
- 当前安装 CLI 已由 `scripts/build-cli.ts` 打成 `dist/cli/codex-web.mjs`；不得为本任务重写 CLI 或重复解决已经存在的预编译边界。
- 两种入口各运行至少三轮，记录从 spawn 到 `/login` 可响应的时间、入口/子进程命令行和 RSS；app-server 子树单独列出，不把它的内存归因给入口。
- 保留产品改动的门槛：预编译入口启动时间中位数至少降低 10%，或入口相关 RSS 中位数至少降低 20 MiB，且三轮方向一致。
- 若达到门槛，必须完成 `npm run test`、`npm run build`、`npm run test:smoke`、`npm pack --dry-run --json --ignore-scripts` 和临时安装/跨目录启动验证。
- 不远程推送；归档和 Git 提交另行确认。

---

### 任务 1：建立临时预编译入口与测量器

**文件：**
- 生成但不入库：`/volume2/SSD/codex/Temp/codex-web-production-entry-<unique>/start-next-with-bridge.mjs`
- 生成但不入库：`/volume2/SSD/codex/Temp/codex-web-production-entry-<unique>/measure-startup.mjs`

**接口：**
- 临时 bundle：以 `scripts/start-next-with-bridge.ts` 为入口，`bundle=true`、`packages=external`、`platform=node`、`format=esm`、`target=node20.9`。
- 测量器：输入模式和命令，输出 spawn-to-ready、HTTP status、进程树 pid/ppid/cmdline/RSS，并在每轮结束后停止服务。

- [x] 使用现有 esbuild 生成临时 bundle，语法检查通过，不修改 `dist/`。
- [x] 编写一次性 Node 测量器，等待 `/login`、读取 `/proc` 进程树并使用排他 JSON 输出。
- [x] 确认测量器停止服务后 3102 端口释放，不遗留 app-server 进程。

### 任务 2：执行当前入口与预编译入口对照

**文件：**
- 读取：`package.json`、`scripts/start-next-with-bridge.ts`、`scripts/build-cli.ts`。
- 生成但不入库：六轮测量 JSON 和总汇总。

- [x] 当前入口运行三轮 `npm run start`，记录启动时间和进程树 RSS。
- [x] 临时入口运行三轮 `node <temp>/start-next-with-bridge.mjs`，显式设置 `CODEX_WEB_APP_ROOT`，记录相同指标。
- [x] 分离 npm/sh/tsx 启动层、Next+bridge server 和 app-server 子树，避免比较口径错位。
- [x] 汇总中位数和逐轮方向，判断是否达到 10% 启动或 20 MiB RSS 门槛。

### 任务 3：按证据决定是否接入产品

**条件 A：未达到门槛**

- [x] 条件 A 不适用：实测达到门槛，因此按条件 B 保留产品改动。

**条件 B：达到门槛时才执行**

**文件：**
- 创建：`scripts/build-production-server.mjs`
- 创建：`scripts/start-production.mjs`
- 创建：`server/production-entry-build-wiring.test.ts`
- 修改：`package.json`
- 修改：`server/production-server-options.test.ts`

**接口：**
- `npm run build:production-server` 生成 `dist/start-next-with-bridge.mjs`。
- 源码仓库的 `npm run start` 使用普通 JavaScript 启动器重建并加载 bundle，避免常驻 `tsx` loader，同时不会运行陈旧产物。
- npm 安装包只携带启动器与 `dist/start-next-with-bridge.mjs`，启动时不依赖开发期的 TypeScript 源码、`tsx` 或 esbuild。
- `npm run build:cli` 在打包前显式生成生产入口；普通 `npm run build` 及现有 CLI 行为不变。

- [x] 先增加构建/启动接线测试并确认旧配置不满足断言。
- [x] 用现有 esbuild 实现最小生产入口构建脚本，并调整 npm scripts/files。
- [x] 运行定向测试、全量测试、构建、Smoke、pack dry-run 和安装后跨目录验证。
- [x] 再运行三轮正式入口测量，确认产品接线后的收益仍达到门槛。

### 任务 4：形成结论与交接

**文件：**
- 修改：`docs/exec-plans/completed/2026-07-24-production-entry-precompile-evaluation.md`
- 修改：`docs/insights/2026-07-24-frontend-framework-reevaluation.md`
- 修改：`docs/handover/2026-07-23-web-only-performance-refactor.md`
- 条件 B 时修改：`docs/handover/2026-07-23-codex-web-cli-package.md`

- [x] 记录六轮原始指标、门槛判断、CLI 已预编译边界和未能证明的内容。
- [x] 条件 B 时记录构建、Smoke、pack 和跨目录反例；条件 A 时明确没有产品代码改动。
- [x] 运行文档相对链接扫描、`find docs -maxdepth 3 -type f | sort` 和 `git diff --check`。
- [x] 经用户确认后归档并提交；不远程推送。

## 状态总览

- 当前状态：`Code complete`、`Tests pass`、`Smoke passed`；用户已确认归档和 Git 提交，不远程推送。
- 已实现：源码仓库的 `npm run start` 通过普通 JavaScript 启动器即时生成并加载预编译入口；安装包直接加载随包 bundle，不携带构建器或 TypeScript 源入口。
- 门槛结论：正式入口启动中位数降低 36.41%，入口相关 RSS 中位数降低 105.97 MiB，三轮方向一致，保留改动。

## 决策日志

- 2026-07-24：复用现有 esbuild，不新增 bundler、runtime loader 或发布依赖。
- 2026-07-24：不把安装 CLI 与源码仓库 `npm run start` 混为同一入口；CLI 已经预编译，本阶段只评估后者。
- 2026-07-24：先在临时目录 POC，避免为未经证明的收益修改 postbuild、npm files 和生产启动命令。
- 2026-07-24：POC 三轮中位数显示就绪时间降低 48.35%、入口相关 RSS 降低 171.66 MiB，达到两项保留门槛，进入条件 B。
- 2026-07-24：不接入 `postbuild`；源码启动器即时重建，发布构建显式产出 bundle，兼顾新鲜度与安装包无开发依赖启动。
- 2026-07-24：正式 `npm run start` 保留 npm 父进程作为真实使用口径；其入口 RSS 包括 npm 与生产 Node 进程，不与直接 `node bundle` 的 POC 口径混用。
- 2026-07-24：本阶段未修改 Next 页面、认证、bridge、app-server 协议或 UI；收益来自移除常驻 `tsx` launcher/loader。

## 测量结果

| 入口 | 第 1 轮 | 第 2 轮 | 第 3 轮 | 就绪中位数 | 入口 RSS 中位数 |
|---|---|---|---|---:|---:|
| 改动前 `npm run start` | 2152.82 ms / 273.45 MiB | 2039.22 ms / 272.42 MiB | 2119.71 ms / 272.78 MiB | 2119.71 ms | 272.78 MiB |
| 临时直接 bundle POC | 1094.79 ms / 103.66 MiB | 1106.93 ms / 100.63 MiB | 1042.74 ms / 101.13 MiB | 1094.79 ms | 101.13 MiB |
| 正式 `npm run start` | 1394.27 ms / 167.84 MiB | 1341.02 ms / 166.43 MiB | 1347.94 ms / 166.82 MiB | 1347.94 ms | 166.82 MiB |

POC 相对旧入口的中位数变化为启动降低 48.35%、入口 RSS 降低 171.66 MiB。接入后的真实 `npm run start` 因保留 npm 父进程与即时构建步骤，收益收敛为启动降低 36.41%、入口 RSS 降低 105.97 MiB，仍明显超过 10% 或 20 MiB 门槛。app-server 子树均单独统计，不计入入口 RSS；正式三轮 app-server RSS 为 145.54、145.46、145.40 MiB。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
|---|---|---|---|
| 2026-07-24 | 只读源码盘点 | CLI 与源码生产入口 | CLI 已由 esbuild 打成 `dist/cli/codex-web.mjs`；只有 `npm run start` 仍依赖运行时 `tsx` |
| 2026-07-24 | 临时 POC，隔离 `CODEX_HOME`，各 3 轮 | 当前 `npm run start` vs 直接预编译入口 | 启动中位数 2119.71 ms → 1094.79 ms；入口 RSS 中位数 272.78 MiB → 101.13 MiB；三轮方向一致，达到保留门槛 |
| 2026-07-24 | Vitest | 构建接线与 `dist` 路径解析 | 先红后绿；2 个测试文件、7 项通过 |
| 2026-07-24 | 正式入口，隔离 `CODEX_HOME`，3 轮 | 接线后 `npm run start` | 启动中位数 1347.94 ms，入口 RSS 中位数 166.82 MiB；相对旧入口降低 36.41% 和 105.97 MiB，三轮方向一致；每轮结束 3102 均释放 |
| 2026-07-24 | 全量验证 | typecheck、unit、build、bridge smoke | `npm run test`：128 个文件、596 项通过；`npm run build` 与 `npm run build:cli` 通过；Smoke 读取 5 个模型，账号来源为 `app-server.account/read` |
| 2026-07-24 | pack dry-run 与实际 tgz | 发布清单 | dry-run 1634 个条目，压缩 17,069,691 bytes、解包 74,666,271 bytes；bundle、CLI 与启动器均在包内 |
| 2026-07-24 | 全新临时安装，仓库外 cwd | 安装包反例与启动 | 包内存在 bundle/启动器，不存在构建器/TypeScript 源入口；`--help` 与 `--version` 正常；应用根目录指向安装包，cwd 保持外部目录，`/login` 200，app-server 使用隔离 `CODEX_HOME`；停止后 3103 释放 |
