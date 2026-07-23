# Codex Web CLI 打包技术交接

关联执行计划：[2026-07-23-codex-web-cli-package.md](../exec-plans/completed/2026-07-23-codex-web-cli-package.md)

## 用户能力

- `npm pack` 生成可安装的 `codex-web-<version>.tgz`。
- 安装后提供 `codex-web` 命令，支持 host、port、Codex Home、自动打开浏览器、帮助和版本参数。
- CLI 从任意工作目录启动；安装目录负责提供 `.next`、主题和静态资源，调用目录作为 app-server cwd。
- 默认只监听 `127.0.0.1:3001`，避免无意暴露到局域网。

## 架构决策

项目继续使用 `scripts/start-next-with-bridge.ts` 自定义 server。Next standalone 不能携带自定义 server，而且 Codex Web 要求 Next 请求与 `/codex-bridge` WebSocket 共用端口，因此没有采用 `.next/standalone/server.js`。

`scripts/build-cli.ts` 使用 esbuild 将本地 CLI、server 和 bridge 源码打成 `dist/cli/codex-web.mjs`，npm 第三方依赖保持 external，由安装时的 package dependencies 提供。CLI 在加载 server 前设置 `CODEX_WEB_APP_ROOT`，解决打包入口位于 `dist/cli` 时的资源根目录定位问题。

npm `files` 白名单只包含以下运行时资产：

- `.next/BUILD_ID`、根级 manifest、`.next/server`、`.next/static`
- `dist/cli`
- `next.config.mjs`
- `public`、`themes`

`.next/dev` 和 `.next/cache` 不进入 tarball。首次清单审计结果为压缩约 15.8 MiB、解包约 69.2 MiB、1553 个文件。

## 运行时配置

CLI 必需的 Web 登录环境变量：

```text
CODEX_WEB_LOGIN_EMAIL
CODEX_WEB_LOGIN_PASSWORD
CODEX_WEB_SESSION_SECRET
```

Codex Home 优先级：`--codex-home`、`CODEX_HOME`、当前用户的 `~/.codex`。开发、测试、smoke 和打包安装验证必须显式传入 `/volume2/SSD/codex/Temp/codex-dev-home`，不得依赖默认真实目录。

## 后续更新入口

当前产物是本地 tarball，不包含 npm registry 发布和设置页“一键更新”接线。后续接入更新按钮时，应先确定可信发布源和签名/校验策略，再由服务端检查版本并展示可验证的更新状态；浏览器端不得直接执行 npm 安装命令。

## 验证要求

- `npm run test`
- `npm run build`
- 启动隔离 dev server 后运行 `npm run test:smoke`
- `npm pack --dry-run --json --ignore-scripts`
- 在全新临时目录安装 tarball 并运行 `codex-web --help`、`codex-web --version`
- 从非安装目录启动 CLI，验证登录页、bridge 和 app-server cwd
