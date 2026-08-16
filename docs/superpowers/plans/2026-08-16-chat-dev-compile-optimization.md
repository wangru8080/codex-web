# `/chat` 开发模式首次编译优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 缩短开发模式首次进入 `/chat` 的编译等待，同时保持终端、预览和聊天功能行为不变。

**架构：** 优先收窄大型 barrel import 的模块图，再把终端与预览的重量依赖留在用户首次打开对应面板时加载。使用 Next 配置、直接图标导入和现有动态组件边界，不引入新运行时依赖。

**技术栈：** Next.js、Webpack/Turbopack、React、TypeScript、xterm、Mermaid、React Syntax Highlighter。

## 全局约束

- 默认使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不修改 `/home/rrssnas/code/codex`。
- 不清理或覆盖 `.next`；缓存对照另行确认。
- 所有用户可见状态继续使用真实 app-server 来源。

---

### Task 1：收窄图标包导入

**文件：** `next.config.mjs`、`src/components/ui/icon.tsx`、`src/components/ui/semantic-icon.tsx`

- [x] 添加两个图标包的 `optimizePackageImports` 配置。
- [x] 将图标 barrel 导出改为具体图标模块导入，保持现有导出名称和调用方不变。
- [x] 运行 `npm run typecheck` 与相关 UI unit tests。

### Task 2：延迟终端依赖

**文件：** `src/components/layout/WorkspaceSidebar/TerminalPanel.tsx`、必要时 `TabPanel.tsx`

- [x] 保持终端只在标签打开后挂载。
- [x] 确认 xterm 样式仍在终端动态边界内；Next 开发编译仍会发现异步 CSS，需独立路由才能完全隔离。
- [x] 运行终端定向测试和 typecheck。

### Task 3：延迟预览重量依赖

**文件：** `src/components/layout/WorkspaceSidebar/PreviewPanel.tsx` 及其直接依赖

- [x] 将源码高亮组件拆为动态加载的 `SourceView`。
- [x] 保持已有代码、Markdown 和图表预览的输出与错误收口。
- [x] 运行预览相关 unit tests 与 typecheck。

### Task 4：冷启动验证与收口

- [x] 测量 Turbopack 首次 `/login` 和认证 `/chat`；记录清缓存后的冷启动基线。
- [x] 运行 `npm run test`、`npm run build`、`npm run test:smoke`。
- [x] 检查 `git diff --check`、工作区生成物和计划状态。

## 结果与剩余风险

- Phosphor 根入口已完全移出业务组件；清空旧 `.next` 后，`/login` 冷请求为 26.7 秒，后续请求进入缓存后恢复快速。
- 清空旧 `.next` 后，认证 `/chat` 冷请求为 14.1 秒，第二次请求为 0.2 秒；此前超过 180 秒的异常主要由旧缓存和网络文件系统上的编译产物状态放大。开发环境仍使用网络文件系统，首次冷编译时间会随缓存状态变化。
- Hugeicons 的逐模块导入因当前包缺少对应 TypeScript 声明而撤回，保留 Next 的 `optimizePackageImports` 配置。
- 终端已迁移到独立 `/workspace/terminal` iframe 路由；本次清缓存后首次路由编译约 4.9 秒，父页面仍负责 app-server process 生命周期。
- 预览已迁移到独立 `/workspace/preview` iframe 路由；本次清缓存后首次路由编译约 11.1 秒，不再阻塞 `/chat` 首次编译。
- 本次 A/B 缓存操作未覆盖既有暂存物：当前 `.next` 已移动至 `/volume2/SSD/Trash/home/rrssnas/code/codex-web/2026-08-16-next-cache/.next`（约 6.2G）；目标目录中原有约 2.9G 缓存保持不变。
