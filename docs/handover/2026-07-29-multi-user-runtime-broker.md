# 多用户 Runtime Broker 技术交接

关联执行计划：[2026-07-29-multi-user-runtime-broker.md](../exec-plans/completed/2026-07-29-multi-user-runtime-broker.md)

统一 CLI 计划：[2026-07-29-unified-codex-web-cli.md](../exec-plans/completed/2026-07-29-unified-codex-web-cli.md)

macOS 适配计划：[2026-07-29-macos-multi-user-runtime.md](../exec-plans/completed/2026-07-29-macos-multi-user-runtime.md)

延期事项：[2026-07-29-multi-user-runtime-broker-followups.md](../exec-plans/deferred/2026-07-29-multi-user-runtime-broker-followups.md)

配置热加载计划：[2026-08-04-runtime-broker-config-hot-reload.md](../exec-plans/completed/2026-08-04-runtime-broker-config-hot-reload.md)

## 用户能力

- 一个非 root Codex Web 支持多个静态账号并发登录。
- 每个账号固定映射一个白名单 Linux 或 macOS 系统用户，拥有独立 UID、组、home、`CODEX_HOME`、cwd 和 Codex 账号状态。
- 同一用户的多个浏览器共享一个 app-server；不同用户不共享 transport、notification 或 approval。
- 登录不启动 runtime。首次 WebSocket attach 懒启动，最后连接离开后按宽限期和 active Turn 状态回收。

## 信任边界

root broker 独占 root-owned `0600` JSON 配置，其中包含 scrypt 密码哈希和 HMAC Session secret。非 root Web 进程只能访问 `0660` Unix socket，不能读取配置或各用户 Codex 凭据。浏览器只持有 SameSite Strict、HttpOnly Session cookie。

登录请求只能提交邮箱和密码。UID、GID、系统用户名、home、`CODEX_HOME`、cwd、可执行文件和 argv 全部来自静态配置与系统用户数据库。broker 启动时核对系统 home。Linux 普通用户通过固定 `setpriv` argv 初始化 UID、GID 和补充组并清除 capability；macOS 普通用户通过固定 `/usr/bin/sudo -n -H -u` argv 初始化目标 UID、主组和补充组，再由 `/usr/bin/env -i` 清空环境。两种平台都不启用 shell，UID 0 只接受 `osUser=root`，且要求全局和用户项双重授权。

app-server 使用干净环境，不继承 broker 的配置或 Session secret。配置拒绝覆盖身份变量以及 `LD_*`、`DYLD_*`、`NODE_OPTIONS` 等加载器或运行时注入变量。

## 运行协议

Web 与 broker 通过 NDJSON Unix socket 通信：

- `login`：scrypt 校验并签发 HMAC Session；错误尝试按规范化邮箱限速，不信任客户端可控的代理来源头。
- `verifySession`：Proxy 与敏感 API 独立验证 Cookie。
- `attachRuntime`：再次验证 Session，成功后连接切换为双向 JSON-RPC message stream。

WebSocket upgrade 先验证远程连接策略、同源 Origin 和 cookie，再 attach broker。浏览器不会收到共享 bridge token。legacy 单用户模式继续使用原有环境变量登录和 query token bridge。

## 进程生命周期

`UserRuntimeRegistry` 以用户 ID 为键维护 `PersistentAppServer`、浏览器 peer 和 active Turn 集合。`turn/started` 加入 active Turn，`turn/completed` 移除。同用户最后 peer 离开且没有 active Turn 时启动 `disconnectGraceMs` 定时器；重连取消定时器。broker 关闭时立即关闭全部 runtime。

## 配置热加载

runtime CLI 监听 `users.json` 的父目录，因此普通保存和编辑器原子替换都会触发防抖加载。候选配置必须重新通过 root 所有者、`0600` 权限、JSON schema、系统账号 home 和 root 双重授权检查；系统用户全部解析完成后才创建新 runtime factory 并原子提交。任何阶段失败都保留最后有效配置，不影响在线用户，后续有效保存可以恢复。

broker 的认证请求每次读取当前配置快照。新增用户立即可登录；等价用户配置复用现有 runtime。删除、禁用或任一用户字段变化会关闭该用户 peer/runtime，完整用户执行配置参与 Session credential version，因此旧 Cookie 也会失效。`sessionSecret`、`codexCommand`、`setprivCommand` 或 `allowRootRuntime` 变化会淘汰全部当前 runtime；`sessionMaxAgeSeconds` 和 `disconnectGraceMs` 不主动中断在线连接。

## 部署

Linux 参考 `deploy/systemd/`，macOS 参考 `deploy/launchd/`。Linux 示例假设：

- Web 用户为 `codex`。
- Web 与 broker 共享组为 `codex-web-runtime`。
- CLI 位于 `/usr/local/bin`。
- Web 使用 `codex-web serve`，root runtime 使用 `codex-web runtime serve`；npm 只发布一个 `codex-web` bin。
- broker 配置位于 `/etc/codex-web/users.json`。
- socket 位于 `/run/codex-web/runtime-broker.sock`。

macOS 使用 root-owned LaunchDaemon 运行 runtime，并以 `dscacheutil` 查询规范化的 UID、GID、home 与 shell。Web LaunchDaemon 使用非 root `UserName` 和共享组访问持久目录中的 `0660` socket；用户配置仍为 version 1，不增加平台专用登录协议。

实际安装 systemd 文件、创建用户/组或写入 `/etc` 不属于仓库构建流程，需要管理员在核对路径后执行。升级 npm 包后应同时重启 runtime 和 Web 服务，使两个进程使用同一个已升级 CLI。

## 诊断与限制

- `/api/codex/bridge-url` 返回当前认证用户、home 和同源 bridge 路径。
- app-server initialize 仍是 UI 中 `CODEX_HOME` 的事实源。
- 首版账号来自静态 JSON，不提供浏览器用户管理界面。
- Turnstile 是 Web 全局配置；broker 普通用户只读，只有 `admin` 角色可更新。
- runtime 支持 Linux 与 macOS；Windows 明确拒绝多用户启动，但单用户 `codex-web serve` 保持支持。
- Linux 使用 `getent + setpriv`；macOS 使用 `dscacheutil + sudo + env -i`。macOS 若修改默认 sudo policy 导致 root 的非交互降权被拒绝，runtime 会快速失败并通过 app-server stderr 诊断暴露。

## 验证记录

- broker 配置、密码、Session、分帧、服务端、runtime registry 与降权 argv 定向测试。
- legacy Web auth、Origin、Proxy 与 route wiring 定向测试。
- 真实 Unix broker + HTTP WebSocket 集成测试：无 cookie 拒绝、同用户双浏览器复用、不同用户 JSON-RPC 隔离。
- 全量 Vitest：149 个测试文件、676 项测试通过。
- 初始实现验证过 `codex-web` 与 `codex-web-broker` 两个 CLI；当前发布入口已统一为单个 `codex-web` bin，通过 `serve` 与 `runtime` 子命令区分两个进程。
- Chrome 150 CDP 真实浏览器 smoke 通过：`rrssnas` 与 `codex` 使用独立浏览器 context 登录，返回各自 home 和测试 `CODEX_HOME`；同用户第二页面复用一个 runtime；跨用户 marker 不串线；最后连接退出后两个 runtime 均关闭。证据位于 `/volume2/SSD/codex/Temp/codex-web-multi-user-browser-smoke-YRSiAf/result.json`。
- 浏览器 smoke 发现并修复退出连接未主动关闭的问题：Web 退出成功后发布 `codex-web:logout`，AppServerProvider 停止重连并关闭 bridge，再进入登录页。
- 实际 root 环境 Linux UID smoke 通过：broker 为 UID/GID 0；`rrssnas` runtime 为 UID/GID 1000/10、补充组 10/100/133；`codex` runtime 为 UID/GID 1004/100、补充组 100/133；两者 effective/bounding capability 均清零，使用独立测试 `CODEX_HOME` 和 cwd，互相读取身份文件被拒绝，最后连接断开后两个进程均退出。证据位于 `/volume2/SSD/codex/Temp/codex-web-multi-user-uid-smoke-5DFEwR/result.json`。
- 统一 CLI 构建与回归通过：npm 只发布 `codex-web` bin；`serve`、legacy 无子命令和 `runtime` 分发通过；全量 149 个测试文件、680 项测试通过；npm dry-run 不包含旧 broker CLI 或 service。
- 统一 CLI 的 Chrome 150 真实浏览器 smoke 通过：实际运行构建后的 `codex-web runtime serve` 和 `codex-web serve`，双用户 UID、测试 `CODEX_HOME`、cwd、同用户复用、跨用户 marker 隔离与退出回收均通过。证据位于 `/volume2/SSD/codex/Temp/codex-web-unified-cli-browser-smoke-FQr070/result.json`。
- macOS 15.7.7 x86_64 单用户真实 Chrome smoke 通过：发布 tarball 安装在隔离目录，Web 登录、真实 app-server `initialize`、`model/list` 与 `account/read` 均通过，app-server UID 为 501，返回 7 个模型。证据保留在远端 `/private/tmp/codex-web-macos-smoke-bDaazu/single-v4-result.json`。
- macOS 多用户真实 Chrome smoke 通过：普通账号与 root 账号使用独立 browser context、`CODEX_HOME` 和 cwd；普通用户由 UID 0 的 sudo launcher 启动实际 UID 501 app-server，root app-server 为 UID 0；同用户第二页面复用同一 runtime，关闭第一个页面不影响第二个页面，最后页面关闭后两个 runtime 均回收。两个隔离环境各返回 7 个模型，未使用真实 Codex Home。证据保留在远端 `/private/tmp/codex-web-macos-smoke-bDaazu/multi-v8-result.json`。
- macOS 两份 LaunchDaemon 样例已在目标 Mac 使用 `plutil -lint` 通过。验证结束后已确认 Web、runtime、app-server、Chrome 和 Unix socket 均无残留监听；远端隔离目录按约束保留。
- macOS 适配后的本地全量回归为 149 个测试文件、683 项测试通过；生产 CLI 构建、Linux 单用户真实 app-server smoke 和 npm dry-run 通过。Linux root UID/Chrome smoke 有前述既有通过证据，但本轮因执行沙箱不能取得 root 未重新运行。
- 2026-08-04 配置热加载回归：全量测试与生产 CLI 构建通过。真实 Chrome 使用生产 runtime/Web CLI 和隔离目录验证无效配置回退、等价配置 PID 不变、运行中为同一 `osUser` 新增不同邮箱/密码/`CODEX_HOME` 账号、密码交叉拒绝、单用户 `CODEX_HOME` 替换和未变化用户持续在线。rrssnas 两个 app-server 均为 UID/GID `1000:10`，codex 热加载前后均为 `1004:100`；退出后进程和 socket 无残留。证据位于 `/volume2/SSD/codex/Temp/codex-web-unified-cli-browser-smoke-FdDug9/result.json`。
