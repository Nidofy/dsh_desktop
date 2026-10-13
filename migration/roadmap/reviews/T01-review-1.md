# T01 独立审查，第 1 轮

## Summary

结论：**NEEDS_FIX**。健康退化加载、普通 keep/replace 与旧租约路径已有可运行实现，但 F1–F3 是凭据及恢复一致性的 P1 缺陷；F4–F6 为 P2。不能按当前交付整体集成，尤其不能先合入 Host 的无条件启动兜底。2026-10-05（Asia/Shanghai）独立重跑作者相关测试 **47/47**（含 2 个 native 用例）、全量 host/client typecheck 和 scoped lint，退出均为 0；独立副本的 **5/5 诊断测试成功复现缺陷**，不构成功能通过。

没有修改作者业务代码、测试或 handoff，没有合入实现、推送或启动其他模型。T03 独立审查另见 [T03-review-1.md](T03-review-1.md)，其结果不作为本结论的条件。

## Table of Contents

- [实际对象与环境](#实际对象与环境)
- [发现与修复项](#发现与修复项)
- [验收范围与交接核对](#验收范围与交接核对)
- [运行证据](#运行证据)
- [集成与 T02 前置能力](#集成与-t02-前置能力)
- [Dev Note](#dev-note)

## 实际对象与环境

作者目录为 Electron 内 `.build/dispatch/worktrees/T01`，实际分支 `codex/roadmap-t01-connection-recovery`。开始及验证后的 staged/unstaged 和相关未跟踪文件均为空；审查以实际文件及相对 `codex/roadmap-integration` 的 diff 为准，不校验 SHA。该 diff 包含作者开工时受控同步的 R roadmap 资料；它们不是本任务的业务实现。业务变更为 store.ts、ui.ts、Host index.ts、四个 connections 测试文件及 T01 handoff；runtime.ts/api.ts 未改。主目录原有八个 R 登记文件的修改、integration-ledger 和已有审查报告全部保留。

已读当前 AGENTS、适用 packages/docs 规则、REVIEW、SCOPE、contracts-v1、ownership、wiring-queue、HANDOFF_TEMPLATE 及实际 handoff；沿用本会话已读取的 architecture/testing/defensive-patterns、dsh-doc 和 dsh-prose-standard。相关业务目录没有额外下级 AGENTS。Host index.ts 属 R；作者提供的变更只能作为 W01 待审补丁，不以作者提交替代 R 接线授权和验收。

现有作者依赖可用，node_modules/.pnpm 是独立普通目录，本轮没有重新安装作者依赖。实际运行 Node 24.16.0、锁定 pnpm 11.7.0；native 基线实际执行成功，使用已有 helper 普通复制件，没有源码重建或 digest/SHA 校验。作者环境准备日志为其整理记录，不据此宣称完整历史命令留证。**技术接受现有环境用于源码测试**；作者代行 R 建 worktree、安装和复制 helper 的流程偏差保留，不追认真实 Loader、Windows 安全存储或发行资格。

为增补故障测试，在 Electron 内创建 `.build/dispatch/worktrees/T01-review-1` 独立审查副本。创建前确认作者工作树干净、目标不存在，按实际作者分支复制，再确认业务差异为空；没有遗漏待审未提交文件。仅在此副本新增 [诊断测试](../../../.build/dispatch/worktrees/T01-review-1/apps/desktop-host/tests/roadmap-review-T01-diagnostics.spec.ts)。副本自身执行 frozen/offline 安装（退出 0，60.7 秒），没有共享可写依赖链接；未构建 dsh bin 的安装警告保留，不能作为启动通过。测试采用合成凭据，各目录独立 TEMP/TMP/DSH_HOME。

## 发现与修复项

### F1 / P1：keep 复制缓存中已被后端删除的秘密

位置：[store.ts:297](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L297)（297–302、317–334）。keptValue 读 this.keys；mutate 仅在 appliedRevision 不等于 state.revision 时重新 apply。触发：保存 A、后端删除 A 的秘密引用、同一 owner 未 inspect 时对 A 执行 keep。实际提交新修订并把旧缓存值写入新引用，没有按契约拒绝缺 Key；后端失效状态被绕过，凭据可被重新创建。这不等同旧在途租约合理保留 A 的值。

最小修复：在 CAS 命中后从官方 backend 重新 resolve 当前引用，缺失/后端拒绝统一映射为 keep 不可用；仅有效读回后创建独立新引用。保留旧租约固定行为。可复核测试：[诊断:43](../../../.build/dispatch/worktrees/T01-review-1/apps/desktop-host/tests/roadmap-review-T01-diagnostics.spec.ts#L43) 已复现；修复后应改为断言拒绝、无新 revision/引用，再补后端 get 抛错和 replace 修复路径。

### F2 / P1：cleanup 与 journal 双故障后可丢失秘密回收义务

位置：[store.ts:222](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L222)（recover 222–258、mutate 317/342–350）。触发：credential-staged 后中断，恢复时 unset 失败且 cleanup.json 写失败。recover 保留旧 journal，但在写台账失败分支先返回，没有把 merged 记入 pendingCleanup；随后新保存覆盖并最终删除旧 journal。实际旧 staged secret 仍在 backend，而 state、cleanup 与 journal 均不再记录其引用，之后恢复/collect 无法重试清理。

最小修复：任何新事务开始前，必须保证旧未完成义务仍有可靠持久记录；若台账不能提交，不得覆盖唯一 journal。pending/recovery 状态同时反映这项义务，不能报告 ready。健康连接可继续服务，但此故障窗口的新写必须等待或稳定拒绝。可复核测试：[诊断:54](../../../.build/dispatch/worktrees/T01-review-1/apps/desktop-host/tests/roadmap-review-T01-diagnostics.spec.ts#L54) 组合真实 orphan 引用、unset 拒绝、台账写失败和后续保存，已复现；应补同 owner 与冷重启恢复、无遗忘引用的断言。

### F3 / P1：current 路由先于新凭据与健康映射公开

位置：[store.ts:348](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L348)、[apply:261](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L261)，消费者 [runtime.ts:105](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/runtime.ts#L105)（105–130）。mutate 先 this.state=next，再 await apply；apply 等待所有 get 后才同步交换 keys/health。触发：A→B replacement 后，B 的 backend get 延迟。实际 desired=2/applied=1，state.current 已选 B，但 B 没有已发布 key/health；路由消费者使用这个新 current，acquire 对真实存在的 B 秘密却拒绝 CONNECTION_MISSING_CREDENTIAL。两张映射彼此同步交换并不能保证配置与映射的整体交换。

最小修复：分离 durable desired 与可服务的 published 视图，把路由使用的 current、keys、health 和 appliedRevision 一次同步发布；异步解析期间消费者看到旧完整视图或显式尚未应用状态。可复核测试：[诊断:76](../../../.build/dispatch/worktrees/T01-review-1/apps/desktop-host/tests/roadmap-review-T01-diagnostics.spec.ts#L76) 已复现；补实际 route/request 在延迟 save/revoke/inspect 窗口的可见行为，不能只检查同配置 inspect 的映射刷新。

### F4 / P2：collect 后状态仍公布已退休修订的健康

位置：[store.ts:425](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L425)（425–431）、[api.ts:86](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/api.ts#L86)。触发：retention=0、保存 B 后收集无租约 A。实际 state 中只剩 B，retainedRevisions=1，但 status.revisions 仍含 A available；collect 删 keys，没有同步删 health 或发布对应健康版本。HTTP collect 返回该失配视图，消费者无法按同一列表判断保留与可用性。

最小修复：收集后的保留目录和 key/health 投影同步发布，按契约更新 healthRevision。可复核测试：[诊断:96](../../../.build/dispatch/worktrees/T01-review-1/apps/desktop-host/tests/roadmap-review-T01-diagnostics.spec.ts#L96) 已复现；修复后检查 status/inspect/HTTP collect 均不包含已收集 A，旧有效 lease 阻止回收仍成立。

### F5 / P2：Host 捕获任何安装错误，却没有保证修复入口存在

位置：[index.ts:94](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/index.ts#L94)（94–102、113–114）、[api.ts:38](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/api.ts#L38)（38–51）。installConnectionApi 在 installConnections、workbench 和导入 JSON 读取成功后才注册 HTTP handler。触发：home/nidofy-connections 为文件导致 mkdir 失败；或其他 handler 注册前不可恢复错误。实际安装拒绝、修复 handler 未注册，index 的宽泛 catch 只 console.error，后续仍发送 ready；handoff 的“修复页面可达”不成立。未实跑整壳启动，ready 续行来自源码检查，handler 缺失已用真实 Context 与真实文件故障复现。

最小修复：按可恢复错误分类退化，未知/不可恢复安装错误保留可见失败；如产品要求继续工作区，应先安装独立、认证且有界的 unavailable/repair 入口，再明确报告降级状态，并清理部分安装效果。这属于 R 的 W01 接线，不能直接合入无条件 catch。可复核测试：[诊断:107](../../../.build/dispatch/worktrees/T01-review-1/apps/desktop-host/tests/roadmap-review-T01-diagnostics.spec.ts#L107) 已复现；补官方 Loader/profile 的就绪或失败回执、认证 HTTP 修复入口及安装失败后的生命周期清理。

### F6 / P2：产品可见行为与破坏性接口变更的文档/测试未交付完整

位置：[connections-ui.spec.ts:1](../../../.build/dispatch/worktrees/T01/apps/desktop-host/tests/connections-ui.spec.ts#L1)、[connections-host.spec.ts:1](../../../.build/dispatch/worktrees/T01/apps/desktop-host/tests/connections-host.spec.ts#L1)、[handoff](../../../.build/dispatch/worktrees/T01/migration/roadmap/handoffs/T01.md)。UI 用例只断言 HTML 字符串含文案，未执行留空 keep、replace、CAS 冲突与恢复错误渲染；Host 用例直接安装 store/runtime，未经过 installConnectionApi、index 或 Loader。错误码细分和新状态字段已公开，但 diff 只有 store JSDoc 与交接，没有 owning 产品文档或 `docs/upgrade-guide/` 记录；根规则要求外部可见 breaking change 立即登记。

最小修复：补 API/页面提交与错误回放的实际可见行为测试，至少覆盖 F1/F3/F5；记录新错误码、留空 keep 与旧 wire 兼容、后端拒绝/invalid-state 修复方式，并按文档 owner 提交 owning README/升级指南补丁。真实 Loader 与包资格可继续单列 NOT_RUN，但不能把纯字符串测试称为 Host/修复页面验收。可复核方式为 scoped API/UI 测试、keyless 可见输出记录和文档 pairing/type/reference 验证。此为交付范围缺口，不是依赖安装阻塞。

## 验收范围与交接核对

| 要求 | 已查事实 | 结论 |
|---|---|---|
| 加载与健康分离 | 缺活动/非活动/旧修订 Key、后端拒绝、撤销不读秘密均在作者测试通过；单连接退化不整体抛出 | 可运行局部能力，不能覆盖 F3/F5 |
| keep/replace、租约、引用 | 普通 keep 创建独立引用；实际 agent/request 在途 A 钉住，B 切换、CAS 与 operationId 路径通过 | F1/F2/F3 必须先修 |
| cleanup/journal/损坏配置 | 普通 unset 失败重试、损坏 state/journal 保留字节并 invalid-state 已覆盖 | 双故障恢复未成立（F2） |
| 状态与消费者 | UI 使用新 availability/recovery；api/runtime 编译且原入口继续消费 | F3/F4/F5/F6 未关闭 |
| Host 就绪 | 两个 Context/runtime 测试通过 | 真实 Loader/profile 和修复 HTTP 用户流程 NOT_RUN |

handoff 对作者 26 例、扩展 47 例和类型命令的计数可复现；对真实 Windows provider、Loader、浏览器自动化与包资格的未执行声明应保留。必须改正“keep 当前可读”无条件描述、“无数据丢失路径，仅清理延迟”和“owner 意外失败仍修复页面可达”，分别对应 F1/F2/F5；原子交换描述必须涵盖 state/current，不能仅两张 Map。其源码基线是八文件，不能把“外加五文件”文字作为实际文件数量，增量实际四文件。本轮没有修改作者 handoff，修复项交回作者。

## 运行证据

全部 shell 命令、cwd、退出码和异步完成记录见 [命令清单](../../../.build/dispatch/evidence/T01-review-1/commands.json)；两次初始沙箱启动失败为 NOT_STARTED，按根规则以相同只读命令窄范围 host 重试。读取不存在的 README/glob/旧 upgrade-guides 路径产生的 read/rg 错误保留，后续改为真实路径核对；不算验证通过。源码读取输出截断处已按路径重读。

| 验证 | 实际执行及结果 | 证据 |
|---|---|---|
| 作者相关回归 | vitest run connections、connections-recovery、connections-host、connections-ui、protection、notebook、context-integration、settings；8 文件 47/47，退出 0 | [focused-baseline.log](../../../.build/dispatch/worktrees/T01/.build/dispatch/evidence/T01-review-1/focused-baseline.log) |
| 类型 | `node node_modules/pnpm/bin/pnpm.cjs run typecheck`；host/client 构建链完成，退出 0 | [typecheck.log](../../../.build/dispatch/worktrees/T01/.build/dispatch/evidence/T01-review-1/typecheck.log) |
| lint | oxlint --config .oxlintrc.json，仅本单元三业务文件与四测试文件；退出 0 | [oxlint.log](../../../.build/dispatch/worktrees/T01/.build/dispatch/evidence/T01-review-1/oxlint.log) |
| 独立故障复现 | review 副本 vitest run roadmap-review-T01-diagnostics.spec.ts；初版 4/4、增补真实 install API 故障后最终 5/5，均退出 0 | [最终日志](../../../.build/dispatch/worktrees/T01-review-1/.build/dispatch/evidence/T01-review-1/diagnostics-final.log) |
| 审查副本依赖 | 主目录锁定 pnpm 入口 install --frozen-lockfile --offline；退出 0 | [安装日志](../../../.build/dispatch/worktrees/T01-review-1/.build/dispatch/evidence/T01-review-1/pnpm-frozen-offline.log) |

作者测试与 review 测试分别在其目录设 `TEMP=TMP=<该目录>/.build/dispatch/tmp/T01-review-1`、`DSH_HOME=<该目录>/.build/dispatch/test-home/T01-review-1`。精确八文件命令与完整隔离步骤在 JSON；诊断的故障通过 vi.mock 限定 atomic-write，秘密服务为合成 backend，其余文件 I/O 为真实隔离目录。模拟故障只证明源码窗口，不能推为真实后端/整机资格。

未执行：完整 test/coverage/doc-sync/build/hygiene、既有全仓 lint/concrete-terms 故障复核、真实 Loader/安装包、浏览器用户流程、Windows CredentialProvider、跨进程并发、断电/杀进程恢复；均 **NOT_RUN**。本次 scoped lint 通过不覆盖作者申报的全仓 lint 失败，不将历史 NEEDS_FIX 改为通过。

## 集成与 T02 前置能力

当前可接收的是审查材料、故障复现及接口细化输入；健康分类、普通独立引用和旧租约已有测试依据，但与有缺陷的 store 状态发布共同交付，**当前业务单元不可整体集成**。作者修复 F1–F4、补全 F6，R 修正或退回 F5/W01 后需针对实际修改复核；不得让测试绿掩盖恢复窗口。T25 现状特征化断言只能由 R 在 W01 同批更新，不修改 T25 自有测试。

T02 所需的官方 CredentialProvider 定义和 credentials get/set/unset 消费能力已在现有仓库存在，隔离合成数据测试也可运行；可开展 provider 设计、独立存取/命名空间/拒绝测试。T01 安全 keep、清理持久性和原子路由消费前置尚不满足，且实现未集成，不能将 T02 的 T01 依赖标为已验收或进行正式消费者联验。T02 自身真实 Windows 隔离身份/provider、W03 注册接线和 R 环境/文件租用仍须独立具备；本报告不自动启动 T02。

两份新报告的 scoped AST 链接/anchor、段落换行、concrete-terms 和维护引用检查退出 0；校验未解析或匹配提交号。主目录 git diff --check 退出 0，作者 T01/T03 工作树最终仍干净；两个审查副本各仅新增自己的诊断测试。见 [文档检查日志](../../../.build/dispatch/evidence/review-T0103-doc-validation.log)。此检查不替代未执行的全仓文档校验。

## Dev Note

本报告由独立审查者写入主目录。作者业务目录保持只读，审查副本及复现日志保留在 Electron 内。状态仅针对本交付单元；源码局部能力、完整运行时接线和安装包验收是不同结论。
