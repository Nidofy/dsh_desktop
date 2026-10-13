# 文件归属与派工登记

> 当前执行规则（2026-10-07）：用户要求 Sol↔Astra 连续开发，GLM 仅文档。下面旧多作者、R 独占、逐任务审查和分离集成安排已停止作为执行门槛；当前代码作者承接共享接线权限，历史事实和功能验收要求保留。以 [CONTINUOUS](dispatch/CONTINUOUS.md)、[NEXT_HANDOFF](dispatch/NEXT_HANDOFF.md) 和实际代码为准。

## Summary

本参考定义单一作者的写入范围和排期。机器登记 [registry.json](registry.json) 列每条任务输入、依赖能力、验收、回退和实际交付状态；任务原文见 [dispatch/tasks.json](dispatch/tasks.json)。当前 R 已接收 T01/T03 审查允许的源码与 T25 第二轮通过的测试，原 NEEDS_FIX 和未启动记录保留为历史。T02 实施、T04 第一单元可人工绑定；正式 W02/W04 接线仍由 R。见[当前移交](#当前移交)与[台账](integration-ledger.md)，未自动启动任何会话。

## Table of Contents

- [席位和状态](#席位和状态)
- [路径归属](#路径归属)
- [启动条件](#启动条件)
- [当前移交](#当前移交)
- [Dev Note](#dev-note)

## 席位和状态

最多三个实施席位 I1/I2/I3，加一个审查/集成席位 R。I1=T01、I2=T03 仍未分派；I3=T25 已开展，当前等待作者修复；R 已获本轮人工授权审查与维护登记。assigned 记录任务分派事实，不等于会话正在写入。T25 是独立测试作者，不替代 R 独立审查。模型建议沿用原派工包，客户端实际选择另记。

READY 表示输入、实际依赖、接口版本、独立环境和文件租用就绪，尚未开工；IN_PROGRESS 表示唯一作者正在写；READY_FOR_REVIEW 是作者请求复核；REVIEWED 是独立审查完成；NEEDS_FIX 表示审查已开展且发现未关闭；INTEGRATED 需完整接线与集成验证；QUALIFIED 需阶段或实际包证据。READY/REVIEW 均不表示功能通过。NOT_STARTED、NEEDS_FIX、PARTIAL、DEPENDENCY_BLOCKED、ENVIRONMENT_BLOCKED、ASSET_BLOCKED、DEFERRED 不能折算 PASS。当前 T00=REVIEWED、T25=NEEDS_FIX，其他任务 NOT_STARTED。T01/T03 的设计输入已采用，launchState=WAIT_ISOLATED_ENV。

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
| T15 | 新 packages/nidofy/companion-live2d/ 源码、assets 清单、tests | 单 renderer；依赖/资源发行接线 R Relay28: REAL_FIXED_ASSETS_WEB_CORE_LICENSE_UNCONFIRMED；证据 `.build/dispatch/evidence/relay-28`，当前交接 `dispatch/NEXT_HANDOFF.md`。 |
| T16 | companion/src/pet-*；apps/desktop/src/pet.ts；pet tests | 与 T14/T15 文件隔离，index/locale 仍 R Relay28: STATIC_COORDINATION_DEVELOPMENT_CARRIER_VALIDATED_PACKAGE_UNQUALIFIED；证据 `.build/dispatch/evidence/relay-28`，当前交接 `dispatch/NEXT_HANDOFF.md`。 |
| T17 | 新 packages/nidofy/history-search/；项目关联与检索 tests | context.ts 查询接线由 R，在 T05 完成后 |
| T18 | companion/src/hints/、return-card/ 及 tests | 只消费 receipt/notice/scope；client index/locale R |
| T19 | desktop-host/src/selftest 的正式本机／连接 owner 与 Desktop 实际载体 fixture | 独立 Node 资源接原 Shell/native；同次2真实 Electron开发载体2项通过，本机0模型/0Agent，连接5正常+1取消合成SSE/0计费/0Agent，完整输入冷读/双语容量报告/原生导出/无补发；报告renderer/清单仍UNKNOWN，安装/现场/真实缓存未认证，整体PARTIAL |
| T20 | 独立工程／资源预算、物理副本 owner、官方完整输入及实际 Agent→保护 Shell→T11；显式因素、顺序矩阵与原报告验证 | Relay26 51项源码、Host／8测试入口strict、13文件lint、4pair与指定原字节检查；支持Node profile独立20合成HTTP／23stream／15Agent／9动作／0计费，资源拒绝保留原T11及超额输出。真实production Main／preload renderer独立8合成HTTP／5Agent／3TAP／1完成矩阵／0计费；双语预览编辑撤销、未知峰值表、原报告／坏文件拒绝、已提交响应丢失重载零自动读取／重发、工程／矩阵取消排空及无后继行，关闭零重放。Relay25时钟及旧格式／证据保留；总资格PARTIAL，运行峰值／Host内存／安装及真实质量缓存计费仍未知 Relay27：有界目录／物理解码前拒绝／单次官方冷验及无截点资源水位；当前证据 relay-27，完整峰值和安装仍 UNKNOWN。 Relay28: NECESSARY_SHELL_RESOURCE_PHASE_VALIDATED_PEAKS_UNQUALIFIED；证据 `.build/dispatch/evidence/relay-28`，当前交接 `dispatch/NEXT_HANDOFF.md`。 |
| T21 | 新 packages/nidofy/companion-analysis/ 及 tests | 可选；Session/LLM 聚合 R |
| T22 | desktop-extras/src/client/natural-settings、NaturalSettings、index、Environment、locales 及 tests；desktop-host/src/companion/style | Relay36：明确当前 scope 只读状态、取消/不明回执后新预览不重放，实际 p36f 通过；原 owner 权限不扩展。 |
| T23 | util/http-proxy type-only 定义、desktop-host/connections/egress.ts provider 及实际消费面/tests | 当前作者完成 Root/Loader、ConfigEditor、PiAi/DeepSeek、vision/probe/MCP 与 Main 资源接线；覆盖范围及缺口见 probes/T23-egress-coverage.md |
| T24 | migration/roadmap/release/、evidence/T24/ | 仅候选构建/验收，不改业务语义；打包公共配置 R Relay28: UNSIGNED_CANDIDATE_BUILT_STARTUP_AND_REGISTRY_INSTALL_QUALIFICATION_PENDING；证据 `.build/dispatch/evidence/relay-28`，当前交接 `dispatch/NEXT_HANDOFF.md`。 Relay29: 本地候选隔离资格、私有卸载保留修补及文件副本限制已记录；生产身份/完整恢复待现场，见 handoffs/relay-29-astra.md。 |
| T25 | migration/roadmap/acceptance/、fixtures/；下方已登记三个 owner-local `roadmap-acceptance-*` 测试 | 预留作者修复，不改业务代码或原作者测试；尚未合入主目录，运行配置 R |
| T26 | migration/roadmap/support-matrix*、apps/desktop/portable/README.txt、发行/升级说明 | Relay36：当前完整p36f、T21记录额度、T22只读状态、旧ACL与清理事实已同步，见handoffs/relay-36-astra.md。 package README 按已经释放的所有权逐个登记；历史封存报告不改 Relay28: CURRENT_CAPABILITY_SUPPORT_MATRIX_AND_AFFECTED_READMES_UPDATED；证据 `.build/dispatch/evidence/relay-28`，当前交接 `dispatch/NEXT_HANDOFF.md`。 Relay29: 本地候选隔离资格、私有卸载保留修补及文件副本限制已记录；生产身份/完整恢复待现场，见 handoffs/relay-29-astra.md。 |

表中 desktop-extras 和 working-notebook 均指 `packages/nidofy/` 下对应包。未来包路径仅是文件归属预留，不是新框架/API 已存在。实际任务需要不同路径时先由 R 修改登记后才能写入。未列的文件默认未分配，不能凭相近名称认领。

T25 首批正式测试路径由 R 追认登记并预留给 T25 修复：`apps/desktop-host/tests/roadmap-acceptance-connections.spec.ts`、`packages/nidofy/desktop-extras/tests/roadmap-acceptance-notebook.spec.ts`、`packages/nidofy/desktop-extras/tests/roadmap-acceptance-compaction-boundary.spec.ts`。另有自有 `handoffs/T25.md`。实际文件目前仅在 T25 worktree，T01/T03 不得改这些文件。原先未预登记的流程偏差保留在审查和台账中；本次登记不把 NEEDS_FIX 改为通过。

独立审查者拥有 `reviews/T00-review-1.md`、`reviews/T25-review-1.md` 及 T25-review-1 审查副本内的 `roadmap-review-T25-diagnostics.spec.ts`；审查诊断未作为正式任务测试合入。R 仅维护全局登记，不与作者共写其修复文件。

## 启动条件

T01 输入为现有 store/runtime/api/ui、T00 连接草案和合成凭据故障基线；验收缺 Key 三类、keep/replace、A/B 在途、丢 ACK 和 Host 就绪/最小 UI。T03 输入为 v1 store/types/settings 和 v2 草案；验收 1000 次新增退休、来源/CAS/UTF-8/固定 ID、迁移中断和活动快照。T25 输入为当前实际实现与需求，首批只设计/复现缺 Key、退休容量、flush 边界；尚无未来 API 时不提交虚构接口红测试。

每任务细目及回退在 registry.json；依赖状态须由可运行实现和最小验证支持。R 已采用经独立审查的 T00 v1 作为首批设计输入，运行时功能仍待实现。T01/T03 的目标 worktree 当前不存在，独立 frozen 安装、隔离 TEMP/TMP/DSH_HOME 与任务最小测试均 NOT_RUN，不能标 READY。新 worktree 不自动带入本轮未提交的 R 资料；创建后必须保存或受控同步必要文件，再核查实际内容。无自动启动会话。

T25 的机械环境现状已按 [T25 审查](reviews/T25-review-1.md#环境偏差结论) 技术追认：独立依赖、Node 24.16.0、pnpm 11.7.0 frozen 安装、helper 普通复制件与合成数据隔离，仅足以运行源码基线。作者代行 R 和越过 T00 复核门槛的历史偏差保留；helper 源码构建、完整历史留证、Loader 与发行资质未确认。T25 可由人工续派修复，不替代 T01/T03 各自环境验证。

## R / W01 移交申请（2026-10-05）

R 本轮仅写自己的台账、registry、ownership、wiring-queue、EXECUTION 与 handoffs/R-T01-W01.md，以及 .build/dispatch/evidence/R-T01-W01/。T01/T25 停写与临时移交仍 WAIT_AUTHOR_STOP；未授予业务共享文件写权。待移交范围：T01 连接实现/配套测试、apps/desktop-host/src/index.ts、apps/desktop/README 双语配对、当前版本连接升级项，以及主目录 apps/desktop-host/tests/roadmap-acceptance-connections.spec.ts。T25 原工作树与 handoff 保留，Notebook/compaction 测试继续归 T25。开始/结束记录在确认后激活；[预检交接](handoffs/R-T01-W01.md) 不作为停写证据。

## 共享入口归属说明

R 持有 WorkbenchOwner、工作台大 UI、Host/Main 启动聚合和 client locale/index，防止任务在不同 worktree 同时重排同一文件。每次接线需要覆盖所有消费者；“不是我的文件”不能作为漏接线的验收理由。

## R 串行接收租用（2026-10-05）

人工本轮指定 R 为唯一集成人员，三作者实际交付目录干净，按已结束交付的串行移交处理；上一轮 WAIT_AUTHOR_STOP 是历史前置记录，本轮授权解除该前置，不再次申请。R 在主目录持有 reception-plan.json 列出的 T01/T03/T25 业务、测试、配套文档与 handoff，以及 contracts-v1 和 Host index 的临时排他租用；作者目录不写入，T25 的 Notebook/compaction 原断言保持。复制的作者分支 R 登记与审查一律排除，主目录当前记录先保存到 .build/dispatch/evidence/R-integration-20261005/preserved-main。完成后释放本轮接收租用；W02/W04 的后续顺序分配另登记。

## 当前移交

本轮接收租用已结束；作者 T01/T03/T25 目录保留，未写入。R 的主目录测试断言适配和接口登记为 READY_FOR_REVIEW，需人工指定独立审查者，R 不自行授予独立通过。作者交付的 REVIEWED 与 R 改动的未审查分别登记。全部旧席位及任务状态留在 registry.history，不作为仍在写入的事实。

| 文件范围 | 独占责任 | 移交安排 |
|---|---|---|
| 新 `packages/nidofy/secure-credentials/**`、T02 handoff/evidence | T02，独立 T02 目录 | RESERVED_MANUAL_BINDING；环境已准备。公开 CredentialProvider 只读；bundle/manifests/lock/API 注册和 W03 由 R |
| desktop-extras `src/compaction.ts`、预留 `src/notebook-evidence.ts` / `src/notebook-commit.ts`、`tests/context-integration.spec.ts` / 同名快照、新 compaction 测试/fixtures，T04 handoff/evidence | T04，独立 T04 目录 | RESERVED_MANUAL_BINDING；仅预算/证据/候选单元可启动。新文件不是已有 API；正式发布依赖 W04 |
| desktop-extras `src/context.ts` / `src/index.ts` / 公共 notebook-types / README；working-notebook `src/index.ts` / `src/settings.ts` / `src/client/NotebookPanel.tsx`；官方 session-persistence/session-query 公共 seam | R | W02/W04 预留，未实施。先接官方持久化代次/连续前缀，再按已审查 T04 候选适配串行更新所有消费者；未接线时产品仍 v1 |
| T03 `src/notebook.ts` 与 shared/notebook-types 的已审查交付 | T03 原件保留，后继只读 | 本轮库接收完成；T04 不重写库语义，需要类型变化交 R；不要求 T03 实现 T04 压缩 |
| 三个 T25 roadmap-acceptance 测试 | 后续 R 串行接线；原目录归 T25 | 连接三条断言已调整，Notebook/压缩保持；待产品变化才更新，保留真实持久化和失败期证据 |

T02/T04 各自只能在登记工作树写授权范围，不能把带过去的 R 输入副本当作作者交付再覆盖主台账。R 输入受控复制并形成本地准备基线，实际作者尚未绑定。主目录当前未提交记录和历史审查仍保留，无 force、自动清理或主线合并。

## Dev Note

本次租用结束不授予后继修改公共入口的权限。R 自行实施的断言与语义登记仍需人工指定的独立审查者复核；保持库、产品、环境与包资格的不同状态。
