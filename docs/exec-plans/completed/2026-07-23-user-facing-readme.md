# 面向用户的 README 重写实施计划

> **For agentic workers:** 本计划在当前任务中内联执行；步骤使用复选框跟踪，不创建额外功能，不自动提交 Git。

**Goal:** 将 README 重写为面向 Codex Web 用户的项目说明，准确介绍现有功能、安装、启动、安全配置、升级与限制。

**Architecture:** README 以用户首次接触项目的阅读顺序组织：先说明产品用途和已实现能力，再提供当前可执行的安装与快速启动步骤，最后说明配置、安全、开发和已知限制。所有功能描述以现有 app-server 接线、页面和已完成验证记录为依据，不把规划能力描述为已经可用。

**Tech Stack:** Markdown、Node.js、npm、Codex CLI、Codex app-server。

## Global Constraints

- 只修改 `README.md` 和本执行计划。
- README 面向最终用户，不记录维护者本机路径或内部迁移过程。
- npm registry 尚未发布，不能把 `npm install --global codex-web` 描述为当前可用入口。
- SSH remote 和浏览器版自动更新尚未完成，必须放入当前限制。
- 示例不得包含固定密码、固定会话密钥或维护者本机绝对路径。
- 不运行发布，不提交 Git。

---

### Task 1: 重写并验证用户 README

**Files:**
- Modify: `README.md`
- Create then move: `docs/exec-plans/active/2026-07-23-user-facing-readme.md` -> `docs/exec-plans/completed/2026-07-23-user-facing-readme.md`

**Interfaces:**
- Consumes: `package.json` 的 Node 版本、CLI bin 和 scripts；`scripts/codex-web-cli-options.ts` 的参数；现有 app-server 页面、组件和已完成执行计划中的功能事实。
- Produces: 面向用户的安装、启动、配置、安全与功能说明，不改变任何运行时代码。

- [x] **Step 1: 重写 README 内容结构**

写入项目简介、架构、功能、运行要求、当前安装方式、快速启动、CLI 参数、路径规则、安全、升级、源码开发、当前限制和常见问题。

- [x] **Step 2: 核对功能与分发事实**

确认 README 只声称当前已经接入的 app-server 功能；确认 npm registry、GitHub Release、SSH remote 和浏览器自动更新的状态没有被提前描述为可用。

- [x] **Step 3: 运行文档自检**

运行：

```bash
git diff --check
rg -n "/home/|/volume2/|rrssnas|node-v24|123456|0123456789abcdef" README.md
rg -n "npm install --global codex-web|SSH|自动更新|GitHub Release" README.md
git status --short
```

预期：空白检查通过；本机路径和固定测试凭据扫描无结果；发布与限制说明能被定位；工作区只包含 README 和本计划。

验证结果：

- `git diff --check` 通过。
- 本机绝对路径、固定测试密码和固定测试密钥扫描无结果。
- npm registry、GitHub Release、SSH remote 和浏览器自动更新边界均已明确写入。
- CLI 参数与 `scripts/codex-web-cli.ts` 核对一致。
- 工作区只有 `README.md` 和本执行计划发生变化。

- [x] **Step 4: 归档执行计划**

将本计划移动到 `docs/exec-plans/completed/2026-07-23-user-facing-readme.md`，保留完整 checklist 和验证结果。按用户要求不创建 Git 提交。
