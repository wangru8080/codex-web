# 统一 Codex Web CLI 实施计划

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** npm 只发布一个 `codex-web` CLI，通过 `serve` 与 `runtime` 子命令分别启动 Web 服务和多用户 runtime 服务。

**Architecture:** `codex-web-cli.ts` 负责顶层命令分发，Web 分支继续复用现有参数解析和启动链路，runtime 分支调用现有 broker 启动逻辑。Web 与 runtime 仍是两个独立 systemd 进程，权限边界不变；旧 `codex-web [选项]` 保留兼容，旧 `codex-web-broker` 不再作为 npm bin 发布。

**Tech Stack:** Node.js、TypeScript、esbuild、systemd、Vitest。

## Global Constraints

- 不修改 Web UI、聊天组件、app-server 协议或多用户安全边界。
- `codex-web serve [选项]` 启动非 root Web 服务。
- `codex-web runtime serve --config <路径> --socket <路径>` 必须由 root 启动。
- `codex-web runtime hash-password` 从 stdin 读取密码。
- npm `bin` 只包含 `codex-web`。
- 不引入新依赖，不删除历史计划，不执行 Git push。

---

### Task 1: 顶层命令分发

**Files:**
- Modify: `scripts/codex-web-cli-options.ts`
- Modify: `scripts/codex-web-cli.ts`
- Modify: `scripts/codex-web-broker-cli.ts`
- Test: `scripts/tests/codex-web-cli-options.test.ts`
- Test: `scripts/tests/codex-web-broker-options.test.ts`

**Interfaces:**
- Produces: `parseCodexWebCommand(args)`，返回 Web 或 runtime 分支及剩余 argv。
- Produces: `runCodexWebRuntimeCli(args)`，复用现有配置、hash-password 和 root 校验。

- [x] 为 `serve`、`runtime serve`、`runtime hash-password`、legacy 无子命令和未知命令编写参数测试。
- [x] 运行两份 CLI 定向测试并确认新增断言先失败。
- [x] 在 `codex-web-cli.ts` 分发顶层命令；runtime 分支不初始化 Web 环境或 Next 服务。
- [x] 更新总帮助文本，展示统一命令形式。
- [x] 运行 CLI 定向测试并确认通过。

### Task 2: 单 bin 构建与部署命名

**Files:**
- Modify: `package.json`
- Modify: `scripts/build-cli.ts`
- Move: `deploy/systemd/codex-web-broker.service` to `deploy/systemd/codex-web-runtime.service`
- Modify: `deploy/systemd/codex-web.service`
- Modify: `deploy/systemd/codex-web-runtime.service`
- Modify: `deploy/systemd/users.example.json`
- Test: `server/tests/production-entry-build-wiring.test.ts`

**Interfaces:**
- npm bin: `{ "codex-web": "dist/cli/codex-web.mjs" }`。
- Runtime service: `ExecStart=/usr/local/bin/codex-web runtime serve ...`。

- [x] 为单 bin、单 CLI 构建入口和 systemd runtime 命令补构建接线测试。
- [x] 将 esbuild 收敛为一个 `codex-web.mjs` 输出，并将 package files 收窄到该文件。
- [x] 将 systemd runtime 单元改名并更新 `Requires`、`After`、`ExecStart`。
- [x] 更新 users 样例中的 hash-password 命令提示。
- [x] 运行构建接线测试和 `npm run build:cli`。

### Task 3: 文档、回归与归档

**Files:**
- Modify: `README.md`
- Modify: `docs/handover/2026-07-29-multi-user-runtime-broker.md`
- Move: `docs/exec-plans/active/2026-07-29-unified-codex-web-cli.md` to `docs/exec-plans/completed/2026-07-29-unified-codex-web-cli.md`

- [x] 将部署命令统一为 `codex-web serve`、`codex-web runtime serve` 和 `codex-web runtime hash-password`。
- [x] 运行 `npm run test`，149 个测试文件、680 项测试通过。
- [x] 运行 CLI 帮助、版本、密码哈希和非 root runtime 拒绝反例。
- [x] 完整 prepack 构建通过，并使用 `npm pack --dry-run --ignore-scripts` 确认只发布一个 bin 且不包含旧 broker CLI 产物。
- [x] 检查无服务、测试进程、临时日志或构建垃圾进入 Git。
- [x] 更新 checklist 和验证记录后归档计划。

## 验收标准

```bash
codex-web serve --host 127.0.0.1 --port 3001
codex-web runtime serve --config /etc/codex-web/users.json --socket /run/codex-web/runtime-broker.sock
printf '%s' '密码' | codex-web runtime hash-password
```

- 上述命令均来自同一个 `codex-web` bin。
- `codex-web --host ...` 继续兼容。
- Web 进程保持非 root，runtime 进程保持 root，用户 app-server 生命周期不变。

## 验证记录

- CLI 与构建接线定向测试：3 个测试文件、13 项测试通过。
- `npm run build:cli`：Next 26 个页面、production server 和 `dist/cli/codex-web.mjs` 构建通过。
- `npm run test`：149 个测试文件、680 项测试通过。
- CLI smoke：Web/runtime 帮助、`0.4.1` 版本、scrypt 密码哈希通过；非 root `runtime serve` 以退出码 1 拒绝。
- npm dry-run：包含 `dist/cli/codex-web.mjs` 和 `codex-web-runtime.service`，不包含旧 broker CLI 或 service。
- Chrome 150 真实浏览器 smoke：构建后的 `codex-web runtime serve` 与 `codex-web serve` 完整链路通过；`rrssnas`/`codex` 使用 UID 1000/1004 和独立测试 `CODEX_HOME`/cwd；同用户第二页面复用 runtime，跨用户 marker 隔离，退出后两个 runtime 均停止。证据位于 `/volume2/SSD/codex/Temp/codex-web-unified-cli-browser-smoke-FQr070/result.json`。
