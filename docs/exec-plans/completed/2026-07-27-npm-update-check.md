# npm 检查更新实施计划

> **For agentic workers:** 按本计划逐项执行并更新 checklist；本轮在当前会话内联实现，不使用子代理。

**目标：** 让“设置 → 关于 → 检查更新”按需查询 `@wangru8080/codex-web` 的 npm `latest` 版本，并明确展示可更新、已最新或检查失败。

**架构：** 浏览器只调用同源 `/api/app/updates`。Next API 直接读取 npm registry 的公开包元数据，以 `package.json` 派生的 `APP_VERSION` 为当前版本并复用现有 semver 比较器；不启动 npm 子进程，不检查或修改全局安装状态。

**技术栈：** Next.js 16 Route Handler、React 19、TypeScript、Vitest、npm registry HTTP API。

## 全局约束

- 不新增依赖，不执行安装、更新或删除命令。
- 当前版本只来自 `APP_VERSION`；最新版本只来自 npm registry `@wangru8080/codex-web@latest`。
- 检查更新必须由用户点击触发，不恢复页面启动时的自动轮询。
- 网络失败不得伪装为“已是最新版”。
- 验证使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### 任务 1：建立服务端更新检查

**文件：**

- 创建：`src/app/api/app/updates/route.ts`
- 创建：`src/app/api/app/updates/tests/route.test.ts`

- [x] 先写测试，覆盖新版、同版本和 registry 异常。
- [x] 运行定向测试，确认实现前失败。
- [x] 实现固定 registry 地址、超时、响应校验、semver 比较和 `no-store`。
- [x] 运行定向测试，确认普通路径和反例均通过。

### 任务 2：接入 About 交互

**文件：**

- 修改：`src/components/settings/AboutSection.tsx`
- 修改：`src/i18n/en.ts`
- 修改：`src/i18n/zh.ts`
- 修改：`src/codex-web/tests/about-section-removal.test.ts`
- 修改：`src/frontend-preview/mock-api.ts`

- [x] 启用按钮并在重复点击期间禁用，展示检查中状态。
- [x] 展示可更新、已最新和失败状态；新版提供 npm 发布页入口。
- [x] 更新中英文文案、静态接线测试和预览 mock。
- [x] 运行 About 与版本定向测试。

### 任务 3：验证与收口

**文件：**

- 移动：本计划到 `docs/exec-plans/completed/2026-07-27-npm-update-check.md`

- [x] 运行 `npm run test`。
- [x] 运行 `npm run build`。
- [x] 启动开发服务并对 About 检查更新做最小浏览器验证。
- [x] 记录 Smoke Ledger、检查 diff，将计划归档。

### 任务 4：新增复制升级命令

**文件：**

- 修改：`src/components/settings/AboutSection.tsx`
- 修改：`src/i18n/en.ts`
- 修改：`src/i18n/zh.ts`
- 修改：`src/codex-web/tests/about-section-removal.test.ts`

- [x] 只在发现新版本时显示“复制升级命令”按钮。
- [x] 复用 `copyWithToast` 复制 `npm install --global @wangru8080/codex-web@latest`，保留失败回退与本地化反馈。
- [x] 覆盖复制命令接线，以及“已是最新版时不显示复制按钮”的反例。
- [x] 运行定向测试、全量测试、生产构建和 CDP 点击验证。

## 状态总览

- 当前状态：`Code complete`、`Tests pass`、`Smoke passed`、`Review passed`。
- 成功标准：点击检查后只出现真实 npm registry 派生的结果；相同版本显示已最新，网络或数据异常显示失败。

## 决策日志

- 2026-07-27：不使用 `npm outdated -g`，因为它读取全局安装树，无法代表源码、容器或其他启动方式中的当前运行版本。
- 2026-07-27：不执行 `npm view` 子进程；直接访问其底层 registry 元数据，减少进程、PATH、npm 配置和退出码差异。

## Smoke Ledger

| 日期 | 环境 | 验证 | 结果 |
| --- | --- | --- | --- |
| 2026-07-27 | 只读调研 | npm CLI 直连与代理查询 | 两次均超时；确认 UI 必须明确呈现网络失败，不能静默判定为最新版。 |
| 2026-07-27 | TDD | 更新 API 与 About 接线定向测试 | 实现前因路由缺失和按钮禁用失败；实现后 3 个文件、9 项测试通过。 |
| 2026-07-27 | 隔离 `CODEX_HOME`，沙箱外 | `npm run test` | 138 个测试文件、635 项测试全部通过；沙箱内既有 7 项端口/子进程限制失败已原样复跑排除。 |
| 2026-07-27 | 隔离 `CODEX_HOME`，沙箱外 | `npm run build` | 生产构建通过，Next 产物包含动态 `/api/app/updates`。 |
| 2026-07-27 | 隔离开发服务、CDP | About 四状态交互 | 检查中按钮禁用；新版显示版本与 npm 链接；同版本显示已最新；失败显示重试提示且按钮恢复。 |
| 2026-07-27 | 隔离开发服务、真实 registry | `/api/app/updates` | 2.6 秒返回 200；当前版本与 npm latest 均为 `0.3.1`，`updateAvailable=false`，source breadcrumb 正确。 |
| 2026-07-27 | 隔离开发服务、CDP | 复制升级命令与反例 | 真实鼠标点击调用剪贴板接口，写入命令完整且成功 toast 出现；切换到已是最新版后复制按钮隐藏，浏览器异常为 0。系统剪贴板读取因安全策略未执行，改用只记录本次写入参数的安全桩。 |
