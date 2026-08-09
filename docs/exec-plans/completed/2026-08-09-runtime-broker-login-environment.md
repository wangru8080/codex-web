# Runtime Broker 按用户加载登录环境

状态：Smoke passed

## 目标

在保持 `inheritEnv: false` 的前提下，让每个 Runtime Broker 用户可以选择执行自己的登录 shell profile，再将环境变量传给该用户的 app-server 和 MCP 子进程。

## 方案

1. 在用户配置增加可选 `inheritLoginEnvironment` 开关，默认关闭。
2. Broker 使用 `setpriv` 或 `sudo` 降权，以系统账号登记的 shell 执行登录 profile，并在 5 秒内获取带标记的 NUL 分隔环境快照。
3. 过滤 Broker 管理变量、动态加载变量和非法变量名，不继承 Broker 的全局环境。
4. 环境合并顺序为登录 shell 环境、`users[].env`、Broker 强制身份变量；显式用户配置覆盖 profile 同名变量。
5. profile 失败、超时或缺失环境标记时，明确阻止对应用户 runtime 启动。

## 验收

- 配置解析接受布尔 `inheritLoginEnvironment`，拒绝非法字段值。
- 用户 A 的登录环境变量不会出现在用户 B 的启动环境中。
- profile 输出文字不会污染标记后的环境数据，受保护变量不会覆盖 Broker 身份变量。
- profile 失败或超时时，用户 runtime 不启动并返回明确错误。
- Linux/macOS 启动参数继续使用干净环境，现有测试通过。

## Smoke Ledger

- 正例：启用 `inheritLoginEnvironment` 时，每个用户分别加载自己的登录环境，`users[].env` 覆盖同名变量。
- 反例：用户 A 的专属变量不会进入用户 B；`HOME`、`NODE_OPTIONS`、`LD_*` 等受保护变量不会覆盖 Broker 管理环境。
- 验证：`npm test` 通过，180 个测试文件、871 项测试；`npm run build` 通过。
- 浏览器 smoke：`npm run test:smoke:multi-user` 通过，真实 Chrome 验证多账号登录、隔离 CODEX_HOME、热加载、并发限制和 runtime 回收。
- GitHub MCP：登录 shell 能读取 `GITHUB_PAT_TOKEN`；隔离 CODEX_HOME 页面最终显示 `Connected`、`bearerToken`、44 个工具、4 个资源和 5 个资源模板。
- root UID smoke：Broker 以 UID 0 运行，`rrssnas`/`codex` app-server 分别切换到 UID 1000/1004，Broker 全局环境未泄漏，用户环境标记按账号隔离，跨用户文件读取被拒绝，Linux capabilities 清零，runtime 全部回收。
- Session UI smoke：配置变化后旧 Web Session 返回 401，页面停止重连并自动跳转登录页，失效提示可见；重新登录后返回原链路，未变化用户保持在线。
- Profile 现状：两个账号的 `ugnas.conf` 都指向 `/root/ugnas.conf`，因此两边都按配置获得 GitHub Token；这是共享 profile 值，不是 Broker 串环境。
- 诊断修复：多用户 smoke 的 root fixture 增加隔离 `CODEX_WEB_STATE`，避免非 root runner 读取 `/root/.codex-web`。
