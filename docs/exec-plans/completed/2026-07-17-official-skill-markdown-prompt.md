# 官方技能 Markdown 提示词对齐执行计划

状态：Code complete / Tests pass / Smoke passed

## 目标

将输入框通过 `$<skill-name>` 选择的技能按官方 Codex App 语义发送：用户文本使用 `[$skill-name](SKILL.md 绝对路径)` Markdown 链接，同时继续向 app-server 发送结构化 `type: "skill"` 输入，由 app-server 负责注入完整 `<skill>...</skill>` 上下文。

## 已确认基准

- 官方 session 的用户消息为 `[$skill-demo](/volume2/CodexApp/skills/skill-demo/SKILL.md) 测试技能`。
- 官方 session 随后出现完整 `<skill>...</skill>` 上下文，说明 Markdown 用户文本与结构化技能输入各有职责。
- 当前 Web session 的用户消息为 `$skill-demo 测试技能`，但已经正确产生完整 `<skill>...</skill>` 上下文。
- 因此只需修正输入框的技能文本序列化，必须保留现有 `UserInput { type: "skill", name, path }` 接线。

## 执行清单

- [x] 在 `src/lib/message-input-logic.ts` 中为技能 badge 生成官方 Markdown 链接；单技能和多技能均按 badge 顺序序列化。
- [x] 对缺少 `skillPath` 的旧 badge 保留 `$skill-name` 兼容格式，禁止伪造路径。
- [x] 更新 `src/lib/message-input-logic.test.ts`，逐字断言单技能、多技能、无用户正文和旧 badge 反例。
- [x] 更新 `src/codex-web/turn-input.test.ts`，断言 Markdown 文本与结构化 skill input 同时提交。
- [x] 运行针对性测试、完整 `npm run test`、`npm run build` 和 `npm run test:smoke`。
- [x] 使用隔离 `CODEX_HOME` 启动应用，验证 `$skill-demo` 选择、badge 展示及实际 `turn/start` payload。
- [x] 更新本计划的状态、决策日志和 Smoke Ledger。

## 成功标准

1. `$skill-demo` 选择后，发送给 app-server 的文本逐字为 `[$skill-demo](/volume2/SSD/codex/Temp/codex-dev-home/skills/skill-demo/SKILL.md) 用户问题`。
2. 同一 `turn/start` 继续包含 `{ type: "skill", name: "skill-demo", path: "/volume2/SSD/codex/Temp/codex-dev-home/skills/skill-demo/SKILL.md" }`。
3. app-server session 继续生成完整 `<skill>...</skill>` 上下文，技能可以正常执行。
4. 多技能按选择顺序输出多个 Markdown 链接；普通消息和缺少路径的旧技能 badge 不回归。

## 决策日志

- 2026-07-17：以用户提供的官方 Codex App session 为逐字基准；不把 `<skill>` 正文拼入 Web 文本，因为该内容由 app-server 根据结构化 skill input 注入。
- 2026-07-17：保留现有技能 badge UI 和 `type: "skill"` 协议输入，仅修改 `agent_skill` 的文本序列化边界。
- 2026-07-17：多技能沿用现有选择顺序，每个技能分别生成 Markdown 链接；缺失路径的旧 badge 继续发送 `$skill-name`，避免构造无效链接。

## Smoke Ledger

- 红灯验证：实现前 targeted test 中 3 个官方 Markdown 格式用例失败，收到值仍为 `$skill-demo` marker；旧 badge 反例通过。
- Targeted test：`src/lib/message-input-logic.test.ts`、`src/codex-web/turn-input.test.ts`、`src/codex-web/skill-try-wiring.test.ts` 共 3 个测试文件、33 项通过。
- 完整测试：沙箱外 Vitest 共 75 个测试文件、352 项通过；`npm run test` 中的 typecheck 通过。沙箱内仅 `server/websocket-bridge.test.ts` 因 `listen EPERM 127.0.0.1` 失败，已在沙箱外完整复验通过。
- 生产构建：执行 `npm run build` 后生成新的 `.next/BUILD_ID`、server manifests 和静态产物。工具在 Turbopack 汇总行返回前让出输出，但构建进程随后完成；没有代码或类型错误。
- Smoke：`npm run test:smoke` 通过，输出确认 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`、模型数 7、账号来源为 `app-server.account/read`。
- UI 正例：真实输入 `$skill-demo` 后出现 `skill-demo` 技能项，选择后显示独立 badge，正文输入框只保留用户问题 `测试技能`。
- Payload 正例：拦截的 `turn/start.input` 同时包含文本 `[$skill-demo](/volume2/SSD/codex/Temp/codex-dev-home/skills/skill-demo/SKILL.md) 测试技能` 和结构化 `{ type: "skill", name: "skill-demo", path: "/volume2/SSD/codex/Temp/codex-dev-home/skills/skill-demo/SKILL.md" }`。
- 反例：缺少 `skillPath` 的旧 badge 保留 `$legacy 执行`；普通命令和文件引用不经过技能 Markdown 序列化。
- 浏览器 console 只有本功能之前已存在的 `/api/setup`、`/api/settings/app`、`/api/git/status` 404/连接噪声；未出现技能选择或 `turn/start` 序列化错误。
