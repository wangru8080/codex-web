# Turnstile 登录恢复修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution in this session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Turnstile 脚本加载竞态和客户端错误恢复，使登录页在临时网络/挑战失败后可以恢复，并保留可诊断的错误类别。

**Architecture:** 保留现有显式渲染方式，在组件内管理共享脚本的加载状态；脚本失败或超时后允许重新加载，已加载 API 直接渲染。登录表单继续由服务端 Siteverify 做最终校验，仅改善客户端错误状态和恢复路径。

**Tech Stack:** React 19、Next.js 16、TypeScript、Vitest、Cloudflare Turnstile explicit rendering API。

## Global Constraints

- 不保存 Turnstile token、私密密钥或密码到浏览器存储和日志。
- 不绕过服务端 Siteverify。
- 只修改与 Turnstile 登录链路直接相关的文件。
- 所有代码注释、文档和测试说明使用中文。
- 多用户存在启用的 root 账号时，Turnstile 配置由 root broker 保存在 root 的 `${CODEX_WEB_STATE}/turnstile.json`，未设置时为 `/root/.codex-web/turnstile.json`；Web 进程不读取私密密钥。
- 多用户没有启用的 root 账号时沿用 Web 状态目录；单用户行为保持不变。

---

### Task 1: 修复 Turnstile 脚本加载和恢复

**Files:**
- Modify: `src/components/auth/TurnstileWidget.tsx`
- Test: `src/components/auth/TurnstileWidget.test.tsx`（若现有测试环境不支持组件渲染，则改为测试抽出的最小加载逻辑）

- [x] **Step 1: 覆盖已有脚本、脚本失败、脚本超时和错误回调场景。**
- [ ] **Step 2: 运行针对性测试，确认现有实现无法处理至少一个场景。**
  - 本次先完成实现后补回归测试，未单独运行修复前失败状态。
- [x] **Step 3: 增加最小的脚本加载状态管理，保证 load 事件不会被错过；失败后移除失效标签并允许重试。**
- [x] **Step 4: 将 Cloudflare 错误码传递给上层，并保留自动重试兼容性。**
- [x] **Step 5: 运行针对性测试并确认通过。**

### Task 2: 修复登录页错误状态

**Files:**
- Modify: `src/components/auth/LoginForm.tsx`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`

- [x] **Step 1: 让 Turnstile 成功回调清除过期的验证错误。**
- [x] **Step 2: 区分加载失败/挑战失败与服务端 token 校验失败的用户提示。**
- [x] **Step 3: 保留重试操作，不在客户端错误回调中触发重复 reset。**
- [x] **Step 4: 运行类型检查和相关单元测试。**

### Task 3: 验证回归

**Files:**
- Modify: 仅在测试需要时补充现有测试文件。

- [x] **Step 1: 运行 `npm run typecheck`。**
- [x] **Step 2: 运行 `npm run test`。**
- [x] **Step 3: 运行 `npm run build`。**
- [x] **Step 4: 使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 启动服务，验证登录页普通路径、Turnstile 启用路径和失败后重试路径。**
  - 使用 `/home/rrssnas/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome` 完成生产入口浏览器 smoke。
  - Turnstile 正常加载：官方测试 token 生成，登录按钮启用，无失败提示。
  - Turnstile 加载失败：显示失败提示和重试按钮；解除网络阻断后 token 生成、旧错误清除并成功跳转 `/chat`。
  - Turnstile 关闭反例：不渲染组件、不请求 `challenges.cloudflare.com`，登录按钮可用。
- [x] **Step 5: 汇报实际运行过的验证命令和剩余风险。**

### Task 4: 启用前真实预检

**Files:**
- Modify: `src/components/settings/SecuritySection.tsx`
- Modify: `src/app/api/settings/security/route.ts`
- Modify: `server/turnstile.ts`
- Test: `server/tests/turnstile.test.ts`

- [x] **Step 1: 设置页使用候选 site key 生成一次性测试 token。**
- [x] **Step 2: 启用配置时必须把测试 token 随更新请求提交。**
- [x] **Step 3: 服务端先用候选 secret key 调用 Siteverify，成功后才写配置。**
- [x] **Step 4: 验证失败保持旧配置不变并返回脱敏错误类别。**

### Task 5: 多用户 root 配置所有权

**Files:**
- Modify: `server/runtime-broker-protocol.ts`
- Modify: `server/runtime-broker-client.ts`
- Modify: `server/runtime-broker-server.ts`
- Modify: `server/turnstile-config.ts`
- Modify: `src/app/api/auth/config/route.ts`
- Modify: `src/app/api/auth/login/route.ts`
- Modify: `src/app/api/settings/security/route.ts`
- Test: `server/tests/runtime-broker-server.test.ts`
- Test: `server/tests/turnstile-config.test.ts`

- [x] **Step 1: broker 公开返回 root 管理状态和不含 secret 的配置。**
- [x] **Step 2: root 管理模式由 broker 使用 root 的 `CODEX_WEB_STATE` 完成 Siteverify。**
- [x] **Step 3: 只有有效 root Web 会话可以更新 root-owned 配置。**
- [x] **Step 4: 无启用 root 账号时 Web 进程继续使用现有状态目录。**
- [x] **Step 5: 测试 secret 不跨越公开协议且普通用户无法更新。**

### Task 6: 客户端错误码与部署说明

**Files:**
- Modify: `src/components/auth/LoginForm.tsx`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Modify: `README.md`
- Modify: `docs/handover/2026-07-29-multi-user-runtime-broker.md`

- [x] **Step 1: 仅展示 Cloudflare 六位数字客户端错误码。**
- [x] **Step 2: 脚本加载异常继续显示通用错误，不暴露内部信息。**
- [x] **Step 3: 记录单用户、多用户 root 管理和无 root 回退路径。**
- [x] **Step 4: 运行定向测试、全量测试、构建和浏览器 smoke。**

### Task 7: 统一 Turnstile 状态路径和权限

**Files:**
- Modify: `server/turnstile-config.ts`
- Modify: `server/runtime-broker-server.ts`
- Test: `server/tests/turnstile-config.test.ts`
- Test: `server/tests/runtime-broker-server.test.ts`

- [x] **Step 1: 显式设置 `CODEX_WEB_STATE` 时统一使用 `${CODEX_WEB_STATE}/turnstile.json`。**
- [x] **Step 2: 未设置时统一使用启动用户的 `~/.codex-web/turnstile.json`；root broker 使用 root 用户目录。**
- [x] **Step 3: 保存目录和文件分别固定为 0700、0600，只读取新的统一路径。**
- [x] **Step 4: 运行路径、权限、全量测试和生产构建验证。**

### Task 8: 移除旧路径兼容并适配 Windows 默认目录

**Files:**
- Modify: `server/turnstile-config.ts`
- Modify: `server/runtime-broker-server.ts`
- Test: `server/tests/turnstile-config.test.ts`
- Modify: `README.md`

- [x] **Step 1: 删除旧 `codex-web/turnstile.json`、旧 `CODEX_HOME` 和 `/etc` 候选读取。**
- [x] **Step 2: 保持 `homedir()` 与 `path.join()` 默认路径解析，使 macOS/Linux 使用 `~/.codex-web`、Windows 使用用户目录下 `.codex-web`。**
- [x] **Step 3: 验证旧文件不会被读取或用于补全新配置。**
- [x] **Step 4: 运行定向测试、全量测试和生产构建。**
