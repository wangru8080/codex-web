# 钩子设置与运行时接线执行计划

> **执行要求：** 按任务逐项实现和勾选；Hook 的发现、信任与执行均以 Codex app-server 为事实源。

**目标：** 在设置中提供对齐官方 Codex App 的 Hook 浏览、审查、信任、配置编辑和运行提示，并在隔离环境验证真实 Hook 执行。

**架构：** 前端通过 `hooks/list` 读取当前 cwd 的 Hook 元数据，通过 `config/batchWrite` 写入 `hooks.state` 的信任哈希并热重载配置。Web 不执行 Hook；执行仍由 app-server 完成，运行状态使用 `hook/started` 与 `hook/completed` 通知。配置编辑继续使用 app-server `fs/readFile`/`fs/writeFile`，保存后重新读取 Hook 列表，把解析错误显示给用户。

**技术栈：** Next.js、React、TypeScript、Codex app-server JSON-RPC、Vitest、Playwright。

## 全局约束

- 不修改 `/home/rrssnas/code/codex` 官方源码。
- 不引入新依赖，不在浏览器中自行解析或执行 Hook。
- 测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 或新的唯一隔离目录。
- 信任状态必须持久化到 app-server 管理的用户 `config.toml`，并用实际读取结果验证。
- 无 Hook、未审查 Hook、错误配置和已信任 Hook 都必须有可验证状态。

---

### 任务 1：Hook app-server 接口

**文件：**
- 修改：`src/codex-web/AppServerProvider.tsx`
- 新增：`src/codex-web/hooks-config.ts`
- 测试：`src/codex-web/tests/hooks-config.test.ts`

- [x] 增加 `listHooks(cwds)`，直接调用 `hooks/list`。
- [x] 增加单项/批量信任构造函数，写入 `hooks.state` 的 `trusted_hash`，使用 `reloadUserConfig: true`。
- [x] 增加启用状态写入，保持与官方 TUI 的配置键一致。
- [x] 用单元测试覆盖待审查判定、信任编辑和值合并。

### 任务 2：Hook 设置页与配置编辑器

**文件：**
- 新增：`src/app/settings/hooks/page.tsx`
- 新增：`src/components/settings/HooksSection.tsx`
- 修改：`src/components/settings/nav-config.ts`
- 修改：`src/components/ui/semantic-icon.tsx`
- 修改：`src/i18n/en.ts`
- 修改：`src/i18n/zh.ts`
- 修改：`src/app/settings/page.tsx`
- 测试：设置路由与 Hook UI targeted tests

- [x] 增加“钩子”导航、官方风格图标、标题、说明和可点击的官方文档链接。
- [x] 通过 `hooks/list` 展示空状态、来源分组、总数、待审查数、warnings 和 errors。
- [x] 实现审查弹窗、Hook 展开详情、单项信任、全部信任和重新加载。
- [x] “打开配置文件”通过编辑器读取 `sourcePath`，提供保存/取消；保存后重新调用 `hooks/list` 并显示配置错误。

### 任务 3：输入框待审查提示

**文件：**
- 修改：`src/components/chat/MessageInput.tsx`
- 测试：`src/codex-web/tests/hooks-ui-wiring.test.ts`

- [x] 按当前 `workingDirectory` 调用 `hooks/list`，只根据 `untrusted`/`modified` 展示待审查提示。
- [x] 提供“全部信任”和“审查钩子”入口；信任后立即刷新状态。
- [x] 无 Hook 或全部已信任时不显示提示，形成反例覆盖。

### 任务 4：真实执行与回归验证

**文件：**
- 更新：本计划 Smoke Ledger

- [x] 运行 targeted tests、`npm run test` 和 `npm run build`。
- [x] 在唯一隔离 `CODEX_HOME` 创建官方格式的 Hook 样例，验证未信任时不执行。
- [x] 在 app-server 信任流程中验证 `config.toml` 出现对应 `hooks.state` 哈希，并验证 Hook 实际执行。
- [x] 验证错误 Hook 配置的协议返回；设置页会展示 app-server 返回的 warnings/errors。
- [x] 浏览器通过独立 headless Chrome/CDP 验证 `/settings/hooks` 路由受登录保护，保存登录页截图；Hook 具体交互由 targeted wiring tests、类型检查和 app-server smoke 覆盖。

## Smoke Ledger

| 场景 | 预期 | 状态 |
| --- | --- | --- |
| 无 Hook | 设置页显示“未找到钩子”，输入框无提示 | 代码路径与 UI wiring 已覆盖 |
| 未信任 Hook | 设置页与输入框显示待审查，Hook 不执行 | app-server 隔离 smoke 通过 |
| 信任 Hook | `config.toml` 落盘信任哈希，Hook 可执行 | app-server 隔离 smoke 通过 |
| Hook 内容改变 | 状态回到“已修改/待审查”，Hook 不执行 | `hookNeedsReview` 单测覆盖 |
| 配置语法错误 | 设置页显示 app-server 返回的错误 | hooks/list 协议夹具验证；前端错误渲染 wiring 已覆盖 |
| 配置编辑取消 | 文件内容保持不变 | 编辑器状态逻辑与 targeted wiring 覆盖 |
