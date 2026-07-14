# 权限策略真实工具调用 E2E 执行计划

> **执行要求：** 使用当前会话内联执行；当前环境没有 `superpowers:executing-plans` 技能，因此按本计划逐项执行并在每项后检查结果。步骤使用复选框跟踪。

**目标：** 在隔离 `CODEX_HOME` 和专用临时目录中，通过真实 Codex app-server turn 验证四种权限策略对联网和工作区外文件写入的实际控制行为。

**架构：** 新增一个可重复运行的 TypeScript E2E 脚本，通过现有 WebSocket bridge 初始化 app-server、创建临时线程、发送要求执行 shell 命令的真实 turn，并处理或观察 app-server server request。脚本以唯一标记文件、HTTP 响应内容、approval 请求和 Auto Review 通知作为断言，不以模型最终文字作为成功依据。

**技术栈：** Node.js 24、TypeScript、`tsx`、`ws`、Codex app-server JSON-RPC、现有 `createWebSocketBridge`。

## 全局约束

- 只使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 测试根目录固定为 `/volume2/SSD/codex/Temp/codex-permission-e2e-20260714-142802`；执行前确认不存在同名对象。
- 不修改 `/home/rrssnas/code/CodexWeb`，不向当前 Git 工作区写测试标记。
- 不执行删除命令；测试产物保留原层级并在结果中列出。
- 联网请求使用 `https://example.com/`，超时 20 秒，并为 app-server 进程设置项目规定的代理环境变量。
- 每个策略使用独立 ephemeral thread，避免 session scope 授权串扰。
- E2E 脚本拒绝在错误 `CODEX_HOME` 或已存在的测试根目录上运行。

---

### Task 1：建立真实工具 E2E 驱动器

**文件：**
- 创建：`scripts/permission-policy-tool-e2e.ts`
- 修改：`package.json`

**接口：**
- 输入：`CODEX_HOME`、当前工作目录、四项权限参数。
- 输出：每项的 thread/turn ID、approval/Auto Review 事件、命令完成状态、标记文件与联网文件断言。

- [x] **Step 1：实现 JSON-RPC E2E 客户端**

客户端必须支持 request、notification、server request response、按 predicate 等待消息，以及 turn 超时；初始化参数复用 `appServerInitializeCapabilities()`。

- [x] **Step 2：实现唯一测试目录保护**

执行前检查：

```text
/volume2/SSD/codex/Temp/codex-permission-e2e-20260714-142802
```

若已存在则立即失败，不覆盖；不存在时只创建 `workspace/` 与 `outside/` 两个子目录。

- [x] **Step 3：加入 npm 命令**

在 `package.json` 增加：

```json
"test:e2e:permissions": "tsx scripts/permission-policy-tool-e2e.ts"
```

- [x] **Step 4：运行类型检查**

运行：

```bash
export NODE_HOME=/volume2/SSD/node-v24.14.0
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run typecheck
```

预期：退出码 0。

### Task 2：验证“请求批准”真实用户审批

**文件：**
- 测试：`scripts/permission-policy-tool-e2e.ts`

**接口：**
- 参数：`approvalPolicy=on-request`、`approvalsReviewer=user`、`permissions=:workspace`。
- 断言：收到 approval server request；返回一次性允许后命令完成并产生文件。

- [x] **Step 1：启动独立线程并发送真实命令任务**

模型输入明确要求调用 shell，向 `outside/request-marker.txt` 写入 `request-ok`，并用 `curl` 把 `https://example.com/` 保存为 `outside/request-network.html`。

- [x] **Step 2：确认审批发生并允许一次**

允许的 server request method 仅限：

```text
item/commandExecution/requestApproval
item/fileChange/requestApproval
item/permissions/requestApproval
```

按对应官方 schema 返回一次性允许；未知 server request 立即失败。

- [x] **Step 3：验证真实副作用**

断言 marker 内容为 `request-ok`，联网文件非空且包含 `Example Domain`，并且 turn 最终完成。

### Task 3：验证“替我审批”真实 Auto Review

**文件：**
- 测试：`scripts/permission-policy-tool-e2e.ts`

**接口：**
- 参数：`approvalPolicy=on-request`、`approvalsReviewer=auto_review`、`permissions=:workspace`。
- 断言：出现 `item/autoApprovalReview/started` 与 `item/autoApprovalReview/completed`；Web 客户端不代替 reviewer 返回用户审批。

- [x] **Step 1：发送等价风险命令任务**

目标改为 `outside/auto-marker.txt` 与 `outside/auto-network.html`，避免与其他策略共享结果。

- [x] **Step 2：观察 Auto Review**

记录 started/completed 通知以及最终判定；如果 reviewer 允许，验证文件和联网结果；如果 reviewer 拒绝，验证没有用户 approval server request，并记录拒绝事件及无副作用结果。两种结果都必须来自真实 Auto Review，不允许脚本伪造批准。

- [x] **Step 3：确认 turn 收口**

断言 turn 为 completed 或包含明确的 Auto Review 拒绝结果，不得无限等待。

### Task 4：验证“完全访问”无审批直通

**文件：**
- 测试：`scripts/permission-policy-tool-e2e.ts`

**接口：**
- 参数：`approvalPolicy=never`、`approvalsReviewer=user`、`permissions=:danger-full-access`。
- 断言：没有 approval server request，工作区外写入和真实联网均成功。

- [x] **Step 1：发送真实风险命令任务**

目标为 `outside/full-marker.txt` 与 `outside/full-network.html`。

- [x] **Step 2：验证无审批**

从 turn 开始到完成期间，approval server request 计数必须为 0。

- [x] **Step 3：验证真实副作用**

断言 marker 内容为 `full-ok`，联网文件非空且包含 `Example Domain`。

### Task 5：验证“自定义”恢复 config 行为

**文件：**
- 测试：`scripts/permission-policy-tool-e2e.ts`

**接口：**
- 来源：`config/read`；当前隔离配置的 null legacy 字段按 app-server 默认展开为 `on-request/user/workspaceWrite`。
- 断言：真实风险命令需要用户 approval，允许后成功。

- [x] **Step 1：读取并记录 config**

记录 `default_permissions`、`approval_policy`、`approvals_reviewer`、`sandbox_mode`，不得读取真实生产 `CODEX_HOME`。

- [x] **Step 2：发送真实风险命令并允许一次**

目标为 `outside/config-marker.txt` 与 `outside/config-network.html`；必须收到真实 approval server request。

- [x] **Step 3：验证真实副作用**

断言 marker 内容为 `config-ok`，联网文件非空且包含 `Example Domain`。

### Task 6：回归验证与结果归档

**文件：**
- 修改：`docs/exec-plans/active/2026-07-14-permission-tool-e2e.md`
- 修改：`docs/exec-plans/completed/2026-07-14-permission-policy-parity.md`

- [x] **Step 1：运行真实 E2E**

```bash
export NODE_HOME=/volume2/SSD/node-v24.14.0
export PATH="$NODE_HOME/bin:$PATH"
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
export http_proxy=http://192.168.3.12:7899
export https_proxy=http://192.168.3.12:7899
export all_proxy=socks5://192.168.3.12:7899
export no_proxy="localhost,127.0.0.1,::1"
npm run test:e2e:permissions
```

预期：四项分别输出策略、实际 approval/Auto Review 证据和文件验证结果；退出码 0。

- [x] **Step 2：运行回归测试**

```bash
npm run test
npm run test:smoke:permissions
```

预期：全部退出码 0。

- [x] **Step 3：更新 Smoke Ledger**

写明每项的真实工具结果、反例、遗留风险与测试产物绝对路径；不得把 Auto Review 的拒绝结果描述成执行成功。

- [x] **Step 4：完成计划**

全部验证通过后，将本计划从 `docs/exec-plans/active/` 移至 `docs/exec-plans/completed/`；该移动必须在执行前再次获得用户明确同意。

## 自检

- 覆盖四项权限策略、联网、工作区外写入、用户审批、Auto Review、无审批和 config 恢复。
- 明确允许 Auto Review 的真实允许或拒绝两类合法结果，并要求记录副作用差异。
- 没有删除、覆盖测试产物或使用真实 `CODEX_HOME` 的步骤。
- 所有命令、路径、断言和协议 method 均已明确，无占位步骤。

## 执行结果

- 状态：`Tests pass`、`Smoke passed`；等待用户单独确认移动归档。
- 真实模型：`gpt-5.6-sol`。
- 请求批准：用户 approval 1 次；工作区外 marker 与 HTTPS 响应均成功。
- 替我审批：用户 approval 0 次；Auto Review 状态为 `approved`；工作区外 marker 与 HTTPS 响应均成功。
- 完全访问：用户 approval 0 次、Auto Review 0 次；工作区外 marker 与 HTTPS 响应均直接成功。
- 自定义：隔离 `config/read` 使用 legacy defaults；用户 approval 1 次；工作区外 marker 与 HTTPS 响应均成功。
- 四个联网文件均为 559 字节，包含 `Example Domain`；测试根目录为 `/volume2/SSD/codex/Temp/codex-permission-e2e-20260714-142802`。
- 回归：`npm run test` 为 37 个测试文件、174 项通过；`npm run test:smoke:permissions` 通过。
