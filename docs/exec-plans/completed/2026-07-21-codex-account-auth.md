# Codex 账户登录与退出实施计划

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** 让 Codex 设置页完全通过 app-server 账户协议完成状态检查、ChatGPT 授权、API Key 登录、取消和退出，并准确响应登录完成通知。

**Architecture:** `AppServerProvider` 继续作为唯一账户状态所有者，在启动和账户通知后通过 `account/read` 获取事实状态，并保存 `account/login/completed` 的原始结果。`CodexSection` 只消费 Provider 状态与 action，通过登录 ID 关联当前授权流程，不在浏览器持久化凭据或构造账户状态。

**Tech Stack:** React 19、TypeScript、Codex app-server generated schema、Vitest、Next.js。

## Global Constraints

- 开发、测试和页面验证必须使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 账户状态只能来自 `app-server.account/read`、`account/updated` 和 `account/login/completed`。
- API Key 只作为 `account/login/start` 的瞬时输入，不得写入浏览器存储、日志或截图。
- 不得调用 `/api/codex/account`、`/api/codex/status`、`/api/codex/login` 或 `/api/codex/rate-limits`。
- 不改变 CodexWeb 设置页整体布局与视觉结构。

---

### Task 1: 登录完成通知适配

**Files:**
- Create: `src/codex-web/account-login-adapter.ts`
- Create: `src/codex-web/account-login-adapter.test.ts`
- Modify: `src/codex-web/app-server-state.ts`

**Interfaces:**
- Consumes: `JsonRpcNotification` 与 generated `AccountLoginCompletedNotification`。
- Produces: `readAccountLoginCompletion(notification)` 和 `isAccountLoginCompletionFor(loginStart, completion)`。

- [x] **Step 1: 编写失败测试**

  覆盖成功、失败、非登录通知、ChatGPT 登录 ID 匹配和不匹配。

- [x] **Step 2: 运行测试确认失败**

  Run: `npm exec vitest run -- src/codex-web/account-login-adapter.test.ts`

  Expected: 因适配器尚不存在而失败。

- [x] **Step 3: 实现最小适配器与状态字段**

  `readAccountLoginCompletion` 只接受 `account/login/completed`；匹配函数对 ChatGPT/browser 与 device-code 使用 `loginId` 精确关联。

- [x] **Step 4: 运行测试确认通过**

  Run: `npm exec vitest run -- src/codex-web/account-login-adapter.test.ts`

  Expected: 全部用例通过。

### Task 2: Provider 账户事实状态闭环

**Files:**
- Modify: `src/codex-web/AppServerProvider.tsx`
- Modify: `src/codex-web/codex-settings-app-server-wiring.test.ts`

**Interfaces:**
- Consumes: `account/read`、`account/login/start`、`account/login/cancel`、`account/logout`、`account/updated`、`account/login/completed`。
- Produces: `state.account`、`state.accountLoginCompletion` 以及现有账户 actions。

- [x] **Step 1: 增加失败接线断言**

  断言 Provider 保存 generated 登录完成通知，并且退出后调用 `account/read`，不写入伪造的 `{ account: null, requiresOpenaiAuth: true }`。

- [x] **Step 2: 运行定向测试确认失败**

  Run: `npm exec vitest run -- src/codex-web/codex-settings-app-server-wiring.test.ts`

  Expected: 登录完成状态和退出回读断言失败。

- [x] **Step 3: 实现通知与退出回读**

  登录开始前清空旧完成结果；完成通知立即写入 sourced state，成功时回读账户；`account/updated` 始终回读账户；退出响应后再执行 `account/read`。

- [x] **Step 4: 运行定向测试确认通过**

  Run: `npm exec vitest run -- src/codex-web/codex-settings-app-server-wiring.test.ts`

  Expected: 接线断言全部通过。

### Task 3: Codex 设置页状态与交互

**Files:**
- Modify: `src/components/settings/CodexSection.tsx`
- Modify: `src/codex-web/codex-settings-app-server-wiring.test.ts`

**Interfaces:**
- Consumes: `state.connection`、`state.account`、`state.accountLoginCompletion` 和账户 actions。
- Produces: 检查中、无需登录、未登录、ChatGPT/API Key/Bedrock 已登录、授权等待、失败和取消 UI。

- [x] **Step 1: 增加状态反例断言**

  断言 `state.account === null` 时显示检查中且不展示登录表单；已检查且 `account === null` 时才展示登录入口。

- [x] **Step 2: 实现最小 UI 状态机**

  OAuth 完成通知匹配当前 `loginId` 后自动收口；失败显示 app-server error；API Key 成功后清空输入并回读账户；额度只对 ChatGPT 账户读取；断线时禁用账户操作。

- [x] **Step 3: 运行账户定向测试**

  Run: `npm exec vitest run -- src/codex-web/account-login-adapter.test.ts src/codex-web/codex-settings-app-server-wiring.test.ts`

  Expected: 正反例全部通过。

### Task 4: 完整验证与交付

**Files:**
- Modify and move: `docs/exec-plans/active/2026-07-21-codex-account-auth.md` to `docs/exec-plans/completed/2026-07-21-codex-account-auth.md`
- Create: `/volume2/SSD/codex/Temp/codex-openai-login-settings.png`

**Interfaces:**
- Produces: 测试、构建、页面验证结果和 OpenAI 授权相关截图。

- [x] **Step 1: 运行完整验证**

  Run: `npm run test`

  Expected: typecheck 与全部 Vitest 测试通过。

  Run: `npm run build`

  Expected: Next.js 生产构建通过。

- [x] **Step 2: 启动隔离应用并检查设置页**

  Run: `npm run dev`

  Expected: `/settings/codex` 可访问，账户状态与连接状态一致，console 无本次改动引入的错误。

- [x] **Step 3: 验证正例与反例并截图**

  正例：真实浏览器识别隔离环境中已存在的 API Key 登录，并显示退出入口；OAuth 成功、失败、取消和登录 ID 串线通过 generated 通知单测验证。

  反例：普通未登录状态不显示授权等待；API Key 为空不会发请求；未连接时不能登录或退出。

- [x] **Step 4: 更新状态与归档**

  填写状态总览、决策日志和 Smoke Ledger，然后把计划移动到 `docs/exec-plans/completed/`。

## 状态总览

- 当前状态：`Code complete`、`Tests pass`、`Smoke passed`、`Review passed`。

## 决策日志

- 2026-07-21：以 generated `AccountLoginCompletedNotification` 的 `{ loginId, success, error }` 为登录流程收口依据。
- 2026-07-21：退出后必须重新调用 `account/read`，禁止根据 UI 预期构造账户状态。
- 2026-07-21：已有隔离环境保存了 API Key；为避免破坏该凭据，不为截图执行真实退出或 OAuth 回调。

## Smoke Ledger

- 失败测试：适配器缺失、设置页无检查态、Provider 不保存完成通知和退出伪造状态的断言均按预期失败。
- 定向测试：2 个测试文件、6 项测试通过，覆盖完成通知成功/失败、非账户通知、ChatGPT 登录 ID 匹配/不匹配与 API Key `loginId: null`。
- 全量测试：`npm run test` 的 typecheck 通过；Vitest 99 个测试文件、478 项测试通过。
- 生产构建：`npm run build` 通过，22 个路由生成成功；保留既有 `theme/loader.ts` NFT trace 警告。
- Bridge smoke：`npm run test:smoke` 通过，使用隔离 `CODEX_HOME`，读取 7 个模型，账户来源为 `app-server.account/read`。
- 浏览器正例：`/settings/codex` 显示 app-server 已连接、`API Key 已登录` 和退出入口，页面布局无重叠。
- 浏览器反例：Resource Timing 中不存在 `/api/codex/account`、`/api/codex/status`、`/api/codex/login` 或 `/api/codex/rate-limits` 请求。
- 既有噪声：页面仍请求不存在的 `/api/settings/app` 并返回 404；该请求不属于 Codex 账户接线，本次未修改。
- 未执行：没有使用真实 OpenAI 账户完成 OAuth 回调；隔离环境已有 API Key，避免为截图破坏现有凭据。
- 截图：`/volume2/SSD/codex/Temp/codex-openai-login-settings.png`。
