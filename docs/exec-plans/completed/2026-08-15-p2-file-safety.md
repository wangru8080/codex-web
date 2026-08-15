# P2 文件读取安全与附件链路修复计划

> 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**目标：** 修复文件预览完整传输后才限流、Blob URL 未释放，以及文件附件和 Token 估算仍依赖已删除 HTTP API 的问题。

**架构：** 文件系统事实源继续使用 Codex app-server。由于当前 `fs/readFile` 不支持 range/limit 且 `fs/getMetadata` 不返回大小，受限读取使用 app-server `command/exec` 在目标主机最多读取“上限 + 1”字节，并通过 `outputBytesCap` 约束 JSON-RPC 响应；Unix 与 Windows 分别使用系统自带命令。普通配置读写继续使用原生 `fs/*`。

**技术栈：** React 19、Next.js 16、TypeScript、Codex app-server JSON-RPC v2、Vitest、Playwright。

## 约束

- 不新增 `/api/files*` 文件后端。
- 本地与 SSH 远端都以 app-server 运行目标为文件事实源。
- 文本、文档、图片、音视频预览统一限制为 10 MiB。
- 文件树附件必须生成真实二进制附件；读取失败时保留现有 `@mention` 降级。
- 开发和测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

## Task 1：受限读取

- [x] 为 Unix/Windows 受限读取命令、大小查询和超限错误补失败测试。
- [x] 在 `AppServerProvider` 暴露 `readFileLimited` 与 `getFileSize`。
- [x] 文本、文档与媒体预览统一改走受限读取。
- [x] 验证普通文件成功、超过上限只传输上限加 1 字节。

## Task 2：媒体缓存释放

- [x] 单项清理调用 `URL.revokeObjectURL()`。
- [x] 全量清理释放所有已完成及等待中的 URL。
- [x] 验证清理后同一路径重新读取，且旧 URL 只释放一次。

## Task 3：附件与 Token 估算迁移

- [x] 文件树“添加到对话”通过 app-server 读取并创建真实 `File`。
- [x] 文件 Token 估算使用 app-server 文件大小，目录估算使用 `fs/readDirectory`。
- [x] 断言相关源码不再包含 `/api/files/raw`、`/api/files/serve`、`/api/files?`。

## Task 4：验证

- [x] 运行定向测试。
- [x] 运行 `npm run test`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run test:smoke`。
- [x] 使用真实浏览器验证预览、超限反例、图片、附件和 Token 估算，检查 console。
- [x] 停止本次测试服务。

## Task 5：修复历史图片 Markdown 嵌套告警

- [x] 为 `ChatImg` 加载态与失败态补充合法 phrasing content 接线测试。
- [x] 将两个状态容器从 `<div>` 改为保持现有布局的 `<span>`。
- [x] 运行定向测试、全量测试和生产构建。
- [x] 使用真实 Chrome 复验历史图片，确认图片加载且不再出现 `<div>` 嵌套 `<p>` 告警。
- [x] 停止本次测试服务。

## Smoke Ledger

- 协议事实：当前 app-server `fs/readFile` 只能整文件返回，`fs/getMetadata` 不含大小；未伪造 range 参数，也未新增本地文件 HTTP 后端。
- 受限读取：Unix/Windows 都通过 app-server `command/exec` 在目标主机最多读取“上限 + 1”字节，使用 read-only、禁网 sandbox，并按 Base64 最大长度设置 `outputBytesCap`。
- 命令反例：Unix 实命令对 `/dev/zero` 在 1 KiB 上限下只读取 1025 字节；普通 Python 文件读取和大小查询都返回 140 字节。
- 定向测试：8 个测试文件、52 项通过。
- 全量测试：CI 模式 189 个测试文件、923 项通过。
- 生产构建：`npm run build` 通过，生成 28 个静态页面。
- Smoke：`npm run test:smoke` 通过，隔离 `CODEX_HOME` 下读取 5 个模型，账号来源为 `app-server.account/read`。
- 浏览器正例：真实 Chrome 151 登录后，Python 源码预览显示真实内容；文件树添加 `example.py` 后出现 `~35` 的真实附件胶囊；`example.ts` mention 显示 `~44`。
- 媒体正例：2.3 MiB PNG 通过 Blob URL 完整显示，尺寸 1254×1254；刷新时旧 Blob URL 被释放，新预览使用新 URL。
- 超限反例：真实浏览器打开 13.3 MiB source map，界面显示“文件过大，无法预览（上限 10 MB）”，页面无运行时异常。
- 剩余风险：Windows 命令构造已由单元测试覆盖，但本轮没有 Windows app-server 可执行真实端到端验证。
- 追加修复：`ChatImg` 加载态与失败态改用段落内合法的 `<span>`，保留原有 block/flex 布局和 alert 语义。
- 追加定向测试：媒体接线 1 个测试文件、7 项通过；最终全量测试 189 个测试文件、924 项通过。
- 追加浏览器验证：真实 Chrome 历史线程两张图片均为 Blob URL，尺寸 1254×1254、`complete=true`；本轮 console error 为 0，`<div>`/`<p>` 嵌套告警未再出现。
- 环境收口：隔离开发服务已停止，本轮两个 Chrome 测试标签已关闭，未生成截图。
