# Runtime Broker 配置热加载实施计划

> **执行要求：** 按任务逐步实现并在每个阶段更新本文件 checklist、决策日志和 Smoke Ledger。

关联技术交接：[多用户 Runtime Broker 技术交接](../../handover/2026-07-29-multi-user-runtime-broker.md)

**目标：** 让 `codex-web runtime serve` 自动加载有效的 `users.json` 变更，同时保留未变化用户的在线 runtime，并安全失效受影响身份。

**架构：** 监听配置文件所在目录以兼容编辑器原子替换，变化后防抖并按启动时相同的权限、结构和系统用户规则构建候选配置。候选完全有效后，由 broker 原子替换认证配置和 runtime factory；registry 仅关闭删除、禁用或配置变化的用户，未变化用户继续使用当前 app-server。

**技术栈：** Node.js `fs.watch`、TypeScript、Vitest、现有 NDJSON Runtime Broker、真实 Chrome CDP smoke。

## 全局约束

- 不引入第三方依赖，不修改 Codex app-server 协议。
- 配置文件仍必须是 root 拥有的普通文件且权限为 `0600`。
- 无效候选配置不得部分生效，不得中断当前用户。
- 未变化用户的 runtime、连接和运行中 Turn 不得因热加载中断。
- 删除、禁用或任何身份/runtime 配置变化必须关闭对应连接和 runtime，使旧 Session 失效。
- `sessionSecret`、`codexCommand`、`setprivCommand` 或 `allowRootRuntime` 变化影响所有当前用户。
- 浏览器验证必须使用 `/volume2/SSD/codex/Temp` 下的新隔离目录，不得使用真实 `CODEX_HOME`。

## 状态总览

- [x] 阶段 1：配置 watcher 与失败回退
- [x] 阶段 2：broker/registry 原子重载与受影响用户协调
- [x] 阶段 3：CLI 接线、文档和回归
- [x] 阶段 4：真实浏览器隔离 smoke

## Task 1：配置文件监听器

**文件：**
- Create: `server/runtime-broker-config-watcher.ts`
- Test: `server/tests/runtime-broker-config-watcher.test.ts`

**接口：**
- `watchRuntimeBrokerConfig(options): () => void`
- `options.load(): Promise<RuntimeBrokerConfig>` 完成文件安全读取和系统用户解析前的配置解析。
- `options.apply(config): Promise<void>` 仅接收完整有效候选配置。
- `options.onError(error): void` 记录失败并保留旧配置。

- [x] 先写失败测试：普通写入和原子替换均触发一次最终配置应用。
- [x] 写失败测试：无效 JSON/权限错误调用 `onError`，旧配置不被替换，后续有效保存仍能恢复。
- [x] 使用父目录 `watch()`、文件名过滤和短防抖实现最小 watcher；关闭函数清理 watcher 和 timer。
- [x] 运行 `npm exec vitest run server/tests/runtime-broker-config-watcher.test.ts`。

## Task 2：在线配置原子切换

**文件：**
- Modify: `server/runtime-broker-server.ts`
- Modify: `server/user-runtime-registry.ts`
- Modify: `server/runtime-broker-launch.ts`
- Test: `server/tests/runtime-broker-server.test.ts`
- Test: `server/tests/user-runtime-registry.test.ts`

**接口：**
- `RuntimeBrokerServer.reload(config, createRuntime): void`
- `UserRuntimeRegistry.reload(options): void`
- registry 比较规范化后的完整用户项；全局启动/签名配置变化时由 server 标记所有用户受影响。

- [x] 写失败测试：新增用户立即可登录，旧用户 runtime 保持同一实例。
- [x] 写失败测试：删除、禁用、密码、角色、`CODEX_HOME` 变化关闭对应 peer/runtime，旧 token 被拒绝。
- [x] 写失败测试：全局签名或启动参数变化关闭全部在线 runtime。
- [x] 将登录、Session 验证和 attach 改为读取当前配置快照。
- [x] registry 更新 runtime factory；只关闭受影响 entry，并让新连接使用新配置。
- [x] 运行 `npm exec vitest run server/tests/runtime-broker-server.test.ts server/tests/user-runtime-registry.test.ts server/tests/runtime-broker-launch.test.ts`。

## Task 3：CLI 接线与文档

**文件：**
- Modify: `scripts/codex-web-broker-cli.ts`
- Modify: `README.md`
- Modify: `docs/handover/2026-07-29-multi-user-runtime-broker.md`
- Test: `server/tests/production-entry-build-wiring.test.ts`

- [x] 启动时保存配置路径；每次候选加载都重新执行文件安全检查和 `resolveBrokerRuntimeUsers()`。
- [x] 候选配置与系统用户全部解析后创建新 factory 并调用 `broker.reload()`。
- [x] 启动/停止 watcher 与 broker 生命周期绑定；成功和失败日志不得输出密码哈希或 Session secret。
- [x] README 说明自动生效范围、旧 Session 失效规则、错误回退和无需 `daemon-reload`。
- [x] 交接文档记录信任边界与运行语义。
- [x] 运行 `npm exec vitest run server/tests/production-entry-build-wiring.test.ts`。

## Task 4：全量与真实浏览器验证

**文件：**
- Modify: `scripts/unified-cli-browser-smoke.ts`
- Modify: `package.json`（仅当需要独立 smoke script 时）

- [x] 扩展真实浏览器 smoke：两个用户分别使用独立 browser context 和隔离 `CODEX_HOME` 登录。
- [x] 普通路径反例：保存等价配置后两个 runtime PID 均不变化，消息仍可发送。
- [x] 触发路径正例：新增登录身份后无需重启即可从新 browser context 登录。
- [x] 触发路径反例：写入无效配置后现有用户仍在线且新身份不可登录。
- [x] 触发路径正例：修改一个用户的 `CODEX_HOME` 后仅该用户旧连接/runtime 关闭，另一用户 PID 不变化；重新登录后使用新目录。
- [x] 使用 Node 24、`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 运行 `npm run test`。
- [x] 运行 `npm run build:cli`，确保真实浏览器使用包含热加载代码的生产 CLI。
- [x] 运行真实 Chrome smoke 并把 `result.json` 路径写入 Smoke Ledger。

## 决策日志

| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-08-04 | 监听父目录而不是配置文件 inode | 兼容 `sudoedit` 和常见编辑器的临时文件原子替换。 |
| 2026-08-04 | 无效候选保留最后有效配置 | 防止半写入或配置错误导致全站登录和在线 Turn 中断。 |
| 2026-08-04 | 用户任一字段变化均淘汰该用户 runtime | 密码、角色和路径都属于身份或执行边界，继续复用旧连接会绕过新配置。 |
| 2026-08-04 | 等价配置不重建 runtime | 热加载不应干扰未变化用户及运行中 Turn。 |

## Smoke Ledger

| 场景 | 期望 | 状态 | 证据 |
|---|---|---|---|
| 等价/未变化用户 | 未变化用户 runtime PID 不变、消息继续 | 已验证 | `/volume2/SSD/codex/Temp/codex-web-unified-cli-browser-smoke-FdDug9/result.json` |
| 无效配置保存 | 旧配置继续服务、新用户返回 401 | 已验证 | `/volume2/SSD/codex/Temp/codex-web-unified-cli-browser-smoke-FdDug9/result.json` |
| 同系统用户新增账号 | runtime 在线时新增不同邮箱、密码和 `CODEX_HOME`，无需重启即可登录 | 已验证 | `/volume2/SSD/codex/Temp/codex-web-unified-cli-browser-smoke-FdDug9/result.json` |
| 密码隔离反例 | 两个同 `osUser` 账号的密码交叉登录均返回 401 | 已验证 | `/volume2/SSD/codex/Temp/codex-web-unified-cli-browser-smoke-FdDug9/result.json` |
| 修改单用户 `CODEX_HOME` | 仅该用户失效并在重登后使用新目录 | 已验证 | `/volume2/SSD/codex/Temp/codex-web-unified-cli-browser-smoke-FdDug9/result.json` |
| 跨用户反例 | 未变化用户 PID、消息和目录不受影响 | 已验证 | `/volume2/SSD/codex/Temp/codex-web-unified-cli-browser-smoke-FdDug9/result.json` |
| 真实 UID 降权 | rrssnas 两个账号均为 `1000:10`，codex 为 `1004:100` | 已验证 | `/volume2/SSD/codex/Temp/codex-web-unified-cli-browser-smoke-FdDug9/result.json` |

## 验证记录

- `npm run test`：162 个测试文件、748 项测试通过。
- `npm run build:cli`：Next.js 生产构建、production server bundle 和统一 CLI bundle 通过。
- `npm run test:smoke:multi-user`：真实 Chrome CDP、生产 Web、真实登录 API 与 WebSocket bridge 通过；所有 `CODEX_HOME` 均位于新隔离目录。
- `sudo ... npm run test:smoke:multi-user:unified-cli`：真实 Chrome 150、生产 `codex-web runtime serve` 与 `codex-web serve` 通过。原 `rrssnas` runtime 在线时热加载 `rrssnas-alt`，两者使用不同邮箱、不同密码哈希和不同 `CODEX_HOME`，均为 UID/GID `1000:10`；两套密码交叉登录均返回 401。codex 热加载前后均为 `1004:100`，PID 从 `1277452` 变为 `1277698`；四套 `CODEX_HOME` 全部位于隔离目录。退出后四个 PID、fixture、runtime CLI、Web CLI 和 Unix socket 均无残留。证据：`/volume2/SSD/codex/Temp/codex-web-unified-cli-browser-smoke-FdDug9/result.json`。
