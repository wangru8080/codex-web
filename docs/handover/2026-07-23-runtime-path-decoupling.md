# 运行时路径解耦技术交接

> 对应执行计划：[2026-07-23-runtime-path-decoupling.md](../exec-plans/completed/2026-07-23-runtime-path-decoupling.md)

## 结论

生产入口现已区分应用根目录与用户工作目录：前者从 `import.meta.url` 解析并交给 Next，后者保留启动时 cwd 并传给 app-server。源码仓库迁移到其他目录后，不需要修改生产启动脚本中的绝对仓库路径。

开发入口不再拒绝自定义 `CODEX_HOME`。未设置或只包含空白字符时仍采用 `/volume2/SSD/codex/Temp/codex-dev-home`，显式设置其他目录时完整保留该选择。正式 app-server 进程启动函数不再自行注入开发隔离目录。

主题加载器优先使用 Electron 资源目录，其次使用生产入口设置的 `CODEX_WEB_APP_ROOT`，最后才在普通源码开发模式下回退到启动 cwd。

## 路径契约

| 路径 | 来源 | 用途 |
|---|---|---|
| 应用根目录 | 入口模块 `import.meta.url` | `.next/BUILD_ID`、Next `dir`、主题资源 |
| 工作目录 | 启动时 `process.cwd()` | app-server 子进程 cwd、用户项目语义 |
| `CODEX_HOME` | 显式环境或开发默认值 | Codex 账号、配置、历史和附件 |

## 验证记录

- 定向测试：`server/production-server-options.test.ts`、`server/codex-process.test.ts`、`src/lib/theme/loader.test.ts`，3 个文件、10 项通过。
- 全量测试：114 个文件、542 项通过。
- 生产构建：Next.js 生产构建成功。
- bridge smoke：隔离 `CODEX_HOME` 下通过，模型 7 个，账号来源 `app-server.account/read`。
- 仓库外启动：从 `/volume2/SSD/codex/Temp` 执行绝对路径生产入口；应用目录为 `/home/rrssnas/code/codex/web`，工作目录为 `/volume2/SSD/codex/Temp`；根路径返回登录跳转，登录页 HTTP 200。
- 反例：`buildCodexProcessEnv()` 在未指定 `CODEX_HOME` 时不注入开发隔离目录；主题解析在提供应用根目录时不使用用户工作目录。

## 剩余风险

- 当前入口仍是仓库内 TypeScript 脚本，尚未生成 `codex-web` 可分发命令；本次只完成其前置路径边界。

## 后续修复

- 2026-07-23：主题加载器的动态 `existsSync`、`readdirSync` 和 `readFileSync` 已使用 `turbopackIgnore` 限定为运行时访问；`next.config.mjs` 通过 `outputFileTracingIncludes` 精确包含 `themes/**/*.json`。
- 修复后生产构建不再报告 `Turbopack build encountered`、unexpected file 或 NFT warning。
- route NFT manifest 精确包含 12 个主题 JSON，未包含 `next.config.mjs`；因此既消除了整仓库误追踪，也保留了未来 standalone 产物所需主题资源。
