# 全局搜索 app-server 接线执行计划

> **执行要求：** 按任务逐项实现并更新 checklist；实现必须遵守 app-server 事实源、CodexWeb UI 基准和隔离 `CODEX_HOME` 规则。

**目标：** 移除全局搜索对不存在的 `/api/search` 的依赖，将会话和文件搜索分别接到 `thread/list` 与 `fuzzyFileSearch`，并将历史消息全文搜索明确显示为不支持。

**架构：** 在 `src/codex-web/global-search-adapter.ts` 集中处理 app-server 请求参数和协议结果到 UI 模型的映射，`GlobalSearchDialog.tsx` 只负责查询范围、并发请求、过期结果保护和展示。消息搜索不发请求、不读取本地数据库，也不从已加载消息伪装全量能力。

**技术栈：** React 19、TypeScript、Codex app-server JSON-RPC、Vitest、Next.js、Playwright smoke。

## 全局约束

- 会话来源必须是 `app-server.thread/list`。
- 文件来源必须是 `app-server.fuzzyFileSearch`。
- app-server 没有历史消息全文搜索接口时，UI 必须显示 unsupported。
- 不新增旧 REST 兼容路由，不修改 `/home/rrssnas/code/CodexWeb`。
- 所有测试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### 任务 1：搜索协议适配器

**文件：**
- 新建：`src/codex-web/global-search-adapter.ts`
- 新建：`src/codex-web/global-search-adapter.test.ts`

**接口：**
- `buildGlobalThreadSearchParams(query)` 生成 `thread/list` 的标题子串查询参数。
- `threadToGlobalSearchSession(thread)` 将真实 Thread 映射为会话结果。
- `buildGlobalFileSearchRoots(workingDirectory, threads)` 生成去重、非空的文件搜索根目录。
- `fuzzyFileToGlobalSearchResult(file, threads, activeThreadId)` 将 fuzzy 结果关联到可导航会话。

- [x] 先写会话参数、会话映射、根目录去重、文件映射和不可导航反例测试。
- [x] 运行 `npm run test -- src/codex-web/global-search-adapter.test.ts`，确认测试先失败。
- [x] 实现最小适配器并再次运行定向测试，确认通过。

### 任务 2：对话框真实接线与 unsupported 展示

**文件：**
- 修改：`src/components/layout/GlobalSearchDialog.tsx`
- 修改：`src/i18n/zh.ts`
- 修改：`src/i18n/en.ts`
- 新建：`src/codex-web/global-search-wiring.test.ts`

**接口：**
- 消费 `useAppServerActions().listThreads` 和 `fuzzyFileSearch`。
- 消费 `useAppServerState().threads` 及 `usePanel()` 当前工作目录/会话。
- 保留 `session:`、`file:`、`message:` 范围前缀；`message:` 只显示不支持说明。

- [x] 写接线反例测试：不存在 `/api/search`，消息范围不发真实搜索请求，普通范围同时包含真实会话/文件入口。
- [x] 使用查询序号屏蔽异步过期结果，并按 scope 只调用必要能力。
- [x] 添加中英文 unsupported、无文件根目录和搜索失败文案。
- [x] 运行定向测试并检查 TypeScript。

### 任务 3：集成验证与记录

**文件：**
- 修改：`docs/exec-plans/completed/2026-07-18-global-search-app-server.md`

- [x] 使用 Node 24 与隔离 `CODEX_HOME` 运行 `npm run test`。
- [x] 运行 `npm run build`。
- [x] 启动应用并运行 `npm run test:smoke`，验证普通查询路径；反例确认 `message:` 显示 unsupported 且网络层没有 `/api/search`。
- [x] 更新状态总览、决策日志与 Smoke Ledger。

## 状态总览

- 当前状态：Code complete、Tests pass、Smoke passed。
- 用户影响：全局搜索不再请求缺失的 REST；会话与文件使用真实 app-server 能力，历史消息全文搜索明确降级。

## 决策日志

- 2026-07-18：确认生成协议含 `thread/list` 和 `fuzzyFileSearch`，不含历史消息全文搜索方法。
- 2026-07-18：文件搜索根目录来自当前工作目录与已加载 `thread/list` 的 cwd，结果必须关联真实 thread 后才可导航。
- 2026-07-18：`fuzzyFileSearch` 使用固定 `cancellationToken=global-search-dialog`，新查询由 app-server 取消同 token 的旧查询；UI 查询序号继续阻止过期结果回写。
- 2026-07-18：用户确认后，计划文件已移动到 `completed/`。

## Smoke Ledger

- 2026-07-18 正例：浏览器输入 `session:动态`，展示来自 `thread/list` 的 3 条真实会话结果；输入 `file:GlobalSearchDialog`，展示 `fuzzyFileSearch` 命中的 `GlobalSearchDialog.tsx`。
- 2026-07-18 反例：浏览器输入 `message:动态`，只展示“app-server 暂不提供历史消息全文搜索接口”，不展示伪消息结果；Playwright 网络筛选确认没有 `/api/search` 请求。
- 2026-07-18 自动验证：定向测试 2 个文件、11 项断言通过；`npm run test`、`npm run build`、`npm run test:smoke` 在隔离 `CODEX_HOME` 下成功。
- 2026-07-18 已知噪声：浏览器控制台存在本次改动前已有的 `/api/git/status`、`/api/settings/app`、`/api/setup` 404，不属于全局搜索链路。
