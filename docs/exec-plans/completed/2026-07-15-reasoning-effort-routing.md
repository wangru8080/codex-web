# 推理等级请求接线修复实施计划

> **执行要求：** 在当前会话内按任务逐项实施并更新复选框；使用隔离 `CODEX_HOME` 验证，不自动提交 Git。

**目标：** 让输入框选择的推理等级通过真实 app-server `turn/start.effort` 生效，并在 rollout `turn_context.effort` 中可验证。

**架构：** UI 继续持有 `selectedEffort`；页面发送参数、Provider action 类型和 `turn/start` 构造链路显式传递 `ReasoningEffort`。`thread/start` 不伪造协议中不存在的 effort 字段，首轮在创建线程后的 `turn/start` 覆盖配置默认值，后续轮沿用同一路径。

**技术栈：** React 19、TypeScript、Vitest、Codex app-server v2 `turn/start`。

## 全局约束

- app-server notification 和 rollout 是生效状态事实源。
- 不修改生成的协议类型；直接复用现有 `ReasoningEffort`。
- 未显式选择时传 `undefined`，继续使用 app-server/config 默认值。
- 新会话与历史会话必须共用同一 effort 路由语义。
- 开发与测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

### Task 1：建立请求参数回归测试

**文件：**
- 新增：`src/codex-web/turn-start-request.test.ts`
- 新增：`src/codex-web/turn-start-request.ts`

- [x] 编写失败测试：显式 `high` 必须生成 `{ effort: "high" }`，未选择时不得生成 effort 字段。
- [x] 运行定向 Vitest，确认测试先失败。
- [x] 实现最小 `withReasoningEffort(params, effort)` 请求 helper。
- [x] 再次运行定向测试并确认通过。

### Task 2：贯穿新会话与历史会话发送链路

**文件：**
- 修改：`src/codex-web/AppServerProvider.tsx`
- 修改：`src/app/chat/page.tsx`
- 修改：`src/app/chat/[id]/page.tsx`
- 修改：`src/components/chat/ChatView.tsx`

- [x] 为 `SendOneTurnParams` 和 `SendTurnInThreadParams` 增加 `effort?: ReasoningEffort`。
- [x] 构造 `turn/start` 时通过 helper 设置 effort，并在首轮转发到内部 `sendTurnInThread`。
- [x] 新会话首页把 `selectedEffort` 传入两条发送分支并加入 callback 依赖。
- [x] 历史会话页把输入框 effort 传入 app-server 发送参数。
- [x] 清除上下文后新建线程的发送路径继续使用当前输入框 effort。

### Task 3：验证与归档

- [x] 运行定向测试、`npm run test` 和 `npm run build`。
- [x] 使用隔离 app-server 做 `high` 触发与配置默认值反例，检查 rollout `turn_context.effort`。
- [x] 更新 Smoke Ledger。
- [x] 输出计划归档拟执行操作清单，取得用户明确同意后移动到 `completed/`。

## Smoke Ledger

- 修复前证据：生产 rollout `/volume2/SSD/codex/Temp/codex-start-home/sessions/2026/07/15/rollout-2026-07-15T10-01-13-019f6381-b755-7f40-8874-894ee7a57a5e.jsonl` 在 UI 选择 `gpt-5.5 + 高` 后仍记录 `effort: low`，与 `config.toml` 默认值一致，确认请求丢失覆盖字段。
- TDD：新增请求 helper 前，定向测试因 `Cannot find module './turn-start-request'` 失败；实现后 2/2 通过。
- 反例：`withReasoningEffort(params, undefined)` 和 `withReasoningEffort(params, "auto")` 均保持请求不带 effort，不覆盖 app-server/config 默认值。
- `npm run test`：40 个测试文件、189 个测试全部通过，包含 TypeScript 类型检查。
- `npm run build`：生产构建成功；保留项目既有 Next.js NFT 动态路径警告。
- 真实触发：隔离配置 `/volume2/SSD/codex/Temp/codex-dev-home/config.toml` 明确为 `model_reasoning_effort = "low"`；生产页面显式选择 `GPT-5.5 + 高` 并发送“只回复 EFFORT_HIGH_OK”。
- 真实结果：新 rollout `/volume2/SSD/codex/Temp/codex-dev-home/sessions/2026/07/15/rollout-2026-07-15T10-26-36-019f6398-f3fc-7db0-a478-66bf765b959e.jsonl` 记录 `model: gpt-5.5`、`effort: high`，collaboration mode 同步为 `reasoning_effort: high`，最终回复 `EFFORT_HIGH_OK`。
- 进程收口：验证后已向测试服务发送 SIGTERM；端口 `37613` 返回连接失败，Web、tsx 和本轮 `codex app-server --stdio` 子进程均已退出。
- 临时日志：`/volume2/SSD/codex/Temp/codex-effort-e2e-20260715-1024.log`，按统一临时目录规则保留。
