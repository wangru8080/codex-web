# 连续工具分组折叠实施计划

> **执行要求：** 在当前会话内逐项实现并验证；未经用户要求不创建 Git 提交。

**目标：** 连续工具或命令在同一组内展示，组内全部执行完成后立即折叠，非工具过程内容保持直接可见，不再等最终回答开始后折叠整轮处理过程。

**架构：** 增加一个纯函数，把有序过程块切分成“连续工具组”和“普通过程块”。流式消息直接渲染这些分段，工具组根据是否仍有未完成结果自动展开或折叠；历史消息复用已有 `renderParts` 分段，移除整轮 `ProcessCollapseGroup` 外壳，仅保留各工具组自身折叠。

**技术栈：** React 19、TypeScript、Vitest、Next.js、现有 `ToolActionsGroup`。

## 全局约束

- UI 行为以官方 `codex-rs/tui` 的连续执行 cell 语义和 `/home/rrssnas/code/CodexWeb` 的工具 cell 样式为参考。
- 不修改 `/home/rrssnas/code/CodexWeb`。
- 不引入第三方依赖，不改变 app-server 协议、reducer 或事实源。
- 测试和调试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 所有代码注释、文档和说明使用中文。

---

### 任务 1：连续工具过程分段

**文件：**

- 新建：`src/components/chat/streaming-process-groups.ts`
- 新建：`src/components/chat/streaming-process-groups.test.ts`
- 修改：`vitest.config.ts`，精确收集新增测试文件

**接口：**

- 输入：`MessageContentBlock[]` 中已经按 app-server item 顺序排列的过程块。
- 输出：`groupConsecutiveToolBlocks(blocks): StreamingProcessSegment[]`。
- `tool_use` 连续出现时合并为一个 `tools` 段；thinking、过程正文和上下文压缩分别形成 `block` 段并切断工具组。

- [x] **步骤 1：先写失败测试**

```ts
expect(groupConsecutiveToolBlocks(blocks)).toEqual([
  { type: "block", block: thinking },
  { type: "tools", blocks: [tool1, tool2] },
  { type: "block", block: processText },
  { type: "tools", blocks: [tool3] },
]);
```

- [x] **步骤 2：运行定向测试并确认失败**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm exec vitest run src/components/chat/streaming-process-groups.test.ts
```

预期：因实现文件或导出函数尚不存在而失败。

- [x] **步骤 3：实现最小纯函数**

```ts
export function groupConsecutiveToolBlocks(blocks: StreamingProcessBlock[]): StreamingProcessSegment[] {
  const segments: StreamingProcessSegment[] = [];
  let pendingTools: ToolUseBlock[] = [];
  // 普通过程块出现前刷新连续工具；结尾再次刷新。
  return segments;
}
```

- [x] **步骤 4：运行定向测试并确认通过**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm exec vitest run src/components/chat/streaming-process-groups.test.ts
```

预期：连续工具、单个工具、无工具和普通块切断分组测试全部通过。

### 任务 2：流式消息按连续工具组折叠

**文件：**

- 修改：`src/components/chat/StreamingMessage.tsx`

**接口：**

- 消费：`groupConsecutiveToolBlocks()` 的分段结果。
- 保留：`processToolResultsById` 作为工具完成状态的 app-server 结果映射。
- 行为：工具组存在未完成结果时展开；组内工具都有结果时立即折叠。

- [x] **步骤 1：用连续工具分组替代逐个工具 cell**

```tsx
<ToolActionsGroup
  tools={segment.blocks.map(toToolAction)}
  isStreaming={hasRunningTool}
  defaultExpanded={hasRunningTool}
/>
```

- [x] **步骤 2：移除流式消息的整轮 `ProcessCollapseGroup`**

过程正文、thinking 和上下文压缩直接按顺序显示；最终回答开始不再控制整轮过程折叠。

- [x] **步骤 3：兼容没有 `processBlocks` 的旧流式路径**

旧路径的 `toolItems` 作为一个连续工具组渲染，只有该组全部完成后才折叠。

### 任务 3：历史消息保持相同展示语义

**文件：**

- 修改：`src/components/chat/MessageItem.tsx`

**接口：**

- 消费：现有 `parseToolBlocks()` 产生的 `renderParts`；其 `pendingTools` 已按过程正文边界形成连续工具组。
- 行为：直接渲染 thinking 与 `processParts`，不再用整轮 `ProcessCollapseGroup` 包裹；每个 `tools` part 继续由默认折叠的 `ToolActionsGroup` 展示。

- [x] **步骤 1：移除历史整轮过程折叠外壳**

```tsx
{thinking && <ToolActionsGroup tools={[]} thinkingContent={thinking} defaultExpanded={false} />}
{processParts.map((part, index) => renderAssistantPart(part, index))}
```

- [x] **步骤 2：保留反例行为**

没有工具、thinking 或过程正文时，不增加任何处理区；final answer 仍直接显示，计划块仍独立显示。

### 任务 4：验证与记录

**文件：**

- 更新并移动：`docs/exec-plans/active/2026-07-18-consecutive-tool-group-collapse.md` → `docs/exec-plans/completed/2026-07-18-consecutive-tool-group-collapse.md`

- [x] **步骤 1：运行完整测试**

```bash
export NODE_HOME=/volume2/SSD/node-v24.14.0
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
```

- [x] **步骤 2：运行生产构建**

```bash
npm run build
```

- [x] **步骤 3：运行 Smoke**

```bash
npm run test:smoke
```

- [x] **步骤 4：启动开发应用并检查 UI**

验证目标：运行中工具组展开；连续组完成后折叠；点击可展开；过程正文不会随最终回答整体隐藏。

## Smoke Ledger

| 场景 | 预期 | 结果 |
| --- | --- | --- |
| 连续两个命令，第二个仍运行 | 同组展开并显示两项 | 单元与接线测试通过；实际命令完成过快，未截获运行中画面 |
| 连续两个命令均完成 | 同组自动折叠，点击可展开 | UI 验证通过：默认 `aria-expanded=false`，点击后为 `true`，两条命令及结果均可见 |
| 命令 → 过程正文 → 命令 | 形成两个工具组，过程正文直接可见 | 纯函数测试通过，过程正文正确切断分组 |
| 无工具直接输出最终回答 | 不出现空工具组或“已处理”外壳 | UI 反例通过：Skill 历史会话的过程说明直接显示，无空工具组 |
| 三个连续读取/搜索工具 | 保留“已探索 N 项”子分组 | 代码审查通过：仍复用未修改的 `computeSegments()` / `ContextGroup` |

## 状态总览

- 当前状态：Smoke passed
- 用户影响：工具密集型回答不再用整轮过程折叠隐藏过程说明。
- 验证：`npm run test` 通过（76 个文件、358 项测试）；`npm run build` 通过；`npm run test:smoke` 通过并确认隔离 `CODEX_HOME`；浏览器实测连续两个命令折叠与点击展开通过。
- 剩余风险：本次两个只读命令完成过快，运行中展开态由单元/接线测试覆盖，未取得人工视觉帧。页面仍有既有 `/api/setup`、`/api/settings/app`、`/api/git/status` 404；生产构建仍有既有 Turbopack NFT 动态路径告警。

## 决策日志

- 2026-07-18：以过程块中的非工具内容作为连续工具组边界。
- 2026-07-18：不改变 `ToolActionsGroup` 的视觉样式和内部“已探索”规则。
- 2026-07-18：历史消息同步取消整轮过程折叠，避免流式完成切换到历史记录后 UI 语义突变。
- 2026-07-18：首次定向测试因 Vitest 固定 include 未收集新增文件而失败；经用户补充确认后，仅增加该测试文件的精确 include，不扩大测试扫描范围。
- 2026-07-18：工具组 key 包含 `running/complete` 生命周期，仅在整组完成时重建，确保完成即折叠且完成后仍可由用户展开。
- 2026-07-18：使用隔离环境创建只读验证会话，连续执行 `pwd` 与 `git status --short`；完成后显示单个“已处理 2 项”折叠组，展开后两条命令结果独立可见。
- 2026-07-18：Playwright 与 Turbopack 自动临时产物经用户单独确认后移入 `/volume2/SSD/Trash/2026-07-18-codex-web-ui-verify/`，未覆盖既有 Trash 内容。
