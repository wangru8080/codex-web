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

- [x] 测量 Turbopack 首次 `/login` 和认证 `/chat`；记录 `/chat` 仍受 xterm/可选预览异步图与网络文件系统影响。
- [x] 运行 `npm run test`、`npm run build`、`npm run test:smoke`。
- [x] 检查 `git diff --check`、工作区生成物和计划状态。

## 结果与剩余风险

- Phosphor 根入口已完全移出业务组件，`/login` 冷请求从此前超时降至约 1 秒。
- 认证 `/chat` 仍可能因 xterm CSS、Mermaid、Sandpack 和网络文件系统缓存编译超过 180 秒；这些异步依赖需要独立路由或独立本地构建目录才能彻底隔离，本次不引入更大架构改动。
- Hugeicons 的逐模块导入因当前包缺少对应 TypeScript 声明而撤回，保留 Next 的 `optimizePackageImports` 配置。
- 终端已迁移到独立 `/workspace/terminal` iframe 路由；认证后首次路由编译约 14.9 秒，二次请求约 0.1 秒，父页面仍负责 app-server process 生命周期。
