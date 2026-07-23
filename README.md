# Codex Web

Codex Web 是基于 `codex app-server` 的浏览器工作台。浏览器通过本地 Web bridge 与 app-server 通信；开发和测试必须使用隔离的 `CODEX_HOME`。

## CLI 安装与启动

构建本地 npm 安装包：

```bash
npm run build:cli
npm pack --pack-destination /volume2/SSD/codex/Temp
npm install --global /volume2/SSD/codex/Temp/codex-web-0.1.0.tgz
```

配置 Web 登录凭据后，在需要作为 Codex 工作目录的项目目录中启动：

```bash
export CODEX_WEB_LOGIN_EMAIL="admin@example.com"
export CODEX_WEB_LOGIN_PASSWORD="使用独立强密码"
export CODEX_WEB_SESSION_SECRET="使用至少32个字符的独立随机值"
cd /path/to/your/project
codex-web --open
```

`codex-web` 默认监听 `127.0.0.1:3001`。可用参数：

```text
--host <地址>         监听地址
--port <端口>         HTTP 端口；0 表示随机端口
--codex-home <路径>   Codex 配置与会话目录
--open                启动后打开浏览器，不能与 --port 0 同时使用
--help                显示帮助
--version             显示版本
```

`--codex-home` 优先于 `CODEX_HOME`；两者都没有时使用当前用户的 `~/.codex`。CLI 安装目录只存放应用资源，执行 `codex-web` 时的当前目录才是 app-server 工作目录，因此安装包或项目目录迁移后不需要修改硬编码路径。

升级时生成新版本 tarball，再通过 npm 安装新 tarball。不要直接修改全局安装目录中的 `.next` 或 `dist` 文件。

## 开发启动

先配置 Node、开发环境和 Web 登录凭据：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
export CODEX_WEB_LOGIN_EMAIL=test@admin.com
export CODEX_WEB_LOGIN_PASSWORD=123456
export CODEX_WEB_SESSION_SECRET=0123456789abcdef0123456789abcdef
npm run dev
```

开发模式未设置 `CODEX_HOME` 时，默认使用
`/volume2/SSD/codex/Temp/codex-dev-home`；显式设置时使用指定目录，不再强制写死默认值。
测试和 smoke 仍必须显式使用隔离 `CODEX_HOME`。

## 路径边界

Codex Web 区分三类路径：

- 应用根目录：由启动入口的 `import.meta.url` 解析，用于读取 `.next`、主题和其他应用资源。
- 工作目录：生产入口启动时的 `process.cwd()`，作为 app-server 的 cwd；它可以是任意用户项目目录。
- `CODEX_HOME`：Codex 账号、配置和会话目录。生产入口仍要求显式设置，开发入口允许覆盖默认开发目录。

因此生产入口不要求从源码仓库 cwd 启动。例如在构建完成后，可以从其他目录执行绝对路径入口，应用资源仍从源码或安装目录加载，app-server cwd 则保持为调用目录。

`CODEX_WEB_SESSION_SECRET` 必须至少 32 个字符；生产环境应使用独立随机值，不要使用上面的测试值。邮箱、密码和会话密钥只从服务端环境变量读取，不会显示在页面或写入浏览器存储。登录会话有效期为 3 天，修改邮箱、密码或 session secret 会使已有会话立即失效。

只有确认网络边界、HTTPS 反向代理和防火墙均已配置时，才应使用 `--host 0.0.0.0` 对其他设备开放访问。普通本机使用保持默认监听地址。

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
