# Codex Web CLI 打包实施计划

> **执行要求：** 按任务逐项实现和验证；步骤使用复选框跟踪。本计划在当前会话内直接执行，不派发子代理。

**目标：** 生成可通过 npm tarball 安装的 `codex-web` 命令，使应用从任意项目目录启动，并继续使用包内 Next 生产资产和同源 Web bridge。

**架构：** 保留现有自定义 Next Server，因为 bridge 必须和 Web UI 共用 HTTP 端口。使用 esbuild 将 CLI 与自定义 server 源码打成单个 ESM 入口，第三方 npm 包保持 external；npm `files` 白名单只收录生产 `.next` 资产，排除 `.next/dev` 和缓存。

**技术栈：** Node.js 20.9+、Next.js 16、TypeScript、esbuild、Vitest、npm pack。

**状态：** Smoke passed

## 全局约束

- CLI 默认监听 `127.0.0.1:3001`，只有显式 `--host` 才改变监听地址。
- `--codex-home` 优先于 `CODEX_HOME`；两者都没有时使用当前用户的 `~/.codex`。
- 登录邮箱、密码和 session secret 只从服务端环境变量读取。
- 开发、测试和 smoke 使用 `/volume2/SSD/codex/Temp/codex-dev-home`，不得读取真实 `CODEX_HOME`。
- tarball 输出到 `/volume2/SSD/codex/Temp`；同名文件存在时停止，不静默覆盖。
- 不执行删除命令，不自动发布 npm，不自动推送 Git。

---

### 任务 1：CLI 参数与安装路径

**文件：**
- 新建：`scripts/codex-web-cli-options.ts`
- 新建：`scripts/codex-web-cli-options.test.ts`
- 修改：`server/production-server-options.ts`
- 修改：`server/production-server-options.test.ts`

**接口：**
- `parseCodexWebCliArgs(args, env, homeDirectory)` 返回 host、port、codexHome、open、help 和 version。
- `resolveProductionServerPaths(entryModuleUrl, workingDirectory, applicationRoot)` 优先使用显式应用根目录。

- [x] 编写参数默认值、参数覆盖、非法输入和显式应用根目录测试。
- [x] 运行定向测试并确认新增断言先失败。
- [x] 实现最小解析和路径逻辑。
- [x] 再次运行定向测试并确认通过。

### 任务 2：可执行入口与构建

**文件：**
- 新建：`scripts/codex-web-cli.ts`
- 新建：`scripts/build-cli.ts`
- 修改：`scripts/start-next-with-bridge.ts`
- 修改：`package.json`
- 修改：`package-lock.json`

**接口：**
- npm `bin.codex-web` 指向 `dist/cli/codex-web.mjs`。
- `npm run build:cli` 先构建 Next，再由 esbuild 生成带 Node shebang 的 ESM CLI。
- CLI 设置 `CODEX_WEB_APP_ROOT` 后加载自定义 Next Server，保证调用 cwd 仍作为 app-server cwd。

- [x] 写入 CLI 入口，并让 `--help`、`--version` 在认证配置缺失时也能独立运行。
- [x] 增加 esbuild 构建脚本和 Node engine。
- [x] 配置 npm 生产文件白名单，排除 `.next/dev`、`.next/cache` 和源码测试。
- [x] 运行 `npm run build:cli`，验证入口具有 shebang 且可执行帮助命令。

### 任务 3：文档与交接

**文件：**
- 修改：`README.md`
- 新建：`docs/handover/2026-07-23-codex-web-cli-package.md`

- [x] 记录 tarball 安装、环境变量、参数、跨目录启动和升级方式。
- [x] 说明 CLI 默认使用真实 `~/.codex`，测试必须显式传隔离目录。
- [x] 记录 custom server 与 Next standalone 不兼容的架构决策。

### 任务 4：完整验证与产物

**产物：**
- `/volume2/SSD/codex/Temp/codex-web-0.1.0.tgz`
- `/volume2/SSD/codex/Temp/codex-web-cli-install-<时间戳>/`

- [x] 运行 `npm run test`，预期 typecheck 与全部 Vitest 测试通过。
- [x] 运行 `npm run build`，预期生产构建完成且没有主题 NFT tracing warning。
- [x] 运行 `npm run test:smoke`，验证隔离 bridge 与 app-server bootstrap。
- [x] 运行 `npm pack --dry-run --json`，断言包清单不含 `.next/dev` 和 `.next/cache`。
- [x] 确认目标 tarball 不存在后运行 `npm pack --pack-destination /volume2/SSD/codex/Temp`。
- [x] 在唯一临时目录安装 tarball，验证 `--help`、`--version` 和跨 cwd 启动。
- [x] 使用隔离 `CODEX_HOME` 请求登录页和 bridge，再终止测试进程。
- [x] 更新 Smoke Ledger、计划复选框和状态，并将本计划移动到 `docs/exec-plans/completed/`。

## Smoke Ledger

- 普通路径：安装后的 CLI 从 `/volume2/SSD/codex/Temp` 启动，应用根目录来自 npm 安装包，工作目录保持调用目录，`CODEX_HOME` 为隔离目录。
- 登录路径：未认证 `/` 返回 307 到登录页；正确凭据返回 200，Cookie 为 `HttpOnly`、`SameSite=Strict`、`Max-Age=259200`。
- Bridge 路径：认证后的 `/api/codex/bridge-url` 返回真实 token URL，WebSocket 握手成功。
- 反例：缺少 `CODEX_WEB_LOGIN_EMAIL` 时 CLI 退出码为 1；`--open --port 0` 同样快速失败。
- 产物反例：tarball 清单不含 `.next/dev` 和 `.next/cache`。
