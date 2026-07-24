# Codex Web Web-only 化与性能重构技术交接

> 阶段 0 执行计划：[2026-07-23-web-performance-baseline.md](../exec-plans/completed/2026-07-23-web-performance-baseline.md)
>
> 阶段 1 执行计划：[2026-07-24-app-server-selector-subscriptions.md](../exec-plans/completed/2026-07-24-app-server-selector-subscriptions.md)
>
> 阶段 2 执行计划：[2026-07-24-chat-rendering-virtualization.md](../exec-plans/completed/2026-07-24-chat-rendering-virtualization.md)
>
> 阶段 3 执行计划：[2026-07-24-heavy-module-lazy-loading.md](../exec-plans/completed/2026-07-24-heavy-module-lazy-loading.md)

## 文档目的

本文交接 Codex Web 从“兼容桌面应用形态的 Web 前端”收敛为“以浏览器为唯一 UI 载体的本地 Web 工作台”的背景、边界、现状判断和后续实施建议。

目标不是重做视觉设计，也不是削减产品能力，而是在以下约束下解决开发启动慢、首次路由切换慢和持续交互卡顿：

- 保留当前 CodexWeb 风格的左右侧栏、聊天区、设置、Skills、MCP、Plugins、文件工作区和审批流程。
- 保留 `codex app-server` 作为唯一运行时事实源。
- 保留浏览器必须通过 Web bridge 连接 `codex app-server --stdio` 的架构边界。
- 保留 `codex-web` CLI 的本地安装、启动、登录和单端口访问能力。
- 不把已有功能替换成假数据、静态 Demo 或浏览器端自建协议状态。

本文记录的是技术方向和实施边界，不代表性能重构已经完成。所有性能判断中，代码结构可以证明的部分与仍需性能采样验证的部分会分别说明。

## 当前结论

### Next.js 不是 Web-only 化的主要障碍

Next.js 本身是 Web 框架，当前项目还需要同时提供页面、服务端 API、登录会话、生产资源和 WebSocket bridge 接线，因此现阶段没有充分理由仅因“只需要 Web UI”就整体迁移到 Vite。

当前较重的部分主要来自：

1. 从桌面 UI 基准继承的 Electron 和多平台兼容分支。
2. 阶段 1 已将全局 `AppServerProvider` 改为 selector 订阅；聊天渲染和长历史列表本身仍是后续主要优化面。
3. 聊天页面、输入区、工具流、Markdown 和代码高亮集中在大型客户端组件中。
4. 重型预览能力与主工作台共享依赖图，部分能力虽已动态加载，仍缺少系统化的按需边界。
5. `next dev` 对首次访问路由按需编译，开发模式的首次启动和首次切换不能等同于生产性能。

推荐路线是保留 Next.js 服务端和 CLI，先完成 Web-only 边界清理和前端状态/渲染架构重构。只有在 Web UI 与 bridge 后端能够完全独立部署后，才重新评估 Vite SPA。

### 不承诺“永远不会变慢”

性能目标必须转化为可复现的预算和测试。框架迁移本身不能保证交互流畅；如果继续使用大范围 Context 更新、同步 Markdown 高亮和未虚拟化的长消息列表，换成其他框架仍然会慢。

后续实施应以以下结果为准：

- 相同 fixture、相同浏览器和相同机器下的前后对比。
- 开发模式与生产模式分别记录，禁止混为一个指标。
- 除平均值外记录 P95 交互耗时和长任务。
- 保留功能回归、协议来源和反例 smoke，不以减少功能换取指标。

## 当前运行架构

```text
浏览器 Web UI
  |
  | HTTP / WebSocket
  v
Next.js 自定义 Server + Web bridge
  |
  | JSON-RPC over stdio
  v
codex app-server
```

开发入口为 `scripts/dev-next-with-bridge.ts`：先创建 bridge 和 app-server，再启动 `next dev`。生产入口为 `scripts/start-next-with-bridge.ts`：加载 Next 生产构建，并让 Next 请求与 `/codex-bridge` WebSocket 共用端口。

这套单端口结构也是 CLI 打包继续使用 Next.js 的主要原因。若迁移 Vite，需要新增独立 HTTP 服务、静态资源服务、API 路由、登录会话和 WebSocket upgrade 接线，迁移范围明显超过前端渲染优化。

## 用户可见症状与原因判断

### 已知症状

- 执行 `npm run dev` 后，浏览器首次进入页面较慢。
- 第一次点击尚未访问的入口或切换设置 Tab 较慢。
- 页面已经加载后，部分按钮、Tab 和聊天交互仍有迟滞。

### 可以从代码结构确认的原因

#### 1. 开发路由按需编译

`next dev` 会在首次访问页面时编译对应路由，并启用 HMR、source map、开发错误检查和 React 开发行为。第一次进入 `/chat`、`/settings/*`、`/plugins`、`/mcp` 或 `/skills` 时出现编译等待属于开发模式成本。

这部分必须通过生产构建对照确认：

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run build
npm run start
```

如果生产模式明显流畅，首次打开和首次切换的主要瓶颈是开发编译；不应为此直接重写产品架构。

#### 2. App-server 状态订阅粒度过大（阶段 1 已处理）

`src/codex-web/AppServerProvider.tsx` 维护单个 `CodexWebAppServerState`，并直接作为 `AppServerContext.Provider` 的 value。连接、Thread、Turn、Item、Approval、Token Usage、MCP、账号、配置和 diagnostics 的任何更新都可能替换整个状态对象。

阶段 0 时，调用 `useAppServerState()` 的组件会在 Context value 改变时重新渲染，即使组件只需要其中一个字段；`AppShell`、聊天页、会话列表和多个设置模块因此被高频 notification 放大为大范围 React 渲染。阶段 1 已迁移为 selector 订阅，结果见本文末尾；本段保留为问题背景。

这是持续交互卡顿的高优先级候选原因，优先级高于删除几个 npm 依赖。

#### 3. 主工作台组件承担过多状态

`src/components/layout/AppShell.tsx` 同时管理路由、左右面板、拆分会话、工作目录、Git 状态、搜索、更新弹窗和多个持久化状态。

`src/components/chat/ChatView.tsx` 同时承担历史消息、实时 Turn、工具过程、审批、模型、推理等级、Goal/Plan、附件、重试、上下文和输入提交等逻辑。

`src/components/chat/MessageInput.tsx` 也包含大量本地状态、命令面板、引用、附件、目录摘要、模型和权限交互。即使使用了 `useMemo` 或 `useCallback`，大型父组件状态变化仍可能引发较宽的子树协调和渲染。

#### 4. Markdown、代码高亮和预览能力较重

当前存在以下能力：

- `streamdown` 与 `@streamdown/*`：聊天流式 Markdown、代码、数学公式和 Mermaid。
- `shiki`：聊天代码块高亮和主题映射。
- `react-markdown`：Skills 详情和更新说明。
- `react-syntax-highlighter`：文件预览。
- CodeMirror：Markdown 编辑。
- Sandpack：JSX/TSX 预览。

这些功能都有真实产品用途，但不能全部进入聊天首屏的同步执行路径。尤其是长对话、连续代码块和流式 delta 到达时，重复解析与高亮可能形成主线程长任务。

#### 5. App-server 初始化可能增加等待

开发入口会同时启动 app-server。初始化阶段可能读取账号、模型、配置、历史 Thread、Skills 和 MCP 状态。若指定的 `CODEX_HOME` 配置了较多 MCP 或网络服务，启动慢可能包含后端等待，而不只是浏览器渲染。

因此性能记录必须同时保留：

- Next 终端中的路由编译耗时。
- bridge/app-server 初始化与请求耗时。
- 浏览器 Performance 中的脚本、渲染和长任务耗时。

### 仍需采样验证的假设

以下判断目前不能仅凭代码搜索视为事实，实施前必须测量：

- 哪一种 app-server notification 引发的提交耗时最高。
- 长会话是否因为消息列表未虚拟化而线性变慢。
- Shiki、Streamdown、Mermaid 或 Sandpack 中哪一个占用最多首屏脚本和主线程时间。
- Git 状态轮询、文件 watch 或会话列表刷新是否在空闲状态持续触发渲染。
- 开发模式卡顿与生产模式卡顿的占比。

## Web-only 产品边界

### 必须保留

- 浏览器工作台的现有整体布局和视觉风格。
- 登录、session secret、三天会话有效期和现有安全边界。
- Thread、Turn、Item、Goal、Plan、Approval、Token Usage 和 diagnostics 的 app-server 来源。
- 本地与 SSH Remote app-server 连接边界。
- Skills、MCP、Plugins、设置、历史会话、全局搜索、附件和文件工作区。
- `codex-web` CLI 从任意工作目录启动的能力。
- Web bridge 的 Origin、token、known_hosts 和进程退出处理。
- 当前移动端与窄屏布局能力。

### 可以删除或隔离

只有在完成引用扫描和功能回归后，才处理以下桌面遗留：

- `window.electronAPI` 及仅 Electron 可达的分支。
- Electron 版本、窗口、透明材质和桌面 shell 专用类型。
- 只为 Electron 保留的平台样式和窗口控制逻辑。
- 已无 Web 入口的安装向导、桌面更新入口或 IPC 适配层。
- 与 Codex app-server 单 Runtime 产品范围冲突的旧 Provider/Runtime 文案与类型。

不应直接删除共享的 Windows/macOS/Linux 路径和 shell 处理逻辑。Web bridge 与 app-server 仍运行在服务器操作系统上，平台差异依旧真实存在；“Web-only”只表示 UI 载体是浏览器，不表示后端无需跨平台。

### 暂不迁移 Vite

在以下条件全部满足前，不启动 Vite 迁移：

1. `/api/*`、Web 登录会话和 CSRF/Origin 策略已经有独立服务端归属。
2. bridge 有独立且稳定的 HTTP/WebSocket server 入口。
3. CLI 能同时定位静态 UI 与后端资源，并通过安装验证。
4. Next 特有路由和动态服务端能力已经完成清单审计。
5. 生产性能采样证明 Next 运行时本身仍是主要瓶颈。

若这些条件未满足，迁移 Vite 只会把当前问题转化为部署、认证和服务端接线风险。

## 目标架构

```text
Web UI 视图层
  - 路由与布局
  - 细粒度 selector
  - 虚拟化消息列表
  - 按需加载的 Markdown/预览能力
            |
            v
App-server 客户端状态层
  - transport store
  - thread/turn store
  - approval store
  - account/config store
  - diagnostics store
            |
            v
Web bridge
  - HTTP/WS 安全边界
  - JSON-RPC 转发
  - app-server 生命周期
            |
            v
codex app-server
```

核心变化是让 UI 订阅“它需要的状态切片”，而不是让所有消费者订阅完整 app-server 状态。协议 reducer 和事实源不变，变化的是浏览器端状态发布方式。

推荐优先评估 React `useSyncExternalStore` 与项目内轻量 store，而不是立即引入大型状态框架。若 selector、订阅和调试需求证明自建 store 会重复造轮子，再评估 Zustand。引入第三方状态库前必须记录包体积、React 19 兼容性和 selector 行为。

## 分阶段实施建议

本工作横跨性能基线、状态层、聊天渲染和桌面遗留清理，执行时应拆成至少四份独立计划。每一阶段都必须可单独回滚并产生可验证的软件。

### 阶段 0：建立可重复性能基线

目标：先证明慢在哪里，避免按主观感受重构。

建议工作：

- 新增受控长历史 fixture，覆盖空会话、普通会话、长会话和持续流式 Turn。
- 增加浏览器 Performance 标记，记录 bridge ready、app-server initialized、首屏可交互和路由完成。
- 使用 React Profiler 比较 `AppShell`、`ChatView`、`MessageList`、`MessageItem` 和 `MessageInput` 的提交次数与耗时。
- 记录 `npm run dev` 首次访问、第二次访问以及生产 `npm run start` 的差异。
- 记录冷启动和热启动，不用单次结果得出结论。

基线至少包含：

| 场景 | 需要记录 |
|---|---|
| `/chat` 空会话冷启动 | 服务端响应、脚本加载、Hydration、可交互时间 |
| `/chat/[id]` 普通历史 | 消息数量、React commit、长任务 |
| 长历史会话 | 滚动、打开工具块、输入响应 |
| 普通消息与流式消息 | delta 频率、MessageList/Item 重渲染次数 |
| 设置 Tab 首次与二次切换 | 路由编译、网络请求、交互耗时 |
| 无 MCP 与 MCP-heavy | app-server 初始化和 UI ready 差异 |

阶段验收：能够用一条固定命令复现至少一个开发慢路径和一个生产慢路径，并保存前置指标；此时不要求性能已经改善。

### 阶段 1：拆分 App-server 状态订阅

目标：高频 notification 只更新相关消费者。

主要文件边界：

- `src/codex-web/AppServerProvider.tsx`：保留连接生命周期和 action 接口，逐步移出单体状态发布。
- `src/codex-web/app-server-state.ts`：继续定义协议状态，不把 UI 临时状态混入协议状态。
- `src/codex-web/turn-reducer.ts` 及其他 adapter：保留 reducer 语义和 source breadcrumb。
- 新增独立 store/selector 文件时，按 transport、thread/turn、approval、account/config、diagnostics 职责拆分。

必须保持的接口语义：

- action 仍返回 generated schema 对应的 response。
- notification 仍先经过现有 reducer/adapter。
- 未知 notification 仍进入 diagnostics，不因性能优化被丢弃。
- server request 和 approval queue 顺序不变。

迁移策略：

1. 先为现有 `useAppServerState()` 增加渲染计数测试或 Profiler fixture。
2. 建立 selector 订阅 API，并先迁移只读、低风险消费者。
3. 迁移 `AppShell`，使其只订阅 active turn 和 approval 集合。
4. 迁移会话列表、聊天详情和设置模块。
5. 全部消费者迁移后，再收缩兼容 hook。

阶段验收：Token Usage 或 diagnostics 更新时，不应让与其无关的设置页、输入框和会话项重新渲染；普通消息与使用 Skill 的消息都必须验证。

### 阶段 2：优化聊天和长历史渲染

目标：消息数量和流式 delta 增长时，交互延迟保持在预算内。

主要文件边界：

- `src/components/chat/ChatView.tsx`：拆出数据编排与视图状态，不改变发送、重试、审批和 Goal/Plan 语义。
- `src/components/chat/MessageList.tsx`：引入窗口化/虚拟化边界，并保留置底、加载更早历史和编辑最近用户消息行为。
- `src/components/chat/MessageItem.tsx`：稳定 props，避免无关消息重新解析。
- `src/components/chat/StreamingMessage.tsx`：批处理高频 delta，保留工具顺序和 running/completed 状态。
- `src/components/chat/MessageInput.tsx`：拆分命令、附件、模型和权限子状态，确保输入不受消息流更新影响。

虚拟化必须覆盖以下反例：

- 动态高度 Markdown、代码块、图片和审批卡片。
- 展开/折叠工具过程后高度变化。
- 加载更早历史时保持视觉锚点。
- 用户处于底部时继续自动跟随；向上阅读时不得强制滚到底部。
- 编辑最近用户消息、回滚和恢复 Thread 后列表顺序正确。

阶段验收：长历史 fixture 下输入框响应、Tab 切换和滚动满足预算；普通短会话不得因虚拟化增加闪烁或布局跳动。

### 阶段 3：重模块按需加载与依赖收敛

目标：聊天首屏不加载尚未使用的编辑器、预览器和渲染能力。

优先事项：

1. 确认 Sandpack 只在 JSX/TSX 预览打开后加载。
2. 确认 Mermaid 与数学公式插件仅在消息实际包含对应内容时初始化。
3. 将文件预览的 `react-syntax-highlighter` 与聊天 Shiki 统一方案单独评估，不能在没有视觉回归时直接替换。
4. 检查 `markdown-it`、`rehype-raw`、`@codemirror/lang-yaml` 是否为未使用直接依赖。
5. 统一图标库属于后续低优先级工作，不与性能主路径重构混合提交。

依赖数量不是阶段验收指标。必须比较客户端 route chunk、首次执行时间和交互长任务；若删除依赖但 bundle 与性能无变化，不应宣称性能优化完成。

### 阶段 4：清理桌面 UI 遗留

目标：让代码明确表达浏览器是唯一 UI 载体，同时保留服务端跨平台能力。

执行前先建立清单：

- 查找 `electronAPI`、Electron 类型和桌面窗口调用。
- 查找仅 Electron 可达的路由、组件和样式选择器。
- 区分浏览器 OS 样式与 Electron shell 样式。
- 区分后端平台处理与前端桌面兼容。

删除或移动任何文件前，必须依照仓库规则先输出拟执行操作清单并得到确认。需要清理的文件只能按原层级移动到 `/volume2/SSD/Trash/`，不得执行删除命令。

阶段验收：浏览器 UI 不再依赖 Electron 全局变量；Linux、Windows 和 macOS 上的 bridge、路径与 shell 处理仍有测试覆盖。

### 阶段 5：重新评估前端框架

只有阶段 0 至 4 完成后仍有证据指向 Next 生产运行时，才进行 Next 与 Vite 的 POC 对比。

POC 必须使用同一套 `/chat` 首屏组件、app-server fixture、登录与 WebSocket 安全约束、生产静态资源、性能采样设备和浏览器。

若 Vite 只改善开发冷编译、却要求重写认证、API 和 CLI，则不应迁移。若独立 bridge 已经承担全部服务端职责，Vite 能显著降低生产资源与内存，才创建正式迁移计划。

## 性能预算建议

以下是目标预算，不是当前实测结果。阶段 0 应根据目标服务器性能校准数值，但后续只能收紧，不能静默放宽。

| 指标 | 建议目标 |
|---|---:|
| 生产模式空聊天首屏可交互 | 2 秒内 |
| 已访问过的主 Tab 切换 | P95 小于 200 ms |
| 普通按钮点击到视觉反馈 | P95 小于 100 ms |
| 输入框按键到绘制 | P95 小于 50 ms |
| 单次 React commit | 常规小于 16 ms，复杂更新小于 50 ms |
| 浏览器主线程长任务 | 单次小于 50 ms，连续流式期间不得持续堆积 |
| app-server notification 无关组件重渲染 | 0 次 |

开发模式应另设预算：首次路由允许编译等待，但同一路由第二次访问和页面内交互必须接近生产表现。

## 测试与验收矩阵

### 基础验证

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run typecheck
npm run test
npm run build
npm run test:smoke
```

涉及 CLI 或生产资源边界时还需执行：

```bash
npm pack --dry-run --json --ignore-scripts
```

并在隔离安装目录验证 `codex-web --help`、`codex-web --version` 和从非安装目录启动。

### 必须保留的功能回归

- 登录、登出、会话过期和现有会话立即失效机制。
- `model/list`、账号状态和 Rate Limit 展示。
- 新建、恢复、归档、取消归档和删除 Thread 的协议行为。
- 普通 Turn、流式 delta、interrupt、retry 和 crash recovery。
- command、file change、MCP、Skills、Goal、Plan 和 Approval 展示。
- 文件树、附件、图片、Markdown、代码块、Mermaid 和预览。
- 全局搜索、设置导航、移动端侧栏和双侧栏共存。
- SSH Remote 的 known_hosts、远端 cwd 和能力降级提示。

### 必须做的反例 smoke

- 空会话与长历史会话。
- 普通消息与使用 Skill 的消息。
- 无 MCP 与 MCP-heavy 配置。
- 无附件与图片/文件附件。
- 静态完成消息与持续流式消息。
- 工作区侧栏关闭与同时打开文件树、预览面板。
- 开发首次路由与同路由二次访问。

性能优化不能只证明 UI 能打开，还要证明不相关状态不会导致重渲染，并记录一个“应该变化”和一个“不应该变化”的反例。

## 风险与回退原则

### 状态层风险

- selector 切分可能漏订阅，造成 UI 不再随 notification 更新。
- 批处理 delta 可能改变工具顺序、打字机效果或完成状态时机。
- 外部 store 可能产生 tear、陈旧快照或 React 19 并发兼容问题。

控制方式：每次只迁移一个状态域，保留旧 Context 对照测试，使用 generated schema fixture 验证通知前后状态。

### 虚拟列表风险

- 动态高度和图片加载会改变滚动位置。
- 加载更早历史可能破坏当前阅读锚点。
- 审批、工具展开和编辑消息可能被错误卸载。

控制方式：先在长历史 fixture 接入，保留短会话原行为对照，并为滚动锚点、自动置底和展开状态增加 E2E。

### Web-only 清理风险

- 把后端跨平台代码误判为 Electron 遗留，会破坏 Windows 或 macOS 服务器。
- 移除平台样式可能改变浏览器在不同 OS 下的布局。
- 桌面变量可能仍被 mock、fixture 或兼容路由使用。

控制方式：按符号和入口证明不可达后再清理；文件清理遵守移动到 Trash 的仓库规则；桌面清理与性能重构分开提交。

### 依赖精简风险

- npm 包数量下降不等于客户端 bundle 下降。
- `sharp` 是 Next 可选依赖，`es5-ext` 来自 Sandpack 间接依赖，不能作为普通未使用直接依赖删除。
- 替换高亮和图标库容易产生 UI 回归。

控制方式：依赖变更单独提交，记录前后 tarball、route chunk 和浏览器性能，不把安装警告误判为漏洞。

## 推荐提交顺序

后续实施建议按以下独立提交组织，提交信息使用中文：

1. `test: 建立 Web 性能基线与长历史场景`
2. `refactor: 增加 app-server 状态选择器订阅`
3. `refactor: 迁移工作台到细粒度状态订阅`
4. `perf: 降低聊天流式更新的渲染范围`
5. `perf: 为长历史消息接入稳定虚拟化`
6. `perf: 延迟加载 Markdown 与预览重模块`
7. `refactor: 清理浏览器不可达的桌面 UI 兼容层`
8. `docs: 更新 Web-only 架构与性能验收记录`

每个提交必须包含对应测试和前后指标。不要把状态重构、依赖清理、视觉调整和桌面遗留清理合并成一个大提交。

## 下一步

阶段 0、1、2、3 已完成并归档。下一阶段是阶段 4 桌面 UI 遗留清理；该阶段涉及移动文件，必须先建立独立执行计划和清单并再次确认，不能与阶段 3 混合。

在没有生产性能对照之前，不应把 `npm run dev` 的首次路由编译慢等同于产品生产环境慢；在没有 React Profiler 和浏览器 Performance 数据之前，也不应把 799 个 npm 包直接认定为点击卡顿的原因。

## 阶段 0 实施结果（2026-07-23）

### 已建立的入口

- `npm run performance:baseline:dev -- default`
- `npm run performance:baseline:production -- default`
- `npm run performance:baseline:production -- no-mcp`
- `npm run performance:baseline:production -- mcp-heavy`

采集仅在 URL 带 `codexPerformance=1` 时启用。结果使用排他文件创建并保存到 `/volume2/SSD/codex/Temp/codex-web-performance-baseline/`；React 生产构建不提供 Profiler commit，因此生产结果使用 Navigation Timing、User Timing、Long Task 和 DOM 状态，开发结果额外记录 React Profiler。

### 默认配置前置指标

| 指标 | 开发 | 生产 |
|---|---:|---:|
| 成功场景 | 7/7 | 7/7 |
| 可交互时间 P95 | 3724 ms | 2967 ms |
| 路由完成 P95 | 1943 ms | 1780 ms |
| 输入到绘制 P95 | 257 ms | 75 ms |
| 长任务总数 | 74 | 34 |
| 最长长任务 | 696 ms | 361 ms |
| 设置首次/二次路由 | 1164/407 ms | 220/121 ms |

这些数值是同一机器上的前置基线，不代表优化完成。开发与生产均未全面满足本文建议预算，开发结果明显受 React 开发行为和路由编译影响。

### React 提交反例

- 长历史在 500 ms 空闲窗口内新增 207 次 commit；一次输入动作再新增 142 次。
- 普通历史在相同空闲窗口内新增 54 次 commit；一次输入动作再新增 42 次。
- 长历史 `MessageList` 单次最慢约 199 ms，`ChatView` 约 213 ms，`AppShell` 约 434 ms。
- 设置页空闲窗口新增 0 次 commit，说明采集器本身不会无条件制造提交。
- 真实流式 Turn 已通过唯一标记完成回显；开发模式记录到 `StreamingMessage` 4 次 commit。

“输入后应该变化”与“空闲时不应该变化”的反例表明，下一阶段应优先收窄 app-server Context 的订阅范围，而不是先迁移框架或删除依赖。

### MCP 对照

生产空聊天冷启动各运行三次：

- 无 MCP 可交互时间：1249、1378、1611 ms，中位数 1378 ms。
- 8 个本地快速 MCP 可交互时间：1219、1332、1356 ms，中位数 1332 ms。

两组差异落在当前运行噪声内，不能据此认定本地快速 MCP 是主要瓶颈，也不能外推到网络型或启动缓慢的真实 MCP。

## 阶段 1 实施结果（2026-07-24）

### 状态发布结构

- `AppServerProvider` 保留 bridge 生命周期、现有 reducer/adapter 和 action 接口，状态改由稳定的项目内 Store 发布。
- UI 使用 React `useSyncExternalStore` 按字段或当前 Thread 切片订阅，不再暴露完整 `useAppServerState()` Hook。
- action 在调用时读取 Store 最新快照，避免审批、附件、模型设置和 interrupt 捕获陈旧状态。
- generated response、notification reducer、approval queue、未知通知 diagnostics 和 source breadcrumb 均未改变。

### 开发模式前后对照

| 场景 | 阶段 0 空闲 commit | 阶段 1 空闲 commit | 阶段 0 输入 commit | 阶段 1 输入 commit |
|---|---:|---:|---:|---:|
| 普通历史 | 54 | 5 | 42 | 25 |
| 长历史 | 207 | 18 | 142 | 17 |

同一机器、同一隔离 `CODEX_HOME` 下，新的开发基准 8/8 场景成功，输入到绘制 P95 为 70 ms。普通消息和带固定测试 Skill 的消息均完成真实 app-server Turn 并回显唯一标记。结果保存在：

`/volume2/SSD/codex/Temp/codex-web-performance-baseline/2026-07-23T17-00-14-834Z-dev-default/`

空闲 commit 已显著下降，但仍未达到 0；长历史 `MessageList` 单次最慢约 205 ms，`ChatView` 约 222 ms，说明阶段 2 应继续收窄聊天内部渲染并评估虚拟化，而不是把阶段 1 结果视为性能工作完成。

## 阶段 2 实施结果（2026-07-24）

### 聊天渲染边界

- `MessageList` 使用 MIT `react-virtuoso@4.18.10` 处理动态高度消息，稳定消息 ID 作为 key，单调 `firstItemIndex` 保持历史前插语义。
- 加载更早、空状态、编辑最近用户消息、rewind、流式尾行、底部跟随和向上阅读入口仍保留在现有 `MessageListProps` 边界内。
- `ChatView` 的展示派生值通过 `requestAnimationFrame` 合并为帧级快照；terminal effect 继续直接读取原始 app-server Turn，未延迟 completed、failed 或 interrupted 的业务收口。
- `MessageInput` 和 `StreamingMessage` 增加浅比较 memo 边界；app-server reducer、generated schema、approval 顺序和 source breadcrumb 未改变。

### 验证与性能对照

- `npm run test`：123 个测试文件、574 项测试通过。
- `npm run build`：Next.js 生产构建及 postbuild 环境文件恢复通过。
- `npm run test:smoke`：隔离 `CODEX_HOME` 下 bridge/app-server Smoke 通过，读取 7 个模型，账号来源为 `app-server.account/read`。
- 开发性能基准 8/8 场景通过，包括普通真实 Turn 与固定测试 Skill Turn；结果保存在 `/volume2/SSD/codex/Temp/codex-web-performance-baseline/2026-07-24T01-05-06-532Z-dev-default/`。
- 长历史当前分页共 60 条消息，底部实际挂载 11 条、顶部挂载 13 条；初始位于底部且滚到顶部后能够恢复底部。普通历史 10 条全部挂载，作为短列表反例。
- 长历史 `MessageList` 最慢提交由阶段 1 约 205 ms 降至约 61.1 ms；空闲窗口 commit 保持 18，输入窗口 commit 从 17 增至 22，输入到绘制 P95 为 63.2 ms。DOM 和单次提交耗时改善已经证实，但 commit 次数没有改善，不应表述为全部性能预算达标。
- 1440×900 桌面与 390×844 移动视口均保持底部、输入框可见且无横向溢出；CDP 未捕获浏览器异常。

阶段 2 当前达到 `Code complete`、`Tests pass` 和 `Smoke passed`，执行计划已归档到 completed；尚未提交或远程推送。

## 阶段 3 实施结果（2026-07-24）

### 按需加载边界

- 聊天普通 Markdown 只保留 CJK 基础插件；Math、Mermaid 和共享代码插件根据正文能力扫描结果动态导入，模块 Promise 缓存失败后可重试。
- Shiki 从静态 `createHighlighter` 导入改为缓存动态导入，共享高亮器与 token LRU 上限不变。
- `MessageResponse`、Reasoning 与 ThinkingRow 复用同一加载 Hook；app-server 消息正文、通知顺序和 source breadcrumb 未改变。
- 聊天自定义 Markdown 组件不再覆盖 Streamdown 的 `code`/`pre` 分派，否则 Mermaid 与代码插件只会下载而不会渲染。
- Sandpack、CodeMirror Markdown 编辑器和 CSV 数据表继续保持既有 `next/dynamic` 边界；`react-syntax-highlighter` 保留，等待独立视觉回归。

### 依赖收敛

- 从直接依赖移除 `markdown-it`、`@types/markdown-it`、`rehype-raw` 和 `@codemirror/lang-yaml`，锁文件通过 `npm install --package-lock-only --ignore-scripts` 更新。
- 未执行 `npm uninstall` 或删除命令，因此现有 `node_modules` 中仍可能显示旧包为 extraneous；全新安装不再把它们作为直接依赖。`rehype-raw` 仍可由 Streamdown 间接依赖，不应误报为完全退出依赖树。

### 验证与性能反例

- `npm run test`：125 个测试文件、582 项测试通过。
- `npm run build`：Next.js 生产构建及 postbuild 环境恢复通过，聊天主 chunk 只保留能力检测与动态导入调度，重实现位于独立 chunk。
- `npm run test:smoke`：隔离 `CODEX_HOME` 下 bridge/app-server Smoke 通过，读取 7 个模型，账号来源为 `app-server.account/read`。
- 开发性能基准 12/12 通过；普通 Markdown 的 code/math/mermaid/shiki 标记均为 false，Math 仅 math=true，Mermaid 仅 mermaid=true，代码仅 code/shiki=true。结果位于 `/volume2/SSD/codex/Temp/codex-web-performance-baseline/2026-07-24T02-18-14-537Z-dev-default/`。
- 生产性能基准中阶段 3 专项 4/4 通过，但整套为 11/12：阶段 2 长历史初始置底条件稳定超时。结果位于 `/volume2/SSD/codex/Temp/codex-web-performance-baseline/2026-07-24T02-34-45-896Z-production-default/`，不得表述为生产矩阵全部通过。
- 1440×900 桌面与 390×844 移动视口下，Mermaid、KaTeX、代码块和输入框均可见；移动端 Mermaid 宽 340px，无页面或图表横向溢出。
- Sandpack 反例确认触发前没有 `.sp-wrapper`，触发 inline TSX 后动态出现容器与 iframe。远程 CDP 访问 HTTP IP 来源时不是可信上下文且没有 `crypto.subtle`；随后复用本机 Playwright 缓存的 Headless Chrome 149 访问 `http://localhost:3102`，确认 `isSecureContext=true`、`crypto.subtle=true`，Sandpack 按需加载后没有 digest 异常、JavaScript exception 或 Sandpack console error。唯一 404 为既有 `/api/git/status` 探测，不属于 Sandpack。

阶段 3 达到 `Code complete`、`Tests pass` 和 `Smoke passed`；生产长历史残余与远程 HTTP IP 的可信上下文限制已显式保留，本地 Headless Chrome 已补齐 Sandpack console 证据。执行计划已归档，阶段 3 代码与归档记录纳入同一提交，未远程推送。
