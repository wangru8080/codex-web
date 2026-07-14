# 文件夹路径自动补全实施计划

> **执行要求：** 按任务逐项实施并更新复选框；实现过程遵循 TDD，不使用真实本地 `CODEX_HOME`。

**目标：** 在项目文件夹选择器中，根据用户输入的路径片段动态展示匹配子目录，并支持键盘与鼠标快速进入目录，同时移除冗余的 `Go` 文字按钮。

**架构：** 继续使用现有 `app-server fs/readDirectory` 作为唯一目录事实源。纯路径拆分和前缀匹配放在 `directory-browser-adapter.ts`，React 组件只负责 200ms 防抖、过期请求隔离、候选展示和键盘交互；原有目录列表及“选择此文件夹”确认流程保持不变。

**技术栈：** React 19、TypeScript、Vitest、Codex app-server v2 `fs/readDirectory`、现有 Dialog/Input/Button 组件。

## 全局约束

- 不修改 `/home/rrssnas/code/CodexWeb`，只参考其 UI 边界。
- 不新增第三方依赖，不新增后端 API，不让浏览器直接访问本地文件系统。
- 开发与验证显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 候选仅包含目录；匹配当前输入路径的最后一段，不递归扫描。
- 保留点击目录逐级浏览和底部“选择此文件夹”的既有语义。
- 不自动创建 Git 提交。

---

### Task 1：路径查询与匹配规则

**文件：**
- 修改：`src/codex-web/directory-browser-adapter.ts`
- 测试：`src/codex-web/directory-browser-adapter.test.ts`

**接口：**
- 新增 `directoryCompletionQuery(inputPath, fallbackDirectory)`，返回 `{ parentPath, fragment }`。
- 新增 `matchingDirectories(inputPath, fallbackDirectory, entries)`，返回按现有目录排序规则过滤后的 `BrowsableDirectory[]`。

- [x] 为 Unix 绝对路径、Windows 路径、相对片段、大小写不敏感匹配和仅目录过滤编写失败测试。
- [x] 运行 `npx vitest run src/codex-web/directory-browser-adapter.test.ts`，确认新增断言先失败。
- [x] 实现最小路径拆分和目录匹配逻辑。
- [x] 再次运行定向测试并确认通过。

### Task 2：文件夹选择器自动补全交互

**文件：**
- 修改：`src/components/chat/FolderPicker.tsx`

**接口：**
- 消费现有 `readDirectory(path)` 与 Task 1 的 `matchingDirectories()`。
- 保持 `FolderPickerProps`、`onSelect(path)` 和调用方不变。

- [x] 删除 `Go` 文字按钮，保留表单 Enter 打开完整路径。
- [x] 输入变化后等待 200ms，再读取父目录并显示最多 8 个匹配子目录。
- [x] 使用递增请求标识忽略过期异步结果，关闭弹窗或进入目录时清空候选。
- [x] 支持 `ArrowDown`、`ArrowUp`、`Tab`、`Enter`、`Escape` 和候选点击。
- [x] 为候选列表补充 `listbox/option` 语义与选中状态，错误时不覆盖主目录浏览错误。

### Task 3：验证与归档

**文件：**
- 修改：`docs/exec-plans/active/2026-07-15-folder-path-autocomplete.md`
- 完成后移动：`docs/exec-plans/completed/2026-07-15-folder-path-autocomplete.md`

- [x] 运行定向 Vitest，验证路径匹配反例。
- [x] 运行 `npm run test`，验证类型检查与全部单元测试。
- [x] 运行 `npm run build`，验证生产构建。
- [x] 使用隔离 `CODEX_HOME` 启动应用，验证输入前缀出现目录候选、键盘选择、鼠标选择、无匹配和原有底部确认路径。
- [x] 在 Smoke Ledger 记录触发路径与反例结果。
- [x] 输出归档拟执行操作清单并取得用户明确同意后，再把计划移动到 `completed/`。

## Smoke Ledger

- TDD 反例：新增 3 个目录补全测试在接口实现前均以 `is not a function` 失败；实现后定向测试 6/6 通过。
- `npm run test`：39 个测试文件、185 个测试全部通过，包含 TypeScript 类型检查。
- `npm run build`：生产构建成功；保留项目既有的 Next.js NFT 动态路径警告。
- 生产交互：使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 在随机端口 `34577` 启动；输入 `/volume2/SSD/co` 后候选仅显示 `codex`。
- 键盘触发：`Tab` 将候选补全为 `/volume2/SSD/codex/` 并动态展示 `Chat`、`report`、`research`、`Temp`；`Enter` 进入 `/volume2/SSD/codex/Chat`。
- 反例：输入 `/volume2/SSD/definitely-no-match` 显示“无匹配目录”，当前已浏览目录和底部“选择此文件夹”保持不变。
- 控制台：未发现本功能新增错误；仍有既有 `/api/setup`、`/api/settings/app` 404 和 Dialog Description 警告。
- Playwright MCP 本轮产生的 `/home/rrssnas/code/codex/web/.playwright-mcp`（124 KB）已在用户确认后移动到 `/volume2/SSD/Trash/2026-07-15-folder-path-autocomplete/home/rrssnas/code/codex/web/.playwright-mcp`，并验证源目录消失、Trash 新条目存在；`/volume2/SSD/codex/Chat/.playwright-mcp` 的内容均为 6 月历史文件，本轮未写入且未处理。
