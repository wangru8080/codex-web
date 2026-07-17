# App-Server 文件树收口实施计划

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** 移除文件树外壳残留的旧 `/api/files/*` 操作，让新建文件、新建目录、手动刷新和外部变更刷新统一使用 Codex app-server `fs/*` 与 `fs/changed`。

**Architecture:** `AppServerProvider` 继续作为浏览器文件系统唯一入口，补齐可配置的 `fs/createDirectory`、`fs/watch` 和 `fs/unwatch` 动作，并把匹配 watch 的 `fs/changed` 通知交给订阅者。`FileTreePanel` 先用 `fs/readDirectory` 检查同名项，再使用 app-server 动作创建文件/目录；`FileTree` 在工作区生命周期内注册 watch，将手动刷新和变更通知收口到同一个目录重载函数，同时复用现有文件变更事件通知预览面板。

**Tech Stack:** React 19、Next.js 16、TypeScript、Codex app-server JSON-RPC v2、Vitest、Playwright smoke。

## Global Constraints

- 文件树事实源只能是 Codex app-server `fs/*` 与 `fs/changed`，不得新增或保留该外壳的 `/api/files/*` 请求。
- 保持 CodexWeb 现有文件树布局、按钮、创建表单、懒加载和预览交互不变。
- 新建项前必须用 `fs/readDirectory` 检查父目录同名项，存在时停止并提示，禁止 `fs/writeFile` 静默覆盖。
- 工作区切换和组件卸载必须执行 `fs/unwatch`，不得遗留 connection-scoped watch。
- `fs/changed` 必须同时驱动文件树刷新和现有预览文件变更通道。
- 开发、测试和 smoke 显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### Task 1: Provider 文件协议动作与 watch 生命周期

**Files:**
- Modify: `src/codex-web/AppServerProvider.tsx`
- Create: `src/codex-web/app-server-file-watch.test.ts`

**Interfaces:**
- Produces: `createDirectory(path, recursive?)`、`watchFileSystem(path, onChanged)`。
- `watchFileSystem` 在 `fs/watch` 成功后返回异步清理函数；清理函数先移除本地 notification listener，再请求 `fs/unwatch`。

- [x] **Step 1: 编写失败测试**

断言 Provider 使用 generated `FsChangedNotification`、`FsWatchResponse` 类型，并发出 `fs/watch`、`fs/unwatch`；断言只把 watchId 匹配的 `changedPaths` 交给订阅者。

- [x] **Step 2: 运行红灯测试**

Run: `npm run test -- --run src/codex-web/app-server-file-watch.test.ts`

Expected: FAIL，Provider 尚未暴露 watch 动作。

- [x] **Step 3: 实现最小 Provider 动作**

为 `AppServerActions` 增加精确签名；watchId 使用连接内唯一计数器生成，监听在 request 前注册以避免丢失快速通知；watch 失败时立即移除监听；清理时对已断开的旧 client 不再误发 unwatch。

- [x] **Step 4: 运行定向测试**

Run: `npm run test -- --run src/codex-web/app-server-file-watch.test.ts`

Expected: PASS。

### Task 2: 新建文件和目录迁移到 fs/*

**Files:**
- Modify: `src/components/layout/panels/FileTreePanel.tsx`
- Modify: `src/codex-web/app-server-files.ts`
- Modify: `src/codex-web/app-server-files.test.ts`
- Modify: `src/codex-web/app-server-file-tree-wiring.test.ts`

**Interfaces:**
- Consumes: `readDirectory`、`createDirectory(path, false)`、`writeFile(path, utf8ToBase64(content))`。
- Produces: 与现有 UI 相同的新建成功、错误提示和文件预览行为。

- [x] **Step 1: 补充失败测试**

覆盖 UTF-8 初始 Markdown Base64 编码和 Windows/POSIX 文件名大小写语义；断言 FileTreePanel 不含 `/api/files/write`、`/api/files/mkdir` 或 `fetch(endpoint)`，并在写文件前读取父目录防覆盖。

- [x] **Step 2: 运行红灯测试**

Run: `npm run test -- --run src/codex-web/app-server-files.test.ts src/codex-web/app-server-file-tree-wiring.test.ts`

Expected: FAIL，文件树外壳仍调用旧 HTTP API。

- [x] **Step 3: 实现新建接线**

先调用 `readDirectory(targetDir)` 检查同名项，存在则显示本地化错误并停止；目录调用 `createDirectory(targetPath, false)`，文件把 `# <stem>\n\n` 编码后交给 `writeFile`。成功后保留当前 reload 与预览打开行为。

- [x] **Step 4: 运行定向测试**

Run: `npm run test -- --run src/codex-web/app-server-files.test.ts src/codex-web/app-server-file-tree-wiring.test.ts`

Expected: PASS。

### Task 3: 手动刷新与 fs/changed 自动刷新收口

**Files:**
- Modify: `src/components/project/FileTree.tsx`
- Modify: `src/codex-web/app-server-file-tree-wiring.test.ts`
- Modify: `docs/exec-plans/active/2026-07-17-app-server-file-tree-closure.md`

**Interfaces:**
- Consumes: `watchFileSystem(workingDirectory, onChanged)`、`dispatchFileChanged({ source: "external" })`。
- Produces: 工作区级 watch、同一 `fetchTree` 刷新入口、预览热更新事件和卸载清理。

- [x] **Step 1: 补充失败接线测试**

断言 FileTree 注册工作区 watch、接收 changedPaths 后调用 `fetchTree` 和 `dispatchFileChanged`，effect cleanup 调用 unwatch；保留手动 `refresh-file-tree` 到同一 `fetchTree` 的路径。

- [x] **Step 2: 实现 watch effect**

工作目录有效时注册一次 watch；通知到达时刷新根树并派发现有文件变更事件；目录切换或卸载时等待或调用返回的清理函数，处理 watch request 与卸载竞态。

- [x] **Step 3: 运行定向和全量验证**

Run: `npm run test -- --run src/codex-web/app-server-file-watch.test.ts src/codex-web/app-server-files.test.ts src/codex-web/app-server-file-tree-wiring.test.ts`

Run: `npm run test`

Expected: 定向测试、TypeScript typecheck 和全量 Vitest 全部通过。

- [x] **Step 4: 运行生产构建与 smoke**

Run: `npm run build`

Run: `npm run test:smoke`

Expected: 生产构建成功；smoke 验证 app-server 初始化与基础聊天路径无回归。

- [x] **Step 5: 更新状态总览、决策日志和 Smoke Ledger**

记录新建正例、同名文件反例、手动刷新、`fs/changed` 正例、非匹配 watchId 反例、unwatch 生命周期、全量测试和构建结果。完成后计划归档需先按仓库规则列出移动操作并取得用户确认。

## 状态总览

- `Code complete`：新建文件/目录、手动刷新和 `fs/changed` 接线完成。
- `Tests pass`：typecheck、3 个定向测试文件 16 项、全量 75 个测试文件 348 项通过。
- `Smoke passed`：生产构建与隔离 bridge smoke 通过，现有开发服务 `/chat` 返回 200。
- `Review passed`：文件树外壳已无 `/api/files/*`，watchId 过滤、unwatch 竞态和防覆盖路径已检查。

## 决策日志

- `fs/writeFile` 没有排他创建参数，因此新建项先用 `fs/readDirectory` 检查父目录；相比依赖不同平台的 metadata 不存在错误文本，这能稳定保留旧 `overwrite: false` 用户语义。
- watch 生命周期归属文件树实例：只有文件树挂载时订阅当前工作区，切换目录和卸载时解除，避免 Provider 永久监听任意历史目录。
- `fs/changed` 复用现有 `codepilot:file-changed` 消费通道更新预览，不另建第二套预览事件。

## Smoke Ledger

- 红灯：首次定向运行因 `app-server-file-watch` 不存在在 typecheck 阶段失败；新建迁移后的定向运行继续精确暴露 watch 尚未接入。
- 新建正例：文件先用 `fs/readDirectory` 检查父目录，再把 UTF-8 Markdown 编码为 Base64 交给 `fs/writeFile`；目录调用 `fs/createDirectory` 且 `recursive: false`。
- 新建反例：POSIX 路径保持大小写敏感；Windows 路径按大小写不敏感识别同名项，命中后显示本地化错误且不调用写入。
- 刷新正例：手动刷新事件和匹配 watchId 的 `fs/changed` 都调用同一个 `fetchTree`；通知路径同时进入现有 `codepilot:file-changed` 预览通道。
- watch 反例：非匹配 watchId 与非 `fs/changed` 通知均返回 null；目录切换或卸载在异步 watch 注册前后都能执行 listener cleanup 和 `fs/unwatch`。
- 定向验证：3 个测试文件、16 项通过。
- 全量验证：首次沙箱内运行仅因 websocket 测试监听 `127.0.0.1` 返回 EPERM；允许本地监听后 75 个测试文件、348 项全部通过。
- 生产构建：沙箱内首次因 Turbopack 辅助进程无法绑定端口失败；允许本地监听后构建通过并生成 22 个路由，仅保留既有 NFT trace 警告。
- smoke：`npm run test:smoke` 通过，使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，模型 7 个，账号来源为 `app-server.account/read`。
- 页面走查：同仓库已有开发服务占用 3000，未终止该进程；`http://127.0.0.1:3000/chat` 返回 200。CDP 版本端点因会暴露现有浏览器会话控制地址而被权限审查拒绝，本轮未执行浏览器控制与截图。
- 剩余风险：`fs/writeFile` 协议没有原子排他创建参数，父目录同名检查与写入之间仍存在极小的竞态窗口；当前实现已恢复旧 UI 的正常防覆盖语义，但无法仅凭现有 `fs/*` schema 消除该协议级竞态。
