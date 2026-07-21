# Web 本地偏好与旧设置接口清理实施计划

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** 不实现 `/api/settings/app`，把语言和默认面板改为浏览器本地偏好，并移除主题与预览中的旧接口引用。

**Architecture:** 新增一个小型 `app-preferences` 模块，集中管理 Web 专属的 `locale` 与 `defaultPanel` localStorage 键、值校验和不可用回退。主题模式继续由 `next-themes` 持久化，主题系列继续由 `ThemeFamilyProvider` 持久化；这些 Web 偏好不进入 Codex app-server。

**Tech Stack:** React 19、TypeScript、Next.js、Vitest、浏览器 localStorage。

## Global Constraints

- 开发、测试与 smoke 必须使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不新增 `/api/settings/app` route 或其它服务端设置存储。
- 不把语言、主题、字体或默认面板写入 Codex app-server。
- 不改变 CodexWeb 设置页整体布局与视觉结构。
- 不执行删除命令，不修改真实 `CODEX_HOME`。

---

### Task 1: 本地偏好模块

**Files:**
- Create: `src/lib/app-preferences.ts`
- Create: `src/lib/app-preferences.test.ts`

**Interfaces:**
- Produces: `readLocalePreference()`、`writeLocalePreference(locale)`、`readDefaultPanelPreference()`、`writeDefaultPanelPreference(panel)`。
- Values: locale 为 `en | zh`；default panel 为 `none | file_tree | git`。

- [x] **Step 1: 编写失败测试**

  覆盖有效值读写、无效值回退、localStorage 缺失和读写抛错。

- [x] **Step 2: 运行测试确认失败**

  Run: `npm exec vitest run -- src/lib/app-preferences.test.ts`

  Expected: 因模块尚不存在而失败。

- [x] **Step 3: 实现最小模块**

  使用 `codex-web:locale` 与 `codex-web:default-panel` 两个独立键；所有访问捕获浏览器禁用存储或隐私模式异常。

- [x] **Step 4: 运行测试确认通过**

  Run: `npm exec vitest run -- src/lib/app-preferences.test.ts`

  Expected: 全部用例通过。

### Task 2: 设置页与聊天页改接本地偏好

**Files:**
- Modify: `src/components/layout/I18nProvider.tsx`
- Modify: `src/components/settings/GeneralSection.tsx`
- Modify: `src/app/chat/[id]/page.tsx`
- Modify: `src/components/settings/AppearanceSection.tsx`
- Modify: `src/frontend-preview/mock-api.ts`
- Create: `src/codex-web/app-settings-local-preferences-wiring.test.ts`

**Interfaces:**
- Consumes: Task 1 的四个读写函数。
- Produces: 浏览器独立的语言和默认面板；主题继续复用既有本地持久化；生产源码不再请求 `/api/settings/app`。

- [x] **Step 1: 编写失败接线测试**

  断言五个调用方和 preview mock 均不包含 `/api/settings/app`，语言与默认面板调用本地偏好函数，外观页不再包含 `persistThemeSetting`。

- [x] **Step 2: 运行接线测试确认失败**

  Run: `npm exec vitest run -- src/codex-web/app-settings-local-preferences-wiring.test.ts`

  Expected: 旧 fetch 与 mock 分支断言失败。

- [x] **Step 3: 实现最小改接**

  `I18nProvider` 首次读取本地 locale，没有值时按浏览器语言初始化并保存；`GeneralSection` 与历史聊天页共享默认面板；`AppearanceSection` 只调用既有主题 Provider；preview 删除旧 mock 分支。

- [x] **Step 4: 运行定向测试确认通过**

  Run: `npm exec vitest run -- src/lib/app-preferences.test.ts src/codex-web/app-settings-local-preferences-wiring.test.ts`

  Expected: 本地偏好与接线断言全部通过。

### Task 3: 完整验证与归档

**Files:**
- Modify and move: `docs/exec-plans/active/2026-07-21-local-app-preferences.md` to `docs/exec-plans/completed/2026-07-21-local-app-preferences.md`

**Interfaces:**
- Produces: 类型、测试、构建、bridge smoke、浏览器正反例结果。

- [x] **Step 1: 运行完整自动化验证**

  Run: `npm run test`

  Expected: typecheck 与 Vitest 全部通过。

  Run: `npm run build`

  Expected: Next.js 生产构建通过。

  Run: `npm run test:smoke`

  Expected: 隔离 app-server bridge smoke 通过。

- [x] **Step 2: 浏览器验证**

  启动隔离应用，打开设置页；Network/Resource Timing 不得出现 `/api/settings/app`，页面仍能读取默认设置。历史聊天页接线由定向测试和生产源码扫描验证，避免干扰现有聊天任务。

- [x] **Step 3: 记录反例**

  localStorage 无效 locale 不得覆盖浏览器语言检测；无效默认面板必须回退 `file_tree`；主题切换不得产生 REST 请求。

- [x] **Step 4: 更新状态与归档**

  填写状态总览、决策日志和 Smoke Ledger，确认 completed 目标无同名文件后移动计划。

## 状态总览

- 当前状态：Code complete、Tests pass、Smoke passed、Review passed。
- 用户影响：语言、主题、字体和默认面板仅保存在当前浏览器；设置页和历史聊天页不再请求不存在的 `/api/settings/app`。

## 决策日志

- 2026-07-21：Web UI 偏好由当前浏览器拥有，不属于 Codex app-server 事实状态。
- 2026-07-21：主题模式与主题系列已有本地持久化，只移除重复 REST 写入。
- 2026-07-21：默认面板没有已保存值或值无效时回退 `file_tree`；语言没有已保存值或值无效时继续使用浏览器语言检测。
- 2026-07-21：浏览器验收只复用专用设置页标签，不操作现有聊天任务；历史聊天页改接由 Vitest 接线断言和生产源码扫描覆盖。

## Smoke Ledger

- 失败测试：本地偏好模块尚未创建时，模块测试按预期失败；旧 fetch、主题持久化 helper 和 preview mock 仍存在时，接线测试按预期失败。
- 定向测试：`src/lib/app-preferences.test.ts`、`src/codex-web/app-settings-local-preferences-wiring.test.ts` 与移动端历史页回归测试共 3 个文件、11 个用例通过。
- 完整测试：隔离 `CODEX_HOME` 下 `npm run test` 通过，共 101 个测试文件、485 个用例。
- 生产构建：`npm run build` 通过，共生成 22 个路由；保留既有 theme loader Turbopack NFT trace 警告，不影响本次功能。
- Bridge smoke：隔离 `CODEX_HOME` 下 `npm run test:smoke` 通过，模型数为 7，账号状态来源为 `app-server.account/read`。
- 浏览器正例：生产服务的通用与外观设置页正常渲染，读取本地语言偏好 `zh`，控制台无错误。
- 浏览器反例：Network 与 Resource Timing 均未出现 `/api/settings/app`；未保存默认面板时 localStorage 键保持为空，由读取函数回退 `file_tree`，未伪造持久化值。
- 源码反例：生产源码扫描未发现 `/api/settings/app`；主题仍调用既有 Provider，历史聊天页读取本地默认面板。
