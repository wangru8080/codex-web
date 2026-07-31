# Runtime 诊断与 Legacy Smoke 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成多用户 Runtime Broker 延期的诊断 breadcrumb，并为 legacy 单用户入口增加可重复的隔离 smoke 验证。

**Architecture:** 服务端新增受认证保护的只读 `/api/auth/me`，复用既有 `authenticateWebRequest()` 返回当前用户公开信息；诊断面板同时显示 app-server initialize 的真实 `CODEX_HOME` 与 Web 认证/OS 用户来源。Legacy smoke 使用现有 `start-next-with-bridge` 入口，在隔离 `CODEX_HOME` 和临时端口上验证页面、bridge、initialize、model/list、account/read 与 thread/list。

**Tech Stack:** Next.js App Router、TypeScript、Vitest、tsx、Codex app-server stdio bridge。

## Global Constraints

- 默认测试隔离目录为 `/volume2/SSD/codex/Temp/codex-dev-home`；本次 smoke 使用独立临时目录，避免真实账号和会话。
- 不修改 `~/code/codex`，不保存 OAuth token、API key 或密码到浏览器。
- 所有用户可见诊断字段必须显示真实来源；无来源时显示 `unsupported`。
- 代码注释、文档和提交信息使用简体中文。

---

### Task 1: 认证用户诊断 API

**Files:**
- Create: `src/app/api/auth/me/route.ts`
- Test: `src/app/api/auth/me/route.test.ts`

- [x] 编写测试：未认证请求返回 401；broker/legacy 认证请求返回 id、email、osUser、codexHome、cwd、role，但不返回密码或 session token。
- [x] 实现 GET route，调用 `authenticateWebRequest(request)`，成功返回 `{ user, source: "web-auth.session" }`，失败返回 401 和 no-store。
- [x] 运行定向 Vitest，确认 API 行为通过。

### Task 2: 诊断面板 breadcrumb

**Files:**
- Modify: `src/components/settings/CodexSection.tsx`
- Modify: `src/codex-web/DiagnosticsBridgePanel.tsx`
- Test: `src/codex-web/tests/diagnostics-bridge-panel.test.ts`

- [x] 编写接线测试，确认面板请求 `/api/auth/me`，展示认证用户、OS 用户、认证用户的 CODEX_HOME，并保留 `initialize.codexHome` 的 app-server 来源。
- [x] 在面板挂载时读取 `/api/auth/me`，请求失败或未认证时显示 `unsupported`，不得伪造值。
- [x] 展示字段来源：app-server CODEX_HOME 使用 `app-server.initialize`；认证用户元数据使用 `web-auth.session`；broker 用户的 OS 用户使用 `web-auth.session.osUser`。
- [x] 运行定向 Vitest 和 typecheck。

### Task 3: Legacy 单用户隔离 Smoke

**Files:**
- Create: `scripts/legacy-runtime-smoke.ts`
- Modify: `package.json`
- Test: `scripts/tests/legacy-runtime-smoke.test.ts`

- [x] 为 smoke runner 写解析/断言测试，覆盖隔离 CODEX_HOME、HTTP `/login`、WebSocket bridge URL 和 initialize 响应必须存在 `codexHome`。
- [x] 实现 runner：创建 `/volume2/SSD/codex/Temp/` 下的唯一临时目录，设置 `CODEX_HOME`、legacy 登录环境变量和随机端口，启动现有生产入口，等待 HTTP 可用后通过 WebSocket 完成 initialize、model/list、account/read、thread/list，再优雅关闭进程。
- [x] runner 输出临时目录、端口、CODEX_HOME 和各协议请求结果；不输出密码、cookie 或 token。
- [x] 增加 `npm run test:smoke:legacy` 脚本并实际运行。

### Task 4: 文档收口与完整验证

**Files:**
- Modify: `docs/exec-plans/deferred/2026-07-29-multi-user-runtime-broker-followups.md`
- Modify: `docs/exec-plans/completed/2026-07-29-multi-user-runtime-broker.md`

- [x] 记录诊断 breadcrumb 已完成和 legacy smoke 的隔离环境、结果与限制。
- [x] 运行 `npm run test`、`npm run build`、`npm run test:smoke:legacy`。
- [x] 仅在命令实际成功后更新状态词为 `Code complete`、`Tests pass`、`Smoke passed`。
