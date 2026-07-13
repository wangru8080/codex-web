# Web App-Server REST Noise Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or equivalent task-by-task execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在生产模式默认真实路由下，清理会影响 Goal/Plan 验证的旧 CodexWeb REST 404 噪声，并把可替换的数据源收敛到 codex app-server。

**Architecture:** Web UI 继续以 `AppServerProvider` 中的 app-server request/notification state 为事实源。Phase 1 只处理优先级 1-3：禁用纯噪声旧轮询、让 Codex-only 模型列表使用 `app-server.model/list`、让左侧历史列表在 app-server connected 时只走 `thread/list` adapter；`/api/setup`、`/api/settings/app`、`/api/files/browse` 等 Web 本地体验层留到后续阶段。

**Tech Stack:** Next.js App Router, React hooks, Vitest, codex app-server generated protocol types.

## Global Constraints

- 默认开发、测试、smoke 使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 生产模式未显式设置 `CODEX_WEB_DEMO=1` 时不得走 demo/mock REST。
- Goal/Plan UI 状态必须来自 app-server source breadcrumb，不写 Web 私有假状态。
- 不直接修改 `/home/rrssnas/code/CodexWeb`。
- 步骤 4 暂不动：`/api/setup`、`/api/settings/app`、`/api/files/browse` 保持现状。

---

## Task 1: 禁用旧任务通知和更新检查 REST 噪声

**Files:**
- Modify: `src/hooks/useNotificationPoll.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Test: targeted `rg` 检查，确保默认 Web 生产路径不再轮询 `/api/tasks/notify` 和 `/api/app/updates`

**Interfaces:**
- Consumes: app-server notification stream from `AppServerProvider`
- Produces: no-op legacy task notification poll in Codex app-server Web mode

- [x] **Step 1: 让 `useNotificationPoll` 在 Codex Web 模式下不启动轮询**

  Implementation:
  - 保留 hook 导出，避免调用方改动过大。
  - 默认不请求浏览器 Notification 权限。
  - 默认不调用 `/api/tasks/notify` 或 `/api/tasks/notify/ack`。

- [x] **Step 2: 禁用 `/api/app/updates` 自动检查**

  Implementation:
  - 在 `AppShell` 中保留 update 状态 UI 变量，但默认不 fetch `/api/app/updates`。
  - 不影响已有布局和设置入口。

- [x] **Step 3: 验证**

  Run:
  ```bash
  rg -n "api/tasks/notify|api/app/updates" src
  npm run test
  ```

  Expected:
  - 只有禁用说明或非默认 legacy 代码引用。
  - 测试通过。

## Task 2: Codex-only 模型列表替换为 app-server `model/list`

**Files:**
- Modify: `src/hooks/useProviderModels.ts`
- Test: `src/codex-web/app-server-model-groups.test.ts`

**Interfaces:**
- Consumes: `ModelListResponse` from `app-server.model/list`
- Produces: Codex-only `ProviderModelGroup` with provider id `codex_account`

- [x] **Step 1: 添加纯函数 adapter**

  Implementation:
  - 新增小函数，把 app-server model items 映射成 `ProviderModelGroup`。
  - 保持 `value` 为 model id，`label` 为 display name 或 id。
  - 不伪造非 app-server provider group。

- [x] **Step 2: 让 `useProviderModels(..., { codexOnly: true })` 优先使用 `useAppServerState().models`**

  Implementation:
  - app-server connected 且有 `models` 时直接更新 provider groups。
  - 不再 fetch `/api/codex/models`。
  - app-server 未连接时返回空组和 `fetchState='idle'` 或 `failed`，由调用方保持加载/不可发送状态。

- [x] **Step 3: 验证**

  Run:
  ```bash
  npm run test -- src/codex-web/app-server-model-groups.test.ts
  npm run test
  ```

  Expected:
  - adapter 测试覆盖隐藏模型过滤和默认模型。
  - 全量测试通过。

## Task 3: 左侧历史列表收敛到 app-server thread adapter

**Files:**
- Modify: `src/components/layout/ChatListPanel.tsx`
- Test: existing app-server history adapter tests

**Interfaces:**
- Consumes: `useAppServerState().threads` and `refreshThreads()`
- Produces: `ChatSession[]` via `threadToChatSession`

- [x] **Step 1: app-server connected 时只读 `thread/list`**

  Implementation:
  - 保留 `refreshThreads()`。
  - 删除 connected 路径下对 `/api/chat/sessions` 与 `/api/codex/sessions?cwd=...` 的 fallback。
  - 周期刷新只在 app-server connected 时调用 `refreshThreads()`；未连接时不打旧 REST。

- [x] **Step 2: 禁用旧 session 创建/删除/重命名 REST 在 app-server thread 上的操作**

  Implementation:
  - `read_only` 或 app-server thread 来源的会话不调用 `/api/chat/sessions/:id`。
  - 新建项目会话继续走 `/chat?cwd=` 或新聊天页路径，不 POST `/api/chat/sessions`。

- [x] **Step 3: 验证**

  Run:
  ```bash
  npm run test
  npm run build
  ```

  Expected:
  - 左侧列表显示来自 app-server `thread/list` 的历史。
  - 默认生产模式不再请求 `/api/chat/sessions` 和 `/api/codex/sessions`。

## Deferred Task 4: Web 本地体验层

暂不执行：
- `/api/setup`
- `/api/settings/app`
- `/api/files/browse`
- 最近项目、主题/语言、文件夹选择器和 Web 本地设置存储
- 右侧工作区旧 REST：`/api/git/status`、`/api/tasks?session_id=...`、`/api/settings/workspace`

## Smoke Ledger

- [x] `npm run test`：34 files / 161 tests passed，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`
- [x] `npm run build`：普通沙箱因 Turbopack EPERM 失败；提权重跑通过，仅有既有 `next.config.mjs` / `theme/loader.ts` NFT warning
- [x] 真实浏览器生产模式：`CODEX_HOME=/volume2/SSD/codex/Temp/codex-start-home npm run start`
- [x] console 检查：`/api/tasks/notify`、`/api/app/updates`、`/api/codex/models`、`/api/codex/sessions`、`/api/chat/sessions*`、`/api/providers/models` 已从本轮 `/chat` 与详情页验证中消失；`/api/setup`、`/api/settings/app`、`/api/files/browse`、`/api/git/status`、`/api/tasks?session_id=...`、`/api/settings/workspace` 记录为 deferred。
