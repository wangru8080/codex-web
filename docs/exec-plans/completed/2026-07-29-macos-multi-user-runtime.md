# macOS 多用户 Runtime 与桌面平台验收实施计划

关联技术交接：[2026-07-29-multi-user-runtime-broker.md](../../handover/2026-07-29-multi-user-runtime-broker.md)

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**完成状态：** Code complete、Tests pass、Smoke passed、Review passed。未发布、未提交、未推送。

**Goal:** 保留 Linux 多用户 runtime 行为，为 macOS 增加按系统用户隔离启动 app-server 的 runtime 与 launchd 部署样例，同时完成 macOS 单用户/多用户真实 Chrome 验收并明确 Windows 仅支持单用户。

**Architecture:** Web 登录、Session、Unix socket 协议和 `UserRuntimeRegistry` 保持不变，只在 runtime 的系统用户解析与进程启动边界按 `process.platform` 分派。Linux 继续使用 `getent + setpriv`；macOS 使用 `dscacheutil` 读取 UID/GID/home/shell，并由 root runtime 通过固定 `/usr/bin/sudo -n -H -u <user> -- /usr/bin/env -i ...` argv 初始化目标用户组和干净环境。Windows 的 `runtime serve` 在读取配置和创建 socket 前明确拒绝，单用户 `codex-web serve` 保持现有跨平台入口。

**Tech Stack:** Node.js 20.9+、TypeScript、Vitest、Codex app-server、Unix domain socket、systemd、launchd、Google Chrome CDP。

## Global Constraints

- 不修改 Web UI、聊天 reducer、app-server 协议、登录协议或 Session 格式。
- 不引入第三方依赖，不使用 shell 字符串拼接，不接受浏览器提供的 UID、GID、home、cwd、命令或环境变量。
- Linux `setpriv` argv、capability 清零和 parent-death signal 行为必须保持不变。
- macOS 非 root app-server 必须使用目标账号的主组和补充组，并在 `env -i` 后只接收 broker 构造的白名单环境。
- root runtime 继续要求 `allowRootRuntime` 与用户项 `allowRoot` 双重授权。
- Windows 本轮不支持多用户 runtime；`runtime hash-password` 仍可跨平台使用。
- 本地和远端测试不得读取真实 `CODEX_HOME`；本地使用 `/volume2/SSD/codex/Temp`，macOS 使用唯一 `/private/tmp/codex-web-macos-smoke-*` 目录。
- macOS 实机账号使用 `wr` 与 `root`，但两者的 `CODEX_HOME` 和 cwd 都指向隔离目录。
- 不删除测试文件；停止进程后保留隔离目录并报告路径。

---

### Task 1: Runtime 平台边界与用户解析

**Files:**
- Modify: `server/runtime-broker-launch.ts`
- Modify: `scripts/codex-web-broker-cli.ts`
- Test: `server/tests/runtime-broker-launch.test.ts`

**Interfaces:**
- Produces: `resolveRuntimeBrokerPlatform(platform: NodeJS.Platform): "linux" | "darwin"`，Windows 和其他平台抛出明确错误。
- Produces: `parseDarwinUserRecord(osUser: string, stdout: string): RuntimeUserRecord`，解析 `dscacheutil` 的 `uid`、`gid`、`dir`、`shell`。
- Produces: `lookupRuntimeUser(osUser: string, platform?: "linux" | "darwin"): Promise<RuntimeUserRecord>`。
- Changes: `buildBrokerRuntimeProcessOptions(config, user, platform?)` 和 `createBrokerRuntimeFactory(config, users, platform?)` 接收已解析平台。

- [x] **Step 1: 编写平台失败测试**

  断言 `resolveRuntimeBrokerPlatform("win32")` 抛出“多用户 runtime 仅支持 Linux 和 macOS”，Linux/macOS 分别返回 `linux`/`darwin`。

- [x] **Step 2: 编写 macOS 用户记录解析测试**

  使用固定 `dscacheutil` 输出断言普通用户与 root 的 UID、GID、home、shell；缺字段、非整数和 UID 0 别名继续拒绝。

- [x] **Step 3: 运行定向测试确认新增断言失败**

  Run: `npm exec vitest run server/tests/runtime-broker-launch.test.ts`

  Expected: FAIL，缺少平台解析和 macOS 记录解析接口。

- [x] **Step 4: 实现最小平台解析**

  Linux 查询固定执行 `/usr/bin/getent passwd <osUser>`；macOS 查询固定执行 `/usr/bin/dscacheutil -q user -a name <osUser>`。两条路径都使用 `execFile` argv，不启用 shell。

- [x] **Step 5: 在 CLI 启动最前面拒绝 Windows 多用户**

  `hash-password` 在平台校验前返回；`runtime serve` 先解析支持平台，再检查 UID 0、配置所有者和 socket。

- [x] **Step 6: 运行定向测试确认平台与用户解析通过**

  Run: `npm exec vitest run server/tests/runtime-broker-launch.test.ts scripts/tests/codex-web-broker-options.test.ts`

  Expected: PASS。

### Task 2: macOS 目标用户 app-server 启动

**Files:**
- Modify: `server/runtime-broker-launch.ts`
- Test: `server/tests/runtime-broker-launch.test.ts`

**Interfaces:**
- Linux non-root: `setpriv --reuid --regid --init-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --pdeathsig=SIGTERM -- <codex> app-server --stdio`。
- macOS non-root: `/usr/bin/sudo -n -H -u <osUser> -- /usr/bin/env -i KEY=VALUE ... <codex> app-server --stdio`。
- root: 两个平台都直接执行固定 `codexCommand app-server --stdio`。

- [x] **Step 1: 编写 macOS argv 与干净环境测试**

  断言命令固定为 `/usr/bin/sudo`，argv 不包含 `sh`/`-c`，`env -i` 后包含 broker 管理的 `HOME`、`USER`、`LOGNAME`、`SHELL`、`PATH`、`NODE_ENV`、`RUST_LOG`、`CODEX_HOME` 和允许的用户 env。

- [x] **Step 2: 编写 Linux 反例测试**

  断言传入 `linux` 后现有 `setpriv` argv 逐项不变，避免 macOS 分支削弱 Linux capability 与 parent-death 约束。

- [x] **Step 3: 运行定向测试确认 macOS argv 断言失败**

  Run: `npm exec vitest run server/tests/runtime-broker-launch.test.ts`

  Expected: FAIL，macOS 仍走 Linux `setpriv`。

- [x] **Step 4: 实现 macOS 启动分支**

  仅对已解析的 `darwin` 平台构造固定 sudo/env argv；用户自定义 env 继续经过现有保护变量和 `DYLD_*` 拒绝规则。

- [x] **Step 5: 运行 runtime broker 全部定向测试**

  Run: `npm exec vitest run server/tests/runtime-broker-config.test.ts server/tests/runtime-broker-launch.test.ts server/tests/runtime-broker-server.test.ts server/tests/user-runtime-registry.test.ts`

  Expected: PASS。

### Task 3: launchd 部署与发布接线

**Files:**
- Create: `deploy/launchd/com.codex-web.runtime.plist`
- Create: `deploy/launchd/com.codex-web.web.plist`
- Create: `deploy/launchd/users.example.json`
- Modify: `server/tests/production-entry-build-wiring.test.ts`

**Interfaces:**
- Runtime LaunchDaemon: root 启动 `codex-web runtime serve`，固定配置与 socket 参数，主组允许 Web 用户访问 `0660` socket。
- Web LaunchDaemon: 示例非 root 用户启动 `codex-web serve`，通过同一 socket 连接 runtime。
- npm 包继续发布一个 `codex-web` bin，现有 `files: ["deploy/"]` 同时包含 systemd 与 launchd 样例。

- [x] **Step 1: 编写 launchd 接线失败测试**

  读取两份 plist 和 macOS 用户配置，断言 runtime/Web 命令、root/非 root 边界、socket 一致、配置不包含真实账号或真实 `CODEX_HOME`。

- [x] **Step 2: 创建最小 launchd 样例**

  使用 `ProgramArguments` 数组，不使用 shell；配置 `RunAtLoad`、`KeepAlive`、`WorkingDirectory` 和必要环境变量。所有用户名与目录使用部署示例值。

- [x] **Step 3: 创建 macOS 用户配置样例**

  保持 version 1，不添加平台专用 schema；省略 Linux 专用 `setprivCommand`，使用 `/usr/local/bin/codex` 与 `/Users/<示例用户>` 结构。

- [x] **Step 4: 运行构建接线测试**

  Run: `npm exec vitest run server/tests/production-entry-build-wiring.test.ts`

  Expected: PASS。

### Task 4: 文档与交接

**Files:**
- Modify: `README.md`
- Modify: `docs/handover/2026-07-29-multi-user-runtime-broker.md`
- Modify: `docs/exec-plans/active/2026-07-29-macos-multi-user-runtime.md`

- [x] **Step 1: 更新支持矩阵**

  README 明确 Windows/macOS/Linux 单用户代码支持状态，Linux/macOS 多用户支持状态，以及 Windows 浏览器可以访问远端实例但 Windows 主机不运行多用户 runtime。

- [x] **Step 2: 增加 macOS launchd 部署步骤**

  写明共享组、隔离配置、plist 安装、`launchctl bootstrap/bootout`、日志、升级重启和 socket 目录权限；示例不得出现当前系统真实用户或路径。

- [x] **Step 3: 更新安全边界与验证台账**

  记录 macOS `dscacheutil + sudo + env -i`、Windows 拒绝、Linux 不回归，以及哪些结果来自静态测试、Linux 实机或 macOS 实机。

- [x] **Step 4: 文档自检**

  Run: `git diff --check`

  Run: `rg -n "runtime serve|launchd|Windows|macOS|setpriv|sudo -n" README.md docs/handover deploy/launchd`

  Expected: 命令、平台状态和部署文件一致。

### Task 5: 本地回归、构建与 Linux 实机 smoke

**Files:**
- Modify: `docs/exec-plans/active/2026-07-29-macos-multi-user-runtime.md`

- [x] **Step 1: 全量测试**

  Run: `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test`

  Expected: typecheck 与全部 Vitest 通过。

- [x] **Step 2: 生产 CLI 构建**

  Run: `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run build:cli`

  Expected: Next、production server 与单一 `dist/cli/codex-web.mjs` 构建通过。

- [x] **Step 3: npm 发布内容检查**

  Run: `npm pack --dry-run --ignore-scripts`

  Expected: 单一 CLI、systemd 与 launchd 样例均包含，未出现旧 broker bin。

- [x] **Step 4: Linux 单用户 smoke**

  Run: `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test:smoke`

  Expected: 真实 app-server initialize 往返通过。

- [ ] **Step 5: Linux UID 与真实 Chrome 回归**

  Run as root: `npm run test:smoke:multi-user:uid`

  Run as root: `npm run test:smoke:multi-user:unified-cli`

  Expected: Linux UID/GID、capability、双用户隔离、同用户复用与退出回收保持通过；不使用真实 `CODEX_HOME`。

  本轮未重跑：当前执行沙箱不是 root，`sudo` 受 no-new-privileges 限制。相同 Linux smoke 在 macOS 适配前已有真实 root 通过证据；本轮通过显式 Linux argv 单测和全量回归防止平台分支回归。

### Task 6: macOS 隔离实机验收

**Files:**
- Create local temporary artifacts only under `/volume2/SSD/codex/Temp/codex-web-macos-smoke-*`
- Create remote temporary artifacts only under `/private/tmp/codex-web-macos-smoke-*`
- Modify: `docs/exec-plans/active/2026-07-29-macos-multi-user-runtime.md`
- Modify: `docs/handover/2026-07-29-multi-user-runtime-broker.md`

- [x] **Step 1: 创建唯一隔离目录并传输发布产物**

  本地构建 tarball 后通过 `scp` 复制到 `wr@192.168.3.121` 的唯一临时目录；远端只在该目录执行 npm 安装，不覆盖全局 CLI。

- [x] **Step 2: macOS 单用户真实 Chrome smoke**

  以 `wr` 启动隔离 `codex-web serve`，使用隔离 `CODEX_HOME`/cwd 和真实 `/usr/local/bin/codex`；Chrome 使用独立 `--user-data-dir`。断言 Web 登录、bridge initialize、`model/list`、app-server 平台、退出和进程停止。

- [x] **Step 3: 准备 macOS 多用户 root runtime**

  配置仅包含 `wr` 与双重授权 root，两个账号的 `CODEX_HOME`/cwd 均位于隔离目录。由于远端 sudo 需要密码，由用户手动以 root 运行隔离 smoke；LaunchDaemon 样例另行通过 `plutil -lint` 验证。

- [x] **Step 4: macOS 多用户真实 Chrome smoke**

  使用两个独立 browser context 登录 `wr` 与 root；断言 initialize 返回各自隔离 home/cwd，同用户第二页面复用一个 runtime，不同用户 thread/notification 不串线，最后连接退出后两个 app-server 回收。

- [x] **Step 5: 停止远端测试服务**

  smoke 在 `finally` 中停止 Web、runtime 和 Chrome；随后只读确认 app-server 和 socket 也无残留监听。远端临时目录保留并记录。

### Task 7: 归档与完成状态

**Files:**
- Move: `docs/exec-plans/active/2026-07-29-macos-multi-user-runtime.md` to `docs/exec-plans/completed/2026-07-29-macos-multi-user-runtime.md`
- Modify before move: the same plan file

- [x] **Step 1: 更新全部 checklist 与 Smoke Ledger**

  分别记录单元测试、构建、npm dry-run、Linux smoke、macOS 单用户和 macOS 多用户结果，未执行的平台不得写成通过。

- [x] **Step 2: 检查工作区与临时产物边界**

  Run: `git status --short`

  Run: `git diff --check`

  Expected: Git 只包含计划内源码、测试、部署和文档；没有日志、截图、tarball、隔离配置或密码哈希进入仓库。

- [x] **Step 3: 归档计划**

  将计划移动到 `docs/exec-plans/completed/`，不删除任何历史文件，不自动提交或推送 Git。

## 验收标准

- `codex-web serve` 在 Linux/macOS 保持可用，Windows 单用户入口没有被多用户平台校验阻断。
- `codex-web runtime serve` 在 Linux 使用原有 `setpriv`，在 macOS 使用 `dscacheutil + sudo + env -i`，在 Windows 创建 socket 前明确拒绝。
- Linux 与 macOS 的同用户复用、跨用户隔离和退出回收语义一致。
- macOS 实机验证只使用 `/private/tmp/codex-web-macos-smoke-*`，不读取或修改 `wr`、root 的真实 Codex Home。
- npm 仍只发布一个 `codex-web` CLI，并同时携带 systemd 与 launchd 部署样例。

## 验证记录

- 调研：Node `child_process.spawn` 支持 POSIX UID/GID；Apple 要求系统 daemon 使用 root-owned LaunchDaemon；macOS 实机 `dscacheutil` 为普通用户和 root 返回唯一规范化 UID、GID、home 与 shell。
- macOS 环境预检：macOS 15.7.7 x86_64，Node 24.14.0，npm 11.18.0，Codex CLI 0.144.6，Google Chrome 150；SSH 用户 `wr`，`sudo` 需要交互密码。
- 定向 runtime 测试：5 个测试文件、21 项测试通过；覆盖 Linux `setpriv` 反例、macOS `dscacheutil` 解析、sudo/env argv、配置与 registry 生命周期。
- 全量测试：`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test` 通过，149 个测试文件、683 项测试。
- 生产构建：`npm run build:cli` 通过，Next、production server 和单一 `dist/cli/codex-web.mjs` 均生成。
- 发布清单：`npm pack --dry-run --ignore-scripts` 通过，共 1659 个文件、17.4 MB；包含单一 `codex-web` bin、systemd 与 launchd 样例，不含旧 broker bin。
- Linux 单用户 smoke：真实 app-server initialize、`model/list` 和 `account/read` 通过，使用默认隔离 `CODEX_HOME`。Linux root UID/真实 Chrome smoke 本轮因沙箱不具备 root 未重跑；既有通过证据记录在关联交接文档。
- macOS plist：两份 LaunchDaemon 样例在目标 Mac 使用 `plutil -lint` 通过。
- macOS 单用户 smoke：真实 Chrome 登录、WebSocket bridge、app-server initialize、`model/list`、`account/read` 通过；app-server UID 501，模型 7 个，证据 `/private/tmp/codex-web-macos-smoke-bDaazu/single-v4-result.json`。
- macOS 多用户正例：普通账号与 root 账号在独立 browser context 登录，分别使用 UID 501 与 UID 0 app-server、独立隔离 `CODEX_HOME`/cwd；同用户第二页面复用同一 runtime；最后页面关闭后 runtime 均退出。两个用户各返回 7 个模型，证据 `/private/tmp/codex-web-macos-smoke-bDaazu/multi-v8-result.json`。
- macOS 多用户反例：关闭普通用户第一个页面后 runtime 仍存在；关闭第二页面后仅普通用户 runtime 退出，root runtime 保持；关闭 root 页面后 root runtime 退出。未观察到跨用户身份或路径串线。
- 隔离与清理：未读取真实 Codex Home；本地临时产物保留在 `/volume2/SSD/codex/Temp/codex-web-macos-smoke-8yIqPO`，远端产物保留在 `/private/tmp/codex-web-macos-smoke-bDaazu`。验证结束后已确认没有 Web、runtime、app-server、Chrome 或 socket 监听残留。
