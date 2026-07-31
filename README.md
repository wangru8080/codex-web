# Codex Web

Codex Web 是基于官方 `codex app-server` 的浏览器工作台。它在浏览器中提供 Codex 会话、工具执行、权限审批、项目文件和扩展管理，并以 app-server 的实时事件作为状态来源。

Codex Web 不替代 Codex CLI，也不在浏览器中保存 OpenAI OAuth token 或 API Key。Web bridge 负责在服务端启动 `codex app-server --stdio`，浏览器通过同源 HTTP 和 WebSocket 使用这些能力。

项目地址：[https://github.com/wangru8080/codex-web](https://github.com/wangru8080/codex-web)

## 功能

### 对话与任务

- 新建 Codex 对话，并为每个对话选择工作目录。
- 从 app-server 加载历史对话，支持恢复、历史分页、重命名、归档和取消归档。
- 实时显示回答、推理摘要、运行状态、Token 使用和上下文窗口。
- 支持中断运行、编辑最后一条用户消息并回滚后续 Turn。
- 支持 Goal、Plan、Review 和上下文压缩。
- 同一 Web bridge 下的多个浏览器客户端可以同步用户消息、流式输出、工具状态和审批请求。

### 模型、权限与工具

- 模型列表来自 app-server `model/list`，可选择模型和推理强度。
- 可以按 Thread 设置权限策略和 sandbox 行为。
- 展示命令执行、文件修改、MCP 工具、协作工具及其增量输出。
- 在浏览器中处理命令、文件修改和权限申请。
- 支持 app-server 发起的用户输入表单与 MCP elicitation。
- 未识别的 app-server notification 会保留在诊断信息中，不会静默丢弃。

### 项目文件与附件

- 浏览当前工作目录的文件树，并跟随 app-server 文件变更事件刷新。
- 预览文本、Markdown、代码、图片、PDF、Word（DOC/DOCX）和 Excel（XLS/XLSX）文件；旧版 DOC 为实验性兼容，复杂排版可能存在差异。
- 从文件树将文件、目录或文件片段加入对话。
- 支持图片和普通文件附件，并在历史会话中恢复附件展示。
- 支持本地文件链接、外部链接、图片输出和文件变更差异展示。

### Skills 与 MCP

- 从 app-server 读取 Skills，查看详情、启用或停用，并将 Skill 直接加入新对话。
- 创建用户级或项目级 Skill。
- 查看和编辑 MCP server 配置，支持启停、重新加载和运行状态检查。
- MCP 配置和运行状态分别来自 app-server 配置接口与 `mcpServerStatus/list`。

### 账户与界面

- 在设置页通过 OpenAI 账户授权或 API Key 登录 Codex。
- 查看 Codex 账户状态和 app-server 提供的使用额度信息。
- 支持中文和英文、主题切换、桌面与移动端响应式布局。
- 提供独立的 Web 登录保护，并可选接入 Cloudflare Turnstile。
- 浏览器断线后自动重连；app-server 异常退出后，bridge 会尝试重新启动它。

## 架构

```text
浏览器
  |
  | HTTP / WebSocket
  v
Codex Web + Web bridge
  |
  | JSON-RPC over stdio
  v
codex app-server
```

浏览器不会直接启动本地进程。`codex-web serve` 启动 Next.js 应用和 Web bridge：单用户模式由 Web bridge 启动本机 `codex app-server`；多用户模式由 Web bridge 连接独立的 runtime，再由 runtime 按登录账号启动对应系统用户的 `codex app-server`。

### 平台支持

| 服务端运行方式 | Linux | macOS | Windows |
|---|---|---|---|
| 单用户 `codex-web serve` | 支持 | 支持 | 支持 |
| 多用户 `codex-web runtime serve` | 支持，使用 `setpriv` | 支持，使用 `dscacheutil` 与 `sudo` | 不支持 |

浏览器客户端不受服务端操作系统限制。Windows 或 macOS 浏览器可以访问部署在 Linux/macOS 上的 Codex Web；表格描述的是运行 Codex Web、runtime 和 app-server 的服务端系统。

### 多用户 Runtime Broker

Linux 或 macOS 上可以运行一个非 root Codex Web，并由本机 root runtime 按登录账号启动对应系统用户的 `codex app-server`：

```text
浏览器会话 A ─┐
              ├─> Codex Web（<web-user>）
浏览器会话 B ─┘          │
                         │ Unix socket：<runtime-socket>
                         v
                   Runtime（root）
                     ├─> app-server（<linux-user-a>）
                     └─> app-server（<linux-user-b>）
```

Codex Web 和 runtime 是两个常驻进程。登录本身不会创建 app-server；某个用户首次建立 WebSocket bridge 时才启动该用户的 app-server。同一用户的多个浏览器共享一个 app-server，不同用户的 UID、补充组、`HOME`、`CODEX_HOME`、cwd、消息和审批相互隔离。最后一个连接断开后，没有运行中 Turn 时会在宽限期结束后退出；有运行中 Turn 时等待其完成再退出。

broker 配置必须由 root 拥有且权限为 `0600`。生成密码哈希：

```bash
printf '%s' '独立强密码' | codex-web runtime hash-password
openssl rand -hex 32
```

Linux 以 [`deploy/systemd/users.example.json`](deploy/systemd/users.example.json) 为配置模板，macOS 以 [`deploy/launchd/users.example.json`](deploy/launchd/users.example.json) 为模板。替换密码哈希与 Session 密钥，并保证每个用户的 `osUser` 和 `home` 与系统账户数据库一致。Linux 普通用户通过固定的 `setpriv` 降权；macOS 普通用户通过固定的 `sudo -n -H -u` 初始化目标账号的主组和补充组，再由 `env -i` 建立干净环境。两种平台都不使用 shell 拼接。允许登录 root 环境时，还必须同时设置全局 `allowRootRuntime: true` 和 root 用户项 `allowRoot: true`，否则 runtime 拒绝启动 UID 0 app-server。

#### Linux systemd 部署

仓库提供两个 systemd 样例：

- [`codex-web-runtime.service`](deploy/systemd/codex-web-runtime.service)：以 root 运行 runtime broker，仅监听权限为 `0660` 的 Unix socket。
- [`codex-web.service`](deploy/systemd/codex-web.service)：以普通用户运行 Web，通过 `codex-web-runtime` 组访问 socket。

两个服务使用同一个 `codex-web` CLI：Web 执行 `codex-web serve`，runtime broker 执行 `codex-web runtime serve`。原有 `codex-web --host ... --port ...` 单用户命令继续兼容。安装前应按实际 npm 全局 bin 路径、Web 用户、工作目录、监听地址和反向代理地址调整样例。多用户 Web 进程只需要 `CODEX_WEB_RUNTIME_BROKER_SOCKET`，不需要读取用户密码哈希、broker Session secret 或用户的 Codex 凭据。移除该变量并恢复 `CODEX_WEB_LOGIN_*` 后即可回到单用户模式。

部署前先确认命令位置：

```bash
command -v codex-web
command -v codex
command -v setpriv
```

创建共享组并安装配置模板；共享组已存在时跳过创建：

```bash
getent group codex-web-runtime >/dev/null || sudo groupadd --system codex-web-runtime
sudo install -d -o root -g root -m 0750 /etc/codex-web
sudo install -o root -g root -m 0600 deploy/systemd/users.example.json /etc/codex-web/users.json
sudoedit /etc/codex-web/users.json
```

在配置中为每个登录账号填写唯一的 `id`、登录邮箱、密码哈希、Linux 用户、home、`CODEX_HOME` 和 cwd。`codexCommand`、`setprivCommand`、用户 home 和 cwd 都必须使用目标服务器上的绝对路径。runtime 配置必须由 root 拥有且权限为 `0600`，多用户 Web 进程不能读取它。

安装 systemd 单元后，根据目标服务器修改其中的 `User`、`WorkingDirectory`、`ExecStart`、监听地址和端口：

```bash
sudo install -o root -g root -m 0644 deploy/systemd/codex-web-runtime.service /etc/systemd/system/codex-web-runtime.service
sudo install -o root -g root -m 0644 deploy/systemd/codex-web.service /etc/systemd/system/codex-web.service
sudoedit /etc/systemd/system/codex-web-runtime.service
sudoedit /etc/systemd/system/codex-web.service
sudo systemctl daemon-reload
sudo systemctl enable --now codex-web-runtime.service codex-web.service
```

检查两个常驻服务及其日志：

```bash
systemctl status codex-web-runtime.service codex-web.service
journalctl -u codex-web-runtime.service -u codex-web.service -f
```

runtime socket 由 systemd 的 `RuntimeDirectory` 和 runtime 进程创建，不需要手动创建。未登录时不会启动任何用户 app-server。

#### macOS launchd 部署

仓库提供三个 macOS 样例：

- [`com.codex-web.runtime.plist`](deploy/launchd/com.codex-web.runtime.plist)：root LaunchDaemon，运行 `codex-web runtime serve`。
- [`com.codex-web.web.plist`](deploy/launchd/com.codex-web.web.plist)：以示例非 root 用户运行 `codex-web serve`。
- [`users.example.json`](deploy/launchd/users.example.json)：macOS 用户映射模板。

先确认命令位置，并选择一个已存在的非 root Web 服务账号：

```bash
command -v codex-web
command -v codex
command -v dscacheutil
command -v sudo
WEB_USER="codexweb"
```

如果实际命令路径、Web 用户或工作目录与样例不同，必须先修改 plist 和用户配置。创建共享组及持久目录：

```bash
sudo dseditgroup -o create codex-web-runtime
sudo dseditgroup -o edit -a "$WEB_USER" -t user codex-web-runtime
sudo install -d -o root -g wheel -m 0750 "/Library/Application Support/CodexWeb"
sudo install -d -o root -g codex-web-runtime -m 0750 "/Library/Application Support/CodexWeb/run"
sudo install -d -o root -g wheel -m 0755 "/Library/Logs/CodexWeb"
sudo install -d -o "$WEB_USER" -g codex-web-runtime -m 0750 "/Users/Shared/CodexWeb/workspace"
sudo install -d -o "$WEB_USER" -g codex-web-runtime -m 0700 "/Users/Shared/CodexWeb/web-state"
```

安装配置和 LaunchDaemon；先编辑目标文件，再加载服务：

```bash
sudo install -o root -g wheel -m 0600 deploy/launchd/users.example.json "/Library/Application Support/CodexWeb/users.json"
sudo install -o root -g wheel -m 0644 deploy/launchd/com.codex-web.runtime.plist /Library/LaunchDaemons/com.codex-web.runtime.plist
sudo install -o root -g wheel -m 0644 deploy/launchd/com.codex-web.web.plist /Library/LaunchDaemons/com.codex-web.web.plist
sudo nano "/Library/Application Support/CodexWeb/users.json"
sudo nano /Library/LaunchDaemons/com.codex-web.runtime.plist
sudo nano /Library/LaunchDaemons/com.codex-web.web.plist
sudo plutil -lint /Library/LaunchDaemons/com.codex-web.runtime.plist /Library/LaunchDaemons/com.codex-web.web.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/com.codex-web.runtime.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/com.codex-web.web.plist
```

检查服务与日志：

```bash
sudo launchctl print system/com.codex-web.runtime
sudo launchctl print system/com.codex-web.web
sudo tail -f /Library/Logs/CodexWeb/runtime-error.log /Library/Logs/CodexWeb/web-error.log
```

停止并卸载两个 LaunchDaemon：

```bash
sudo launchctl bootout system/com.codex-web.web
sudo launchctl bootout system/com.codex-web.runtime
```

macOS socket 父目录需要预先创建，但 socket 文件由 runtime 创建，不要手动创建。未登录时，两个 LaunchDaemon 常驻，但不会启动任何用户 app-server。

## 运行要求

- Node.js 20.9.0 或更高版本。
- 已安装 Codex CLI，并且可以通过 `PATH` 执行 `codex app-server`。
- 单用户服务支持 Linux、macOS 和 Windows；多用户 runtime 仅支持 Linux 与 macOS。
- 用于访问界面的现代浏览器。

检查环境：

```bash
node --version
npm --version
codex --version
```

## 安装

### 从源码构建 tarball

也可以在源码仓库中构建 npm tarball，再全局安装该产物：

```bash
git clone https://github.com/wangru8080/codex-web.git
cd codex-web
npm install
npm pack
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
mv "./wangru8080-codex-web-${PACKAGE_VERSION}.tgz" "./codex-web-${PACKAGE_VERSION}.tgz"
npm install --global "./codex-web-${PACKAGE_VERSION}.tgz"
```

`npm pack` 会自动执行生产构建和 CLI 打包。scoped 包默认生成 `wangru8080-codex-web-<版本>.tgz`，上述命令将其重命名为 GitHub Release 使用的 `codex-web-<版本>.tgz`。

安装后检查命令：

```bash
codex-web --version
codex-web --help
```

### 从 GitHub 仓库安装

GitHub 仓库已经公开，可以直接安装当前 `master` 分支：

```bash
npm install --global "github:wangru8080/codex-web#master"
```

这种方式会在安装机器上下载开发依赖并执行完整构建，速度较慢。正式版本更适合使用 GitHub Release 中预先构建的 tarball。

### 从 GitHub Release 安装

发布 GitHub Release 后，可以安装 Release 附件：

```bash
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
npm install --global "https://github.com/wangru8080/codex-web/releases/download/v${PACKAGE_VERSION}/codex-web-${PACKAGE_VERSION}.tgz"
```

### 从 npm registry 安装

可以从 npm 官方 registry 直接安装：

```bash
npm install --global @wangru8080/codex-web --registry=https://registry.npmjs.org/
```

## 快速开始

### 0. 安装codex

```bash
npm install -g @openai/codex
```

### 1. 生成 Web 会话密钥

只生成一次，并将结果保存在服务端的安全配置中：

```bash
openssl rand -hex 32
```

不要在每次启动时重新生成。修改会话密钥会让已有 Web 登录会话立即失效。

### 2. 配置 Web 登录

```bash
export CODEX_WEB_LOGIN_EMAIL="admin@example.com"
export CODEX_WEB_LOGIN_PASSWORD="<独立强密码>"
export CODEX_WEB_SESSION_SECRET="<至少32个字符的固定随机密钥>"
```

这些变量用于保护 Codex Web 页面，不是 OpenAI 账户凭据。OpenAI 账户或 API Key 在登录 Web 后通过“设置 -> Codex”接入 app-server。

### 3. 在项目目录中启动

```bash
cd /path/to/your/project
codex-web serve --open
```

默认地址为 `http://127.0.0.1:3001`。`--open` 会在服务启动后打开默认浏览器。旧命令 `codex-web --open` 仍然兼容，等价于 `codex-web serve --open`。

### 4. 登录并开始对话

1. 使用 `CODEX_WEB_LOGIN_EMAIL` 和 `CODEX_WEB_LOGIN_PASSWORD` 登录 Web。
2. 打开“设置 -> Codex”，检查 app-server 连接状态。
3. 根据需要完成 OpenAI 账户授权或 API Key 登录。
4. 返回“新建对话”，选择项目目录、模型、推理强度和权限策略。
5. 输入任务，或添加文件、Skill 和附件后发送。

## Web UI 输入框便捷操作

输入框可以直接组合项目上下文、Skills 和内置命令：

- 输入 `@` 搜索并引用当前项目中的文件或目录。
- 输入 `$` 搜索已启用的 Skills；可以同时添加多个 Skill，再补充具体任务后发送。
- 输入 `/` 打开内置命令选择器。
- 点击左下角 `+` 菜单，可以添加文件上下文、设置 Goal 或进入 Plan 模式。
- 可以选择本地文件、把文件或目录拖入输入框，或者直接粘贴剪贴板中的图片和文件。
- 可以从项目文件树添加文件或目录，也可以在文件预览中选中内容后将片段加入对话。
- 文件、目录、附件和选中文本会显示为可单独移除的标签，并提供估算 Token 供发送前参考。
- 执行包含计划的任务时，输入框上方会显示可折叠的任务进度；产生文件修改后会切换为文件变更与任务进度并排展示。
- 如果发送未被接受或发生错误，输入内容和附件会保留在输入框中，便于调整后重试。

Codex 正在生成时，输入普通消息并发送会将其加入待发送队列；输入框没有待发送内容时，可以使用停止按钮中断当前 Turn。输入框底部还可以直接调整权限策略、模型和推理力度。

### 内置命令

| 命令 | 用途 |
|---|---|
| `/mcp` | 查看 MCP server 的连接和运行状态。 |
| `/review` | 审查未暂存的更改，或与指定分支进行比较。 |
| `/compact` | 压缩当前任务的上下文。 |
| `/reasoning` | 调整当前模型的推理力度。 |
| `/model` | 选择当前任务使用的模型。 |
| `/status` | 查看任务 ID、上下文用量和速率限制。 |
| `/goal` | 设置 Codex 将持续追求的目标。 |
| `/plan` | 进入 Plan 模式，先讨论和制定计划。 |
| `/memories` | 配置当前任务的记忆使用与生成行为。 |

## CLI 参数

```text
codex-web serve [选项]
codex-web runtime serve --config <绝对路径> --socket <绝对路径>
printf '%s' '密码' | codex-web runtime hash-password
codex-web [选项]  # 兼容原有单用户命令

serve 选项：
--host <地址>         监听地址，默认 127.0.0.1
--port <端口>         HTTP 端口，默认 3001；0 表示随机端口
--codex-home <路径>   Codex 配置与会话目录，默认 CODEX_HOME 或 ~/.codex
--open                启动后打开默认浏览器，不能与 --port 0 同时使用
-h, --help            显示帮助
-v, --version         显示版本

runtime serve 必需参数：
--config <绝对路径>   root 拥有、权限为 0600 的用户配置文件
--socket <绝对路径>   Web 与 runtime 通信的 Unix socket
```

`codex-web runtime serve` 仅支持 Linux 与 macOS，并且必须以 root 启动。Windows 调用该命令会在读取配置或创建 socket 前失败。`codex-web runtime hash-password` 从标准输入读取密码并输出可写入用户配置的 scrypt 哈希，不需要 root 权限。

也可以使用以下环境变量：

| 环境变量 | 用途 | 必需 |
|---|---|---|
| `CODEX_WEB_LOGIN_EMAIL` | Web 登录邮箱 | 单用户模式 |
| `CODEX_WEB_LOGIN_PASSWORD` | Web 登录密码 | 单用户模式 |
| `CODEX_WEB_SESSION_SECRET` | Web 会话签名密钥，至少 32 个字符 | 单用户模式 |
| `CODEX_HOME` | 单用户 app-server 的配置目录；多用户模式下只用于 Web 自身状态 | 否 |
| `PORT` | HTTP 端口 | 否 |
| `CODEX_WEB_NEXT_HOST` | 监听地址 | 否 |
| `CODEX_WEB_PUBLIC_HOST` | `--open` 使用的公开主机名 | 否 |
| `CODEX_WEB_RUNTIME_BROKER_SOCKET` | 启用多用户模式的 Unix socket 绝对路径；与单用户登录变量二选一 | 多用户模式 |

## CODEX_HOME 与工作目录

Codex Web 使用三个彼此独立的路径：

- 安装目录：保存 Codex Web 的 `.next`、主题和 CLI 资源。
- 工作目录：执行 `codex-web` 时所在的目录，会作为 app-server 的 cwd。
- `CODEX_HOME`：保存 Codex 账户、配置、历史会话、MCP 和 Skills。

`CODEX_HOME` 的优先级为：

1. `--codex-home <路径>`
2. 环境变量 `CODEX_HOME`
3. 当前用户的 `~/.codex`

如果已经设置 `CODEX_HOME`，通常不需要再传 `--codex-home`。只有临时切换到另一个 Codex 环境时才需要命令行参数。

## 登录与安全

- Web 登录会话有效期为 3 天。
- 修改 Web 登录邮箱、密码或 session secret 会让已有会话立即失效。
- 登录邮箱、密码和 session secret 只在服务端读取。
- OpenAI OAuth token 和 API Key 由 Codex app-server 管理，不写入浏览器存储。
- 默认监听 `127.0.0.1`，只允许本机访问。
- WebSocket bridge 校验连接 token、Origin 和远程连接策略。

需要向局域网或公网提供访问时，至少应配置 HTTPS 反向代理、防火墙和访问控制，然后再显式监听外部地址：

```bash
codex-web serve --host 0.0.0.0 --port 3001
```

不要将未配置 HTTPS 和访问限制的实例直接暴露到公网。

### Cloudflare Turnstile

登录后打开“设置 -> 安全”可以启用 Turnstile。配置保存在：

```text
${CODEX_HOME}/codex-web/turnstile.json
```

私密密钥不会返回浏览器。启用后，每次登录都需要服务端向 Cloudflare Siteverify 验证一次性 token。

## 升级

使用源码或 GitHub Release tarball 安装时，下载或生成新版本 tarball，然后再次执行全局安装：

```bash
npm install --global ./codex-web-<新版本>.tgz
```

不要直接修改全局安装目录中的 `.next` 或 `dist` 文件。

当前浏览器版的“检查更新”与“安装更新”还没有接入 CLI/npm 更新流程，升级需要在命令行完成。

systemd 多用户部署升级 CLI 后，需要重启两个常驻服务，使 Web 与 runtime 使用同一版本：

```bash
sudo systemctl restart codex-web-runtime.service
sudo systemctl restart codex-web.service
```

macOS launchd 部署升级 CLI 后执行：

```bash
sudo launchctl kickstart -k system/com.codex-web.runtime
sudo launchctl kickstart -k system/com.codex-web.web
```

## 源码开发

```bash
git clone https://github.com/wangru8080/codex-web.git
cd codex-web
npm install

export CODEX_HOME="${TMPDIR:-/tmp}/codex-web-dev-home"
export CODEX_WEB_LOGIN_EMAIL="dev@example.com"
export CODEX_WEB_LOGIN_PASSWORD="<开发环境独立密码>"
export CODEX_WEB_SESSION_SECRET="<至少32个字符的开发环境固定密钥>"

npm run dev
```

建议为开发和测试使用独立 `CODEX_HOME`，避免读取或修改日常使用环境中的账号、配置、会话、MCP、Skills 和审批状态。

常用验证命令：

```bash
npm run test
npm run build
npm run test:smoke
```

仓库还提供 `npm run test:smoke:multi-user:macos`，用于在 macOS 上以 root 验证真实 Chrome、普通用户与 root app-server 的隔离和回收。该命令要求先设置脚本提示的隔离目录、CLI、测试用户等 `CODEX_WEB_MACOS_SMOKE_*` 环境变量，不应指向日常使用的 `CODEX_HOME`。

构建 CLI：

```bash
npm run build:cli
npm pack --dry-run
```

## 当前限制

- 当前只接入本机 `codex app-server --stdio`；SSH remote 尚未完成。
- 浏览器版更新按钮尚未接入 CLI/npm 自动更新。
- 浏览器重连不会终止仍在 bridge 中运行的 Turn；但 app-server 进程崩溃后，旧进程内存中的运行中 Turn 无法继续。
- app-server 没有提供历史消息全文搜索时，界面会明确显示不支持，而不会返回伪造结果。
- 某些 app-server 新增的 server request 可能只显示诊断信息，直到 Codex Web 增加对应交互。

## 常见问题

### 必须设置 `--codex-home` 吗？

不必须。已设置 `CODEX_HOME` 时会直接使用该目录；两者都没有时使用 `~/.codex`。

### `--open` 有什么作用？

服务启动后调用系统默认浏览器打开 Codex Web。它不能与 `--port 0` 同时使用，因为随机端口模式不提供固定的打开地址。

### 为什么需要两次登录？

Web 登录用于限制谁能访问网页；“设置 -> Codex”中的 OpenAI 账户或 API Key 登录用于让 app-server 调用 Codex。两者用途不同。

### 可以从其他目录启动吗？

可以。CLI 会从安装目录读取应用资源，并把执行命令时的当前目录作为项目工作目录。

### 可以直接开放到公网吗？

不建议。应先配置 HTTPS 反向代理、防火墙、访问控制和 Turnstile，并确保源站不接受绕过反向代理的连接。
