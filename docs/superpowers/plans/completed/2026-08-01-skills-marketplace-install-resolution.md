# 技能市场安装解析修复实施计划

> **执行说明：** 本计划用于当前会话内按步骤完成实现与验证。

**目标：** 修复 skills.sh 搜索展示名与 GitHub 仓库真实技能目录名不一致导致的安装失败。

**方案：** 安装接口接收到 `owner/repo` 与展示技能名后，先读取 GitHub tree，定位包含 `SKILL.md` 的真实目录；找到后使用 skills CLI 支持的 GitHub 技能目录 URL 安装。无法解析时保留原始安装路径，兼容现有仓库。

**技术栈：** Next.js Route Handler、Node fetch、skills CLI、Vitest。

## 约束

- 使用默认隔离环境 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 验证。
- 代码注释、文档和说明使用简体中文。
- 不新增依赖，不执行删除命令，不覆盖用户无关改动。

---

### 任务 1：补充安装参数回归测试

**文件：**
- 修改：`src/app/api/skills/marketplace/install.route.test.ts`
- 修改：`src/app/api/skills/marketplace/install/route.ts`

- [ ] 增加测试，确认技能目录 URL 安装时不再传入错误的 `--skill` 展示名。
- [ ] 增加测试，确认普通仓库安装仍保留 `--skill` 参数和全局范围参数。
- [ ] 运行安装路由测试，先确认新增断言失败。

### 任务 2：实现 GitHub 技能目录解析

**文件：**
- 修改：`src/app/api/skills/marketplace/install/route.ts`

- [ ] 查询 `main`、`master` 分支的 GitHub recursive tree。
- [ ] 优先匹配展示名对应目录，随后匹配去掉首段前缀后的目录名。
- [ ] 将匹配到的 `SKILL.md` 父目录转换为 GitHub `/tree/<branch>/<path>` URL。
- [ ] 解析失败时回退到原始 `owner/repo` 安装行为。
- [ ] 运行安装路由测试确认通过。

### 任务 3：完整验证

- [ ] 运行 `npm run test`。
- [ ] 运行 `npm run build`。
- [ ] 在隔离环境启动应用，真实浏览器搜索并点击全局安装。
- [ ] 确认安装成功日志和技能列表中的已安装状态。
- [ ] 保存真实浏览器截图并记录剩余风险。

## 自检

- 搜索接口仍只负责展示和详情读取，安装接口负责真实目录解析，职责边界清晰。
- 现有全局/项目安装范围参数保持不变。
- 没有引入新的第三方依赖或无关重构。
