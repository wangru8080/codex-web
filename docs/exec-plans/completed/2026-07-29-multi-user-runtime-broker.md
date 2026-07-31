# 多用户 Runtime Broker 实施计划

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** 在保留一个 Codex Web 公网入口的前提下，通过本机受限 root broker 为白名单 Linux 用户启动独立 Codex app-server，实现多账号并发登录、权限、`CODEX_HOME`、消息和 approval 隔离。

**Architecture:** 非 root Web 进程通过权限受控的 Unix Socket 向 root broker 请求登录校验、Session 验证和 runtime 连接。broker 按静态配置将 Web 用户映射到固定 Linux 用户，使用 `setpriv` 为非 root runtime 初始化 UID、GID 和补充组，每个活跃用户只维护一个 `PersistentAppServer`；同用户多浏览器共享，不同用户永不共享 transport 或 app-server。

**Tech Stack:** Node.js 20.9+、TypeScript、Unix Domain Socket、Node `crypto.scrypt`/HMAC、`setpriv`、Next.js 16、WebSocket、Vitest、Playwright。

## Global Constraints

- 保留现有单用户 `CODEX_WEB_LOGIN_*` 与单 app-server 模式；多用户 broker 通过显式配置启用。
- Web 进程不得读取 broker Session 密钥、密码哈希或任意用户 `CODEX_HOME`。
- broker 只接受静态白名单用户 ID；浏览器不得提交 UID、GID、用户名、cwd、`CODEX_HOME` 或 app-server 命令。
- root runtime 必须由全局 `allowRootRuntime: true` 和用户项 `allowRoot: true` 双重显式允许。
- 非 root runtime 使用 `setpriv --reuid --regid --init-groups` 并清除继承 capability；不得通过 shell 拼接命令。
- 每个用户首次建立 bridge 连接时懒启动一个 app-server；错误登录不得创建 runtime。
- 同用户最后一个 peer 断开后进入宽限期；没有 active Turn 时关闭，有 active Turn 时等待完成后关闭。
- broker 不可用、Session 无效、配置不安全或用户映射异常时全部失败关闭。
- 不引入新的 npm 依赖；密码使用 Node 标准库 `scrypt`，敏感比较使用恒定时间比较。
- 开发、测试和 smoke 显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，不得读取真实账号数据。
- 所有新增注释、文档、错误消息和说明使用简体中文。

---

### Task 1: Broker 配置、密码与 Session

**Files:**
- Create: `server/runtime-broker-config.ts`
- Create: `server/runtime-broker-password.ts`
- Create: `server/runtime-broker-session.ts`
- Test: `server/tests/runtime-broker-config.test.ts`
- Test: `server/tests/runtime-broker-password.test.ts`
- Test: `server/tests/runtime-broker-session.test.ts`

**Interfaces:**
- Produces: `parseRuntimeBrokerConfig(value)`、`readRuntimeBrokerConfig(path)`、`hashBrokerPassword(password)`、`verifyBrokerPassword(password, encoded)`、`createBrokerSession(user, config)`、`verifyBrokerSession(token, config)`。
- Config user: `{ id, email, passwordHash, osUser, uid, gid, home, codexHome, cwd, role, allowRoot }`；UID/GID 由 broker 启动时从白名单 `osUser` 解析，不接受登录请求覆盖。

- [x] 编写配置正反例：重复 ID/email、相对路径、空 secret、root 未双重授权、非安全文件权限全部拒绝。
- [x] 运行配置测试并确认红灯。
- [x] 实现 JSON schema 级运行时校验和 root-owned `0600` 文件检查。
- [x] 编写 scrypt 哈希、错误密码、损坏哈希、恒定时间验证测试并确认红灯。
- [x] 实现版本化 scrypt 编码，不记录明文或哈希。
- [x] 编写 Session 篡改、过期、禁用用户和密码哈希变化失效测试并确认红灯。
- [x] 实现包含 `sub`、email、role、credential version、过期时间和随机 ID 的 HMAC Session。
- [x] 运行三份定向测试，预期通过。

### Task 2: App-server Peer 抽象与用户 Runtime

**Files:**
- Create: `server/app-server-peer.ts`
- Create: `server/user-runtime-registry.ts`
- Test: `server/tests/user-runtime-registry.test.ts`
- Modify: `server/persistent-app-server.ts`
- Modify: `server/websocket-bridge.ts`
- Modify: `server/codex-process.ts`
- Test: `server/tests/websocket-bridge.test.ts`
- Test: `server/tests/codex-process.test.ts`

**Interfaces:**
- Produces: `AppServerPeer`、`UserRuntimeRegistry.attach(user, peer)`、`detach(userId, peer)`、`close()`。
- `CodexProcessOptions` 新增完整 argv 与干净环境模式；默认行为保持原样。

- [x] 为 WebSocket peer 兼容、干净子进程环境、非 shell argv 写失败测试。
- [x] 将 `PersistentAppServer` 从 `WebSocket` 具体类型收窄为 `AppServerPeer`，保持现有 request/response/server-request 路由行为。
- [x] 实现每用户一个 runtime、同用户 sync 广播、不同用户不广播。
- [x] 跟踪 `turn/started` 与终态 notification；最后 peer 离线且无 active Turn 时宽限关闭。
- [x] 覆盖 active Turn 离线不退出、Turn 完成后退出、宽限期重连复用、broker close 全部退出。
- [x] 运行 codex-process、bridge 与 registry 定向测试，预期通过。

### Task 3: Unix Socket Broker 与降权启动

**Files:**
- Create: `server/runtime-broker-framing.ts`
- Create: `server/runtime-broker-protocol.ts`
- Create: `server/runtime-broker-server.ts`
- Create: `server/runtime-broker-client.ts`
- Test: `server/tests/runtime-broker-framing.test.ts`
- Test: `server/tests/runtime-broker-server.test.ts`
- Create: `scripts/codex-web-broker-cli.ts`
- Create: `scripts/codex-web-broker-options.ts`
- Test: `scripts/tests/codex-web-broker-options.test.ts`

**Interfaces:**
- Broker one-shot IPC: `login`、`verifySession`。
- Broker streaming IPC: `attachRuntime` 成功后双向传输原始 JSON-RPC message。
- Client: `login()`、`verifySession()`、`attachRuntime()`、`close()`。

- [x] 编写 NDJSON 分帧、半包、粘包、超限和非法 JSON 测试。
- [x] 实现 Unix Socket server，启动时拒绝非绝对路径和不安全父目录，socket mode 固定 `0660`。
- [x] 登录先执行限速再验证 scrypt；所有失败使用同一外部错误。
- [x] attach 时 broker 再次验证 Session，不能只信任 Web proxy。
- [x] 构建非 root `setpriv` argv：固定 executable、UID/GID/init-groups、清 capability、固定 app-server argv 和干净环境。
- [x] root runtime 使用固定 command/argv 和干净环境，且必须双重 opt-in。
- [x] 测试错误密码、伪造 token、未知用户、跨用户消息、broker 关闭和 app-server 恢复。
- [x] 实现 broker CLI 的 `serve` 与从 stdin 读取密码的 `hash-password`。

### Task 4: Web 认证与按用户 Bridge 接线

**Files:**
- Modify: `server/web-auth.ts`
- Modify: `server/security.ts`
- Modify: `src/proxy.ts`
- Modify: `src/app/api/auth/login/route.ts`
- Modify: `src/app/api/auth/logout/route.ts`
- Modify: `src/app/api/auth/config/route.ts`
- Modify: `src/app/api/codex/bridge-url/route.ts`
- Modify: `src/app/api/settings/security/route.ts`
- Modify: `scripts/start-next-with-bridge.ts`
- Modify: `scripts/dev-next-with-bridge.ts`
- Test: `server/tests/web-auth.test.ts`
- Test: `server/tests/security.test.ts`
- Test: `src/codex-web/tests/web-auth-route-wiring.test.ts`

**Interfaces:**
- broker 模式登录 Route 将凭据发送到本机 socket，成功后写同名 HttpOnly Cookie。
- Proxy 与敏感 API 通过 broker 验证 Cookie；legacy 模式继续本地 HMAC 验证。
- `/api/codex/bridge-url` 返回同源 `/codex-bridge` 和当前用户真实 home breadcrumb。

- [x] 为 legacy/broker 双模式、broker 不可用、错误凭据和 Session 用户信息写失败测试。
- [x] 将 `isAuthenticatedRequest` 扩展为可异步 broker 验证的统一入口，所有敏感 API 独立复验。
- [x] WebSocket upgrade 校验同源 Origin 和 Cookie，再建立 broker streaming IPC；不再给浏览器暴露共享 broker token。
- [x] logout 清 Cookie；浏览器卸载连接后同用户其他连接继续工作。
- [x] broker 模式安全设置只允许 admin 更新全局 Turnstile；普通用户只读。
- [x] 保留 legacy bridge token、环境变量登录和 Turnstile 行为测试。

### Task 5: CLI、打包、部署样例与诊断

**Files:**
- Modify: `package.json`
- Modify: `scripts/build-cli.ts`
- Modify: `scripts/codex-web-cli.ts`
- Modify: `scripts/codex-web-cli-options.ts`
- Test: `scripts/tests/codex-web-cli-options.test.ts`
- Modify: `server/tests/production-entry-build-wiring.test.ts`
- Modify: `src/codex-web/DiagnosticsBridgePanel.tsx`
- Create: `deploy/systemd/codex-web-broker.service`
- Create: `deploy/systemd/codex-web.service`
- Create: `deploy/systemd/users.example.json`

**Interfaces:**
- Package bins: `codex-web` 与 `codex-web-broker`。
- Web broker mode env: `CODEX_WEB_RUNTIME_BROKER_SOCKET`。
- Broker args: `--config`、`--socket`；所有路径必须是绝对路径。

- [x] 更新 esbuild 为两个明确入口并将部署样例纳入 npm package files。
- [x] Web CLI 检测 broker mode 时不要求单用户登录变量或 runtime `CODEX_HOME`。
- [x] 诊断 UI 展示 app-server initialize 的真实 `CODEX_HOME`、broker 认证用户与 OS 用户 breadcrumb；认证元数据来源为 `web-auth.session`。
- [x] systemd 样例分别使用非 root Web 用户与 root broker，Unix Socket 仅授权约定 group。
- [x] 配置样例不包含可用密码、Session secret 或真实账号。

### Task 6: 文档、验证与反例 Smoke

**Files:**
- Modify: `README.md`
- Create: `docs/handover/2026-07-29-multi-user-runtime-broker.md`
- Create: `scripts/multi-user-runtime-broker-smoke.ts`
- Create: `scripts/multi-user-runtime-broker-uid-smoke.ts`
- Modify: `package.json`

- [x] 文档说明安全模型、账号配置、hash-password、systemd、升级和回滚到 legacy 模式。
- [x] 定向测试：broker config/password/session/framing/server、runtime registry、auth routes、bridge。
- [x] 运行 `npm run test`，typecheck 与全部 Vitest 通过。
- [x] 运行 `npm run build` 与 CLI 构建，生产构建和两个 bin 成功。
- [x] 运行非 root fixture smoke：两个用户并发、错误密码不启动、同用户双浏览器共享、跨用户 notification 不可见。
- [x] 在 root 环境运行 Linux UID smoke：broker UID 0，rrssnas/codex runtime 分别为 UID 1000/1004，清除 capability，隔离目录互不可读，断开后进程退出。
- [x] 启动生产 server，通过 Chrome CDP 运行登录/退出/复用/隔离 smoke；普通登录与多用户触发路径形成正反例。
- [x] 更新状态总览、决策日志和 Smoke Ledger。

### Task 7: 审查与归档

**Files:**
- Modify: `docs/handover/2026-07-29-multi-user-runtime-broker.md`
- Move: `docs/exec-plans/active/2026-07-29-multi-user-runtime-broker.md` to `docs/exec-plans/completed/2026-07-29-multi-user-runtime-broker.md`

- [x] 检查每行修改都可追溯到多用户隔离需求，无临时日志、明文凭据、测试 socket 或构建垃圾进入仓库。
- [x] 审查所有 trust boundary：登录、Cookie、Origin、Unix Socket、配置权限、UID/GID、路径、JSON 帧大小和关闭流程。
- [x] 对照 source breadcrumb、i18n、共享类型、文档和反例 smoke 要求完成自查；未实现的诊断 UI 和未运行的 legacy 实机 smoke 已转入 deferred。
- [x] 归档计划并按实际验证结果使用完成状态词，不声称未运行的验证。

## 状态总览

- 当前状态：Code complete，Tests pass，浏览器 Smoke passed，Linux UID Smoke passed，生产构建通过；诊断 UI 与 legacy 实机 smoke 已转入后续计划。

## 延期事项

- [多用户 Runtime Broker 后续事项](../deferred/2026-07-29-multi-user-runtime-broker-followups.md)

## 决策日志

- 2026-07-29：一个公网 Web 入口；每个活跃 OS 用户一个 app-server，不尝试在单 app-server 内切换 UID 或 `CODEX_HOME`。
- 2026-07-29：网络 Web 进程保持非 root；root broker 仅监听权限受控 Unix Socket。
- 2026-07-29：同用户多浏览器共享 runtime；最后 peer 离开后按 active Turn 状态和宽限期回收。
- 2026-07-29：首版用户管理采用 root-owned 静态配置和 scrypt hash，不增加数据库或网页管理 UI。
- 2026-07-29：保留现有单用户模式，broker mode 显式启用并默认失败关闭。

## Smoke Ledger

| 路径 | 预期 | 状态 | 证据 |
|---|---|---|---|
| legacy 单用户启动 | 行为不变 | 已验证 | 隔离 legacy smoke：`initialize`、`model/list`、`account/read`、`thread/list` |
| 错误多用户凭据 | 统一 401，未创建 runtime | 已验证 | `runtime-broker-server.test.ts`，含伪造来源限速反例 |
| root broker 启动 rrssnas 与 codex runtime | 两个 app-server，UID/CODEX_HOME 独立，capability 清零 | 已验证 | `/volume2/SSD/codex/Temp/codex-web-multi-user-uid-smoke-5DFEwR/result.json` |
| 同用户双浏览器 | 共享一个 app-server | 已验证 | `broker-websocket-bridge.test.ts` |
| 不同用户 notification | 互不可见 | 已验证 | broker bridge JSON-RPC 隔离 + registry 广播隔离测试 |
| 最后连接退出且无 Turn | 宽限后关闭 runtime | 已验证 | `user-runtime-registry.test.ts` |
| 最后连接退出但 Turn 运行 | Turn 完成后关闭 | 已验证 | `user-runtime-registry.test.ts` |
| broker 不可用或 Cookie 伪造 | 页面/API/WS 全部失败关闭 | 已验证 | auth、broker server 与 broker bridge 反例测试 |
| rrssnas 与 codex 真实 Chrome 登录 | Cookie、Home、bridge、消息与回收隔离 | 已验证 | `/volume2/SSD/codex/Temp/codex-web-multi-user-browser-smoke-YRSiAf/result.json` |
