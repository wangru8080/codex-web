# Web 登录与 Cloudflare Turnstile 实施计划

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** 为 Codex Web 增加基于环境变量邮箱/密码的 Web 登录门禁，并提供可在登录后设置页启停的 Cloudflare Turnstile。

**Architecture:** Next.js Proxy 读取签名 HttpOnly Cookie 做请求前的乐观门禁，登录和敏感 API 在服务端再次验证会话。邮箱和密码只来自服务端环境变量；Turnstile 私密密钥只保存在 `${CODEX_HOME}/codex-web/turnstile.json` 并由服务端调用 Siteverify，浏览器仅获得启用状态、站点密钥和私密密钥已配置状态。

**Tech Stack:** Next.js 16、React 19、TypeScript、Node.js crypto/fs、Cloudflare Turnstile、Vitest、Playwright smoke。

## Global Constraints

- 开发、测试、smoke 和浏览器验证显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 测试邮箱与密码为 `test@admin.com`、`123456`，产品运行时通过 `CODEX_WEB_LOGIN_EMAIL`、`CODEX_WEB_LOGIN_PASSWORD` 导出。
- `CODEX_WEB_SESSION_SECRET` 至少 32 个字符；生产启动缺少认证配置时快速失败。
- 私密密钥、登录密码和会话签名密钥不得返回浏览器、写入日志或进入截图。
- Turnstile 启用后必须服务端调用 `https://challenges.cloudflare.com/turnstile/v0/siteverify`；禁用时登录页不加载小组件。
- 不修改 `/home/rrssnas/code/CodexWeb`，不引入第三方依赖，不使用真实本地 `CODEX_HOME`。

---

### Task 1: 服务端认证与会话

**Files:**
- Create: `server/web-auth.ts`
- Test: `server/web-auth.test.ts`
- Modify: `scripts/dev-next-with-bridge.ts`
- Modify: `scripts/start-next-with-bridge.ts`

**Interfaces:**
- Produces: `readWebAuthConfig(env)`、`verifyCredentials(email, password, config)`、`createSessionToken(config)`、`verifySessionToken(token, config)`、Cookie 常量与选项。

- [x] 编写凭据匹配、篡改 token、过期 token、配置变更失效和缺失环境变量测试并确认红灯。
- [x] 使用 HMAC-SHA256 签名包含邮箱、凭据版本和过期时间的会话 token；字符串比较使用恒定时间摘要。
- [x] 启动脚本在运行时验证三项环境变量，构建阶段不读取真实凭据。
- [x] 运行 `npm exec vitest run -- server/web-auth.test.ts`，预期通过。

### Task 2: Turnstile 配置与 Siteverify

**Files:**
- Create: `server/turnstile-config.ts`
- Create: `server/turnstile.ts`
- Test: `server/turnstile-config.test.ts`
- Test: `server/turnstile.test.ts`

**Interfaces:**
- Produces: `readTurnstileConfig()`、`writeTurnstileConfig(update)`、`publicTurnstileConfig(config)`、`verifyTurnstileToken(token, secret, remoteIp, fetcher)`。

- [x] 编写默认禁用、密钥脱敏、私密密钥留空保留、启用缺少密钥拒绝和 Siteverify 正反例测试。
- [x] 配置写入采用同目录临时文件和原子重命名，目录权限 0700、文件权限 0600；UI 明确保存即授权更新该配置。
- [x] Siteverify 使用 JSON POST、超时和失败关闭策略，不记录 token 或私密密钥。
- [x] 运行两份定向测试，预期通过。

### Task 3: 登录和设置 API 与路由门禁

**Files:**
- Create: `src/app/api/auth/config/route.ts`
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/app/api/settings/security/route.ts`
- Modify: `src/app/api/codex/bridge-url/route.ts`
- Modify: `src/proxy.ts`
- Test: `src/codex-web/web-auth-route-wiring.test.ts`

**Interfaces:**
- Public GET `/api/auth/config`: `{ turnstile: { enabled, siteKey } }`。
- Public POST `/api/auth/login`: `{ email, password, turnstileToken? }`，成功设置 HttpOnly Cookie。
- Authenticated POST `/api/auth/logout`: 清除 Cookie。
- Authenticated GET/PATCH `/api/settings/security`: 返回脱敏配置并保存显式更新。

- [x] 编写公开路径、未登录页面重定向、API 401、登录页反向重定向和 bridge-url 二次校验测试。
- [x] Proxy 排除静态资源，只放行登录页和认证公开 API；Demo mock 在认证门禁之后执行。
- [x] 所有写接口校验同源请求，登录失败使用统一错误文案。
- [x] 运行路由接线测试，预期通过。

### Task 4: 登录 UI 与应用外壳

**Files:**
- Create: `src/components/layout/RootAppContent.tsx`
- Create: `src/app/login/page.tsx`
- Create: `src/components/auth/LoginForm.tsx`
- Create: `src/components/auth/TurnstileWidget.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Test: `src/codex-web/web-login-ui.test.tsx`

**Interfaces:**
- 登录页只加载主题、i18n 和图标 Provider，不启动 AppServerProvider。
- Turnstile 组件显式渲染并暴露 `reset()`，处理成功、过期、错误和卸载。

- [x] 编写禁用 Turnstile 不渲染、启用时需要 token、密码显隐和无注册入口测试。
- [x] 按参考图实现紧凑登录卡，使用现有颜色 token、输入框、按钮和图标，保证 390px 与桌面宽度无溢出。
- [x] 登录成功仅接受站内 `next` 路径，默认跳转 `/chat`；失败后重置 Turnstile。
- [x] 运行 UI 定向测试，预期通过。

### Task 5: 安全设置页

**Files:**
- Create: `src/app/settings/security/page.tsx`
- Create: `src/components/settings/SecuritySection.tsx`
- Modify: `src/components/settings/nav-config.ts`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Test: `src/codex-web/security-settings-wiring.test.tsx`

**Interfaces:**
- GET 返回 `enabled`、`siteKey`、`secretKeyConfigured`、当前登录邮箱。
- PATCH 的空 `secretKey` 保留现值；启用前必须存在两项密钥。

- [x] 编写开关、密钥脱敏、保存中状态、错误提示和退出登录测试。
- [x] 使用现有 SettingsCard、FieldRow、Switch、Input 与 Button，实现独立“安全”导航项。
- [x] 保存成功刷新脱敏状态；退出成功返回 `/login`。
- [x] 运行设置页定向测试，预期通过。

### Task 6: 文档、完整验证与归档

**Files:**
- Modify: `README.md`
- Create: `docs/handover/2026-07-22-web-login-turnstile.md`
- Modify and move: `docs/exec-plans/active/2026-07-22-web-login-turnstile.md` to `docs/exec-plans/completed/2026-07-22-web-login-turnstile.md`

- [x] 文档记录 export 示例、配置文件位置、私密密钥行为和反向代理 HTTPS 要求。
- [x] 运行 `npm run test`、`npm run build` 与登录专项 smoke，全部显式使用隔离 CODEX_HOME。
- [x] 浏览器验证未登录门禁、错误凭据、正确凭据、Turnstile 禁用反例、官方测试密钥启用正例、设置保存、退出，以及桌面/移动端布局。
- [x] 更新状态总览、决策日志和 Smoke Ledger，随后归档本计划。

## 状态总览

- 当前状态：`Code complete`、`Tests pass`、`Smoke passed`、`Review passed`。

## 决策日志

- 2026-07-22：邮箱和密码通过服务端环境变量配置，不在 UI 或配置文件中编辑。
- 2026-07-22：参考 sub2api 的密钥脱敏、空私密密钥保留和显式 Turnstile 渲染模式，但不复制其 Vue/Go 代码。
- 2026-07-22：Proxy 只做 Cookie 乐观门禁；敏感 Route Handler 仍执行会话签名校验。
- 2026-07-22：自托管 custom server 的 Origin 校验优先使用标准 Host 头，避免内部监听地址与公开地址不同导致合法登录 403。
- 2026-07-22：Proxy 只排除 Next 静态资源和 favicon；工作区图片等带扩展名的业务请求仍必须经过登录门禁。

## Smoke Ledger

| 路径 | 预期 | 状态 | 证据 |
|---|---|---|---|
| 未登录访问 `/chat` | 重定向 `/login?next=/chat` | 通过 | 生产 HTTP 返回 307，目标为 `/login?next=%2Fchat` |
| 错误邮箱或密码 | 统一拒绝且不创建 Cookie | 通过 | 错误密码 401；正确测试账号 200；认证后 bridge/settings 均 200 |
| Turnstile 禁用 | 登录页无 Cloudflare 脚本和小组件 | 通过 | CDP：`widget=false`、`script=false`、按钮可用、无注册入口 |
| Turnstile 启用 | token 经 Siteverify 成功后才比较凭据并登录 | 通过 | 缺 token 返回 400；官方测试小组件成功后同一浏览器跳转 `/chat` |
| 私密密钥读取 | API 只返回 configured 布尔值 | 通过 | 设置页 secret input 值为空，响应仅 `secretKeyConfigured=true`；文件 mode 600 |
| 设置页交互 | 开关保存立即影响登录配置 | 通过 | CDP 真实节奏执行启用后为 true、再次禁用后为 false；最终保持禁用 |
| 密码与退出交互 | 密码可显隐，退出清除会话 | 通过 | CDP 类型顺序 `password -> text -> password`；点击退出后进入 `/login` |
| 响应式视觉 | 桌面和 390x844 无重叠或横向溢出 | 通过 | 登录页桌面/移动截图及设置页截图；`overflow=false` |
| 控制台与网络 | 无本次稳定复现错误 | 通过 | 设置页 ignore-cache 重载无 4xx；最终 CDP console errors 为空 |
| 全量测试 | typecheck 与 Vitest 通过 | 通过 | `npm run test` 退出码 0；Proxy 既有测试已加入认证 Cookie 前置 |
| 生产构建 | Next.js 生产构建成功 | 通过 | `npm run build` 退出码 0；BUILD_ID 更新于 2026-07-22 23:36:17 |
| app-server smoke | 隔离环境初始化正常 | 通过 | models=7，accountSource=`app-server.account/read` |
