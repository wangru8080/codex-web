# 多用户 Runtime Broker 技术交接

关联执行计划：[2026-07-29-multi-user-runtime-broker.md](../exec-plans/completed/2026-07-29-multi-user-runtime-broker.md)

延期事项：[2026-07-29-multi-user-runtime-broker-followups.md](../exec-plans/deferred/2026-07-29-multi-user-runtime-broker-followups.md)

## 用户能力

- 一个非 root Codex Web 支持多个静态账号并发登录。
- 每个账号固定映射一个白名单 Linux 用户，拥有独立 UID、组、home、`CODEX_HOME`、cwd 和 Codex 账号状态。
- 同一用户的多个浏览器共享一个 app-server；不同用户不共享 transport、notification 或 approval。
- 登录不启动 runtime。首次 WebSocket attach 懒启动，最后连接离开后按宽限期和 active Turn 状态回收。

## 信任边界

root broker 独占 root-owned `0600` JSON 配置，其中包含 scrypt 密码哈希和 HMAC Session secret。非 root Web 进程只能访问 `0660` Unix socket，不能读取配置或各用户 Codex 凭据。浏览器只持有 SameSite Strict、HttpOnly Session cookie。

登录请求只能提交邮箱和密码。UID、GID、Linux 用户名、home、`CODEX_HOME`、cwd、可执行文件和 argv 全部来自静态配置与系统用户数据库。broker 启动时核对系统 home；普通用户通过固定 `setpriv` argv 初始化 UID、GID和补充组并清除 capability。UID 0 只接受 `osUser=root`，且要求全局和用户项双重授权。

app-server 使用干净环境，不继承 broker 的配置或 Session secret。配置拒绝覆盖身份变量以及 `LD_*`、`DYLD_*`、`NODE_OPTIONS` 等加载器或运行时注入变量。

## 运行协议

Web 与 broker 通过 NDJSON Unix socket 通信：

- `login`：scrypt 校验并签发 HMAC Session；错误尝试按规范化邮箱限速，不信任客户端可控的代理来源头。
- `verifySession`：Proxy 与敏感 API 独立验证 Cookie。
- `attachRuntime`：再次验证 Session，成功后连接切换为双向 JSON-RPC message stream。

WebSocket upgrade 先验证远程连接策略、同源 Origin 和 cookie，再 attach broker。浏览器不会收到共享 bridge token。legacy 单用户模式继续使用原有环境变量登录和 query token bridge。

## 进程生命周期

`UserRuntimeRegistry` 以用户 ID 为键维护 `PersistentAppServer`、浏览器 peer 和 active Turn 集合。`turn/started` 加入 active Turn，`turn/completed` 移除。同用户最后 peer 离开且没有 active Turn 时启动 `disconnectGraceMs` 定时器；重连取消定时器。broker 关闭时立即关闭全部 runtime。

## 部署

参考 `deploy/systemd/`。示例假设：

- Web 用户为 `codex`。
- Web 与 broker 共享组为 `codex-web-runtime`。
- CLI 位于 `/usr/local/bin`。
- broker 配置位于 `/etc/codex-web/users.json`。
- socket 位于 `/run/codex-web/runtime-broker.sock`。

实际安装 systemd 文件、创建用户/组或写入 `/etc` 不属于仓库构建流程，需要管理员在核对路径后执行。升级 npm 包后应同时重启 broker 和 Web 服务，使两个预编译入口使用同一版本协议。

## 诊断与限制

- `/api/codex/bridge-url` 返回当前认证用户、home 和同源 bridge 路径。
- app-server initialize 仍是 UI 中 `CODEX_HOME` 的事实源。
- 首版账号来自静态 JSON，不提供浏览器用户管理界面。
- Turnstile 是 Web 全局配置；broker 普通用户只读，只有 `admin` 角色可更新。
- broker 只适用于 Linux；`setpriv` 与系统用户解析没有跨平台回退。

## 验证记录

- broker 配置、密码、Session、分帧、服务端、runtime registry 与降权 argv 定向测试。
- legacy Web auth、Origin、Proxy 与 route wiring 定向测试。
- 真实 Unix broker + HTTP WebSocket 集成测试：无 cookie 拒绝、同用户双浏览器复用、不同用户 JSON-RPC 隔离。
- 全量 Vitest：149 个测试文件、676 项测试通过。
- Next 生产构建、生产 server、`codex-web` 与 `codex-web-broker` 两个 CLI 构建通过；npm dry-run 清单包含两个 bin 和部署样例。
- Chrome 150 CDP 真实浏览器 smoke 通过：`rrssnas` 与 `codex` 使用独立浏览器 context 登录，返回各自 home 和测试 `CODEX_HOME`；同用户第二页面复用一个 runtime；跨用户 marker 不串线；最后连接退出后两个 runtime 均关闭。证据位于 `/volume2/SSD/codex/Temp/codex-web-multi-user-browser-smoke-YRSiAf/result.json`。
- 浏览器 smoke 发现并修复退出连接未主动关闭的问题：Web 退出成功后发布 `codex-web:logout`，AppServerProvider 停止重连并关闭 bridge，再进入登录页。
- 实际 root 环境 Linux UID smoke 通过：broker 为 UID/GID 0；`rrssnas` runtime 为 UID/GID 1000/10、补充组 10/100/133；`codex` runtime 为 UID/GID 1004/100、补充组 100/133；两者 effective/bounding capability 均清零，使用独立测试 `CODEX_HOME` 和 cwd，互相读取身份文件被拒绝，最后连接断开后两个进程均退出。证据位于 `/volume2/SSD/codex/Temp/codex-web-multi-user-uid-smoke-5DFEwR/result.json`。
