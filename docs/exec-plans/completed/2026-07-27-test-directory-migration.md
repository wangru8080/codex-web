# 测试目录统一迁移执行计划

> 状态：Code complete，Tests pass

**目标：** 将仓库现有 134 个 `.test.ts` 和 3 个 `.test.tsx` 统一迁入各模块的 `tests/` 目录，保持测试逻辑与测试数量不变。

**方案：** 测试按所属模块就近集中，而不是迁入单一根目录。每个测试文件只下移一级，因此相对路径统一增加一级；Vitest 仅发现 `tests/` 目录中的测试，生产源码和历史完成计划不做无关修改。

**技术栈：** TypeScript、Vitest 4、Node.js 24。

## 全局约束

- 不执行删除命令，不安装依赖，不修改测试业务语义。
- 使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` 运行验证。
- 保留用户显式设置的非空 `CODEX_HOME`；本次验证使用默认隔离目录。
- 迁移前后测试文件名集合、文件数量和测试用例数量必须一致。
- 历史 completed plan 保留原路径记录，只更新仍承担当前交接作用的 handover 文档。

## 目标目录

| 目标目录 | 文件数 |
| --- | ---: |
| `scripts/tests/` | 2 |
| `server/tests/` | 16 |
| `src/codex/protocol/tests/` | 1 |
| `src/codex-web/tests/` | 99 |
| `src/components/ai-elements/tests/` | 1 |
| `src/components/chat/tests/` | 3 |
| `src/components/ui/tests/` | 1 |
| `src/hooks/tests/` | 1 |
| `src/lib/tests/` | 10 |
| `src/lib/markdown/tests/` | 2 |
| `src/lib/theme/tests/` | 1 |

## Task 1：迁移测试文件

**文件：**

- 创建：上表列出的 11 个 `tests/` 目录。
- 移动：现有 137 个 `.test.ts` / `.test.tsx` 文件到所属模块的 `tests/` 目录，文件名不变。

- [x] 创建目标目录并确认不存在目标同名文件。
- [x] 按模块移动测试文件。
- [x] 验证迁移后仍为 137 个测试文件，且 `tests/` 外没有测试文件。

## Task 2：修正模块路径与测试发现配置

**文件：**

- 修改：迁移后包含相对 import 或 `new URL(..., import.meta.url)` 的测试文件。
- 修改：`src/codex-web/tests/web-only-renderer-boundary.test.ts`。
- 修改：`vitest.config.ts`。

- [x] 为所有相对模块路径增加一级父目录。
- [x] 把源码读取路径 `server/app-server-session.test.ts` 改为 `server/tests/app-server-session.test.ts`。
- [x] 将 Vitest include 收敛为各模块 `tests/` 目录。
- [x] 扫描不存在的相对 import 与旧测试路径。

## Task 3：验证和文档收口

**文件：**

- 修改：`docs/handover/2026-07-21-app-server-crash-recovery.md`。
- 修改：`docs/handover/2026-07-23-runtime-path-decoupling.md`。
- 移动：本计划从 `docs/exec-plans/active/` 到 `docs/exec-plans/completed/`。

- [x] 运行 `npm run typecheck`。
- [x] 运行全量 Vitest，与迁移前 `137 files / 632 tests` 基线对比。
- [x] 记录沙箱环境导致的既有失败，不把它们误判为迁移回归。
- [x] 更新 handover 中仍作为当前入口使用的测试路径。
- [x] 填写 Smoke Ledger 并完成计划。

## Smoke Ledger

| 日期 | 验证 | 结果 |
| --- | --- | --- |
| 2026-07-27 | 迁移前 `npm run test` | Typecheck 通过；137 files / 632 tests；625 通过、7 失败。6 个失败源于沙箱禁止监听 `127.0.0.1`，1 个失败源于子进程无 stdout。 |
| 2026-07-27 | 迁移后目录反例扫描 | 共 137 个测试文件；11 个目标目录数量符合计划；`tests/` 外测试文件为 0；重复文件名为 0。 |
| 2026-07-27 | 迁移路径定向测试 | 3 files / 10 tests 通过，覆盖间接 `new URL` 路径和源码动态 import 断言。 |
| 2026-07-27 | 迁移后 `npm run typecheck` | 通过。 |
| 2026-07-27 | 迁移后全量 Vitest（沙箱外） | 137 files / 632 tests 全部通过；测试文件和用例数量与迁移前一致。 |
| 2026-07-27 | 最终 `npm run test`（沙箱外） | Typecheck 通过；137 files / 632 tests 全部通过。 |

## 决策日志

- 2026-07-27：采用模块内 `tests/`，避免根目录集中后产生跨模块长相对路径。
- 2026-07-27：`.test.tsx` 与 `.test.ts` 同步迁移，避免统一规则留下例外。
- 2026-07-27：不改历史 completed plan 中的旧路径，保留当时执行记录。
- 2026-07-27：沙箱内完整 Vitest 复现既有本地端口权限问题；沙箱外复跑全部通过，不修改测试逻辑规避环境限制。
