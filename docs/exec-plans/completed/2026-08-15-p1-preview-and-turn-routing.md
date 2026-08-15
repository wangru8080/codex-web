# P1 预览与 Turn 路由修复执行计划

**目标：** 修复文件预览信任边界、恢复 HTML 源码与渲染双视图、补全常见源码语法高亮，并阻止旧 Turn 通知覆盖当前 Turn。

**架构：** 文件内容继续只通过 Codex app-server 的 `fs/*` 方法读取。前端在自动读取前执行词法范围校验，并通过 `fs/getMetadata` 检查工作区内的软链接路径；无法证明仍在工作区的路径降级为需用户确认。HTML 使用已读取内容构造带 CSP 的 sandbox `srcDoc`，不再依赖已删除的 Next 文件 Route。通知路由按 `threadId + turnId` 选择 snapshot，只有 ID 匹配时才更新 active Turn。

**技术栈：** Next.js、React、TypeScript、Vitest、Codex app-server JSON-RPC、react-syntax-highlighter。

## 全局约束

- 不新增第三方依赖。
- 不直接读取 Web 服务器本机文件，兼容本地与 SSH app-server。
- 静态 HTML 禁止脚本；交互 HTML 允许内联脚本，但禁止网络连接、同源权限和父页面访问。
- 未识别语言安全回退为纯文本。
- 用户可见状态保留 app-server source breadcrumb。

## Task 1：路径信任边界

**文件：**
- 修改：`src/lib/preview-source.ts`
- 修改：`src/codex-web/AppServerProvider.tsx`
- 修改：`src/components/layout/panels/PreviewPanel.tsx`
- 测试：`src/lib/tests/preview-source.test.ts`

- [x] 增加 `..`、相似目录前缀、Windows 路径和工作区内软链接反例测试。
- [x] 使用词法规范化判断工作区包含关系。
- [x] 暴露 `fs/getMetadata` action，并在自动读取前检查工作区子路径中的软链接。
- [x] 检查失败或发现软链接时切换为 `agent-referenced`，等待用户确认。
- [x] 运行路径与文件预览定向测试。

## Task 2：HTML 双视图与源码高亮

**文件：**
- 修改：`src/lib/inline-html-csp.ts`
- 修改：`src/codex-web/app-server-files.ts`
- 修改：`src/components/layout/panels/PreviewPanel.tsx`
- 新建：`src/components/editor/source-highlight-languages.ts`
- 测试：`src/lib/tests/inline-html-csp.test.ts`
- 测试：`src/codex-web/tests/app-server-files.test.ts`
- 测试：`src/codex-web/tests/app-server-file-preview-wiring.test.ts`

- [x] 写入 HTML 静态/交互 CSP、失效 Route 移除和语言映射失败测试。
- [x] HTML 使用 `源码 | 预览` 分段按钮切换视图。
- [x] 使用 sandbox `srcDoc` 渲染 app-server 返回的 HTML。
- [x] 注册 Python、TypeScript、JavaScript、Shell、JSON、YAML、CSS、SQL、Rust、Go、Java、C/C++、C#、Ruby、PHP、Swift、Kotlin、Lua、PowerShell、Dockerfile 等常见语言。
- [x] 未识别扩展名回退 `plaintext`。
- [x] 运行 HTML、文件适配器、真实高亮 token 和预览接线定向测试。

## Task 3：Turn 通知路由

**文件：**
- 修改：`src/codex-web/AppServerProvider.tsx`
- 新建：`src/codex-web/turn-notification-routing.ts`
- 测试：`src/codex-web/tests/turn-notification-routing.test.ts`

- [x] 写入 Turn A 迟到通知不得覆盖 Turn B 的失败测试。
- [x] 按通知 ID 选择 snapshot 基态。
- [x] 只有通知与 active Turn 匹配时才更新 active 状态，新 `turn/started` 除外。
- [x] 运行 reducer、恢复和通知路由测试。

## Task 4：完整验证

- [x] 运行 `npm run test`。
- [x] 运行 `npm run build`。
- [x] 使用环境变量账号登录隔离开发服务，完成真实浏览器验证并停止服务。
- [x] 浏览器验证：HTML 源码/预览切换、静态/交互 CSP、Python/TS/Shell/HTML 高亮 token。
- [x] 浏览器反例：工作区内软链接不自动读取，显示确认门槛。
- [x] 运行隔离 app-server bridge smoke。
- [x] 更新本计划状态、决策日志和 Smoke Ledger。

## 决策日志

- 2026-08-15：HTML 采用现有分段按钮，不新增下拉框。
- 2026-08-15：不恢复本地 Next 文件 Route，避免破坏唯一 runtime 和 SSH 远端语义。
- 2026-08-15：HTML 预览先保证单文件、内联资源和 HTTPS 静态资源；相对远端文件依赖不伪装为已支持。
- 2026-08-15：使用环境变量账号完成真实浏览器登录；凭据未写入命令参数、日志或截图。
- 2026-08-15：真实浏览器发现 meta CSP 中的 `frame-ancestors` 会被忽略，已移除该无效指令并补回归测试。

## Smoke Ledger

| 场景 | 预期 | 状态 |
| --- | --- | --- |
| HTML 源码视图 | 显示高亮源码 | 浏览器：`language-html`，82 个着色 token |
| HTML 静态预览 | 注入 `script-src 'none'` | 浏览器：`sandbox=""`，页面显示“脚本未执行” |
| HTML 交互预览 | 仅允许内联脚本，`connect-src 'none'` | 浏览器：`allow-scripts allow-forms`，页面显示“脚本已执行” |
| Python/TS/Shell 文件 | 源码视图输出对应高亮 token | 浏览器：44/22/16 个 token 或着色 token |
| 普通工作区文件 | 自动读取并显示 | 路径函数反例测试通过 |
| `..` 或软链接逃逸 | 不自动读取，显示确认门槛 | 浏览器软链接反例与路径函数测试通过 |
| Turn A 迟到通知 | 不覆盖当前 Turn B | 路由测试通过 |
| app-server bridge | 隔离环境连接、模型与账户读取正常 | `npm run test:smoke` 通过 |
| Web 页面 | 环境变量账号登录并完成工作台点击 | 通过；静态脚本反例仅有预期 CSP 拦截日志 |

## 浏览器截图

- `verification-python-highlight.png`
- `verification-typescript-highlight.png`
- `verification-shell-highlight.png`
- `verification-html-source.png`
- `verification-html-interactive.png`
- `verification-html-static.png`
- `verification-symlink-confirmation.png`

## 完成状态

- Code complete
- Tests pass：188 个测试文件、913 个用例。
- Smoke passed：隔离 app-server bridge；真实浏览器登录、源码高亮、HTML 双视图、静态/交互脚本与软链接反例。
- 生产构建通过。
