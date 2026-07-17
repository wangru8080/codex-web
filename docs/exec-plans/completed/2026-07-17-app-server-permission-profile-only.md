# App-server 权限 Profile 唯一管理执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留正式的 `full_access` app-server permission profile，移除旧 `dangerously_skip_permissions` 全局假开关，并确保 Web 不会自动响应 app-server approval。

**Architecture:** `full_access`、`auto_approval`、`request_approval` 和 `config` 继续通过 `AppServerProvider` 转换为 app-server 的 thread/turn 权限参数。设置页不再维护独立的全局跳过开关；app-server 一旦发出 server request，Web 仅展示请求并等待用户决定。

**Tech Stack:** Next.js 16、React 19、TypeScript、Vitest、Codex app-server JSON-RPC。

## Global Constraints

- 官方 `codex-rs/tui` 是权限行为和业务语义基准。
- 保留 `full_access` 到 `approvalPolicy=never`、`:danger-full-access` 和 `dangerFullAccess` 的正式 app-server 映射。
- 不修改 `/home/rrssnas/code/CodexWeb`。
- 不执行任何文件删除命令。
- 所有测试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不使用本地真实 `CODEX_HOME`。

---

### Task 1: 增加权限所有权回归测试

**Files:**
- Create: `src/codex-web/app-server-permission-profile-only-wiring.test.ts`

**Interfaces:**
- Consumes: `threadRuntimeOptions(profile, config)`、`turnRuntimeOptions(profile, cwd)`。
- Produces: 防止旧全局开关和客户端自动审批重新接线的静态回归守卫。

- [x] **Step 1: 写失败测试**

测试读取设置页、应用外壳、旧客户端、权限提示和 app-server runtime options 源码，断言：

```ts
expect(combinedLegacySources).not.toContain("dangerously_skip_permissions");
expect(permissionPrompt).not.toContain("onPermissionResponse('allow')");
expect(runtimeOptions).toContain('profile === "full_access"');
expect(runtimeOptions).toContain('approvalPolicy: "never"');
expect(runtimeOptions).toContain('permissions: ":danger-full-access"');
```

- [x] **Step 2: 确认测试先失败**

Run: `NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test -- src/codex-web/app-server-permission-profile-only-wiring.test.ts`

Expected: FAIL，指出旧设置键或自动批准调用仍存在。

### Task 2: 移除旧全局假开关

**Files:**
- Modify: `src/components/settings/GeneralSection.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/NavRail.tsx`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/lib/claude-client.ts`

**Interfaces:**
- Consumes: `/api/settings/app` 中仍保留的其它通用设置。
- Produces: 不再公开、轮询或消费 `dangerously_skip_permissions` 的 UI 和运行时。

- [x] **Step 1: 精准移除设置 UI**

删除 `GeneralSection` 中仅服务于旧开关的 state、GET/PUT 字段、警告卡片和确认弹窗，同时保留生成式 UI、默认面板和语言设置。

- [x] **Step 2: 移除外壳和旧导航残留**

删除 `AppShell` 的旧设置轮询，以及 `NavRail` 的 `skipPermissionsActive` 属性和提示点；不调整布局。

- [x] **Step 3: 移除失效文案**

同步删除中英文 `nav.autoApproveOn` 和 `settings.autoApprove*` 文案键。

- [x] **Step 4: 停止旧全局值影响运行时**

将旧客户端权限选择收口为既有会话参数：

```ts
const skipPermissions = !!sessionBypassPermissions;
```

不再读取 `getSetting('dangerously_skip_permissions')`。

### Task 3: 禁止 Web 自动批准 app-server request

**Files:**
- Modify: `src/components/chat/PermissionPrompt.tsx`
- Modify: `src/components/chat/ChatView.tsx`

**Interfaces:**
- Consumes: app-server 映射出的 `PermissionRequestEvent`。
- Produces: 所有收到的 app-server approval 都显示 UI，并只由显式用户操作调用响应回调。

- [x] **Step 1: 删除客户端自动批准分支**

从 `PermissionPromptProps` 删除 `permissionProfile`，删除 `full_access` 对 pending permission 自动调用 `onPermissionResponse('allow')` 和隐藏面板的 effect/条件。

- [x] **Step 2: 清理调用点**

从 `ChatView` 的 `PermissionPrompt` 调用中删除 `permissionProfile` 属性；新聊天页保持现有显式审批行为。

- [x] **Step 3: 运行 targeted test**

Run: `NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test -- src/codex-web/app-server-permission-profile-only-wiring.test.ts src/codex-web/app-server-runtime-options.test.ts`

Expected: PASS，且 `full_access` 正式映射断言继续通过。

### Task 4: 完整验证与归档

**Files:**
- Modify: `docs/exec-plans/active/2026-07-17-app-server-permission-profile-only.md`
- Move after completion: `docs/exec-plans/active/2026-07-17-app-server-permission-profile-only.md` → `docs/exec-plans/completed/2026-07-17-app-server-permission-profile-only.md`

**Interfaces:**
- Consumes: Task 1-3 的实现结果。
- Produces: 完整验证记录和已完成执行计划。

- [x] **Step 1: 运行完整测试**

Run: `NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test`

Expected: typecheck 与全部 Vitest 测试通过。

- [x] **Step 2: 运行生产构建**

Run: `NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run build`

Expected: Next.js 生产构建成功。

- [x] **Step 3: 运行基础 smoke**

Run: `NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test:smoke`

Expected: bridge 初始化和基础 app-server 会话链路通过。

- [x] **Step 4: 运行权限反例 smoke**

Run: `NODE_HOME=/volume2/SSD/node-v24.14.0 PATH=/volume2/SSD/node-v24.14.0/bin:$PATH CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test:smoke:permissions`

Expected: `request_approval`、`auto_approval`、`full_access` 和 `config` 均由 app-server 返回真实设置；`full_access` 不产生普通审批，其他 profile 按策略产生或处理审批。

- [x] **Step 5: 更新 Smoke Ledger 并归档**

记录每条实际执行命令、结果和反例；全部完成后将本计划移动到 `docs/exec-plans/completed/`。

## 决策日志

- 2026-07-17：用户确认 `full_access` 是正式 app-server permission profile，必须保留；仅移除旧全局假开关。

## Smoke Ledger

- 失败基线：新增 wiring test 首次运行时 2/3 失败，分别捕获 `dangerously_skip_permissions` 残留和 `PermissionPrompt` 的客户端自动批准分支；`full_access` 正式 app-server 映射断言通过。
- Targeted：`app-server-permission-profile-only-wiring.test.ts` 与 `app-server-runtime-options.test.ts` 共 8 项通过。
- `npm run test`：74 个测试文件、335 项测试通过。沙箱内首次因 `server/websocket-bridge.test.ts` 监听 `127.0.0.1` 返回 EPERM；授权在沙箱外使用同一隔离 `CODEX_HOME` 重跑通过。
- `npm run build`：生产构建通过。沙箱内首次因 Turbopack 创建子进程并绑定端口返回 EPERM；授权重跑通过。保留仓库既有 NFT 动态路径追踪警告。
- `npm run test:smoke`：通过，`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，模型和账号来源均来自 app-server。
- `npm run test:smoke:permissions`：通过，真实 app-server 返回 `configProfile=:workspace`，四种 profile 校验完成。
- 反例：Web 收到 approval server request 时不再读取本地 `permissionProfile` 自动调用允许；`full_access` 仍由 app-server 的 `approvalPolicy=never`、`:danger-full-access` 和 `dangerFullAccess` 管理。
