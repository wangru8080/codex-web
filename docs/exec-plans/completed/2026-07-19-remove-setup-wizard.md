# 移除首次设置弹窗实施计划

> **执行要求：** `writing-plans` 建议使用 `executing-plans` 子技能逐项实施；当前环境未提供该子技能，因此在本任务内按下列检查项顺序执行并逐项验证。

**目标：** 完整移除首次启动时显示的 SetupCenter 欢迎配置弹窗，并把仍有产品价值的配置入口统一接到 Codex 设置页。

**架构：** AppShell 不再维护设置弹窗状态，也不再读取 `/api/setup` 或监听 `open-setup-center`。聊天空态和发送失败路径直接导航到 `/settings/codex`；新聊天页的 `NewChatWelcome` 保持不变。

**技术栈：** React、TypeScript、Next.js、Vitest、Playwright。

## 全局约束

- 保留 `/chat` 新聊天欢迎态，不改变聊天布局、输入框或左右侧栏。
- 不保留无响应的 `open-setup-center` 事件发送端。
- 不执行删除命令；旧组件目录整体移动到 `/volume2/SSD/Trash/home/rrssnas/code/codex/web/src/components/setup/`。
- 开发和测试固定使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 所有文档、测试名称和新增说明使用中文。
- 不改 app-server 协议、数据库 schema 或 Codex 登录状态来源。

---

### 任务 1：锁定移除契约

**文件：**

- 新增：`src/codex-web/setup-center-removal.test.ts`

**接口：**

- 输入：AppShell、聊天空态、发送失败路径、关于页、i18n、共享类型和新聊天页源码。
- 输出：源码级接线契约，保证弹窗入口消失且 `/settings/codex` 成为替代入口。

- [x] **步骤 1：编写失败测试**

  测试断言 `AppShell.tsx` 不含 `SetupCenter`、`/api/setup` 和 `open-setup-center`，配置入口含 `/settings/codex`，`src/components/setup` 不存在，并保留 `NewChatWelcome`。

- [x] **步骤 2：验证测试在实现前失败**

  运行：

  ```bash
  npm exec vitest run -- src/codex-web/setup-center-removal.test.ts
  ```

  预期：FAIL，失败原因是旧 `SetupCenter`、事件发送端、组件目录和专用类型仍存在。

### 任务 2：移除运行时弹窗接线

**文件：**

- 修改：`src/components/layout/AppShell.tsx`
- 修改：`src/components/chat/ChatEmptyState.tsx`
- 修改：`src/lib/stream-session-manager.ts`
- 修改：`src/components/settings/AboutSection.tsx`
- 修改：`src/components/layout/ConnectionStatus.tsx`

**接口：**

- 旧输入：`open-setup-center` 自定义事件和 `/api/setup` 状态。
- 新输出：需要配置时通过 `window.location.assign('/settings/codex')` 或 `router.replace('/settings/codex')` 导航。

- [x] **步骤 1：移除 AppShell 弹窗状态**

  删除 `SetupCenter` 动态导入、`setupOpen`、`setupInitialCard`、首次 setup fetch、事件监听和条件渲染。旧 `#providers` 深链执行：

  ```ts
  history.replaceState(null, '', window.location.pathname + window.location.search);
  router.replace('/settings/codex');
  ```

- [x] **步骤 2：改接仍然有效的配置入口**

  聊天空态和 `NEEDS_PROVIDER_SETUP` 失败路径执行：

  ```ts
  window.location.assign('/settings/codex');
  ```

  关于页移除“重新进入安装向导”按钮；未被应用挂载的 `ConnectionStatus` 移除旧自动弹窗副作用。

- [x] **步骤 3：运行定向测试**

  运行：

  ```bash
  npm exec vitest run -- src/codex-web/setup-center-removal.test.ts
  ```

  预期：旧组件目录尚未移动时仍 FAIL，其余运行时接线断言通过。

### 任务 3：清理弹窗专用源码和语义

**文件：**

- 移动：`src/components/setup/`
- 修改：`src/types/index.ts`
- 修改：`src/i18n/en.ts`
- 修改：`src/i18n/zh.ts`
- 修改：`src/components/settings/ProviderManager.tsx`

**接口：**

- 移除：`SetupCardStatus`、`SetupState` 和仅由 `src/components/setup` 消费的 `setup.*` 翻译键。
- 保留：`chat.empty.openSetup`，其 UI 仍用于进入 Codex 设置页。

- [x] **步骤 1：移动旧组件目录**

  将目录整体移动到：

  ```text
  /volume2/SSD/Trash/home/rrssnas/code/codex/web/src/components/setup/
  ```

  移动后同时验证源目录不存在、Trash 新条目存在且包含 7 个 TSX 文件。

- [x] **步骤 2：移除孤儿类型、翻译和陈旧注释**

  删除 `SetupCardStatus`、`SetupState`、全部专用 `setup.*` 键和 `about.support.runSetupWizard`，更新 `about.support.desc`，并移除 ProviderManager 中对 SetupCenter 的过时注释引用。

- [x] **步骤 3：验证定向测试通过**

  运行：

  ```bash
  npm exec vitest run -- src/codex-web/setup-center-removal.test.ts
  ```

  预期：PASS。

### 任务 4：完整验证与计划归档

**文件：**

- 更新并移动：`docs/exec-plans/active/2026-07-19-remove-setup-wizard.md`

**接口：**

- 产出：测试结果、生产构建结果、浏览器正反例和剩余风险记录。

- [x] **步骤 1：运行完整测试和构建**

  运行：

  ```bash
  export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
  npm run test
  npm run build
  ```

  预期：类型检查、全部 Vitest 测试和 Next.js 生产构建通过。

- [x] **步骤 2：运行浏览器正反例验证**

  验证 `/chat` 不出现首次设置弹窗、关于页没有安装向导入口；反例验证新聊天欢迎语和输入框仍存在，缺少 provider 的按钮进入 `/settings/codex`。

- [x] **步骤 3：清理浏览器诊断产物**

  如果生成 `.playwright-mcp`，整体移动到独立 Trash 批次并验证新条目，不执行删除。

- [x] **步骤 4：记录 Smoke Ledger 并归档计划**

  写入实际运行结果和剩余风险，把计划移动到 `docs/exec-plans/completed/2026-07-19-remove-setup-wizard.md`。

## Smoke Ledger

- 失败优先验证：`src/codex-web/setup-center-removal.test.ts` 初次运行 3 条失败、1 条反例通过；失败点分别是 AppShell 仍加载弹窗、入口仍发送事件、旧组件目录仍存在。
- 定向测试：实现后 4 条全部通过，覆盖 AppShell、配置入口、孤儿语义和新聊天欢迎态反例。
- 完整测试：`npm run test` 通过，86 个测试文件、407 条测试全部通过。
- 生产构建：`npm run build` 在非沙箱环境通过，23 个页面生成成功；保留一条既有 next.config NFT 动态文件追踪警告。
- 浏览器正例：`/chat` 没有“欢迎使用 CodexWeb”“0/2 已完成”“跳过并进入”等首次设置弹窗内容，页面存在 textarea；网络请求中没有 `/api/setup`。
- 浏览器入口：关于页不再显示“重新进入安装向导”，支持说明更新；`/chat#providers` 在客户端完成跳转后进入 `/settings/codex`。
- 浏览器反例：`/chat` 仍显示新聊天欢迎语 “Good evening. Where should we start?” 和输入框，证明新聊天欢迎态未被连带移除。
- 已知噪声：设置页仍有 `/api/settings/app`、`/api/codex/account`、`/api/codex/status`、`/api/codex/rate-limits` 404，均为本次改动前已存在的后端接线问题；本次不扩展范围处理。
- 临时产物：18 个 Playwright 快照/日志已整体移动到 `/volume2/SSD/Trash/2026-07-19-remove-setup-wizard/home/rrssnas/code/codex/web/.playwright-mcp`。
