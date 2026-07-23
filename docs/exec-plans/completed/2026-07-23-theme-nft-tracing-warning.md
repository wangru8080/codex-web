# 主题 NFT 追踪警告修复执行计划

> **执行要求：** 按任务逐项实现并更新复选框；测试和 smoke 显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，不自动提交或推送。
>
> 关联交接：[2026-07-23-runtime-path-decoupling.md](../../handover/2026-07-23-runtime-path-decoupling.md)

**目标：** 消除主题动态文件读取导致的 Turbopack NFT 宽范围追踪警告，同时确保主题 JSON 被精确纳入未来 standalone 产物。

**架构：** 主题目录仍在运行时解析，以保留 Electron、应用根目录和开发 cwd 的现有行为。动态文件访问使用 Turbopack 官方支持的忽略提示阻止保守宽追踪，Next 配置通过 `outputFileTracingIncludes` 明确包含 `themes/**/*.json`。

**技术栈：** Next.js 16.2.10、Turbopack、Node.js 文件系统 API、TypeScript、Vitest。

## 全局约束

- 不修改 `/home/rrssnas/code/CodexWeb`。
- 不删除文件，不使用真实 `CODEX_HOME`。
- 不硬编码主题文件清单，不移除 Electron 外部资源目录能力。
- 追踪 include 只允许覆盖 `themes/**/*.json`。
- 不自动提交或推送 Git。

---

### 任务 1：限制主题动态追踪

**文件：**
- 修改：`src/lib/theme/loader.ts`
- 修改：`src/lib/theme/loader.test.ts`

**接口：**
- 输入：运行时主题目录。
- 输出：按原有校验和排序规则加载的 `ThemeFamily[]`。

- [x] 在动态 `existsSync`、`readdirSync` 和 `readFileSync` 路径参数上添加 `turbopackIgnore`。
- [x] 保持无目录、无默认主题和非法主题时的既有回退行为。
- [x] 添加仓库主题加载测试，断言 12 个主题、唯一 id、按 order 排序且包含 default。
- [x] 运行主题定向测试并确认通过。

### 任务 2：精确包含主题资源

**文件：**
- 修改：`next.config.mjs`

**接口：**
- 输入：Next route output tracing。
- 输出：所有 Node route 的 NFT manifest 精确包含 `themes/**/*.json`。

- [x] 添加 `outputFileTracingIncludes`，路由 glob 为 `/*`，资源 glob 仅为 `./themes/**/*.json`。
- [x] 运行生产构建并确认没有 `Turbopack build encountered` 或 NFT warning。
- [x] 检查 `.next/server/**/*.nft.json`，确认主题文件被追踪且 `next.config.mjs` 未因主题加载器意外进入 route manifest。

### 任务 3：回归与文档收口

**文件：**
- 修改：`docs/handover/2026-07-23-runtime-path-decoupling.md`
- 更新：`docs/exec-plans/active/2026-07-23-theme-nft-tracing-warning.md`

**接口：**
- 输入：构建输出、NFT manifest、测试结果。
- 输出：修复决策、验证记录和已归档计划。

- [x] 使用隔离环境运行 `npm run test`。
- [x] 使用隔离环境运行 `npm run test:smoke`。
- [x] 运行 `git diff --check`。
- [x] 更新交接文档和 Smoke Ledger。
- [x] 将本计划移动到 `docs/exec-plans/completed/`。

## 决策日志

- 2026-07-23：不静态导入或手工维护 12 个主题文件，保留运行时主题目录能力。
- 2026-07-23：忽略动态推断与显式 include 必须成对使用，既避免整仓追踪，也避免 standalone 漏掉主题 JSON。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
|---|---|---|---|
| 2026-07-23 | Next.js 16.2.10 生产构建 | 修复前基线 | 构建成功，但 `theme/loader.ts` 触发 NFT 宽追踪警告 |
| 2026-07-23 | Vitest，隔离 `CODEX_HOME` | 主题定向测试 | 1 个文件、4 项通过；12 个主题、唯一 id、排序和 default 均符合预期 |
| 2026-07-23 | Next.js 16.2.10 生产构建 | `npm run build` | 构建成功，无 Turbopack/NFT warning |
| 2026-07-23 | 结构化 NFT manifest 检查 | route 主题资源与误追踪反例 | 根页面包含 12 个主题 JSON；全部 manifest 中 `next.config.mjs` 为 0 |
| 2026-07-23 | Vitest，隔离 `CODEX_HOME` | `npm run test` | 114 个文件、543 项通过 |
| 2026-07-23 | 真实 app-server，隔离 `CODEX_HOME` | `npm run test:smoke` | 通过；models=7，accountSource=`app-server.account/read` |

## 状态总览

- `Code complete`
- `Tests pass`
- `Smoke passed`
