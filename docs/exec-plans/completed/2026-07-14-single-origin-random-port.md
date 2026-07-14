# 生产单端口同源 Bridge 与随机端口 Implementation Plan

> **For agentic workers:** 当前环境没有 `superpowers:executing-plans`，由当前会话按本计划内联执行。步骤使用 checkbox（`- [ ]`）跟踪。

**Goal:** 让 `npm run start` 通过同一个 HTTP 端口提供 Next 页面/API 与 `/codex-bridge` WebSocket，并在未设置 `PORT` 时由操作系统随机选择空闲端口。

**Architecture:** 生产启动器改为 Next 自定义 Node HTTP Server，不再启动独立随机端口 bridge 与 `next start` 子进程。`createWebSocketBridge` 增加挂载到既有 Server 和限定 upgrade path 的能力；浏览器从 runtime API 取得相对 bridge path，再按当前页面协议和 Host 转换为 `ws://` 或 `wss://` URL。

**Tech Stack:** Node.js 24、Next.js 16.2.10 custom server、`node:http`、`ws`、TypeScript、Vitest、Playwright/CDP。

## Global Constraints

- 保留 `createWebSocketBridge()` 现有独立随机端口行为，避免破坏 dev、smoke 和 E2E。
- 生产 WebSocket path 固定为 `/codex-bridge`，token 继续通过 query string 校验。
- 未设置 `PORT` 时使用 `server.listen(0)`；设置 `PORT` 时严格使用指定端口。
- 同源校验使用浏览器 `Origin` 与请求 `Host`，兼容 localhost、SSH 转发和正确传递 Host 的 HTTPS 反向代理。
- 不修改 `/home/rrssnas/code/CodexWeb`，不新增第三方依赖，不读取真实生产 `CODEX_HOME` 做测试。
- 所有测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

---

### Task 1：同源 URL 与端口解析纯函数

**Files:**
- Create: `server/production-server-options.ts`
- Create: `server/production-server-options.test.ts`
- Modify: `src/codex-web/bridge-url-runtime.ts`
- Modify: `src/codex-web/bridge-url-runtime.test.ts`

**Interfaces:**
- Produces: `readProductionPort(value: string | undefined): number`，未设置返回 `0`，非法值抛出中文错误。
- Produces: `resolveBridgeEndpoint(value: string, location: { protocol: string; host: string }): string`，绝对 `ws/wss` URL 原样返回，相对 path 按页面 origin 转换。

- [x] **Step 1：先写失败测试**

测试必须覆盖：

```ts
expect(readProductionPort(undefined)).toBe(0);
expect(readProductionPort("4123")).toBe(4123);
expect(() => readProductionPort("abc")).toThrow("PORT 必须是 0 到 65535 的整数");
expect(resolveBridgeEndpoint("/codex-bridge?token=x", { protocol: "http:", host: "localhost:4567" }))
  .toBe("ws://localhost:4567/codex-bridge?token=x");
expect(resolveBridgeEndpoint("/codex-bridge?token=x", { protocol: "https:", host: "codex.example.com" }))
  .toBe("wss://codex.example.com/codex-bridge?token=x");
```

- [x] **Step 2：运行 targeted test 并确认失败**

```bash
npm run test -- server/production-server-options.test.ts src/codex-web/bridge-url-runtime.test.ts
```

Expected: 新函数不存在或相对 URL 尚未转换。

- [x] **Step 3：实现最小纯函数并接入 runtime resolver**

`resolveCodexBridgeUrl()` 从构建期 URL或 `/api/codex/bridge-url` 取得字符串后统一调用 `resolveBridgeEndpoint()`；测试通过参数注入 location，生产浏览器使用 `window.location`。

- [x] **Step 4：运行 targeted test**

Expected: 两个测试文件全部通过。

### Task 2：Bridge 挂载共享 HTTP Server

**Files:**
- Modify: `server/websocket-bridge.ts`
- Create: `server/websocket-bridge.test.ts`

**Interfaces:**
- Extends: `WebSocketBridgeOptions` 增加 `server?: Server` 与 `path?: string`。
- Preserves: 未传 `server` 时 bridge 自建 Server、监听 `host/port` 并由 `close()` 关闭。
- Produces: 传入 `server` 时只挂载 upgrade listener；`close()` 移除 listener、关闭 WebSocket，不关闭共享 HTTP Server。

- [x] **Step 1：写共享 Server 失败测试**

测试创建一个 HTTP Server，挂载：

```ts
createWebSocketBridge({ server, path: "/codex-bridge", token: "secret" });
```

断言 `/wrong` upgrade 不被 bridge 接管，`/codex-bridge?token=secret` 被接管；bridge close 后共享 Server 仍处于 listening。

- [x] **Step 2：实现共享 Server 生命周期和 path 过滤**

upgrade handler 首先解析 `request.url` pathname；不匹配时直接 return，不写 socket。独立模式默认 path 为 `/`，保持 smoke 客户端的根路径 URL 可用。

- [x] **Step 3：运行 bridge targeted test**

```bash
npm run test -- server/websocket-bridge.test.ts server/security.test.ts
```

Expected: 全部通过。

### Task 3：同源 Origin 安全校验

**Files:**
- Modify: `server/security.ts`
- Modify: `server/security.test.ts`

**Interfaces:**
- Extends: `BridgeSecurityOptions` 增加 `allowSameOrigin?: boolean`。
- Behavior: `allowSameOrigin=true` 时，Origin URL 的 host 必须等于请求 Host；token 和 remote connection 规则保持不变。

- [x] **Step 1：写安全反例测试**

```ts
expect(validateBridgeRequest(requestWith("https://codex.example.com", "codex.example.com"), options)).toEqual({ ok: true });
expect(validateBridgeRequest(requestWith("https://evil.example", "codex.example.com"), options)).toMatchObject({ statusCode: 403 });
```

- [x] **Step 2：实现同源判断**

只接受 `http:`/`https:` Origin，比较标准化后的 `originUrl.host` 与 `request.headers.host`；显式 `allowedOrigins` 仍可作为兼容白名单。

- [x] **Step 3：运行安全测试**

Expected: localhost、显式远程白名单、同源代理和恶意 Origin 反例全部通过。

### Task 4：生产启动器改为单 Server

**Files:**
- Modify: `scripts/start-next-with-bridge.ts`
- Modify: `src/app/api/codex/bridge-url/route.ts` only if response type documentation needs clarification; runtime value remains `{ bridgeUrl }`.

**Interfaces:**
- Consumes: `readProductionPort(process.env.PORT)`。
- Produces: runtime `CODEX_WEB_BRIDGE_URL=/codex-bridge?token=<token>`。
- Produces: one HTTP Server handling Next requests and bridge upgrades。

- [x] **Step 1：替换子进程启动结构**

核心结构：

```ts
const app = next({ dev: false, hostname: host, port });
await app.prepare();
const server = createServer((request, response) => void app.getRequestHandler()(request, response));
const bridge = createWebSocketBridge({
  server,
  path: "/codex-bridge",
  token,
  allowRemoteConnections: true,
  allowSameOrigin: true,
  codexHome: process.env.CODEX_HOME,
});
process.env.CODEX_WEB_BRIDGE_URL = `/codex-bridge?token=${bridge.token}`;
await listen(server, port, host);
```

非 bridge upgrade 转交 `app.getUpgradeHandler()`；SIGINT/SIGTERM 依次关闭 bridge、HTTP Server 和 Next。

- [x] **Step 2：输出实际随机端口**

启动日志必须包含实际监听结果：

```text
Codex Web: http://127.0.0.1:<actualPort>
Codex Web bridge: ws://127.0.0.1:<actualPort>/codex-bridge?token=...
```

公开 Host 只用于日志；浏览器连接始终从当前页面 origin 推导。

- [x] **Step 3：运行 typecheck 和完整测试**

```bash
npm run test
```

Expected: typecheck 与全部 Vitest 通过。

### Task 5：生产、随机端口与反例 Smoke

**Files:**
- Modify: `docs/exec-plans/active/2026-07-14-single-origin-random-port.md`

- [x] **Step 1：生产构建**

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run build
```

Expected: build 通过，仅允许记录既有 NFT trace warning。

- [x] **Step 2：未设置 PORT 启动**

```bash
unset PORT
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run start
```

Expected: 实际端口不是硬编码 3000；`GET /api/codex/bridge-url` 返回 `/codex-bridge?token=...`。

- [x] **Step 3：同一端口 WebSocket 往返**

连接 `ws://127.0.0.1:<actualPort>/codex-bridge?token=...`，完成 initialize、initialized、model/list；不访问第二个端口。

- [x] **Step 4：显式 PORT 反例**

```bash
PORT=43117 npm run start
```

Expected: HTTP 与 WebSocket 都使用 43117。

- [x] **Step 5：Origin 反例**

正确同源 Origin 连接成功；`Origin: https://evil.example` 返回 403；无效 token 返回 401。

- [x] **Step 6：回归 smoke**

```bash
npm run test:smoke
npm run test:smoke:permissions
```

Expected: 现有独立 bridge smoke 均通过，证明共享 Server 扩展未破坏测试路径。

## Self-Review

- Spec coverage：覆盖同源单端口、未指定端口随机、显式端口固定、SSH/Nginx Host 场景、安全反例和旧 smoke 兼容。
- Placeholder scan：没有待定实现、模糊断言或未定义接口。
- Type consistency：`readProductionPort`、`resolveBridgeEndpoint`、共享 `server/path` options 在各任务中命名一致。
- Scope：不改 dev 启动器；用户只要求 `npm run start`，避免扩大变更。

## Execution Results

- 状态：`Code complete`、`Tests pass`、`Smoke passed`；计划按约定保留在 `active/`，尚未移动归档。
- 最终 `npm run test`：39 个测试文件、182 项通过。
- 未设置 `PORT` 的两次生产启动由系统分配 `39309` 与 `38097`，未回退到固定 3000。
- 显式 `PORT=43117` 时，页面、runtime API 与 WebSocket 均使用 43117。
- runtime API 返回 `/codex-bridge?token=...`，浏览器按页面 origin 解析；HTTP 页面得到 `ws://`，HTTPS 单元测试得到 `wss://`。
- 同端口 WebSocket 完成真实 app-server initialize 与 `model/list`，返回 7 个模型。
- 真实 CDP 浏览器打开 `http://192.168.3.12:38097/chat` 后成功加载 `5.6-Sol`，bridge/WebSocket console 错误为 0。
- 安全反例：恶意 Origin 返回 403，无效 token 返回 401；localhost Origin 与不同 Host 的组合也由单元测试拒绝。
- `npm run build` 通过，仅保留既有 NFT 动态路径追踪警告。
- `npm run test:smoke` 与 `npm run test:smoke:permissions` 均通过，独立 bridge 路径没有回归。

## Decision Log

- Next 16 的 `getUpgradeHandler()` 必须在 `app.prepare()` 后调用；首次生产启动在监听前暴露该错误，调整顺序后随机端口、显式端口和真实浏览器均通过。
- CDP 浏览器与服务不共享 loopback，`127.0.0.1` 验证得到 Chrome 网络错误页；改用同机局域网地址后同源连接成功。这是 CDP 运行环境边界，不是应用回归。
- `WebSocketServer({ noServer: true })` 从未建立连接时不等待其 close callback，bridge 直接移除监听并收口共享/独立 HTTP Server，避免空闲服务停止挂起。
