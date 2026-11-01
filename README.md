# Codex Web

Codex Web is a browser workbench based on the official `codex app-server`. It provides Codex conversations, tool execution, permission approvals, project files, and extension management within the browser, using real-time app-server events as the single source of truth for state.

Codex Web does not replace the Codex CLI, nor does it store OpenAI OAuth tokens or API keys in the browser. The Web bridge is responsible for launching `codex app-server --stdio` on the server, and the browser accesses these capabilities via same-origin HTTP and WebSocket connections.

Project Repository: [https://github.com/wangru8080/codex-web](https://github.com/wangru8080/codex-web)

## Features

### Conversations & Tasks

- Start new Codex conversations and select a working directory for each conversation.
- Load historical conversations from the app-server, with support for resuming, history pagination, renaming, archiving, and unarchiving.
- Real-time display of answers, reasoning summaries, run statuses, token usage, and context window metrics.
- Support for interrupting runs, editing the latest user message, and rolling back subsequent turns.
- Support for Goals, Plans, Reviews, and context compaction.
- Multiple browser clients under the same Web bridge can synchronize user messages, streaming outputs, tool statuses, and approval requests.

### Models, Permissions & Tools

- Model list fetched directly from the app-server's `model/list`, allowing model and reasoning effort selection.
- Configure permission policies and sandbox behaviors per thread.
- Display command executions, file modifications, MCP tools, collaboration tools, and their incremental outputs.
- Review and approve command execution, file modifications, and permission requests directly within the browser.
- Support app-server-initiated user input forms and MCP elicitation.
- Unrecognized app-server notifications are preserved in diagnostics rather than silently dropped.

### Project Files & Attachments

- Browse the current working directory's file tree, updating reactively in response to app-server file change events.
- Preview text, Markdown, code, images, PDF, Word (DOC/DOCX), and Excel (XLS/XLSX) files (legacy DOC files have experimental compatibility; complex layouts may differ).
- Add files, directories, or selected file excerpts into the conversation directly from the file tree.
- Support image and generic file attachments, with attachment display restored across historical sessions.
- Support local file links, external links, image outputs, and file diff visualizations.

### Skills & MCP

- Read Skills from the app-server: view details, enable or disable them, and inject Skills directly into new conversations.
- Create user-level or project-level Skills.
- View and edit MCP server configurations, with support for starting/stopping, reloading, and checking runtime status.
- MCP configurations and runtime statuses are sourced respectively from app-server configuration interfaces and `mcpServerStatus/list`.

### Accounts & Interface

- Sign in to Codex in Settings via OpenAI account authorization or API Key.
- View Codex account status and usage limit details provided by the app-server.
- Support for English and Chinese, theme switching, and responsive layouts for desktop and mobile.
- Dedicated Web login protection supporting either locally defined email/password credentials or standard OpenID Connect (OIDC) Single Sign-On (SSO), plus optional Cloudflare Turnstile integration.
- Automatic browser reconnection after disconnection; if the app-server exits unexpectedly, the bridge attempts to restart it.

## Architecture

```text
Browser
  |
  | HTTP / WebSocket
  v
Codex Web + Web bridge
  |
  | JSON-RPC over stdio
  v
codex app-server
```

The browser does not spawn local processes directly. Running `codex-web serve` launches the Next.js application and the Web bridge: in single-user mode, the Web bridge spawns the local `codex app-server`; in multi-user mode, the Web bridge connects to an independent runtime broker, which in turn starts `codex app-server` under the corresponding operating system user account for each authenticated login.

### Platform Support

| Server Hosting Mode | Linux | macOS | Windows |
|---|---|---|---|
| Single-user `codex-web serve` | Supported | Supported | Supported |
| Multi-user `codex-web runtime serve` | Supported (using `setpriv`) | Supported (using `dscacheutil` and `sudo`) | Not supported |

Browser clients are not restricted by the server operating system. A Windows or macOS browser can access Codex Web hosted on Linux or macOS; the table above describes the server OS hosting Codex Web, the runtime broker, and the app-server.

### Multi-User Runtime Broker

On Linux or macOS, you can run a non-root Codex Web instance, and a root runtime daemon will launch `codex app-server` under the corresponding OS user account based on the logged-in user:

```text
Browser Session A ─┐
                   ├─> Codex Web (<web-user>)
Browser Session B ─┘          │
                              │ Unix socket: <runtime-socket>
                              v
                        Runtime (root)
                          ├─> app-server (<linux-user-a>)
                          └─> app-server (<linux-user-b>)
```

Codex Web and the runtime broker are two persistent background processes. Logging in does not spawn an app-server immediately; the app-server is launched when the user establishes their first WebSocket bridge connection. Multiple browser sessions from the same user share a single app-server instance. Different users have strictly isolated UIDs, supplementary groups, `HOME`, `CODEX_HOME`, cwd, messages, and approvals. The Web service's own persistent state uses `CODEX_WEB_STATE` and is never mixed with user Codex home directories. When the last connection for a user disconnects, an idle app-server terminates after a grace period; if an active turn is still running, it waits until completion before exiting.

#### Linux Quick Deployment

The following steps use generic placeholders:

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

1. Verify commands and system users. Node must be located in a public directory accessible to all service users (cannot use `/root/.nvm/...`):

```bash
printf 'node bin: %s\ncodex-web: %s\ncodex: %s\n' "$NODE_BIN_DIR" "$CODEX_WEB_BIN" "$CODEX_BIN"
command -v setpriv
getent passwd "$WEB_USER" "$USER_A" "$USER_B" root
```

2. Generate password hashes for the three login accounts. Enter the raw password to be used for web login, and save the output `scrypt$v1$...`; when logging in via the web UI, still enter the raw password, not the hash. Then generate a session signing secret independent of the passwords:

```bash
read -r -s -p 'Set web login password for this account: ' CODEX_WEB_LOGIN_PASSWORD
printf '\n'
printf '%s' "$CODEX_WEB_LOGIN_PASSWORD" | codex-web runtime hash-password
unset CODEX_WEB_LOGIN_PASSWORD
openssl rand -hex 32
```

Here `CODEX_WEB_LOGIN_PASSWORD` is only a temporary unexported shell variable; the multi-user broker service does not read it. The hash uses a random salt, so the resulting string differs each time for the same password, but all valid hashes will verify that password.

3. Create the shared group, configuration directory, socket directory, and web state directory. The shared group only allows the unprivileged web service to access the root broker's Unix socket; `WEB_USER` must join this group, while mapped users in `users.json` do not need to:

```bash
getent group codex-web-runtime >/dev/null || sudo groupadd --system codex-web-runtime
sudo usermod -aG codex-web-runtime "$WEB_USER"
sudo install -d -o root -g root -m 0750 /etc/codex-web
sudo install -d -o root -g codex-web-runtime -m 2750 /run/codex-web
sudo install -d -o "$WEB_USER" -g codex-web-runtime -m 0700 "$WEB_STATE"
```

The setgid bit in `2750` ensures that sockets created by root automatically inherit the `codex-web-runtime` group. After adding `WEB_USER` to the group, re-login and verify that `id` lists `codex-web-runtime`.

4. Install [`users.example.json`](deploy/systemd/users.example.json), and edit it for your deployment:

```bash
sudo install -o root -g root -m 0600 deploy/systemd/users.example.json /etc/codex-web/users.json
sudoedit /etc/codex-web/users.json
```

The systemd example in the repository contains one regular `codex` user and one root user with `allowRootRuntime` enabled. The sample `CODEX_WEB_STATE` for the root entry is `/root/.codex-web`; removing this field defaults to the same standard path. Before actual deployment, replace email addresses, password hashes, and session secrets for both accounts.

Below is the complete configuration structure for two regular users and one root user. Replace all three `passwordHash`, `sessionSecret`, email addresses, OS users, and paths; allowing root means its commands, file modifications, and MCP will run with UID 0:

```json
{
  "version": 1,
  "sessionSecret": "<session-secret>",
  "sessionMaxAgeSeconds": 259200,
  "disconnectGraceMs": 30000,
  "maxActiveAppServers": 8,
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
      "maxConcurrentTurns": 2,
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
      "maxConcurrentTurns": 1,
      "env": {
        "CODEX_WEB_STATE": "/root/.codex-web",
        "PATH": "<node-bin-dir>:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      }
    }
  ]
}
```

Verify that no placeholders were missed, and validate JSON syntax, ownership, and permissions:

```bash
sudo grep -nE '<[^>]+>' /etc/codex-web/users.json
sudo jq empty /etc/codex-web/users.json
sudo stat -c '%U %G %a %n' /etc/codex-web/users.json
```

The first command should produce no output, the second should report no errors, and the third should output `root root 600`.

5. In a root login terminal, launch the runtime broker directly. Keep this terminal running:

```bash
NODE_BIN_DIR="$(dirname "$(readlink -f "$(command -v node)")")"
export PATH="$NODE_BIN_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
codex-web runtime serve \
  --config /etc/codex-web/users.json \
  --socket /run/codex-web/runtime-broker.sock
```

The broker must be launched as root. Once started normally, it displays the listening socket path; verify the socket's group and permissions are `codex-web-runtime` and `0660`:

```bash
ls -l /run/codex-web/runtime-broker.sock
```

6. Re-login as `WEB_USER`, and start Codex Web in that user's terminal. Keep this terminal running:

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

Keep `--host 0.0.0.0` if accessing the server port directly; change to `--host 127.0.0.1` when using a local reverse proxy. `CODEX_WEB_PUBLIC_HOST` must be set to the domain or IP actually visited by browsers. In multi-user mode, do not set `CODEX_WEB_LOGIN_EMAIL`, `CODEX_WEB_LOGIN_PASSWORD`, or `CODEX_WEB_SESSION_SECRET`.

Open `http://<public-host>:3001` in your browser. No user app-server is started before login; when a user establishes their first WebSocket bridge connection, the broker launches the app-server under the corresponding OS user defined in `users.json`.

Pressing `Ctrl+C` in either terminal stops that process. After a server reboot, `/run/codex-web` will disappear and the socket directory creation command from step 3 must be re-run. When background persistence, boot autostart, and crash restarts are required, use the [`codex-web-runtime.service`](deploy/systemd/codex-web-runtime.service) and [`codex-web.service`](deploy/systemd/codex-web.service) templates provided in the repository.

#### Linux systemd Background Deployment

For boot startup, auto-restart, and unified logging, use the two systemd units provided in the repo. They still start the same two `codex-web` processes: runtime running as root, and Web running as an unprivileged user.

1. Install configuration files and service templates:

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

2. Edit the actual paths and group in `codex-web-runtime.service`, ensuring at least:

```ini
User=root
Group=codex-web-runtime
UMask=0007
Environment=PATH=<node-bin-dir>:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
RuntimeDirectory=codex-web
RuntimeDirectoryMode=0750
ExecStart=<codex-web-bin> runtime serve --config /etc/codex-web/users.json --socket /run/codex-web/runtime-broker.sock
```

`<codex-web-bin>` must be an absolute path, e.g. the output of `command -v codex-web`. `RuntimeDirectory` automatically creates `/run/codex-web` when the service starts, eliminating the need to create it manually.

3. Edit the web user, working directory, paths, and access addresses in `codex-web.service`:

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

Use `CODEX_WEB_NEXT_HOST=127.0.0.1` for reverse proxy deployments; change to `0.0.0.0` when listening on all network interfaces directly. `EnvironmentFile=-...` indicates that `/etc/codex-web/web.env` is optional; in multi-user mode, do not set `CODEX_WEB_LOGIN_EMAIL`, `CODEX_WEB_LOGIN_PASSWORD`, or `CODEX_WEB_SESSION_SECRET` inside it.

4. Verify and start both services:

```bash
sudo systemd-analyze verify /etc/systemd/system/codex-web-runtime.service /etc/systemd/system/codex-web.service
sudo systemctl daemon-reload
sudo systemctl enable --now codex-web-runtime.service codex-web.service
systemctl status codex-web-runtime.service codex-web.service
ls -l /run/codex-web/runtime-broker.sock
journalctl -u codex-web-runtime.service -u codex-web.service -n 100 --no-pager
```

systemd manages the socket directory, and the runtime process creates `runtime-broker.sock`. The corresponding app-server will only be started per `users.json` once a logged-in user establishes their first WebSocket bridge connection.

#### Broker Configuration Reference

Top-level configuration fields:

| Field | Required | Description |
|---|---|---|
| `version` | Yes | Configuration format version, currently fixed to `1`. |
| `sessionSecret` | Yes | Session signing secret, at least 32 characters; generate with the `openssl` command above. |
| `sessionMaxAgeSeconds` | No | Fixed session lifetime, default `259200` seconds (3 days), allowed range `60` to `604800` seconds. |
| `disconnectGraceMs` | No | Idle app-server exit grace period after the last browser client disconnects; default `30000` ms, allowed range `0` to `600000`. Exits only after running turns finish. |
| `maxActiveAppServers` | No | Global limit on concurrently active user app-servers, must be a positive integer; omit for unlimited. When reached, existing users can still reuse their app-server, but new users cannot spawn one temporarily. |
| `allowRootRuntime` | No | Whether root runtime configuration is allowed, default `false`; this switch alone does not authorize root. |
| `codexCommand` | Yes | Absolute path to the `codex` executable on the target server. |
| `setprivCommand` | Linux: No | Absolute path to Linux `setpriv`, default `/usr/bin/setpriv`; not used on macOS. |
| `users` | Yes | List of user entries; must contain at least one user, and each user's `id` and `email` must be unique. |

User entry fields in `users`:

| Field | Required | Description |
|---|---|---|
| `id` | Yes | Internal broker user ID, must be unique; letters, numbers, underscores, and hyphens only, max 32 chars, first char must be letter or underscore. |
| `email` | Yes | Web login email address, must be unique; matched case-insensitively. |
| `passwordHash` | Yes | scrypt hash generated with `codex-web runtime hash-password`; plain text passwords are not accepted. |
| `osUser` | Yes | Local system account used by the app-server. Runtime resolves UID, GID, home, and shell from system databases; does not accept UID/GID in JSON. |
| `home` | Yes | Absolute path to `osUser`'s home directory, must match the system account database. |
| `codexHome` | Yes | Absolute path to `CODEX_HOME` used by this user's app-server; accounts, configs, sessions, MCP, skills, and approvals come from here. |
| `cwd` | Yes | Absolute path to default working directory for this user's app-server. |
| `inheritLoginEnvironment` | No | Whether to execute the system user's login shell profile and inherit the environment, default `false`. Shell profile runs with a 5s timeout; broker-managed and dynamic variables are filtered. |
| `role` | No | Web role, either `user` or `admin`, default `user`; `admin` can manage security settings but does not grant OS root. |
| `enabled` | No | Whether the account is permitted to log in, default `true`. |
| `allowRoot` | No | Whether this user entry is allowed to start a UID 0 app-server, default `false`; only valid when `osUser: "root"` and top-level `allowRootRuntime` is `true`. |
| `maxConcurrentTurns` | No | Concurrency limit across all browser connections and threads for this user, must be a positive integer; omit for unlimited. |
| `env` | No | Map of additional environment variables passed to app-server; overrides shell environment variables. Names must be uppercase; protected variables like `HOME`, `CODEX_HOME`, `USER`, `SHELL`, `RUST_LOG`, `LD_*`, `DYLD_*` are prohibited. |

#### Broker Configuration Hot-Reloading

`codex-web runtime serve` watches the `users.json` file specified by `--config`. When saved, it re-executes the same regular file, owner, `0600` permissions, structural, and system user validations performed at startup. Candidate configs are switched atomically only after full validation passes, requiring no restart of the runtime service or `systemctl daemon-reload`.

- Newly added users can log in immediately and spawn their app-server on first connection.
- Users with unchanged configurations continue using their current app-server, and active turns are unaffected.
- Modifying `maxActiveAppServers` or `maxConcurrentTurns` takes effect immediately without invalidating sessions, restarting app-servers, or interrupting active turns. Lowering limits rejects new creations or `turn/start` requests exceeding the limit; increasing or removing limits resumes acceptance immediately.
- When `inheritLoginEnvironment` is enabled, user runtimes execute that system user's login shell profile at startup; if the profile fails, times out, or fails to output valid environment markers, the runtime start fails. Toggling this switch or modifying `env` invalidates existing sessions and active connections for that user, requiring re-login to start with the new environment.
- Deleting, disabling, or modifying a user's email, password hash, role, OS user, home, `CODEX_HOME`, cwd, or environment variables invalidates old sessions and active connections; re-login starts a new runtime under the new configuration.
- Modifying `sessionSecret`, `codexCommand`, `setprivCommand`, or `allowRootRuntime` invalidates all online users. Modifying `sessionMaxAgeSeconds` affects only newly issued sessions.
- If JSON is incomplete, permissions are invalid, duplicate identities exist, or system user lookup fails, the broker logs "configuration reload failed" and continues using the last valid configuration. Fixing and re-saving automatically restores loading.

It is recommended to edit using tools that perform atomic file replacement while preserving root ownership and `0600` permissions. Hot reloading never logs password hashes or session secrets.

#### macOS launchd Deployment

The repository provides three macOS sample files:

- [`com.codex-web.runtime.plist`](deploy/launchd/com.codex-web.runtime.plist): Root LaunchDaemon running `codex-web runtime serve`.
- [`com.codex-web.web.plist`](deploy/launchd/com.codex-web.web.plist): Runs `codex-web serve` as an unprivileged sample user.
- [`users.example.json`](deploy/launchd/users.example.json): macOS user mapping template.

First verify command paths and select an existing non-root Web service account:

```bash
command -v codex-web
command -v codex
command -v dscacheutil
command -v sudo
WEB_USER="codexweb"
```

If command paths, the Web user, or working directories differ from the samples, modify the plist and user configs first. Create the shared group and persistent directories:

```bash
sudo dseditgroup -o create codex-web-runtime
sudo dseditgroup -o edit -a "$WEB_USER" -t user codex-web-runtime
sudo install -d -o root -g wheel -m 0750 "/Library/Application Support/CodexWeb"
sudo install -d -o root -g codex-web-runtime -m 0750 "/Library/Application Support/CodexWeb/run"
sudo install -d -o root -g wheel -m 0755 "/Library/Logs/CodexWeb"
sudo install -d -o "$WEB_USER" -g codex-web-runtime -m 0750 "/Users/Shared/CodexWeb/workspace"
sudo install -d -o "$WEB_USER" -g codex-web-runtime -m 0700 "/Users/Shared/CodexWeb/web-state"
```

Install configurations and LaunchDaemons; edit target files before bootstrapping services:

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

Check services and logs:

```bash
sudo launchctl print system/com.codex-web.runtime
sudo launchctl print system/com.codex-web.web
sudo tail -f /Library/Logs/CodexWeb/runtime-error.log /Library/Logs/CodexWeb/web-error.log
```

Stop and remove both LaunchDaemons:

```bash
sudo launchctl bootout system/com.codex-web.web
sudo launchctl bootout system/com.codex-web.runtime
```

The parent socket directory on macOS must be created in advance, but the socket file itself is created by the runtime and should not be created manually. When unauthenticated, both LaunchDaemons remain active but do not spawn any user app-servers.

## Requirements

- Node.js 20.9.0 or higher.
- Codex CLI installed and accessible via `PATH` to run `codex app-server`.
- Single-user service supports Linux, macOS, and Windows; multi-user runtime supports Linux and macOS only.
- A modern web browser to access the interface.

Check environment:

```bash
node --version
npm --version
codex --version
```

## Installation

### Build Tarball from Source

You can build an npm tarball from the source repository and install it globally:

```bash
git clone https://github.com/wangru8080/codex-web.git
cd codex-web
npm install
npm pack
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
mv "./wangru8080-codex-web-${PACKAGE_VERSION}.tgz" "./codex-web-${PACKAGE_VERSION}.tgz"
npm install --global "./codex-web-${PACKAGE_VERSION}.tgz"
```

`npm pack` automatically runs production builds and CLI bundling. Scoped packages generate `wangru8080-codex-web-<version>.tgz` by default; the command above renames it to `codex-web-<version>.tgz` as used in GitHub Releases.

Verify the command after installation:

```bash
codex-web --version
codex-web --help
```

### Install from GitHub Repository

The GitHub repository is public; you can install the `master` branch directly:

```bash
npm install --global "github:wangru8080/codex-web#master"
```

This method downloads devDependencies and builds the full package on the host machine, which is slower. For production use, installing prebuilt tarballs from GitHub Releases is recommended.

### Install from GitHub Releases

Once a GitHub Release is published, install the release asset directly:

```bash
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
npm install --global "https://github.com/wangru8080/codex-web/releases/download/v${PACKAGE_VERSION}/codex-web-${PACKAGE_VERSION}.tgz"
```

### Install from npm Registry

Install directly from the official npm registry:

```bash
npm install --global @wangru8080/codex-web --registry=https://registry.npmjs.org/
```

## Quick Start

### 0. Install codex and codex-web

```bash
npm install -g @openai/codex
npm install -g @wangru8080/codex-web
```

### 1. Generate Web Session Secret

Generate once and save the result securely in your server configuration:

```bash
openssl rand -hex 32
```

Do not regenerate on every restart. Changing the session secret immediately invalidates all existing Web login sessions.

### 2. Configure Web Login

```bash
export CODEX_WEB_LOGIN_EMAIL="admin@example.com"
export CODEX_WEB_LOGIN_PASSWORD="<unique-strong-password>"
export CODEX_WEB_SESSION_SECRET="<fixed-random-secret-at-least-32-chars>"
```

These variables protect the Codex Web interface and are not OpenAI account credentials. OpenAI account or API Key credentials are hooked into the app-server after logging into the Web UI via "Settings -> Codex".

### 3. Launch from Project Directory

```bash
cd /path/to/your/project
codex-web serve --open
```

Default address is `http://127.0.0.1:3001`. `--open` opens the default browser after server launch. The legacy command `codex-web --open` remains backwards-compatible and is equivalent to `codex-web serve --open`.

### 4. Log in and Start Chatting

1. Sign in to the Web interface using `CODEX_WEB_LOGIN_EMAIL` and `CODEX_WEB_LOGIN_PASSWORD`.
2. Open "Settings -> Codex" and check the app-server connection status.
3. Complete OpenAI account authorization or API Key login as needed.
4. Return to "New Chat", choose your project directory, model, reasoning effort, and permission policy.
5. Enter a prompt, or attach files, Skills, and attachments, then send.

## Web UI Composer Shortcuts

The composer allows combining project context, Skills, and built-in slash commands directly:

- Type `@` to search and reference files or directories in the current project.
- Type `$` to search enabled Skills; you can attach multiple Skills before sending.
- Type `/` to open the built-in slash command picker.
- Click the `+` menu on the bottom-left to attach file contexts, set a Goal, or enter Plan mode.
- Pick local files, drag-and-drop files or directories into the composer, or paste images and files from clipboard.
- Attach files or directories from the project file tree, or select excerpts in the file previewer to quote them in the chat.
- Files, directories, attachments, and text excerpts appear as individually removable tags with estimated token counts before sending.
- When executing tasks with a plan, a collapsible task progress bar appears above the composer; once file changes occur, it switches to a side-by-side view showing file changes and task progress.
- If a message is not accepted or fails, input content and attachments are preserved in the composer for easy retry.

While Codex is generating, sending a new message queues it; when there is no queued message, the stop button interrupts the active turn. Permission policies, models, and reasoning effort can also be adjusted directly from the bottom bar of the composer.

### Built-in Commands

| Command | Description |
|---|---|
| `/mcp` | View connection and runtime status of MCP servers. |
| `/review` | Review unstaged changes or compare against a specified branch. |
| `/compact` | Compact the context of the current task. |
| `/reasoning` | Adjust reasoning effort for the active model. |
| `/model` | Select the model used for the current task. |
| `/status` | View task ID, context usage, and rate limits. |
| `/goal` | Set a continuous goal that Codex will pursue. |
| `/plan` | Enter Plan mode to discuss and formulate plans first. |
| `/memories` | Configure memory usage and generation behavior for the current task. |

## CLI Options

```text
codex-web serve [options]
codex-web runtime serve --config <absolute-path> --socket <absolute-path>
printf '%s' 'password' | codex-web runtime hash-password
codex-web [options]  # Backwards-compatible single-user command

serve options:
--host <address>        Listening address, default 127.0.0.1
--port <port>           HTTP port, default 3001; 0 specifies random port
--codex-home <path>     Codex config and session directory, defaults to CODEX_HOME or ~/.codex
--open                  Open default browser upon launch, cannot be used with --port 0
-h, --help              Show help
-v, --version           Show version

runtime serve required options:
--config <absolute-path> User config file owned by root with 0600 permissions
--socket <absolute-path> Unix socket for communication between Web and runtime
```

`codex-web runtime serve` is supported only on Linux and macOS, and must be run as root. Windows invocations fail before reading configs or creating sockets. `codex-web runtime hash-password` reads passwords from stdin and prints an scrypt hash suitable for user configs without requiring root privileges.

The following environment variables can also be used:

| Environment Variable | Description | Required |
|---|---|---|
| `CODEX_WEB_AUTH_MODE` | Authentication mode: `local` (email/password) or `sso` (OpenID Connect); overrides `sso.json` | No |
| `CODEX_WEB_LOGIN_EMAIL` | Web login email (when using `local` auth mode) | Single-user `local` mode |
| `CODEX_WEB_LOGIN_PASSWORD` | Web login password (when using `local` auth mode) | Single-user `local` mode |
| `CODEX_WEB_SESSION_SECRET` | Web session signing key (min 32 chars) | Single-user mode (`local` and `sso`) |
| `CODEX_WEB_OIDC_PROVIDER_NAME` | Display label for the OIDC provider on the login button (default `SSO`) | No |
| `CODEX_WEB_OIDC_ISSUER` | OIDC Issuer URL (`.well-known/openid-configuration` base URL) | Single-user `sso` mode (if not in `sso.json`) |
| `CODEX_WEB_OIDC_CLIENT_ID` | OIDC Client ID | Single-user `sso` mode (if not in `sso.json`) |
| `CODEX_WEB_OIDC_CLIENT_SECRET` | OIDC Client Secret | Single-user `sso` mode (if not in `sso.json`) |
| `CODEX_WEB_OIDC_SCOPES` | OIDC scopes (default `openid email profile`) | No |
| `CODEX_WEB_OIDC_ALLOWED_EMAILS` | Optional comma-separated list of allowed user emails | No |
| `CODEX_WEB_OIDC_ALLOWED_DOMAINS` | Optional comma-separated list of allowed email domains | No |
| `CODEX_HOME` | Codex configuration directory for single-user app-server | No |
| `CODEX_WEB_STATE` | State directory for Web service itself; defaults to current user's `~/.codex-web` | No |
| `PORT` | HTTP port | No |
| `CODEX_WEB_NEXT_HOST` | Listening address | No |
| `CODEX_WEB_PUBLIC_HOST` | Public host used by `--open` | No |
| `CODEX_WEB_RUNTIME_BROKER_SOCKET` | Absolute path to Unix socket enabling multi-user mode; mutually exclusive with single-user login variables | Multi-user mode |

## Codex Paths & Working Directories

Codex Web uses three independent paths:

- Installation directory: Stores Codex Web's `.next`, themes, and CLI assets.
- Working directory: The directory where `codex-web` is executed, serving as the app-server's cwd.
- `CODEX_HOME`: Stores Codex accounts, configuration, session history, MCP, and Skills.
- `CODEX_WEB_STATE`: Stores Web service state, not user Codex sessions; defaults to `~/.codex-web` of the current process user.

In single-user mode, `CODEX_HOME` precedence is:

1. `--codex-home <path>`
2. Environment variable `CODEX_HOME`
3. Current user's `~/.codex`

If `CODEX_HOME` is already set, you typically do not need `--codex-home`. Command-line flags are needed only when temporarily switching to an alternate Codex environment. In multi-user mode, each user app-server's `CODEX_HOME` is specified by `codexHome` in `users.json`; the Web process itself uses `CODEX_WEB_STATE`.

## Authentication & Security

- Web login sessions are valid for 3 days.
- Changing the Web login email, password, or session secret immediately invalidates all active sessions.
- Login email, password, and session secret are read exclusively on the server.
- OpenAI OAuth tokens and API keys are managed by the Codex app-server and never written to browser storage.
- Listens on `127.0.0.1` by default, allowing local connections only.
- The WebSocket bridge validates connection tokens, Origin headers, and remote connection policies.

When exposing access to a local network or the public Internet, configure at least an HTTPS reverse proxy, firewall, and access controls before explicitly listening on external interfaces:

```bash
codex-web serve --host 0.0.0.0 --port 3001
```

Never expose an unconfigured instance lacking HTTPS and access restrictions directly to the public Internet.

### OpenID Connect (OIDC) Single Sign-On (SSO)

Codex Web supports switching between locally defined credentials (`local`) and standard OpenID Connect Authorization Code Flow with PKCE (`sso`), compatible with any OIDC-compliant identity provider.

You can configure OIDC SSO and switch authentication modes either in **Settings -> Security** or via `${CODEX_WEB_STATE}/sso.json` (defaulting to `~/.codex-web/sso.json` with `0600` file permissions) or `CODEX_WEB_OIDC_*` environment variables:

```json
{
  "enabled": true,
  "providerName": "SSO",
  "issuer": "https://idp.example.com/oauth2/default",
  "clientId": "<oidc-client-id>",
  "clientSecret": "<oidc-client-secret>",
  "scopes": "openid email profile",
  "allowedEmails": ["admin@example.com"],
  "allowedDomains": []
}
```

- **Callback / Redirect URI**: Register `<origin>/api/auth/sso/callback` (e.g., `http://127.0.0.1:3001/api/auth/sso/callback` or `https://codex.example.com/api/auth/sso/callback`) in your OIDC provider.
- **Exclusive Mode Switch**: When SSO is enabled (`"enabled": true` or `CODEX_WEB_AUTH_MODE=sso`), password login (`POST /api/auth/login`) is disabled and `CODEX_WEB_LOGIN_EMAIL` / `CODEX_WEB_LOGIN_PASSWORD` are not required at server startup (only `CODEX_WEB_SESSION_SECRET` is required).
- **Allowlist & Multi-User Broker Support**:
  - In single-user mode, you can optionally restrict access via `allowedEmails` and/or `allowedDomains`; if both are empty, any user permitted by your OIDC provider policy is accepted.
  - In multi-user runtime broker mode, the verified OIDC `email` claim is matched against enabled users in `users.json`.
- **Recovery**: If an OIDC misconfiguration prevents sign-in, set `"enabled": false` in `sso.json` (or launch with `CODEX_WEB_AUTH_MODE=local`) to switch back to local email/password login.

### Cloudflare Turnstile

After logging in, Turnstile can be enabled in "Settings -> Security". When enabling or updating keys, the settings page must first pass a live Turnstile challenge, and the server validates it successfully with Siteverify before saving the configuration.

Turnstile configuration is saved at:

```text
${CODEX_WEB_STATE}/turnstile.json
```

If `CODEX_WEB_STATE` is not explicitly set, the default directory of the current managing process user is used:

```text
~/.codex-web/turnstile.json
```

Single-user mode and multi-user mode without an enabled root account use the `CODEX_WEB_STATE` of the user running Web, defaulting to `~/.codex-web`. When a multi-user broker has an active root account, only the `CODEX_WEB_STATE` configured for root is used, defaulting to `/root/.codex-web`; only root can update it. Unprivileged Web processes only read public settings without secrets, and login tokens are verified via Siteverify within the root broker process. Secret keys are never returned to the browser or unprivileged Web processes.

If a misconfiguration prevents login, the file owner can set `"enabled"` to `false` in the active `turnstile.json`. Requests reload the configuration without needing to delete site or secret keys; after logging in, pre-check and re-enable from Settings. State directory permissions should be `0700`, and config file permissions `0600`.

Configurations are loaded exclusively from the unified new path. After upgrading, if an older path still contains configurations, please re-enter and save in Settings; the program will not automatically read, move, overwrite, or delete legacy files.

### UnifiedPush Notifications

The Android client can receive Codex notifications through any UnifiedPush-compatible distributor, including Sunup, ntfy, and distributors backed by push services such as Mozilla Push. The server sends encrypted Web Push messages with VAPID to the endpoint supplied by the distributor.

Notifications are intentionally limited to events that need attention:

- a Turn that reaches `completed` or `failed`;
- a thread goal that transitions to `complete`;
- command, file-change, and permission approvals;
- Codex user-input questions and MCP elicitation requests.

Streaming deltas, ordinary agent messages, interrupted Turns, and idle thread-status changes are not pushed. Notifications are deduplicated by Turn, goal, or server-request ID in the server process.

The first registration for an endpoint sends one test notification through the same Web Push path. The Android client reports notifications as ready only after the push service accepts that test notification; otherwise the registration error is shown. Re-registering the same endpoint and encryption keys after a bridge reconnect is idempotent and does not send another test. A registration with a changed endpoint or key set, or a retry after a failed test, sends a new test notification.

Subscriptions and VAPID keys are stored server-side in:

```text
${CODEX_WEB_STATE}/push.json
```

The directory is created with permissions `0700` and the file with `0600`. The browser and Android client never receive the private VAPID key or any Codex OAuth/API credentials. If neither VAPID key is configured, a key pair is generated once and persisted.

Optional VAPID configuration:

```bash
export CODEX_WEB_PUSH_VAPID_PUBLIC_KEY='<base64url public key>'
export CODEX_WEB_PUSH_VAPID_PRIVATE_KEY='<base64url private key>'
export CODEX_WEB_PUSH_VAPID_SUBJECT='mailto:admin@example.com'
```

Both VAPID keys must be supplied together. Keep the same pair across server restarts and deployments so existing subscriptions remain valid.

Push endpoints must use HTTPS and resolve only to public addresses. Credentials in endpoint URLs, loopback/private/link-local destinations, and private DNS results are rejected. `CODEX_WEB_PUSH_ALLOW_INSECURE_ENDPOINTS=1` exists only for local integration tests and must not be used in production.

## Upgrading

When installed from source or GitHub Release tarballs, download or generate the new release tarball, then run the global installation again:

```bash
npm install --global ./codex-web-<new-version>.tgz
```

Do not modify `.next` or `dist` files inside the global installation directory directly.

The browser version's "Check for Updates" and "Install Update" buttons are not yet connected to the CLI/npm update flow; upgrades must be performed via the command line.

After upgrading the CLI in a systemd multi-user deployment, restart both services so that Web and runtime use the same version:

```bash
sudo systemctl restart codex-web-runtime.service
sudo systemctl restart codex-web.service
```

For macOS launchd deployments, run after upgrading the CLI:

```bash
sudo launchctl kickstart -k system/com.codex-web.runtime
sudo launchctl kickstart -k system/com.codex-web.web
```

## Source Development

```bash
git clone https://github.com/wangru8080/codex-web.git
cd codex-web
pnpm install

export CODEX_HOME="${TMPDIR:-/tmp}/codex-web-dev-home"
export CODEX_WEB_STATE="${TMPDIR:-/tmp}/codex-web-state"
export CODEX_WEB_LOGIN_EMAIL="dev@example.com"
export CODEX_WEB_LOGIN_PASSWORD="<dev-unique-password>"
export CODEX_WEB_SESSION_SECRET="<dev-fixed-secret-at-least-32-chars>"

pnpm run dev
```

It is strongly recommended to use dedicated, isolated directories for `CODEX_HOME` and `CODEX_WEB_STATE` during development and testing to prevent reading or altering daily Codex accounts, configs, sessions, MCP, Skills, approvals, or Web settings.

Common verification commands:

```bash
pnpm run test
pnpm run build
pnpm run test:smoke
```

The repository also provides `pnpm run test:smoke:multi-user:macos` to verify isolation and recycling across Chrome, unprivileged users, and root app-servers on macOS. This command requires setting isolated directories, CLI paths, and test users via `CODEX_WEB_MACOS_SMOKE_*` environment variables as prompted by the script, and should never point to your daily `CODEX_HOME`.

Build CLI:

```bash
pnpm run build:cli
pnpm pack --dry-run
```

## Current Limitations

- Currently connects only to local `codex app-server --stdio`; SSH remote mode is not yet complete.
- The browser update button is not yet integrated with CLI/npm automated updates.
- Browser reconnects do not terminate turns still executing in the bridge; however, if the app-server crashes, in-flight turns in memory cannot be resumed.
- When the app-server does not provide full-text search for message history, the UI explicitly indicates lack of support rather than returning fabricated results.
- Certain newly added server requests from app-server may only display diagnostic information until Codex Web adds dedicated UI interactions.

## FAQ

### Is `--codex-home` required?

No. If `CODEX_HOME` is set in the environment, it is used directly; if neither is set, `~/.codex` is used.

### What does `--open` do?

It instructs the operating system to open Codex Web in the default browser upon server startup. It cannot be used with `--port 0` because random port allocation does not yield a fixed URL upfront.

### Why are two logins required?

Web login controls who can access the web interface; OpenAI account or API Key login under "Settings -> Codex" allows the app-server to invoke Codex. They serve distinct purposes.

### Can it be launched from other directories?

Yes. The CLI reads application assets from the installation directory and treats the current working directory where the command was executed as the project workspace.

### Can it be directly exposed to the Internet?

Not recommended without precautions. Always configure an HTTPS reverse proxy, firewall, access controls, and Turnstile first, and ensure the origin host rejects requests bypassing the reverse proxy.
