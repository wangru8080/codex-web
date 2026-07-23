# 运行时路径解耦执行计划

> **执行要求：** 按任务逐项实现并更新复选框；测试和 smoke 显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，不自动提交或推送。
>
> 技术交接：[2026-07-23-runtime-path-decoupling.md](../../handover/2026-07-23-runtime-path-decoupling.md)

**目标：** 将应用资源目录、用户工作目录和 `CODEX_HOME` 分离，使生产入口可以从仓库外任意目录启动，并允许开发者显式选择不同的 Codex 环境。

**架构：** 生产入口通过自身 `import.meta.url` 定位应用根目录，通过启动时 `process.cwd()` 保留用户工作目录，并把两者分别传给 Next 和 app-server。开发入口在未指定 `CODEX_HOME` 时使用现有隔离默认值，显式指定时不覆盖；主题资源通过应用根目录环境变量定位。

**技术栈：** Node.js 24、Next.js 16、TypeScript、Vitest、Codex app-server Web bridge。

## 全局约束

- 不修改 `/home/rrssnas/code/CodexWeb`。
- 不复制、移动或删除源码文件。
- 测试、构建和 smoke 显式使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不自动提交或推送 Git。
- 不在本阶段加入 CLI 发布、Docker 或自动更新能力。

---

### 任务 1：生产入口路径模型

**文件：**
- 修改：`server/production-server-options.ts`
- 修改：`server/production-server-options.test.ts`
- 修改：`scripts/start-next-with-bridge.ts`

**接口：**
- 输入：入口模块 URL、启动 cwd。
- 输出：`ProductionServerPaths { applicationRoot, workingDirectory, buildIdPath }`。

- [x] 添加路径解析测试，断言应用根目录来自入口模块位置、工作目录来自启动 cwd。
- [x] 实现最小路径解析函数并让生产入口使用它。
- [x] 向 Next 显式传入 `dir: applicationRoot`，构建检查和现场构建 cwd 使用应用根目录。
- [x] bridge 显式使用 `workingDirectory` 启动 app-server。
- [x] 运行定向测试并确认通过。

### 任务 2：Codex 环境选择

**文件：**
- 修改：`server/codex-process.ts`
- 新建：`server/codex-process.test.ts`
- 修改：`scripts/dev-next-with-bridge.ts`

**接口：**
- 输入：`CodexProcessOptions`、进程环境。
- 输出：不伪造 `CODEX_HOME` 的 app-server 子进程环境。

- [x] 添加环境构造测试：显式 option 优先、显式 env 次之、未指定时不注入开发目录。
- [x] 提取纯环境构造函数并用于 `startCodexAppServer()`。
- [x] 开发入口改为“环境变量优先，未设置时采用现有隔离默认值”。
- [x] 运行定向测试并确认通过。

### 任务 3：主题资源路径

**文件：**
- 修改：`src/lib/theme/loader.ts`
- 新建：`src/lib/theme/loader.test.ts`

**接口：**
- 输入：`RESOURCES_PATH`、`CODEX_WEB_APP_ROOT`、启动 cwd。
- 输出：主题目录绝对路径。

- [x] 添加主题路径优先级测试，覆盖 Electron、应用根目录和开发 cwd 回退。
- [x] 实现可测试的主题目录解析函数。
- [x] 运行定向测试并确认通过。

### 任务 4：文档与完整验证

**文件：**
- 修改：`README.md`
- 新建：`docs/handover/2026-07-23-runtime-path-decoupling.md`
- 更新：`docs/exec-plans/active/2026-07-23-runtime-path-decoupling.md`

**接口：**
- 输入：前三项实现及验证结果。
- 输出：路径边界说明、决策记录和 Smoke Ledger。

- [x] 更新 README，说明应用根目录、工作目录和 `CODEX_HOME`。
- [x] 运行路径相关定向测试。
- [x] 使用隔离环境运行 `npm run test`。
- [x] 使用隔离环境运行 `npm run build`。
- [x] 使用隔离环境运行 `npm run test:smoke`。
- [x] 从 `/volume2/SSD/codex/Temp` 启动绝对路径生产入口并检查 HTTP 页面与日志中的工作目录。
- [x] 记录正例和反例结果，完成 handover、状态总览和 Smoke Ledger。
- [x] 将本计划移动到 `docs/exec-plans/completed/`。

## 决策日志

- 2026-07-23：路径解耦不等同于 CLI 打包；本阶段只建立后续打包需要的稳定路径边界。
- 2026-07-23：开发环境允许显式选择任意 `CODEX_HOME`；未指定时继续使用现有隔离默认目录。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
|---|---|---|---|
| 2026-07-23 | 只读代码审查 | 生产入口、主题和 app-server 环境路径 | 修复前证据：应用资源与启动 cwd 混用；app-server 默认写死开发 `CODEX_HOME` |
| 2026-07-23 | 隔离 `CODEX_HOME`，Vitest | 路径、环境与主题定向测试 | 3 个文件、10 项通过 |
| 2026-07-23 | 隔离 `CODEX_HOME`，全量 | `npm run test` | 114 个文件、542 项通过 |
| 2026-07-23 | 隔离 `CODEX_HOME`，生产构建 | `npm run build` | 构建成功；保留既有主题 NFT tracing warning |
| 2026-07-23 | 隔离 `CODEX_HOME`，真实 app-server | `npm run test:smoke` | 通过；models=7，accountSource=`app-server.account/read` |
| 2026-07-23 | `/volume2/SSD/codex/Temp` | 仓库外启动生产入口 | 应用目录与工作目录分离；登录页 HTTP 200 |

## 状态总览

- `Code complete`
- `Tests pass`
- `Smoke passed`
