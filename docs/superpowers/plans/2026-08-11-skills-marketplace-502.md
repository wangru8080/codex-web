# 技能市场 502 修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复技能市场因废弃的匿名 Skills.sh 接口和不完整 CLI 兜底导致的 502。

**Architecture:** 有 Skills.sh token 时调用官方 `/api/v1` API；无 token 时直接使用现有 `skills` CLI 作为唯一搜索来源。CLI 兜底支持空查询（映射为 `skill`）并设置进程超时，避免首屏请求永久等待。

**Tech Stack:** Next.js Route Handler、Node.js child_process、Vitest。

## Global Constraints

- 默认测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不新增第三方依赖，不保存 OAuth/API 凭据到浏览器。
- 用户可见数据必须来自 Skills.sh API 或 `skills` CLI。
- 代码、测试、文档说明使用简体中文。

---

### Task 1: 锁定搜索路由行为

**Files:**
- Modify: `src/app/api/skills/marketplace/search/route.test.ts`

- [x] **Step 1: 添加匿名搜索和空查询的失败回归测试**

断言匿名请求不再调用废弃的 `/api/search`，并在上游不可用时调用 CLI fallback；空查询也必须进入 fallback。

- [x] **Step 2: 添加 token API 路径测试**

断言设置 `SKILLS_SH_API_TOKEN` 时查询请求调用 `/api/v1/skills/search` 并带 `Authorization`。

- [x] **Step 3: 运行 targeted test 验证新测试失败**

运行：`npm run test -- --run src/app/api/skills/marketplace/search/route.test.ts`

预期：现有实现因仍调用 `/api/search` 或跳过空查询 fallback 而失败。

### Task 2: 实现最小修复

**Files:**
- Modify: `src/app/api/skills/marketplace/search/route.ts`

- [x] **Step 1: 移除匿名旧 API 分支**

仅 token 存在时构造 `/api/v1/skills/search` 或 `/api/v1/skills`；匿名请求直接调用 CLI fallback。

- [x] **Step 2: 让 CLI fallback 支持空查询和超时**

空查询使用 `skill` 作为 CLI 查询词；子进程超过 15 秒时终止并返回 502，保留现有错误信息结构。

- [x] **Step 3: 运行 targeted test 验证通过**

运行：`npm run test -- --run src/app/api/skills/marketplace/search/route.test.ts`

预期：该测试文件全部通过。

### Task 3: 完成验证

**Files:**
- No additional files.

- [x] **Step 1: 运行类型检查和相关单元测试**

运行：`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test -- --run src/app/api/skills/marketplace/search/route.test.ts src/lib/tests/skills-marketplace.test.ts`

预期：类型检查通过，所有列出的测试通过。

- [x] **Step 2: 检查工作区改动范围**

运行：`git status --short`

预期：只包含本计划文档、搜索路由和搜索路由测试的改动。

### Task 4: 兼容新版 skills CLI 输出

**Files:**
- Modify: `scripts/skills-marketplace-search.mjs`

- [x] **Step 1: 复现真实 CLI 输出格式**

在隔离目录中运行 `npx --yes skills find ponytail`，确认新版输出在 `owner/repo@skill` 后追加安装量文本。

- [x] **Step 2: 扩展结果行解析规则**

允许技能标识后存在空格和安装量文本，同时保持前两组分别为仓库来源与技能名。

- [x] **Step 3: 运行真实 fallback 脚本验证 JSON 输出**

运行：`node scripts/skills-marketplace-search.mjs ponytail 5`

预期：输出 JSON，`skills` 包含 5 条结果，第一条为 `dietrichgebert/ponytail@ponytail`。

验证结果：隔离环境下 4.1 秒完成，退出码 0，返回 5 条结果；普通查询能返回结果，反例超时路径由路由测试验证为 502。

### Task 5: 防止初始请求覆盖用户搜索

**Files:**
- Modify: `src/components/skills/MarketplaceBrowser.tsx`

- [x] **Step 1: 复现请求竞态**

浏览器打开市场后立即输入 `ponytail`，观察空查询和关键词查询均返回 200，但较晚完成的空查询覆盖关键词结果。

- [x] **Step 2: 只允许最后一次请求更新状态**

为搜索请求增加递增序号；旧请求完成时不得更新结果、错误或 loading。

- [x] **Step 3: 重新构建并复测浏览器**

预期：快速输入后仍显示 `ponytail`，市场 API 全部返回 200，详情页无 502，console 无异常。

验证结果：`build:cli` 通过；隔离生产实例中快速输入后结果可见，三个搜索请求均返回 200，详情页打开成功，无 502 或 console 异常。
