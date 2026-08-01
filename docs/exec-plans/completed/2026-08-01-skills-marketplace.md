# Skills.sh 技能市场完善计划

## 目标

让插件页技能市场使用 Skills.sh 官方 API 搜索、查看详情，并通过官方 `npx skills` CLI 安装/移除单个 Codex Skill。

## 实现

- [x] 将 Skills.sh listing/detail 响应映射为现有市场卡片模型。
- [x] 兼容 Skills.sh 新 API 的 OIDC 鉴权：有令牌使用 `/api/v1`，本地无令牌回退公开 `/api/search`。
- [x] 增加搜索、详情、安装、移除 API 路由。
- [x] 安装参数固定为来源、slug、Codex agent 和全局范围，并校验输入。
- [x] 保留市场安装完成后的 app-server Skills 刷新。
- [x] 增加上游成功/失败、详情内容和命令参数边界测试。

## 借鉴与边界

参考 `agegr/pi-web` 的分层方式，将市场搜索与本地技能管理分离。Skills.sh 只提供公开目录和详情；本地技能状态仍由 Codex app-server `skills/list` 提供，浏览器不保存凭据。

## 验证

- `npm run typecheck`
- targeted Vitest：Skills.sh 适配、搜索 API、安装参数校验
- [x] `npm run test`（158 个测试文件、721 项通过）
- [x] `npm run dev` 启动验证（开发服务器正常监听；未执行真实安装/移除）
