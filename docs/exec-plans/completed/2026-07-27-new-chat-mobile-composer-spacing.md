# 新对话移动端输入框间距修复记录

**目标：** 修复首页和空白新对话在手机端重复叠加横向内边距，导致输入框比会话内输入框更窄、底部工具栏拥挤的问题。

**根因：** 空会话 hero 外层使用 `px-4`，复用的 `MessageInput` 自身也使用 `px-4`。手机端左右各叠加为 32px；进入聊天后只有输入框自身的 16px。

## 实施

- [x] 首页空会话 hero 在手机端改为 `px-0`，`sm` 及以上保留 `px-4`。
- [x] 已创建 Thread 的空白新对话 hero 使用相同规则。
- [x] 增加 wiring 测试，锁定两条入口的响应式间距。
- [x] 使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 完成测试和浏览器验证。

## 验证记录

- `Tests pass`：`npm run test` 通过，139 个测试文件、637 项测试全部通过。
- 手机端正例：390×844 视口下，首页输入框左右各 16px，宽度为 358px；底部工具栏 `scrollWidth` 等于自身宽度，没有横向溢出。
- 反例：桌面端从 `sm` 起继续保留 hero 原有 `px-4`，本次修改不改变桌面布局；会话内输入框未修改。
- 最终截图：`/volume2/SSD/codex/Temp/codex-web-mobile-composer-verified.jpg`。
- 页面尚未加载完成时的初始截图：`/volume2/SSD/codex/Temp/codex-web-mobile-composer-after.jpg`，不作为验收依据。

## 决策

- 复用现有 `MessageInput`，只移除空会话手机端重复的外层间距，不增加组件参数或新抽象。
- 不修改输入框内部工具栏，避免影响已经正常的会话内状态。
