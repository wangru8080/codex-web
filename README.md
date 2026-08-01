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

Codex Web 和 runtime 是两个常驻进程。登录本身不会创建 app-server；某个用户首次建立 WebSocket bridge 时才启动该用户的 app-server。同一用户的多个浏览器共享一个 app-server，不同用户的 UID、补充组、`HOME`、`CODEX_HOME`、cwd、消息和审批相互隔离。Web 服务自己的持久状态使用 `CODEX_WEB_STATE`，不与用户的 Codex home 混用。最后一个连接断开后，没有运行中 Turn 时会在宽限期结束后退出；有运行中 Turn 时等待其完成再退出。

#### Linux 快速部署

以下步骤使用通用示例：

```bash
WEB_USER="codexweb"
USER_A="usera"
USER_B="userb"
PUBLIC_HOST="codex.example.com"
WEB_HOME="/home/$WEB_USER"
WEB_STATE="$WEB_HOME/.config/codex-web-state"
NODE_BIN_DIR="$(dirname "$(readlink -f "$(command -v node)")")"
CODEX_WEB_BIN="$(command -v codex-web)"
CODEX_BIN="$(command -v codex)"
```

1. 确认命令和系统用户。Node 必须位于所有服务用户均可访问的公共目录，不能使用 `/root/.nvm/...`：

```bash
printf 'node bin: %s\ncodex-web: %s\ncodex: %s\n' "$NODE_BIN_DIR" "$CODEX_WEB_BIN" "$CODEX_BIN"
command -v setpriv
getent passwd "$WEB_USER" "$USER_A" "$USER_B" root
```

2. 为三个登录账号分别生成密码哈希。每次输入该账号以后用于网页登录的原始密码，并保存命令输出的 `scrypt$v1$...`；网页登录时仍输入原始密码，不输入哈希。随后生成与登录密码无关的 Session 签名密钥：

```bash
read -r -s -p '设置该账号的 Web 登录密码: ' CODEX_WEB_LOGIN_PASSWORD
printf '\n'
printf '%s' "$CODEX_WEB_LOGIN_PASSWORD" | codex-web runtime hash-password
unset CODEX_WEB_LOGIN_PASSWORD
openssl rand -hex 32
```

这里的 `CODEX_WEB_LOGIN_PASSWORD` 只是未导出的临时 Shell 变量，多用户 broker 服务本身不读取它。哈希使用随机盐，因此同一个密码每次生成的字符串通常不同，但都可以验证该密码。

3. 创建共享组、配置目录、socket 目录和 Web 状态目录。共享组只允许普通 Web 服务访问 root broker 的 Unix socket；`WEB_USER` 需要加入该组，`users.json` 中映射的登录用户不需要加入：

```bash
getent group codex-web-runtime >/dev/null || sudo groupadd --system codex-web-runtime
sudo usermod -aG codex-web-runtime "$WEB_USER"
sudo install -d -o root -g root -m 0750 /etc/codex-web
sudo install -d -o root -g codex-web-runtime -m 2750 /run/codex-web
sudo install -d -o "$WEB_USER" -g codex-web-runtime -m 0700 "$WEB_STATE"
```

`2750` 的 setgid 位使 root 创建的 socket 自动继承 `codex-web-runtime` 组。`WEB_USER` 加组后需要重新登录，再用 `id` 确认其组列表包含 `codex-web-runtime`。

4. 安装 [`users.example.json`](deploy/systemd/users.example.json)，再编辑为实际配置：

```bash
sudo install -o root -g root -m 0600 deploy/systemd/users.example.json /etc/codex-web/users.json
sudoedit /etc/codex-web/users.json
```

下面是两个普通用户和一个 root 用户的完整结构。分别替换三个 `passwordHash`、`sessionSecret`、邮箱、系统用户和路径；允许 root 意味着其命令、文件修改和 MCP 均以 UID 0 运行：

```json
{
  "version": 1,
  "sessionSecret": "<session-secret>",
  "sessionMaxAgeSeconds": 259200,
  "disconnectGraceMs": 30000,
  "allowRootRuntime": true,
  "codexCommand": "<codex-bin>",
  "setprivCommand": "/usr/bin/setpriv",
  "users": [
    {
      "id": "usera",
      "email": "usera@example.com",
      "passwordHash": "<user-a-password-hash>",
      "osUser": "<user-a>",
      "home": "/home/<user-a>",
      "codexHome": "/home/<user-a>/.codex",
      "cwd": "/home/<user-a>",
      "role": "user",
      "enabled": true,
      "allowRoot": false,
      "env": {
        "PATH": "<node-bin-dir>:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      }
    },
    {
      "id": "userb",
      "email": "userb@example.com",
      "passwordHash": "<user-b-password-hash>",
      "osUser": "<user-b>",
      "home": "/home/<user-b>",
      "codexHome": "/home/<user-b>/.codex",
      "cwd": "/home/<user-b>",
      "role": "user",
      "enabled": true,
      "allowRoot": false,
      "env": {
        "PATH": "<node-bin-dir>:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      }
    },
    {
      "id": "root",
      "email": "root@example.com",
      "passwordHash": "<root-password-hash>",
      "osUser": "root",
      "home": "/root",
      "codexHome": "/root/.codex",
      "cwd": "/root",
      "role": "admin",
      "enabled": true,
      "allowRoot": true,
      "env": {
        "PATH": "<node-bin-dir>:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      }
    }
  ]
}
```

确认没有遗漏占位符，并验证 JSON、所有者和权限：

```bash
sudo grep -nE '<[^>]+>' /etc/codex-web/users.json
sudo jq empty /etc/codex-web/users.json
sudo stat -c '%U %G %a %n' /etc/codex-web/users.json
```

第一条命令应无输出，第二条命令应无报错，第三条命令应显示 `root root 600`。

5. 在 root 登录终端直接启动 runtime broker。保持该终端运行：

```bash
NODE_BIN_DIR="$(dirname "$(readlink -f "$(command -v node)")")"
export PATH="$NODE_BIN_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
codex-web runtime serve \
  --config /etc/codex-web/users.json \
  --socket /run/codex-web/runtime-broker.sock
```

broker 必须由 root 启动。正常启动后会显示监听的 socket 路径；确认 socket 所属组和权限为 `codex-web-runtime`、`0660`：

```bash
ls -l /run/codex-web/runtime-broker.sock
```

6. 重新登录 `WEB_USER`，在该普通用户的终端直接启动 Web。保持该终端运行：

```bash
id
NODE_BIN_DIR="$(dirname "$(readlink -f "$(command -v node)")")"
export PATH="$NODE_BIN_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export CODEX_WEB_RUNTIME_BROKER_SOCKET=/run/codex-web/runtime-broker.sock
export CODEX_WEB_PUBLIC_HOST="codex.example.com"
CODEX_WEB_STATE="$HOME/.config/codex-web-state" codex-web serve \
    --host 0.0.0.0 \
    --port 3001
```

直接访问服务器端口时保留 `--host 0.0.0.0`；使用本机反向代理时改为 `--host 127.0.0.1`。`CODEX_WEB_PUBLIC_HOST` 必须填写浏览器实际访问的域名或 IP。多用户模式不设置 `CODEX_WEB_LOGIN_EMAIL`、`CODEX_WEB_LOGIN_PASSWORD` 或 `CODEX_WEB_SESSION_SECRET`。

浏览器打开 `http://<public-host>:3001`。未登录时不会启动用户 app-server；用户首次建立 WebSocket bridge 时，broker 才根据 `users.json` 以对应 OS 用户启动 app-server。

两个终端中的 `Ctrl+C` 会停止对应进程。服务器重启后 `/run/codex-web` 会消失，需要重新执行第 3 步中的 socket 目录创建命令。需要后台常驻、开机启动和异常重启时，再使用仓库提供的 [`codex-web-runtime.service`](deploy/systemd/codex-web-runtime.service) 与 [`codex-web.service`](deploy/systemd/codex-web.service) 模板。

#### Linux systemd 后台部署

如果需要开机启动、自动重启和统一日志，可以使用仓库提供的两个 systemd 单元。它们仍然启动同样的两个 `codex-web` 进程：runtime 以 root 运行，Web 以普通用户运行。

1. 安装配置文件和 service 模板：

```bash
getent group codex-web-runtime >/dev/null || sudo groupadd --system codex-web-runtime
sudo install -d -o root -g root -m 0750 /etc/codex-web
sudo install -o root -g root -m 0600 deploy/systemd/users.example.json /etc/codex-web/users.json
sudo install -o root -g root -m 0644 deploy/systemd/codex-web-runtime.service /etc/systemd/system/codex-web-runtime.service
sudo install -o root -g root -m 0644 deploy/systemd/codex-web.service /etc/systemd/system/codex-web.service
sudoedit /etc/codex-web/users.json
sudoedit /etc/systemd/system/codex-web-runtime.service
sudoedit /etc/systemd/system/codex-web.service
```

2. 修改 `codex-web-runtime.service` 的实际路径和组名，至少确认：

```ini
User=root
Group=codex-web-runtime
UMask=0007
Environment=PATH=<node-bin-dir>:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
RuntimeDirectory=codex-web
RuntimeDirectoryMode=0750
ExecStart=<codex-web-bin> runtime serve --config /etc/codex-web/users.json --socket /run/codex-web/runtime-broker.sock
```

`<codex-web-bin>` 必须是绝对路径，例如 `command -v codex-web` 的输出。`RuntimeDirectory` 会在服务启动时创建 `/run/codex-web`，不需要手动创建。

3. 修改 `codex-web.service` 的 Web 用户、工作目录、路径和访问地址：

```ini
User=<web-user>
Group=codex-web-runtime
WorkingDirectory=/home/<web-user>
Environment=PATH=<node-bin-dir>:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=CODEX_WEB_RUNTIME_BROKER_SOCKET=/run/codex-web/runtime-broker.sock
Environment=CODEX_WEB_STATE=/home/<web-user>/.config/codex-web-state
Environment=CODEX_WEB_NEXT_HOST=127.0.0.1
Environment=CODEX_WEB_PUBLIC_HOST=<public-host>
Environment=PORT=3001
EnvironmentFile=-/etc/codex-web/web.env
ExecStart=<codex-web-bin> serve
```

反向代理部署使用 `CODEX_WEB_NEXT_HOST=127.0.0.1`；直接监听所有网卡时改为 `0.0.0.0`。`EnvironmentFile=-...` 表示 `/etc/codex-web/web.env` 可以不存在；多用户模式不要在其中设置 `CODEX_WEB_LOGIN_EMAIL`、`CODEX_WEB_LOGIN_PASSWORD` 或 `CODEX_WEB_SESSION_SECRET`。

4. 检查并启动两个服务：

```bash
sudo systemd-analyze verify /etc/systemd/system/codex-web-runtime.service /etc/systemd/system/codex-web.service
sudo systemctl daemon-reload
sudo systemctl enable --now codex-web-runtime.service codex-web.service
systemctl status codex-web-runtime.service codex-web.service
ls -l /run/codex-web/runtime-broker.sock
journalctl -u codex-web-runtime.service -u codex-web.service -n 100 --no-pager
```

systemd 会创建 socket 目录，runtime 进程会创建 `runtime-broker.sock`。只有登录用户首次建立 WebSocket bridge 后，才会按 `users.json` 启动对应的 app-server。

#### Broker 配置参考

配置文件顶层字段：

| 字段 | 必需 | 说明 |
|---|---|---|
| `version` | 是 | 配置格式版本，当前固定为 `1`。 |
| `sessionSecret` | 是 | Session 签名密钥，至少 32 个字符；使用上面的 `openssl` 命令生成。 |
| `sessionMaxAgeSeconds` | 否 | Session 固定有效期，默认 `259200` 秒（3 天），允许 `60` 至 `604800` 秒。 |
| `disconnectGraceMs` | 否 | 同一用户最后一个浏览器连接断开后，空闲 app-server 的退出宽限期；默认 `30000` 毫秒，允许 `0` 至 `600000`。运行中的 Turn 完成后才退出。 |
| `allowRootRuntime` | 否 | 是否允许配置 root runtime，默认 `false`；仅此开关不能单独授权 root。 |
| `codexCommand` | 是 | 目标服务器上 `codex` 可执行文件的绝对路径。 |
| `setprivCommand` | Linux 否 | Linux `setpriv` 的绝对路径，默认 `/usr/bin/setpriv`；macOS 不使用该命令。 |
| `users` | 是 | 至少包含一个登录用户；每个用户的 `id` 和 `email` 必须唯一。 |

`users` 中每个用户的字段：

| 字段 | 必需 | 说明 |
|---|---|---|
| `id` | 是 | broker 内部用户 ID，必须唯一；只能包含字母、数字、下划线和连字符，最长 32 个字符，首字符必须是字母或下划线。 |
| `email` | 是 | Web 登录邮箱，必须唯一；匹配时忽略大小写。 |
| `passwordHash` | 是 | 使用 `codex-web runtime hash-password` 生成的 scrypt 哈希；不得填写明文密码。 |
| `osUser` | 是 | app-server 实际使用的本机系统账号。runtime 从系统账号数据库解析 UID、GID、home 和 shell，不在 JSON 中接受 UID/GID。 |
| `home` | 是 | `osUser` 的 home 绝对路径，必须与系统账号数据库一致。 |
| `codexHome` | 是 | 该用户 app-server 使用的 `CODEX_HOME` 绝对路径，账号、配置、会话、MCP、skills 和 approval 状态均来自此目录。 |
| `cwd` | 是 | 该用户 app-server 的默认工作目录绝对路径。 |
| `role` | 否 | Web 角色，只允许 `user` 或 `admin`，默认 `user`；`admin` 可管理安全设置，但不代表操作系统 root。 |
| `enabled` | 否 | 是否允许该账号登录，默认 `true`。 |
| `allowRoot` | 否 | 是否允许该用户项启动 UID 0 app-server，默认 `false`；仅对 `osUser: "root"` 有效，并且顶层 `allowRootRuntime` 也必须为 `true`。 |
| `env` | 否 | 传给 app-server 的额外环境变量字符串对象。变量名必须为大写形式；`HOME`、`CODEX_HOME`、`USER`、`SHELL`、`RUST_LOG`、`LD_*`、`DYLD_*` 等受保护变量禁止设置。 |

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

### 0. 安装 codex 与 codex-web

```bash
npm install -g @openai/codex
npm install -g @wangru8080/codex-web
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
| `CODEX_HOME` | 单用户 app-server 的 Codex 配置目录 | 否 |
| `CODEX_WEB_STATE` | Web 自身状态目录（例如 Turnstile 配置）；多用户模式推荐设置 | 否 |
| `PORT` | HTTP 端口 | 否 |
| `CODEX_WEB_NEXT_HOST` | 监听地址 | 否 |
| `CODEX_WEB_PUBLIC_HOST` | `--open` 使用的公开主机名 | 否 |
| `CODEX_WEB_RUNTIME_BROKER_SOCKET` | 启用多用户模式的 Unix socket 绝对路径；与单用户登录变量二选一 | 多用户模式 |

## Codex 路径与工作目录

Codex Web 使用三个彼此独立的路径：

- 安装目录：保存 Codex Web 的 `.next`、主题和 CLI 资源。
- 工作目录：执行 `codex-web` 时所在的目录，会作为 app-server 的 cwd。
- `CODEX_HOME`：保存 Codex 账户、配置、历史会话、MCP 和 Skills。
- `CODEX_WEB_STATE`：保存 Web 自身状态，不承载用户的 Codex 会话；未设置时单用户模式回退到 `CODEX_HOME`。

单用户模式下，`CODEX_HOME` 的优先级为：

1. `--codex-home <路径>`
2. 环境变量 `CODEX_HOME`
3. 当前用户的 `~/.codex`

如果已经设置 `CODEX_HOME`，通常不需要再传 `--codex-home`。只有临时切换到另一个 Codex 环境时才需要命令行参数。多用户模式下，用户 app-server 的 `CODEX_HOME` 由 `users.json` 的 `codexHome` 指定；Web 进程本身使用 `CODEX_WEB_STATE`。

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
${CODEX_WEB_STATE:-$CODEX_HOME}/codex-web/turnstile.json
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
export CODEX_WEB_STATE="${TMPDIR:-/tmp}/codex-web-state"
export CODEX_WEB_LOGIN_EMAIL="dev@example.com"
export CODEX_WEB_LOGIN_PASSWORD="<开发环境独立密码>"
export CODEX_WEB_SESSION_SECRET="<至少32个字符的开发环境固定密钥>"

npm run dev
```

建议为开发和测试分别使用独立的 `CODEX_HOME` 和 `CODEX_WEB_STATE`，避免读取或修改日常使用环境中的 Codex 账号、配置、会话、MCP、Skills、审批状态或 Web 配置。

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
