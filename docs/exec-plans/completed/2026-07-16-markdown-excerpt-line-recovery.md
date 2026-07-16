# Markdown 片段行号恢复实施计划

> **For agentic workers:** 本计划在当前会话内联执行；步骤使用复选框跟踪，不自动提交 Git。

**Goal:** 修复 Markdown 预览选区偶发缺失行号，并确保模型提示词中的 `Selection` 路径稳定携带相同的 `line/lines` 信息。

**Architecture:** 保留现有 DOM 选区与源 Markdown 映射链路，在 `locateExcerptLines` 的回退搜索中补齐代码块语言标签的渲染语义；完整匹配仍失败时，仅使用唯一且有序的首尾文本锚点恢复范围，歧义场景继续返回无行号，避免伪造。

**Tech Stack:** TypeScript、React 19、Streamdown、Vitest、Playwright/CDP。

## Global Constraints

- 不改变选区正文；模型收到的片段必须与用户选择的可见文本一致。
- 行号采用 1-based，并叠加 frontmatter 的既有偏移。
- 只有唯一、可验证的源位置才显示行号；重复片段或歧义锚点不得猜测。
- 开发和验证使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

### Task 1: 复现与映射修复

**Files:**
- Modify: `src/lib/file-excerpt-reference.ts`
- Modify: `src/lib/file-excerpt-reference.test.ts`

- [x] 补充 fenced code 语言标签导致全选文本无法匹配的回归测试。
- [x] 补充中间存在渲染器文本时的唯一首尾锚点回归测试及歧义反例。
- [x] 实现最小映射修复，并验证提示词生成 `(lines N-M)`。

### Task 2: 完整验证

**Files:**
- Modify: `docs/exec-plans/active/2026-07-16-markdown-excerpt-line-recovery.md`

- [x] 运行定向测试、全量测试和生产构建。
- [x] 使用真实 Chrome/CDP 从 Markdown 预览选择包含代码块的跨行片段，断言输入框卡片显示行号。
- [x] 验证普通短选区与重复文本反例，检查 console。
- [x] 更新 Smoke Ledger、状态总览与审查结论。

### Task 3: 真实模型发送 E2E

- [x] 在原 session 中重新选择 `AGENTS.md` 第 5-33 行并发送唯一标记问题。
- [x] 直接检查新增 JSONL 用户消息包含 `(lines 5-33)`。
- [x] 只在当前回合助手最终消息中验证回答，并关闭测试服务。

## 状态总览

- `Code complete`：代码块语言标签和渲染器附加文本不再导致可确定的 Markdown 选区丢失行号。
- `Tests pass`：最终全量测试通过。
- `Smoke passed`：最终生产构建通过 Chrome/CDP 输入框交互和真实模型发送验证。
- `Review passed`：唯一锚点、重复锚点和短边界反例均已覆盖；未发现本次改动引入的安全或路径边界变化。

## 决策日志

- 继续优先使用完整正文匹配；只有完整匹配失败时才启用首尾锚点。
- 首尾锚点必须各自唯一、顺序正确且不少于 4 个字符；否则不显示行号，避免错误缩小范围。
- fenced code opening info string 按预览可见文本参与搜索；预览未显示该标签时由唯一首尾锚点恢复范围。

## Smoke Ledger

- 红灯复现：新增 fenced code 语言标签与预览器附加文本用例，修复前 2 项失败并返回 `null`。
- 定向测试：`src/lib/file-excerpt-reference.test.ts` 共 15 项通过，包含重复锚点与短边界反例。
- 真实 session：从 `rollout-2026-07-16T15-55-27-019f69ec-63c5-7e13-ac50-73491ccddc7a.jsonl` 提取原始选区，对当前 `AGENTS.md` 恢复为第 5-33 行。
- 提示词：回归断言 `buildFileExcerptPrompt` 生成 `## Selection 1: ... (lines 3-12)`；从旧 session 提取的选区在内存中计算为 `(lines 5-33)`，并已通过后续真实 turn 落盘验证。
- 全量测试：隔离 `CODEX_HOME` 下 60 个测试文件、288 项测试通过。
- 生产构建：`npm run build` 通过；保留仓库既有 Turbopack NFT 动态路径追踪警告。
- Chrome/CDP：最终生产构建中选择 `AGENTS.md` 第 5-33 行并点击“加入对话”，输入框卡片显示 `MD · 5-33`。
- 真实模型发送：在原 session 发送唯一标记 `excerpt-lines-e2e-1784192465386`；同一 JSONL 从 12 行增加到 21 行，第 16、17 行的用户记录包含 `AGENTS.md (lines 5-33)`。
- 当前回合最终消息：只检查唯一标记后的助手 final answer，结果为 `E2E-LINES-5-33-OK`；对应 JSONL 第 18、19 行。
- Console：发现的 404 均来自既有 `/api/settings/*`、`/api/setup`、`/api/git/status`、`/api/tasks` 请求；文件预览与片段引用请求无失败。
- 收口：隔离生产服务和 CDP 测试标签页均已关闭，未生成截图、临时日志或浏览器配置目录。
