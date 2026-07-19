# 移动端 Shell 响应式面板实施计划

**状态：** Review passed

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在小于 1024px 的视口中让聊天主区保持可用宽度，并把会话栏、文件树和 WorkspaceSidebar 改为互斥抽屉，同时保持桌面面板语义不变。

**Architecture:** 新增一个 hydration-safe 的紧凑视口 Hook，AppShell、顶部栏和会话页共享同一断点事实。桌面继续渲染现有固定 CardFrame；移动端复用项目现有 Sheet，把三个侧栏移出 flex 布局，并在顶部按钮层收口互斥规则。

**Tech Stack:** React 19、Next.js 16、TypeScript、Radix Sheet、Vitest、CDP。

## Global Constraints

- 不修改 `/home/rrssnas/code/CodexWeb`。
- 不改变桌面端文件树与 WorkspaceSidebar 可同时打开的产品语义。
- 开发、测试和浏览器验收使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- Node 使用 `/volume2/SSD/node-v24.14.0`。
- 不删除文件，不覆盖上一轮视觉验收产物。
- 代码注释、计划和说明使用中文。

---

### Task 1: 紧凑视口事实与失败测试

**Files:**
- Create: `src/hooks/useCompactViewport.ts`
- Create: `src/codex-web/mobile-shell-responsive-wiring.test.ts`

**Interfaces:**
- Produces: `COMPACT_VIEWPORT_QUERY = "(max-width: 1023px)"`。
- Produces: `useCompactViewport(): boolean | null`，`null` 表示 hydration 前未知。

- [x] **Step 1: 写失败测试**

断言 AppShell 使用移动 Sheet、PanelZone 支持 compact 模式、顶部栏移动互斥、会话默认面板等待视口状态且移动端不自动打开。

- [x] **Step 2: 运行 targeted test 并确认失败**

Run: `npx vitest run src/codex-web/mobile-shell-responsive-wiring.test.ts`

Expected: FAIL，缺少紧凑视口 Hook 和移动 Sheet 接线。

- [x] **Step 3: 实现 hydration-safe Hook**

首次 effect 同步 `matchMedia`，监听后续断点变化并在卸载时移除 listener。

### Task 2: 移动端抽屉与桌面固定栏

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/PanelZone.tsx`

**Interfaces:**
- Consumes: `useCompactViewport()`。
- Changes: `ChatContentRow` 接收 `compactViewport`。
- Changes: `PanelZone({ compactViewport })`。

- [x] **Step 1: 将移动会话栏改为左侧 Sheet**

紧凑视口不再把固定宽度 CardFrame 放进内容 flex；Sheet 关闭时同步 `chatListOpen=false`。

- [x] **Step 2: 将移动 WorkspaceSidebar 与文件树改为右侧 Sheet**

Sheet 内容复用现有 WorkspaceSidebar、FileTreePanel 和 CardSurface；桌面仍使用 ResizeGutter 与固定宽度 CardFrame。

- [x] **Step 3: 运行 targeted test 与 typecheck**

Run: `npx vitest run src/codex-web/mobile-shell-responsive-wiring.test.ts && npx tsc --noEmit`

Expected: PASS。

### Task 3: 移动面板互斥与默认打开策略

**Files:**
- Modify: `src/components/layout/UnifiedTopBar.tsx`
- Modify: `src/app/chat/[id]/page.tsx`

**Interfaces:**
- Consumes: `useCompactViewport()`。
- Preserves: 桌面文件树与 WorkspaceSidebar additive 行为。

- [x] **Step 1: 收口移动端顶部按钮**

打开左栏时关闭两个右栏；打开文件树时关闭左栏和 WorkspaceSidebar；打开 WorkspaceSidebar 时关闭左栏和文件树。

- [x] **Step 2: 阻止移动端默认面板自动弹出**

等待视口状态确定；普通会话在紧凑视口保持右栏关闭，显式 `?file=` 深链仍打开文件树 Sheet。

- [x] **Step 3: 验证正反例**

Run: `npx vitest run src/codex-web/mobile-shell-responsive-wiring.test.ts src/codex-web/new-chat-workspace-wiring.test.ts`

Expected: PASS，桌面 additive 断言仍成立。

### Task 4: 全量与视觉复验

**Files:**
- Modify: `docs/exec-plans/active/2026-07-19-mobile-shell-responsive-panels.md`
- Create outside repository: `/volume2/SSD/codex/Temp/codex-web-mobile-fix-visual-20260719/visual-user-input-smoke.ts`

- [x] **Step 1: 全量验证**

Run:

```bash
export NODE_HOME=/volume2/SSD/node-v24.14.0
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run build
```

Expected: 全部退出码为 0。

- [x] **Step 2: 真实浏览器复验**

在 `1440x900` 与 `390x844` 下覆盖 requestUserInput、倒计时、MCP 表单、三个移动抽屉、横向溢出和 console。

- [x] **Step 3: 更新 Smoke Ledger**

记录桌面 additive 正例、移动主区宽度正例、移动抽屉互斥正例，以及移动端不自动打开默认文件树的反例。

## Smoke Ledger

- **Tests pass：** `npm run test`，88 个测试文件、424 项测试全部通过。
- **Build pass：** `npm run build` 退出码为 0；保留既有的 Turbopack NFT 动态追踪警告。
- **桌面正例：** `1440x900` 下 requestUserInput、倒计时和 MCP 表单正常，文件树与 WorkspaceSidebar 仍保持 additive 语义。
- **移动正例：** `390x844` 下聊天主区不再被固定侧栏压缩；会话列表使用左侧 Sheet，文件树和 WorkspaceSidebar 使用右侧 Sheet，三者互斥。
- **反例：** 普通移动会话不会自动打开默认文件树；显式 `?file=` 仍可打开文件树 Sheet；桌面断点不套用移动互斥规则。
- **浏览器质量：** 无横向溢出、脚本捕获的 console error 为 0，三个 Sheet 均补齐无障碍描述。
- **验收产物：** `/volume2/SSD/codex/Temp/codex-web-mobile-fix-visual-20260719/`。
