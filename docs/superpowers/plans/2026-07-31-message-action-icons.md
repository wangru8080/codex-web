# 消息操作图标对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把助手消息的复制和“在新任务中继续”图标对齐官方 Codex App。

**Architecture:** 复用已安装的 Phosphor 图标库，仅把消息操作栏的自定义复制图标和节点分支图标替换为 `Copy`、横向 `ArrowsSplit`。按钮尺寸、间距、标题和点击行为保持不变。

**Tech Stack:** React、TypeScript、Phosphor Icons、Vitest、Playwright MCP。

## Global Constraints

- 不新增依赖或自绘 SVG。
- 只修改消息操作栏，不改变其他页面的复制图标。
- 保持 `icon-xs` 按钮和 `gap-0.5` 间距。

---

### Task 1: 图标接线

**Files:**
- Modify: `src/components/ui/icon.tsx`
- Modify: `src/components/chat/MessageItem.tsx`
- Test: `src/codex-web/tests/chat-message-copy-wiring.test.ts`

**Interfaces:**
- Consumes: Phosphor `Copy`、逆时针旋转 90° 的 `ArrowsSplit`。
- Produces: 官方样式的复制和续接图标。

- [x] 增加消息操作栏使用两个指定图标的失败测试。
- [x] 导出并接入两个图标，移除该组件不再使用的旧图标依赖。
- [x] 运行 targeted test。
- [x] 运行完整测试和生产构建。
- [x] 使用 Playwright MCP + CDP 检查消息操作栏并截图。

## Smoke Ledger

- `npm run test`：151 个测试文件、699 个测试全部通过。
- `npm run build`：生产构建通过。
- Playwright MCP + CDP：真实页面确认两个按钮均为 24×24px、间距 2px；`ArrowsSplit` 的计算样式为逆时针 90° 旋转矩阵，与官方横向分支轮廓一致。
- CDP 会话报告 `(hover: hover) = false`，因此仅为截图临时展开操作栏；桌面悬停样式与交互逻辑未改动。
- 当前页面仅观察到既有的 `/api/settings/workspace` 404，无本次图标改动新增的控制台错误。

## 自查

- 覆盖两个图标，不改变按钮行为、尺寸或间距。
- 不包含占位步骤，不引入新抽象。
