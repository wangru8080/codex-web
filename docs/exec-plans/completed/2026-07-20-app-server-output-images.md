# Codex app-server 输出图片展示执行计划

**目标：** 让 Web UI 直接展示 Codex app-server 输出中的图片，同时保持现有聊天布局和交互不变。

**事实源：** `item/imageView`、`item/imageGeneration`、动态工具输出、MCP 工具结果，以及 `fs/readFile`。

## 执行步骤

- [x] 1. 补齐协议适配：从 app-server `ThreadItem` 提取图片媒体，不引入遗留 Provider 或图片生成 runtime。
- [x] 2. 补齐本地文件读取：通过 app-server `fs/readFile` 将 `savedPath` / `imageView.path` 转为浏览器可展示的数据 URL。
- [x] 3. 接入现有输出 UI：复用 `MediaPreview` 和图片灯箱，保留文本、工具状态与错误展示。
- [x] 4. 增加单元测试：覆盖图片生成、查看图片、动态工具、MCP 图片和无图片反例。
- [x] 5. 完成验证：运行 typecheck、unit、build、smoke，并对实际输出图片做浏览器截图检查。

## 成功标准

- 图片生成完成后能展示 `savedPath` 对应图片；路径读取失败时有可见错误，不静默消失。
- `imageView`、动态工具和 MCP 返回的图片能进入相同媒体展示链路。
- 普通文本和不含图片的工具结果不出现空白媒体区域。
- 不请求已不存在的 `/api/media/serve`，不读取真实 `CODEX_HOME`。

## Smoke Ledger

| 场景 | 预期 | 结果 |
| --- | --- | --- |
| 图片生成 / imageView | 输出区显示图片，可打开灯箱 | 真实 `view_image` PNG 通过，灯箱通过；SVG 为官方工具不支持反例 |
| 动态工具 / MCP 图片 | 图片内容进入工具结果媒体区 | 单元测试通过，Base64 不进入文本日志 |
| 普通文本 / 无图片工具 | 不出现媒体容器，原输出不变 | 反例单元测试通过 |
| 文件读取失败 | 显示加载失败状态 | 接线测试通过，中文/英文失败文案已接入 |
