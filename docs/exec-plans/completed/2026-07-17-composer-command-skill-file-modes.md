# 输入框命令、技能与文件模式执行计划

状态：Code complete / Tests pass / Smoke passed

## 目标

在聊天输入框中对齐 Codex App/TUI 的三类触发入口：`/` 命令、`$` 技能与 `@` 文件，并确保命令与数据来自 Codex app-server，而不是静态假状态或失效的 HTTP 接口。

## 执行清单

- [x] 梳理现有输入框弹层、命令分发、技能引用、文件搜索与 app-server action 边界。
- [x] 将 `/` 接入 MCP、代码审查、压缩、推理、模型、状态、目标、计划模式、记忆，并为需要二级选择的命令提供原位面板。
- [x] 使用 `thread/compact/start` 执行真实压缩，通过 app-server item 事件显示开始与完成状态。
- [x] 将 `$` 独立为技能入口，读取当前工作目录可用技能，选择后以结构化技能引用加入输入框。
- [x] 将 `@` 接入 app-server 文件模糊搜索；空查询不返回文件，输入字符后按文件名匹配。
- [x] 补齐中文文案、类型与针对性单元测试，并加入普通路径/触发路径反例。
- [x] 运行 `npm run test`、`npm run build` 和相关 smoke/E2E。
- [x] 使用隔离 `CODEX_HOME` 启动应用，通过真实浏览器验证三类交互和浏览器 console。
- [x] 修复生产构建缺失时 `npm run start` 直接崩溃：仅在 `.next/BUILD_ID` 不存在时自动执行一次生产构建。

## 成功标准

1. 输入 `/` 可键盘或鼠标选择九项命令，模型、推理、MCP、状态和记忆展示真实状态；压缩、审查等动作调用真实 app-server 方法。
2. 输入 `$` 显示当前项目可用技能，选择后生成技能标签，发送时仍携带结构化技能引用。
3. 仅输入 `@` 不显示文件结果；继续输入字符后显示当前项目的匹配文件并可加入对话。
4. 普通文本输入不触发任何弹层，已有附件、文件引用和技能发送行为无回归。
5. 测试、构建、smoke/E2E 与真实浏览器验证结果记录在本计划的 Smoke Ledger 中。

## Smoke Ledger

- `npm run typecheck`：通过。
- `npx vitest run src/lib/message-input-logic.test.ts src/components/chat/ContextCompactionRow.test.tsx`：2 个测试文件、12 个测试通过。
- `npx vitest run --exclude server/websocket-bridge.test.ts`：70 个测试文件、321 个测试通过。
- `npm run test`：沙箱外完整执行通过，72 个测试文件、325 个测试通过。
- `npm run build`：生产构建通过；保留既有 `next.config.mjs` / `theme/loader.ts` NFT trace warning。
- Playwright MCP + 生产服务：使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 在随机同源端口完成真实浏览器验证。
- 启动器修复后复验：`npm run typecheck` 通过；排除端口受限用例后仍为 70 个测试文件、321 个测试通过。
- 反例：普通 `src/app/page.tsx` 与 `price$usd` 不触发弹层；仅输入 `@` 不调用文件搜索且不展示假文件结果。
- `/`：九项命令顺序与文案正确；推理选择会更新页脚；状态显示真实线程 ID `019f6e91-d229-7d23-bdcf-d1f4789e3467` 与上下文用量；MCP 返回 `playwright`、23 个工具、已启用；模型面板来自 app-server 并包含 GPT-5.6 系列；记忆与审查面板正常。
- `/compact`：真实调用后先显示“上下文开始压缩”，完成后即时保留新的“已处理 26s”记录，展开显示“上下文已压缩”；隔离 session 为 `/volume2/SSD/codex/Temp/codex-dev-home/sessions/2026/07/17/rollout-2026-07-17T13-34-38-019f6e91-d229-7d23-bdcf-d1f4789e3467.jsonl`。
- `$`：显示 app-server 返回的可用技能及来源；选择 OpenAI Docs 后仅显示技能名 badge，不带 `/`，结构化技能引用保持不变。
- `@`：空查询只显示输入提示；`@AGENTS` 返回文件/目录匹配并按 `match_type` 区分；选择 `AGENTS.md` 后真实模型只读验证返回文档第一行标题 `AGENTS.md`，网络中不再出现 `/api/files/raw` 或 `/api/files/serve`。
- 浏览器 console 仍有本功能之前已存在的 `/api/setup`、`/api/settings/app`、`/api/settings/workspace`、`/api/tasks`、`/api/git/status` 404 轮询噪声；未发现本次命令、技能、文件或 app-server 调用的新错误，本计划不扩大范围处理旧 HTTP 接线。

## 安全审查

- 文件模糊搜索根目录固定为当前工作区；文件和目录内容经 app-server `fs/readFile` / `fs/readDirectory` 读取，不新增任意 HTTP 文件读取路由。
- 代码审查目标使用生成协议的结构化 `ReviewTarget`，不拼接 shell 命令；真实浏览器仅打开审查面板，未执行审查。
- MCP、模型、状态均为只读 app-server 请求；记忆配置仅在用户点击“完成”时通过 `config/batchWrite` 写入，验收未触发写入。
- 测试只使用隔离 `CODEX_HOME`，没有读取或修改本地真实 Codex 配置与会话。

## 决策日志

- 2026-07-17：以本地官方 `codex-rs` TUI、app-server README 与生成协议为语义依据；官方在线手册请求因环境审批服务 503 未能完成，不以网络失败阻塞本地官方源码对齐。
- 2026-07-17：文件匹配使用 app-server `fuzzyFileSearch`，不再依赖旧 `/api/files/suggest` 路由。
