# T00 实际基线

## Summary

本参考记录 2026-10-05（Asia/Shanghai）Electron checkout 的实际能力、格式和验证范围。当前业务源码无未提交修改；新接口仅为 [v1 设计](contracts-v1.md)。五文件 29 测试已在当前源码运行通过，不代表新功能、干净构建或最终安装包合格。

## Table of Contents

- [仓库与来源](#仓库与来源)
- [实现核验](#实现核验)
- [格式与工具链](#格式与工具链)
- [运行与证据](#运行与证据)
- [规则与隔离](#规则与隔离)
- [Dev Note](#dev-note)

## 仓库与来源

独立 Git 根为 `D:/Documents/FeiyangChen/devApps/dshWinUi/electron`；原分支 `codex/electron-dev` 跟踪 origin 同名分支。起始状态仅 `migration/roadmap/` 未跟踪，无 staged 或 tracked 改动。已从当前 HEAD 创建 `codex/roadmap-integration`，此前无同名分支，只有主 checkout 一个 worktree。本轮未创建任务 worktree，未触及外层 Tauri 仓库。

本地 upstream/master 与 `dsh-v0.2.0-rc.2` 指向同一上游节点，当前派生 HEAD 是其直接后继，主题为 `feat(desktop): migrate Nidofy extensions to rc2 and independent working notes`。origin 为 Nidofy/dsh_desktop，upstream 为 deepseek-ai/deepseek-harness；只核验本地 refs，未 fetch，不宣称远端最新状态。精确 HEAD/父提交及来源输出保存在 `.build/dispatch/evidence/T00/source-state.json`，仅供追溯，不作为后续开工门槛。后继必须检查实际文件、未提交变更、依赖与接线。

读取期间派工资料发生外部更新，当前 prompt 已取消 SHA 门槛；原始计划内容保留，不回写旧版本。当前派工输入摘要见 [输入清单](dispatch-inputs.json)。

## 实现核验

| 领域 | 当前实际实现 | 待实施差异及 owner |
|---|---|---|
| 连接 | [store](../../apps/desktop-host/src/connections/store.ts) 有 CAS、operationId、journal、不可变租约；apply 对任何未撤销保留修订缺 Key 抛错；save 必须给 key | T01 逐修订健康、退化修复入口、keep/replace；T02 安全 provider |
| Notebook | [notebook](../../packages/nidofy/desktop-extras/src/notebook.ts) 保留不可变 revision；REMOVE 设置 active=false，但所有 entries/JSON 仍计入额度 | T03 活动投影、历史独立预算、v2 复制迁移 |
| 压缩/同步 | [compaction](../../packages/nidofy/desktop-extras/src/compaction.ts) 有增强失败 basic 回退；[context](../../packages/nidofy/desktop-extras/src/context.ts) flush 后扫描 summary/end；status 先观察再 synchronize，再观察；回合注入完整 Notebook | T04 完整预算与双游标；T05 增量/冷重建，不能假定已有 range API |
| 存储 | [storage-admission](../../apps/desktop-host/src/workbench/legacy/storage-admission.mjs) 用进程内 Map 和 statfs 保留 64 MiB 余量 | T06 跨 Host 唯一配额及覆盖矩阵；现状不是统一 2048 MiB 配额 |
| 原生保护 | [ProtectionOwner](../../apps/desktop-host/src/connections/protection.ts) 已有 turn 准入、父子共享、preview hash、失败后重启要求；Host 白名单仅 scopes/arm/disarm/list/details/preview/restore | T07 清理、capture/export/verify/import 的 Host 接入；底层已有 archive 不代表 UI 可用 |
| 工程事实 | [WorkbenchOwner](../../apps/desktop-host/src/workbench/owner.ts) 经官方 Shell/Protection 执行；ProjectActions 记录运行，Artifacts 关联文件 | T11 独立验证回执、源码/输入覆盖及 STALE；零退出码不推导测试通过 |
| 通知 | WorkbenchOwner notices 为内存有界数组；[UI](../../apps/desktop-host/src/workbench/ui.ts) 观察 runs 转换触发通知 | T12 持久 ID/游标、Main 独立消费，不依赖打开工作台 |
| Companion | [Environment](../../packages/nidofy/desktop-extras/src/client/Environment.tsx) 用首个 retainedBy.mainView 的 Session；已有 companion single 插槽 | T13 显式公共绑定与 scope；T14/T15 独立 UI/渲染，不等于 Live2D 已实现 |
| 发行 | [distribution](../../apps/desktop/src/distribution.ts) 和 [构建解析](../../apps/desktop/scripts/desktop-distribution.mjs) 支持 personal/intranet；缺发行标记走 upstream | 本轮范围 Windows x64 personal/intranet；离线替换更新。Chromium 本地限制不约束任意 Node/Shell 网络；T23/T24 验证 |

## 格式与工具链

| 数据 | 现有版本/证据 | 约束 |
|---|---|---|
| Session writer | `SESSION_FORMAT_VERSION=4`，rc.2 本地 tag 中同为 4 | [状态文档](../../docs/session-format-status.md) 仍列 latestReleasedVersion=3、finalized=4；本轮不核验远端发布，不以文档记录推断 v4 未发布，按已冻结/潜在已发布数据保护 |
| Session SQLite 查询索引 | [schema](../../packages/session-query/session-query-sqlite/src/schema.ts) 版本 8 | 派生索引与源日志分别处理 |
| 连接 state/journal | schemaVersion=1，秘密仅引用 | 未改格式；旧 operationId 窗口有界，不提供永久重放保证 |
| Notebook | schemaVersion=1、sourceThrough=-1 起始、current/revision JSON | v2 尚未实现 |
| Notebook settings | [settings](../../packages/nidofy/working-notebook/src/settings.ts) schemaVersion=1 | revision CAS、未知格式拒绝 |
| extras 偏好 | [state](../../packages/nidofy/desktop-extras/src/state.ts) schemaVersion=2 | 未改偏好 |
| 工程/快照 | ProjectActions config/run/trust=1；ChangeReview baseline=1；Artifacts registry version=1；native 快照/归档相关 record version=1 | 不把各自 version=1 当成共享 schema；未知记录不覆盖 |

root package 版本 `0.2.0-rc.2`，Node engines `^22.19.0 || >=24.0.0`，声明 pnpm `11.7.0`。实际 Node `v24.16.0`，本地 `node node_modules/pnpm/bin/pnpm.cjs --version` 为 `11.7.0`，全局 pnpm 为 `11.19.0`。文档快速入口自动触发依赖检查，日志显示 pnpm 11.19.0、lockfile up to date、resolution skipped、Already up to date，并执行 spawn-helper/lefthook postinstall；未手动安装或升级依赖，tracked 锁/业务文件无变化。后续独立 worktree 必须先解决实际启动工具与声明版本差异，再以 frozen lockfile 准备依赖，不能仅凭 --version 判定入口已锁定。锁文件及现有 helper SHA-256 见 [机器基线](baseline.json)。本轮使用现有 helper，不把其二进制摘要当成已证明由当前源码干净构建。

仓库声明的入口包括 `pnpm run build`、`build:official`、`build:desktop`、`prepare:desktop`、`package:desktop:win:x64:unsigned`、`typecheck`、`lint`、`test`、`test:snapshot`、`test:docs`、`doc-sync`。声明入口不等于本轮运行通过；本轮实际执行见 handoff。应用启动遵循 dsh profiles；不启动真实 profile/home、不调用真实计费服务。

## 运行与证据

| 文件 | 用例数 | 当前结果 | 证据边界 |
|---|---:|---|---|
| apps/desktop-host/tests/connections.spec.ts | 8 | PASS | 合成 secret map，含四个中断点；未验证 OS 安全存储 |
| apps/desktop-host/tests/protection.spec.ts | 5 | PASS | Windows 两个真实 native 用例，加所有者行为测试；未重建 helper |
| packages/nidofy/desktop-extras/tests/notebook.spec.ts | 5 | PASS | v1 现状、来源/CAS/取消，非 v2 |
| packages/nidofy/desktop-extras/tests/context-integration.spec.ts | 9 | PASS | 真实 Cordis/AgentLoop/Session/SQLite 组合和可见快照，合成 LLM；不等于打包 Loader smoke |
| packages/nidofy/working-notebook/tests/settings.spec.ts | 2 | PASS | 设置 CAS/重启/未知格式 |

实际命令为 `node node_modules/vitest/vitest.mjs run apps/desktop-host/tests/connections.spec.ts apps/desktop-host/tests/protection.spec.ts packages/nidofy/desktop-extras/tests/notebook.spec.ts packages/nidofy/desktop-extras/tests/context-integration.spec.ts packages/nidofy/working-notebook/tests/settings.spec.ts`。退出码 0，5 文件/29 用例全部通过，无 skip；Vitest 4.1.8，耗时 2.40s。运行前 TEMP/TMP 指向 `.build/dispatch/tmp/T00`，DSH_HOME 指向 `.build/dispatch/test-home/T00`；native 测试按自身代码在 `apps/desktop/.desktop-build/qualification` 创建随机合成 home/workspace 并自行清理，均位于 Electron 内。

原始日志 `.build/dispatch/evidence/T00/baseline-tests.log`，含 vite-tsconfig-paths 的维护提示；未修改依赖以消除此提示。无新增平台秘密测试身份、无真实 home 测试。文件内容摘要和脚本入口记录在 baseline.json；独立复核可重跑相同命令，不必依赖本机大日志仍在。

文档入口自动维护依赖后，同一五文件命令再次退出 0、29/29 通过，耗时 2.17s，日志为 `baseline-tests-final.log`。`test:docs` 为 20 通过/1 失败，`doc-sync` 为 42 通过/1 失败，均为旧 migration 资料的 concrete-terms 问题；lint 在既有 locales.ts 报 108 处引号错误。实际命令和限制见 [交接](handoffs/T00.md#验收证据)，这些结果不是仓库全绿。

## 规则与隔离

本目录无下级 AGENTS；适用 [根规范](../../AGENTS.md)，人读文档遵循 [docs 规范](../../docs/AGENTS.md)。已读取 architecture、defensive-patterns、持久类型确认流程及 dsh-doc/dsh-prose-standard。非 README 的 roadmap 执行资料不在双语配对发现范围内；不增加仓库级例外，不编辑根规范、冻结历史、业务 README/JSDoc。

调度者在 T00 复核后准备 T01/T03/T25 的内部 worktree：每份独立 node_modules/lib/测试 home/TEMP/TMP/原生输出，不链接主 checkout 可变目录。Node 以本次已验证版本为首批复现版本，pnpm 锁定 11.7.0 并验证实际生命周期调用；先验证 frozen 安装和各任务最小测试。需要平台凭据时仅测试身份；需要监听器时显式本机随机端口并记录。独立 worktree 依赖准备、helper 源码构建和 worktree 创建本轮 NOT_RUN，未启动其他模型。文档命令的自动依赖检查访问了 npm registry 并使用既有机器级工具/缓存配置，未把该检查宣称为独立 worktree 的隔离安装验收。

## Dev Note

执行沙箱启动多次出现 helper setup refresh 错误；只读检查和已授权分支/测试使用经自动审批的宿主执行后成功。没有把执行入口故障作为产品测试失败或修复业务代码。
