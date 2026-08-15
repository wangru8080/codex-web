# 真实用户文件访问与无 Shell 预览执行计划

> **执行要求：** 按任务逐项实现并更新 checklist；不修改用户文件权限，不绕过真实 OS 用户的权限边界。

**目标：** 修复 root runtime 预览非 root 属主文件时的错误权限拒绝，并确保 Unix 上所有文件预览都不再通过 `sh -c` 读取内容。

**架构：** app-server runtime 继续以 Web 会话映射的真实 UID/GID 运行。文件内容统一通过 `app-server.fs/readFile` 读取；读取前用无 shell、固定 argv 的文件大小命令阻止已知超限文件，读取后再次校验响应大小以覆盖文件变化竞态。写入继续由 `app-server.fs/writeFile` 执行并遵循同一 OS 用户权限。

**技术栈：** TypeScript、React、Codex app-server JSON-RPC、Vitest、Playwright smoke。

## 全局约束

- 不修改 `/volume2/SSD/codex/Chat/AGENTS.md` 或其他用户文件的权限、属主与 ACL。
- 普通用户不得因预览实现获得额外文件权限；root 保留 OS 原生权限。
- Unix 文件内容不得通过 `sh -c`、重定向或管道读取。
- 文件预览继续执行读取前大小门禁与读取后大小校验。
- 不修改官方 `/home/rrssnas/code/codex` 源码。

---

### 任务 1：锁定回归行为

**文件：**
- 修改：`src/codex-web/tests/app-server-files.test.ts`
- 修改：`src/codex-web/tests/app-server-file-preview-wiring.test.ts`

**接口：**
- 验证 `buildFileSizeCommand(platformFamily, path): CommandExecParams`。
- 验证 `limitedFileResponse(response, maxBytes): FsReadFileResponse`。

- [x] 增加失败测试：Unix 大小检查使用直接 argv，不包含 `sh` 或文件内容读取管道。
- [x] 增加失败测试：大小命令沿用 runtime 的 OS 权限语义，不使用 read-only 文件沙箱。
- [x] 增加失败测试：Provider 的限流读取先检查大小，再调用 `fs/readFile`，响应超限仍拒绝。
- [x] 运行定向测试，确认旧实现失败。

### 任务 2：统一修复所有文件读取调用面

**文件：**
- 修改：`src/codex-web/app-server-files.ts`
- 修改：`src/codex-web/AppServerProvider.tsx`
- 修改：`src/components/layout/panels/PreviewPanel.tsx`

**接口：**
- `buildFileSizeCommand(platformFamily, path)` 生成固定大小检查命令。
- `limitedFileResponse(response, maxBytes)` 对 `fs/readFile` 响应执行读取后上限校验。
- `readFileLimited(path, maxBytes)` 保持现有调用签名，覆盖预览、媒体、附件、引用和 Skill 图标。

- [x] 删除 Unix `sh -c` 限流内容读取命令及对应解析函数。
- [x] 将 Unix 大小检查改为 `["wc", "-c", path]` 固定 argv，并兼容解析带文件名的输出。
- [x] 大小检查使用 app-server runtime 的真实 OS 权限；不为普通用户提权。
- [x] Provider 在大小合格后调用 `fs/readFile`，随后再次校验 Base64 解码大小。
- [x] 图片 URL 尚未返回时保持加载态，避免异步读取期间渲染空 `src`。
- [x] 运行定向测试并确认通过：2 个测试文件、20 项测试。

### 任务 3：回归与真实路径验证

**文件：**
- 修改：`docs/exec-plans/active/2026-08-15-real-user-file-access.md`

- [x] 使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 运行 `npm run test`：189 个测试文件、923 项测试通过。
- [x] 运行 `npm run build`：生产构建通过。
- [x] 运行 `npm run build:cli`：生产服务与 CLI 打包入口构建通过。
- [x] 运行 `npm pack --dry-run --json --ignore-scripts`：`0.9.10` 包清单生成通过，未创建或覆盖压缩包。
- [x] 启动应用，验证 Markdown、普通源码和图片均能预览。
- [x] 反例验证：响应超限仍被单元测试拒绝；当前 OS 用户无读取权限时，直接大小检查返回 `Permission denied`。
- [x] 核对 Unix 预览请求不再产生 `sh -c`。
- [x] 更新 Smoke Ledger、状态和决策记录。
- [x] 通过连接现有 root runtime broker 的临时 `4801` 实例复核目标文件，root 用户确认预览正常且无权限错误。
- [x] 记录生产 `4799` 尚未部署；该发布操作不阻塞本计划按临时 root runtime 的真实权限验收结果归档。

## 决策记录

- 2026-08-15：截图中的 `sh: line 1: <path>: Permission denied` 来自 shell 打开重定向文件失败，不代表 Markdown 内容被执行。
- 2026-08-15：不采用给文件增加执行权限或统一提升普通用户权限的方案。
- 2026-08-15：所有 `readFileLimited` 调用方共用 Provider 修复，避免逐组件打补丁。
- 2026-08-16：Unix 内容读取改为 `app-server.fs/readFile`；`command/exec` 只以固定 `wc` argv 检查大小，不再启动 shell。
- 2026-08-16：大小检查使用 app-server runtime 的真实 OS 身份。`dangerFullAccess` 仅表示不叠加 Codex 文件沙箱，不会改变非 root 用户的 Unix UID/GID 权限。
- 2026-08-16：生产服务为 `codex-web.service`（端口 `4799`）与 `codex-web-runtime.service`，启动于 20:32；已安装的 `0.9.10` 前端 chunk 仍包含旧 `sh -c` 读取器，尚未加载本次修复。
- 2026-08-16：当前执行身份 `rrssnas` 的 `sudo -n` 需要密码，且无权读取 root systemd 日志；不读取密码哈希、不伪造 root Web 会话，也不在未授权情况下安装或重启生产服务。
- 2026-08-16：本地生产 chunk 已确认包含固定 `wc` argv 与 `dangerFullAccess` 大小检查，并且不包含旧的 `CODEX_WEB_FILE_READ_BYTES`、`sh -c` 重定向读取器；npm dry-run 包清单验证通过。
- 2026-08-16：已生成 `/volume2/SSD/codex/Temp/wangru8080-codex-web-0.9.10.tgz`，SHA-1 为 `a969e35a412b2d8dd267a191d9013f704a39c907`；全局安装因当前终端 `sudo -n` 要求密码而停止，尚未修改生产安装或重启服务。
- 2026-08-16：未安装新包，改用端口 `4801` 启动当前工作区生产构建并连接现有 root runtime broker；用户以 root 登录后确认目标文件预览正常。

## 状态

- Code complete
- Tests pass
- Smoke passed：隔离 `rrssnas` runtime、临时 root runtime
- 生产 `4799` 尚未部署；修复包已生成，发布操作另行执行

## Smoke Ledger

| 场景 | 预期 | 结果 |
|---|---|---|
| root runtime 预览 `660 rrssnas:admin` Markdown | 按 root 原生权限可读 | 通过：临时 `4801` 实例连接现有 root broker，用户确认目标文件预览正常；生产 `4799` 尚未部署 |
| 普通用户读取无权限文件 | 明确拒绝 | 通过：`rrssnas` 对 `700` 目录内文件执行固定 `wc` 返回 `Permission denied` |
| Markdown / 源码 / 图片预览 | 不通过 Unix `sh -c` 读取内容 | 通过：浏览器分别验证目标 `AGENTS.md`、`package.json`、`file.svg`，控制台 0 错误；静态扫描无旧读取器 |
| 超过上限的文件 | 读取前或读取后拒绝 | 通过：单元测试覆盖读取后超限拒绝；读取前比较由 Provider 接线测试覆盖 |
