# Codex Web

Codex Web 是基于 `codex app-server` 的浏览器工作台。浏览器通过本地 Web bridge 与 app-server 通信；开发和测试必须使用隔离的 `CODEX_HOME`。

## 开发启动

先配置 Node、隔离环境和 Web 登录凭据：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
export CODEX_WEB_LOGIN_EMAIL=test@admin.com
export CODEX_WEB_LOGIN_PASSWORD=123456
export CODEX_WEB_SESSION_SECRET=0123456789abcdef0123456789abcdef
npm run dev
```

`CODEX_WEB_SESSION_SECRET` 必须至少 32 个字符；生产环境应使用独立随机值，不要使用上面的测试值。邮箱、密码和会话密钥只从服务端环境变量读取，不会显示在页面或写入浏览器存储。

## Cloudflare Turnstile

登录后打开“设置 → 安全”可以启用 Turnstile 并填写站点密钥、私密密钥。配置保存在：

```text
${CODEX_HOME}/codex-web/turnstile.json
```

私密密钥不会返回浏览器；设置页中的私密密钥输入留空时保留当前值。关闭 Turnstile 后登录页不会加载 Cloudflare 小组件。启用后，每次登录都必须由服务端调用 Cloudflare Siteverify 验证一次性 token。

生产环境应通过 HTTPS 反向代理访问应用，并限制源站只接受来自反向代理的连接。

## 验证

```bash
npm run test
npm run build
npm run test:smoke
```

所有可能触发 app-server 的验证都必须显式设置隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
