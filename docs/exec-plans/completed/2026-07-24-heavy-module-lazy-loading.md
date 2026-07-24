# 重模块按需加载与依赖收敛实施计划

> **执行要求：** 按任务逐项实现并更新复选框；测试与采样显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`；不自动提交或推送。
>
> 技术交接：[2026-07-23-web-only-performance-refactor.md](../../handover/2026-07-23-web-only-performance-refactor.md)

**目标：** 让聊天首屏不再加载尚未出现的 Mermaid、数学公式和 Shiki 运行时，同时删除已证实无生产引用的直接依赖。

**架构：** 保留 Streamdown 作为统一 Markdown 渲染器和 CJK 基础插件；由纯函数扫描 Markdown 能力，再通过模块级 Promise 缓存动态导入 Math、Mermaid 和共享代码插件。插件加载前继续显示普通 Markdown/代码，加载完成后由 React 重新渲染为增强内容；app-server 消息语义与内容不变。

**技术栈：** React 19、Next.js 16 动态 `import()`、Streamdown 2.1、Shiki 3.23、Vitest、CDP 性能基准。

## 全局约束

- 不改变 app-server notification、Turn/Item 顺序、消息正文、Approval 或 source breadcrumb。
- 普通 Markdown 不加载 Math/Mermaid；数学、Mermaid 和代码分别只加载所需能力。
- Sandpack、CodeMirror 和 CSV 查看器保留现有动态边界，不重写预览架构。
- `react-syntax-highlighter` 本阶段只评估，不做无视觉证据的替换。
- 不执行 `npm uninstall` 或删除命令；只更新依赖声明与锁文件。
- 性能结论必须同时有构建清单和浏览器运行时资源证据。

## 状态总览

- 当前状态：`Code complete`、`Tests pass`、`Smoke passed`；执行计划已归档。
- 前置证据：阶段 2 `/chat` 客户端清单包含 Mermaid core 与 KaTeX；普通历史 fixture 每条消息含 TypeScript 代码块。
- 当前 Git：阶段 3 代码、测试、依赖和归档记录纳入同一提交，不远程推送。
- 已知残余：生产性能矩阵的阶段 3 四个专项场景均通过，但阶段 2 长历史初始置底场景稳定失败，因此整套生产矩阵为 11/12，不能标记为生产基线全部通过。

---

### 任务 1：Markdown 能力检测与动态插件加载

**文件：**
- 新建：`src/components/ai-elements/streamdown-plugins.ts`
- 新建：`src/components/ai-elements/streamdown-plugins.test.ts`
- 修改：`vitest.config.ts`

**接口：**

```ts
export type MarkdownCapabilities = { code: boolean; math: boolean; mermaid: boolean };
export function detectMarkdownCapabilities(markdown: string): MarkdownCapabilities;
export function loadStreamdownPlugins(capabilities: MarkdownCapabilities): Promise<Partial<PluginConfig>>;
export function useStreamdownPlugins(markdown: string): PluginConfig;
```

- [x] 普通文本、行内代码、围栏代码、数学和 Mermaid 检测先写失败测试。
- [x] 实现无副作用检测器；转义美元和普通金额不得误触发数学插件。
- [x] 使用模块级 Promise 缓存动态导入，失败后允许重试。
- [x] Hook 只合并已完成加载的插件，CJK 始终保留。
- [x] 运行定向测试并确认通过。

### 任务 2：聊天渲染接线与 Shiki 延迟

**文件：**
- 修改：`src/components/ai-elements/message.tsx`
- 修改：`src/components/ai-elements/reasoning.tsx`
- 修改：`src/components/ai-elements/tool-actions-group.tsx`
- 修改：`src/components/ai-elements/code-block.tsx`
- 新建：`src/codex-web/heavy-module-loading-wiring.test.ts`

**接口：**

```ts
const plugins = useStreamdownPlugins(markdown);
const shiki = await import("shiki");
const highlighter = await shiki.createHighlighter({ langs, themes });
```

- [x] 添加“聊天文件不静态导入 Math/Mermaid”和“Shiki 仅动态导入”接线断言。
- [x] `MessageResponse`、Reasoning 和 ThinkingRow 使用同一插件 Hook。
- [x] 保留消息 memo 比较、Streamdown mode、incomplete Markdown 修补和非代码组件覆盖；移除会截断插件分派的 `code`/`pre` 覆盖。
- [x] 将 `createHighlighter` 静态导入改为缓存动态导入，不改变共享 LRU。
- [x] 运行定向测试、Markdown 测试与 typecheck。

### 任务 3：依赖清单与既有动态边界守卫

**文件：**
- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`src/codex-web/heavy-module-loading-wiring.test.ts`

**接口：**
- 移除直接声明：`markdown-it`、`@types/markdown-it`、`rehype-raw`、`@codemirror/lang-yaml`。
- 保留：`react-syntax-highlighter`、Sandpack、CodeMirror、Shiki 和 Streamdown。

- [x] 用全仓 `rg` 证明四个候选包无生产源码引用。
- [x] 守卫 Sandpack、CodeMirror、CSV 查看器继续通过 `next/dynamic` 加载。
- [x] 修改 `package.json`，运行 `npm install --package-lock-only --ignore-scripts` 更新锁文件。
- [x] 审查锁文件只包含预期依赖图变化。

### 任务 4：运行时资源反例与性能对照

**文件：**
- 修改：`server/web-performance-baseline.ts`
- 修改：`server/web-performance-baseline.test.ts`
- 修改：`scripts/web-performance-baseline.ts`

**接口：**
- `createHistoryFixtureJsonl` 接受可选 `assistantText(index)` 生成专项内容。
- 场景新增普通无增强 Markdown、数学、Mermaid 和代码历史。
- `ScenarioSnapshot.optionalMarkdown` 记录能力标记、脚本资源和渲染断言。

- [x] 先添加场景矩阵和专项 fixture 失败测试。
- [x] 扩展 fixture 与 CDP 等待条件。
- [x] 普通反例断言 Math/Mermaid 未加载；专项场景断言目标能力已加载并正确渲染。
- [x] 保存脚本资源总字节和资源清单，用于阶段 2 前后对照。

### 任务 5：完整验证与交接

**文件：**
- 修改：`docs/handover/2026-07-23-web-only-performance-refactor.md`
- 完成后待确认移动：`docs/exec-plans/completed/2026-07-24-heavy-module-lazy-loading.md`

- [x] 运行 `npm run test`。
- [x] 运行 `npm run build` 并检查 `/chat` 客户端清单不再直接包含 Mermaid core 与 KaTeX。
- [x] 运行 `npm run test:smoke`。
- [x] 运行开发与生产性能基准，对比脚本资源、长任务与路由指标；生产矩阵保留长历史失败记录。
- [x] 桌面和移动视口验证普通 Markdown、代码、数学、Mermaid 与 Sandpack；记录远程 HTTP IP 来源限制，并用本地 Headless Chrome 补齐可信 `localhost` 的 console 检查。
- [x] 更新决策日志、状态总览和 Smoke Ledger。
- [x] 经用户再次确认后移动执行计划。

## 决策日志

- 2026-07-24：采用内容能力检测 + 动态插件导入；Next.js 官方确认动态 `import()` 可延迟外部库，Streamdown 的 `plugins` 接口允许按需缺省 Math/Mermaid。
- 2026-07-24：不替换 `react-syntax-highlighter`；文件预览与聊天 Shiki 的统一需要独立视觉回归，不与首屏减载混合。
- 2026-07-24：不执行 `npm uninstall`；依赖声明由结构化补丁修改，锁文件用 `--package-lock-only --ignore-scripts` 更新。
- 2026-07-24：移除聊天 `CHAT_MARKDOWN_COMPONENTS` 对 `code`/`pre` 的冲突覆盖；该覆盖使 Streamdown 的 Mermaid 与代码插件虽已下载却无法参与渲染，保留它会产生“加载成功、功能未生效”的假结果。
- 2026-07-24：不保留为排查生产长历史而尝试的 `Virtuoso key` 与 `Page.bringToFront` 改动，两者均未改变失败结果；按精准修改原则撤回。
- 2026-07-24：复用本机 Playwright 缓存的 Headless Chrome 149 验证 Sandpack，不新增浏览器安装；通过 `http://localhost:3102` 获得可信上下文，补齐远程 HTTP IP 来源无法提供的 Web Crypto 与 console 证据。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
|---|---|---|---|
| 2026-07-24 | 阶段 2 生产构建清单 | `/chat` 重模块前置状态 | 客户端引用包含 Mermaid core 与 KaTeX；需要阶段 3 拆分 |
| 2026-07-24 | 单元与类型检查 | `npm run test` | 125 个测试文件、582 项测试通过 |
| 2026-07-24 | 生产构建 | `npm run build` | Next.js 26 个页面构建及 postbuild 恢复通过；重模块由动态 chunk 承载 |
| 2026-07-24 | Bridge Smoke | `npm run test:smoke` | 隔离 `CODEX_HOME` 下通过；模型 7 个，账号来源 `app-server.account/read` |
| 2026-07-24 | 开发性能基准 | 12 个默认场景 | 12/12 通过；普通/Math/Mermaid/代码四个专项能力标记互斥正确 |
| 2026-07-24 | 生产性能基准 | 12 个默认场景 | 阶段 3 专项 4/4 通过；整套 11/12，阶段 2 长历史初始置底失败 |
| 2026-07-24 | 桌面与移动 CDP | 1440×900、390×844 | Mermaid、KaTeX、代码块正确；移动端图表宽 340px，无横向溢出 |
| 2026-07-24 | Sandpack 反例 | inline TSX | 远程 CDP 的 HTTP IP 来源缺少 `crypto.subtle`；改用本地 Headless Chrome 149 访问可信 `localhost` 后，触发前无容器，触发后出现容器与 iframe，`isSecureContext=true`、`crypto.subtle=true`，无 digest 异常、JavaScript exception 或 Sandpack console error；唯一 404 为既有 `/api/git/status` 探测 |
