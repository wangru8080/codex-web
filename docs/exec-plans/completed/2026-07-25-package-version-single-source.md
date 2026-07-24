# 应用版本单一来源实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划在当前会话内联执行，不启用子代理。

**目标：** 让 About、Sentry、浏览器与 server 的 app-server 初始化以及 CLI `--version` 全部从根 `package.json` 读取同一版本，后续升级只修改包版本元数据。

**架构：** 新增浏览器与 Node 均可导入的 `src/lib/app-version.ts`，由 TypeScript/Next/esbuild 在构建时内联 `package.json.version`。运行时消费者只引用 `APP_VERSION`；npm 使用自身 `version` 命令同步 `package-lock.json` 根包版本，不增加环境变量或新依赖。

**技术栈：** TypeScript、Next.js 16、esbuild、Vitest、npm package metadata。

## 全局约束

- 将 `package.json` 版本升级到 `0.2.0`，业务源码不得硬编码具体版本。
- 不新增版本配置文件、生成脚本、依赖或运行时文件读取。
- 不修改 app-server method、capabilities、消息状态或 UI 样式。
- 使用 `npm version 0.2.0 --no-git-tag-version --allow-same-version` 同步锁文件，不创建 tag 或提交。
- 验证使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不远程推送；归档和 Git 提交另行确认。

---

### 任务 1：建立版本单一来源与失败测试

**文件：**
- 创建：`src/lib/app-version.ts`
- 创建：`src/lib/app-version.test.ts`

**接口：**
- 输入：根 `package.json.version`。
- 输出：`APP_VERSION: string`。

- [x] 创建测试，导入尚不存在的 `APP_VERSION`，断言其等于 `package.json.version`。
- [x] 在测试中扫描五个运行时消费者，断言使用 `APP_VERSION` 且不再引用 `NEXT_PUBLIC_APP_VERSION` 或硬编码语义版本。
- [x] 运行定向测试，确认因模块缺失和旧接线失败。
- [x] 创建 `app-version.ts`，只导入 `package.json` 并导出一行常量。

### 任务 2：接线全部运行时消费者

**文件：**
- 修改：`src/components/settings/AboutSection.tsx`
- 修改：`src/components/layout/SentryInit.tsx`
- 修改：`src/codex-web/AppServerProvider.tsx`
- 修改：`server/app-server-session.ts`
- 修改：`scripts/codex-web-cli.ts`
- 修改：`server/app-server-session.test.ts`

**接口：**
- 消费：`APP_VERSION`。
- 保持：About 显示、Sentry release 格式、app-server `clientInfo` shape 和 CLI 参数行为。

- [x] 删除 About 的环境变量 fallback，改为导入共享常量。
- [x] 让 Sentry release、两个 app-server initialize 和 CLI `--version` 使用共享常量。
- [x] 删除 CLI 不再需要的 package JSON 异步读取代码和导入。
- [x] 更新 app-server session 测试期望为 `APP_VERSION`。
- [x] 运行版本定向测试和 `npm run typecheck`，确认接线通过。

### 任务 3：同步包元数据与安装文档

**文件：**
- 修改：`package-lock.json`
- 修改：`README.md`

**接口：**
- `package.json.version`、`package-lock.json.version` 和 `package-lock.json.packages[""].version` 均为 `0.2.0`。
- README tarball 命令通过 `package.json` 计算文件名。

- [x] 运行 npm 自带 `version` 命令，仅同步根包锁文件版本。
- [x] 检查锁文件只改变两个根版本字段。
- [x] 把本地 tarball 与 GitHub Release 示例改为读取 `package.json.version` 的 shell 变量。

### 任务 4：完整验证与收口

**文件：**
- 修改：`docs/exec-plans/active/2026-07-25-package-version-single-source.md`

- [x] 运行 `npm run test`、`npm run build`、`npm run build:cli` 和 `npm run test:smoke`。
- [x] 运行构建后的 `codex-web --version`，确认输出 `0.2.0`。
- [x] 启动隔离生产服务，用无扩展 Headless Chrome 验证 About 页显示 `0.2.0` 且 console 无版本相关异常。
- [x] 停止 Chrome、生产服务和 app-server，确认端口与进程释放。
- [x] 运行版本残留扫描、文档链接检查和 `git diff --check`。
- [x] 经用户确认后归档并提交；不远程推送。

### 任务 5：npm scoped 包发布前安装验证

**文件：**
- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`README.md`

- [x] 将包名统一为 `@wangru8080/codex-web`，保留 CLI 命令名 `codex-web`。
- [x] 补齐仓库、主页、问题反馈、许可证和公开 registry 发布元数据。
- [x] 更新 README 的 scoped registry 安装命令与 scoped tarball 文件名。
- [x] 运行 scoped `npm publish --dry-run`，确认发布清单和 public/latest 配置。
- [x] 将实际 tarball 生成到唯一临时目录，不在仓库写入发布包。
- [x] 从 tarball 安装到临时前缀，验证 `--version`、`--help`、仓库外启动、登录和认证后跳转。
- [x] 停止临时服务，确认随机端口释放；保留临时安装目录供复核。

## 状态总览

- 当前状态：`Code complete`、`Tests pass`、`Smoke passed`。单一来源、`0.2.0` 升级、scoped npm 发布配置及 tarball 独立安装验证均完成，等待归档与提交确认。
- 成功标准：以后只修改 `package.json` 并用 npm 同步锁文件，所有运行时版本消费者在重新构建后自动一致。

## 决策日志

- 2026-07-25：选择共享 TypeScript 常量直接导入 `package.json`；Next、esbuild 和 Vitest 已支持 JSON module，不增加构建期环境变量链路。
- 2026-07-25：CLI 版本在构建时内联，与发布 tarball 中的源码版本一致；不保留第二套运行时 JSON 解析函数。
- 2026-07-25：`npm run build:cli` 已内含完整 `npm run build`，验证时不重复执行第二次相同生产构建。
- 2026-07-25：Headless Chrome 只忽略既有 `/api/sdk/account` 与 `/api/git/status` 404；版本文本、扩展 target 和 JavaScript exception 独立断言。
- 2026-07-25：npm 发布元数据采用 `UNLICENSED`，不在缺少 LICENSE 文件和用户明确授权时擅自授予开源许可；registry 与 public access 固定在 `publishConfig`。
- 2026-07-25：npm 包使用 scoped 名称 `@wangru8080/codex-web`，避免占用无 scope 的全局包名；`bin.codex-web` 保持不变，用户安装后的命令仍为 `codex-web`。
- 2026-07-25：实际安装验证使用唯一临时目录和本地 tarball，不执行 registry 发布，不进行全局安装，也不依赖仓库工作目录。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
|---|---|---|---|
| 2026-07-25 | 只读盘点 | 版本来源 | 初始 `package.json=0.1.0`；About、两个 app-server clientInfo 与 Sentry/CLI 各自维护版本来源 |
| 2026-07-25 | TDD 与包元数据 | 共享版本接线 | 测试先因缺少 `app-version` 模块失败；接线后 2 个文件、4 项通过；npm 仅把 package 与锁文件根版本升级为 `0.2.0` |
| 2026-07-25 | 全量测试 | Typecheck 与 Unit | `npm run test` 通过，130 个测试文件、599 项测试；五个消费者禁止环境变量旧入口和任意硬编码语义版本 |
| 2026-07-25 | 生产与 CLI 构建 | Next、server、CLI | `npm run build:cli` 通过，其中完整 Next 构建、postbuild、生产 server bundle 与 CLI bundle 均成功；`node dist/cli/codex-web.mjs --version` 输出 `0.2.0` |
| 2026-07-25 | 隔离 Smoke | app-server initialize | `npm run test:smoke` 通过，读取 5 个模型，账号来源为 `app-server.account/read` |
| 2026-07-25 | Headless Chrome 149 | About 真实页面 | `/settings/about` 显示 `v0.2.0`，扩展 target 为 0，无 JavaScript exception 或版本相关 console error；既有 `/api/sdk/account` 404 不归因于本次改动 |
| 2026-07-25 | 收口 | 产物与进程 | 默认 `.next/static` 为 0 个 map；Chrome、生产服务和 app-server 已停止，3104/9225 端口释放 |
| 2026-07-25 | npm 官方 registry scoped dry-run | 公开发布清单 | `npm publish --dry-run` 通过：`@wangru8080/codex-web@0.2.0`、public/latest、压缩 17,069,643 bytes、解包 74,669,022 bytes、1634 项；未上传且未生成 tgz；浏览器 map 为 0，server 微型 map 的 `sources` 为空 |
| 2026-07-25 | 临时目录 tarball 安装 | npm 消费者路径 | 实际包 `wangru8080-codex-web-0.2.0.tgz` 安装 791 个生产依赖；临时入口 `codex-web --version` 输出 `0.2.0`，`--help` 正常；npm 提示 `sharp` 与 `es5-ext` 安装脚本尚未获 allowScripts 许可，但本次启动链路未受影响 |
| 2026-07-25 | 仓库外生产启动 | 认证与路径反例 | 应用目录指向临时安装包，工作目录指向独立 `runtime-cwd`，隔离 `CODEX_HOME` 正确；登录页 200，登录接口返回 `ok=true`，认证后首页跳转 `/chat`；服务停止后随机端口 45631 已释放 |
