# Web 登录与 Cloudflare Turnstile 技术交接

关联执行计划：[Web 登录与 Cloudflare Turnstile 实施计划](../exec-plans/completed/2026-07-22-web-login-turnstile.md)

## 用户流程

- 未登录访问页面时，`src/proxy.ts` 重定向到 `/login?next=<站内路径>`；API 返回 JSON 401。
- 登录邮箱和密码来自 `CODEX_WEB_LOGIN_EMAIL`、`CODEX_WEB_LOGIN_PASSWORD`。
- 登录成功后写入 HMAC-SHA256 签名的 HttpOnly、SameSite=Strict Cookie，有效期七天。
- 会话包含凭据版本；邮箱或密码环境变量变化后，旧 Cookie 自动失效。
- `/login` 不挂载 AppServerProvider，只有认证成功进入工作台后才读取 bridge URL。

## Turnstile 所有权

- 配置文件：`${CODEX_WEB_STATE}/turnstile.json`；未设置状态目录时使用当前管理进程用户的 `~/.codex-web/turnstile.json`，目录权限 0700、文件权限 0600。
- 公开登录配置只返回 `enabled` 和 `siteKey`。
- 安全设置 API 只返回 `secretKeyConfigured`，不返回 `secretKey`。
- 私密密钥输入为空表示保留当前值；启用时缺少任一密钥会拒绝保存。
- 登录 Route Handler 在比较邮箱密码前调用 Cloudflare Siteverify；网络错误、超时、非 2xx 或 `success !== true` 均关闭登录。

## 安全边界

- Proxy 是请求前乐观门禁；`/api/codex/bridge-url` 与安全设置 API 仍独立验证 Cookie。
- 登录、退出和设置写入检查 Origin；邮箱或密码错误返回同一文案。
- Turnstile token、私密密钥、登录密码和会话密钥不得进入日志、浏览器存储或截图。
- bridge 自身仍使用原有随机 token 与 Origin 校验；Web 登录不替代 bridge 安全边界。

## 验证边界

- 单元测试使用 Cloudflare 响应 mock，不向真实 Siteverify 发送私密密钥。
- 浏览器启用路径使用 Cloudflare 官方测试站点密钥与测试私密密钥。
- 开发和 smoke 固定使用 `/volume2/SSD/codex/Temp/codex-dev-home`，不得切换真实 CODEX_HOME。
