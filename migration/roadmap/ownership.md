# 文件归属与派工登记

## Summary

本参考定义单一作者的写入范围和排期。机器登记 [registry.json](registry.json) 列每条任务输入、依赖能力、验收、回退和实际交付状态；任务原文见 [dispatch/tasks.json](dispatch/tasks.json)。本轮只有 T00 作者工作，未分派其他会话。

## Table of Contents

- [席位和状态](#席位和状态)
- [路径归属](#路径归属)
- [启动条件](#启动条件)
- [Dev Note](#dev-note)

## 席位和状态

最多三个实施席位 I1/I2/I3，加一个审查/集成席位 R。首批建议 I1=T01、I2=T03、I3=T25；都待人工启动，当前 assigned=false。T25 是独立测试作者，不替代 R 独立审查。模型建议沿用原派工包，客户端实际选择另记；本轮未推断或切换模型。

READY 表示输入、实际依赖、接口版本、独立环境和文件租用就绪，尚未开工；IN_PROGRESS 表示唯一作者正在写；READY_FOR_REVIEW 是作者请求复核，进入 REVIEW 队列；REVIEWED 是独立审查完成；INTEGRATED 需完整接线与集成验证；QUALIFIED 需阶段或实际包证据。READY/REVIEW 均不表示功能通过。NOT_STARTED、PARTIAL、DEPENDENCY_BLOCKED、ENVIRONMENT_BLOCKED、ASSET_BLOCKED、DEFERRED 不能折算 PASS。当前 T00=READY_FOR_REVIEW，其余 NOT_STARTED；首批 launchState=WAIT_T00_REVIEW_AND_ENV。

同一 checkout 只有一位作者。R 实施接线时停止相关作者写入，不能审查自己刚写的语义变更后自行盖独立通过；需另一人工指定审查者顺序接替同一席位。高冲突路径默认都归 R；临时移交必须先登记 owner、文件、开始/结束和关联交付，释放前不再分配。

## 路径归属

以下路径相对 Electron 根；大括号与星号为归属范围，不宣称未来文件已存在。每任务另独占 `migration/roadmap/handoffs/<ID>.md` 和自身 `.build/dispatch/evidence/<ID>/`。配套已有 package README/JSDoc/双语记录归当前获租用的任务；跨任务公用说明由 R 合并。所有 package manifests、锁、根 tsconfig、bundle、公共 API/导出聚合、官方 seam、schema catalog 一律 R 独占，优先于下表。

| 作者 | 独占主要路径 | 排他接线/顺序 |
|---|---|---|
| T00/R | migration/roadmap/{baseline*,contracts-*,ownership.md,registry.json,wiring-queue.md,milestones.md,dispatch-inputs.json}、dispatch 登记 | T00 设计交付；后续仅 R 更新总台账 |
| T01 | apps/desktop-host/src/connections/{store,runtime,api,ui}.ts；tests/connections*.spec.ts | T01→T02 必需接线→T09→T10；Host index.ts 留 R |
| T02 | 新 packages/nidofy/secure-credentials/ 内 provider、tests | 官方 CredentialProvider 定义只读；T01 消费更新由 R |
| T03 | desktop-extras/src/notebook.ts、shared/notebook-types.ts、tests/notebook*.spec.ts；working-notebook/src/settings.ts 及 tests/settings.spec.ts | T04/T05 后续变更由 R 单次移交；context/compaction/UI 消费由 R 同批完成 |
| T04 | desktop-extras/src/compaction.ts、tests/context-integration.spec.ts 及对应快照；新增候选提交适配文件 | 等 T03；context.ts/类型接线 R；T05 未启动 |
| T05 | desktop-extras/src/context.ts、新增同步/性能测试；working-notebook client NotebookPanel.tsx | 等 T04；不修改双游标含义 |
| T06 | 新 apps/desktop-host/src/storage/；workbench/legacy/storage-admission.mjs 及需要新增的类型声明 | Notebook/其他 writers 由 R 接线；当前已查到 ProjectActions 和 DesktopArtifacts 消费者 |
| T07 | native/nidofy-protection/src/**；connections/protection.ts；对应 native/protection 测试 | Cargo.lock 仍 R；workbench 入口 R，和 T06 串行 |
| T08 | 新 apps/desktop-host/src/workbench/storage-ui*；存储 UI 测试 | owner.ts/ui.ts locale 接线 R |
| T09 | connections/ui.ts；新网络/缓存设置 UI 适配和 tests | 获 T01/T02 释放；store/api schema R 同批接线 |
| T10 | connections/import.ts；新 migration-ui*、迁移 fixtures/tests | 等 T07/T09；不私改凭据 owner |
| T11 | 新 packages/nidofy/verification/；对应真实执行 tests | WorkbenchOwner、ProjectActions/Artifacts 接线 R |
| T12 | 新 apps/desktop-host/src/notifications/；apps/desktop/src/workbench.ts；通知 tests | workbench/owner.ts、ui.ts 和 prefs 聚合 R；移除旧重复观察 |
| T13 | 新 packages/nidofy/companion/src/{scope,state,binding}*；对应 tests | Environment.tsx/官方公开 seam 由 R；R 完成后移交 T14 |
| T14 | companion/src/client/**；UI tests | Environment.tsx/locales.ts/appearance.ts 获 R 临时独占租用；不改 T13 状态义务 |
| T15 | 新 packages/nidofy/companion-live2d/ 源码、assets 清单、tests | 单 renderer；依赖/资源发行接线 R |
| T16 | companion/src/pet-*；apps/desktop/src/pet.ts；pet tests | 与 T14/T15 文件隔离，index/locale 仍 R |
| T17 | 新 packages/nidofy/history-search/；项目关联与检索 tests | context.ts 查询接线由 R，在 T05 完成后 |
| T18 | companion/src/hints/、return-card/ 及 tests | 只消费 receipt/notice/scope；client index/locale R |
| T19 | 新 packages/nidofy/selftest/ 及 tests | 消费 T10/T11/T23，官方执行入口 R |
| T20 | 新 packages/nidofy/experiments/ 及 tests | 诊断归档共享接口 R |
| T21 | 新 packages/nidofy/companion-analysis/ 及 tests | 可选；Session/LLM 聚合 R |
| T22 | companion/src/intents/、style/ 及 tests | 可选；动作 owner 与 prompt 接线 R |
| T23 | 新 packages/nidofy/egress-policy/ 及 tests | connections/runtime、vision、probe、MCP 实际消费文件 R 排他逐项接线 |
| T24 | migration/roadmap/release/、evidence/T24/ | 仅候选构建/验收，不改业务语义；打包公共配置 R |
| T25 | migration/roadmap/acceptance/、fixtures/；owner-local 新 `roadmap-acceptance-*` 测试 | 不改业务代码或作者测试；放 package 下的独立测试路径先登记，运行配置 R |
| T26 | migration/roadmap/support-matrix*、发行/升级说明 | package README 按已经释放的所有权逐个登记；历史封存报告不改 |

表中 desktop-extras 和 working-notebook 均指 `packages/nidofy/` 下对应包。未来包路径仅是文件归属预留，不是新框架/API 已存在。实际任务需要不同路径时先由 R 修改登记后才能写入。未列的文件默认未分配，不能凭相近名称认领。

## 启动条件

T01 输入为现有 store/runtime/api/ui、T00 连接草案和合成凭据故障基线；验收缺 Key 三类、keep/replace、A/B 在途、丢 ACK 和 Host 就绪/最小 UI。T03 输入为 v1 store/types/settings 和 v2 草案；验收 1000 次新增退休、来源/CAS/UTF-8/固定 ID、迁移中断和活动快照。T25 输入为当前实际实现与需求，首批只设计/复现缺 Key、退休容量、flush 边界；尚无未来 API 时不提交虚构接口红测试。

每任务细目及回退在 registry.json；依赖状态须由可运行实现和最小验证支持。新 worktree 不自动带入未提交成果，调度者保存或受控同步后检查实际差异；不能只凭分支或提交号判定依赖齐全。首批环境由 R 按 [基线隔离规则](baseline.md#规则与隔离) 准备并留结果，当前未准备，不自动启动任务。

## Dev Note

R 持有 WorkbenchOwner、工作台大 UI、Host/Main 启动聚合和 client locale/index，防止任务在不同 worktree 同时重排同一文件。每次接线需要覆盖所有消费者；“不是我的文件”不能作为漏接线的验收理由。
