# T03 独立审查，第 4 轮

## Summary

结论：**REVIEWED，限 T03 v2 存储库及本次修复交付**。第三轮 F5 残余和 P3 的 journal/修订名/提交状态文档问题均 **CLOSED**；F1–F4 历史关闭路径重跑未回退。2026-10-05（Asia/Shanghai）独立执行 5 文件 **46/46**、Host face 类型、scoped lint、指定双语 README pairing，退出均为 0。既存异内容文件已改为保守拒绝，实际已提交后截断/未知版本再丢失 current 的两种冷恢复排列均保留原字节并稳定拒绝。本轮没有发现阻塞该源码交付的实现缺陷。

保留 [第一轮](T03-review-1.md)、[第二轮](T03-review-2.md) 和 [第三轮](T03-review-3.md)，不将历史 NEEDS_FIX 改成通过。**运行时仍 v1，整体 Notebook 需求仍 PARTIAL；REVIEWED 不代表已集成、运行时已切换或安装包合格。** 本轮未修改作者业务代码、测试或 handoff，未合入实现、推送、启动其他模型或更新 R 登记。

## Table of Contents

- [对象与环境](#对象与环境)
- [发现逐项复核](#发现逐项复核)
- [交接与剩余限制](#交接与剩余限制)
- [集成与 T04 前置](#集成与-t04-前置)
- [命令与验证证据](#命令与验证证据)
- [Dev Note](#dev-note)

## 对象与环境

对象为 Electron 内 `.build/dispatch/worktrees/T03`，实际分支 `codex/roadmap-t03-notebook-v2`。检查前后作者目录干净，staged/unstaged 和相关未跟踪文件为空。比较当前文件与第三轮独立副本的实际代码状态，不匹配或校验 SHA；本次增量六文件：notebook.ts、notebook-v2.spec.ts、双语 README、pairing 记录与 handoff。v1、共享类型、context/compaction、working-notebook settings/Config/Panel、依赖 manifest/锁与 R 资料未被本轮作者改动。

已读当前 AGENTS、适用 packages/docs 规则、REVIEW、SCOPE、HANDOFF_TEMPLATE、contracts-v1、ownership、wiring-queue、第三轮报告及作者当前 handoff；沿用本会话已读 architecture/testing/defensive-patterns 与 dsh-doc/dsh-prose-standard。ownership/wiring-queue 的旧 NOT_STARTED 登记不替代作者目录实际开展、修复与测试证据。本轮保留主目录原有八个 R 修改、台账和全部历史报告。

作者现有独立 node_modules/.pnpm 为普通目录且实际可用，沿用 Node 24.16.0、锁定 pnpm 11.7.0、Vitest 4.1.8，没有重复安装、升级依赖、创建新 worktree 或重建 helper。既往环境技术接受限源码测试，流程与真实产品资格限制保留。新增的两个作者回归精确覆盖第三轮真实文件复现，本轮重跑并逐行核对，未另补故障测试；不修改作者测试或既有独立诊断副本。

## 发现逐项复核

| 发现 | 第四轮状态 | 实际路径与证据 |
|---|---|---|
| F5 / P2：以解析失败推定未提交、覆盖既存修订 | **CLOSED** | [revisionTwinStatus:306](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L306) 只区分 absent/identical/conflict，已删除 completeStateShape。存在异内容字节一律 conflict，无需解析或版本猜测；[writeStateFile:336](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L336) 以 NOTEBOOK_IMMUTABLE_CONFLICT 拒绝，不覆盖、降写或删除。 |
| F5：拒绝是否先于 journal/current 变更 | **CLOSED，限支持的单实例独占模型** | [publish:503](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L503) 在 journal stat/截断/追加前检查；[migrateScope:628](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L628) 在 admission、mkdir、journal/current 写前检查。内部 helper 再检查最终名，两个入口均有前置拒绝，不能只依赖末端 helper 在 journal 已写后报错。 |
| F5：已提交后损坏 + missing pointer 冷恢复 | **CLOSED** | [v2 tests:655](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/tests/notebook-v2.spec.ts#L655) 两排列先真实写 v1、完成 v2 转换，验证 immutable==committed current，再关闭、截断或改 schemaVersion=99、移除 v2 current。冷读明确拒绝、原损坏/未知字节保留、没有新 current、history 与 v1 字节不变；新实例再次尝试稳定拒绝。测试没有把第三轮“复现覆盖”的断言当通过标准。 |
| F5：普通临时部分写仍可重试 | **CLOSED，保留原路径修复** | [warm/cold:523](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/tests/notebook-v2.spec.ts#L523)、迁移部分写与近限预算测试全部重跑；完整临时文件优先发布，失败不会产生半最终名，解除故障后相同候选成功，冷 active/history 一致。 |
| F5：原不安全期望修正 | **CLOSED** | [malformed residue:552](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/tests/notebook-v2.spec.ts#L552) 已改成拒绝并保留字节、重复尝试拒绝且不新增 history；[complete twin:577](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/tests/notebook-v2.spec.ts#L577) 同样明确拒绝。完全相同字节的 current 失败重试/迁移重试仍可复用，旧 44 例加两项冷恢复为 46 例。 |
| P3：journal 命名与较高修订提交状态误述 | **CLOSED** | [migrateScope JSDoc:589](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L589) 明确固定路径 journal 字节复用、immutable 内容派生名、较高修订文件提交状态未知；helper/class JSDoc、双语 README 与 handoff 同步保守拒绝说明，未再以“畸形”作未提交证明。 |
| F1–F4 | **CLOSED，保持历史路径范围** | 三排列 history 前缀恢复、同候选 current 失败、peak/net 与冷重启同判、迁移 pointer 有界重试/v1 保留、admission 等待取消零写入回归均通过，没有看到本次 diff 回退。 |

新冷恢复排列使用真实 NotebookStore/NotebookV2Store 与隔离文件 I/O；测试文件的 fs/atomic-write wrapper 在这些用例中关闭注入标志并透传真实调用。普通临时部分写等故障用例限定模拟故障阶段、其余真实 I/O，不等于真实断电实测。没有以此宣称完整产品集成通过。

保守拒绝允许既存异内容候选持续失败并交人工诊断，这是本次明确接受的最小方案；不要求为保持自动重试而覆盖未知文件。此前内部版本若已留下半最终文件，也不能自动推定安全替换。

## 交接与剩余限制

handoff 准确保留前三轮 NEEDS_FIX、第三轮 F5 PARTIAL、作者 READY_FOR_REVIEW 和运行时 PARTIAL；实际六文件范围、46/46、Host tsc、scoped lint、一个 named pair 的证据可复现。作者记录的中间 lint 失败属于其过程证据，本轮独立 lint 为退出 0，不将作者失败或未执行全仓检查消除。

保守拒绝代价、人工恢复协议未设计、跨进程不支持、events/actor 与 generation 待 R/T04、v1 回退与 v2 不可整目录删除的限制披露准确。新错误 NOTEBOOK_IMMUTABLE_CONFLICT 的消费者分类需 R 登记，不自行改变冻结契约或处理为“空目录”。

非阻塞 **P3 文案建议**：[handoff:19](../../../.build/dispatch/worktrees/T03/migration/roadmap/handoffs/T03.md#L19) 的“最终路径永不全文件暴露”应改为“最终路径不暴露半文件”；源码/README 与行为都是后者，属于交接笔误，不影响 F5/P3 原发现关闭，也不构成本轮新的实现阻塞。

仍未验收真实文件系统 rename 拒绝/重试耗尽、断电、进程杀死、跨进程/多 Host、人工受控修复和真实用户迁移。单实例独占是当前支持范围，不将文件预检与 rename 之间的外部并发写入防护宣称为已实现。

## 集成与 T04 前置

**T03 v2 库源码、测试与配套文档可交 R 受控集成；本轮没有合入。** 先前 F5 的持久恢复阻塞已解除，T04 所需 readActive/readHistory/publish 及故障拒绝/可重试存储能力已在待审 worktree 具备，可作为后续消费者实现输入。正式联验仍需 R 合入、固定 events/actor 接口细化及 NOTEBOOK_IMMUTABLE_CONFLICT 分类，并从官方 Session/query 获得 generation 与连续持久前缀；不把手填 scope 或单测事件数组当官方接线证明。没有自动启动 T04。

[context.ts:40](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/context.ts#L40) 仍构造 v1 NotebookStore。W02 待 Config/五预算、context/status 活动投影、Panel/history、完整指令包装预算与可重建模型输入日志；W04 待候选 baseRevision/双游标、成功 end/summary/provider/writer/flush、官方 generation 和 pending/orphan 注入；W05 待 T06 quota。T25 的相关特征化断言仍需 R 同批更新。因此“v2 库可接收”与“运行时已切换”分别登记，整体 Notebook 功能维持 PARTIAL。

## 命令与验证证据

全部执行命令、cwd、退出码、异步完成、沙箱未启动项和审查写入记录见 [命令记录](../../../.build/dispatch/evidence/T03-review-4/commands.json)。未新增独立诊断测试、未写作者业务代码、未安装作者依赖。

| 验证 | 独立实际结果 | 证据 |
|---|---|---|
| 5 文件 vitest | **46/46，退出 0**，v2 29 + 相关 17，8.46 秒 | [focused.log](../../../.build/dispatch/worktrees/T03/.build/dispatch/evidence/T03-review-4/focused.log) |
| Host face 类型 | tsc -b packages/nidofy/desktop-extras/tsconfig.host.json，退出 0 | [typecheck.log](../../../.build/dispatch/worktrees/T03/.build/dispatch/evidence/T03-review-4/typecheck.log) |
| Scoped lint | notebook/shared types/v2 test，run-oxlint，退出 0 | [lint.log](../../../.build/dispatch/worktrees/T03/.build/dispatch/evidence/T03-review-4/lint.log) |
| 指定双语配对 | desktop-extras/README.md，一个 named pair 一致，退出 0 | [pairing.log](../../../.build/dispatch/worktrees/T03/.build/dispatch/evidence/T03-review-4/pairing.log) |

cwd 为作者 T03 根，TEMP=TMP=`<cwd>/.build/dispatch/tmp/T03-review-4`，DSH_HOME=`<cwd>/.build/dispatch/test-home/T03-review-4`，证据为同目录的独立 evidence 子目录。精确五文件命令和静态检查命令在 JSON。Vitest 日志保留 vite-tsconfig-paths 维护提示，没有为消除提示修改依赖。

两条初始只读命令因 sandbox helper 初始化失败未执行，记 NOT_STARTED，同命令 host 重试。两个读取命令最后的 rg --files 在适用业务目录无下级 AGENTS 命中，退出 1 为无命中，不算测试失败；当前 root/packages/docs 规则仍适用。大输出截断后重读了修复 helper、测试新增两排列、handoff 证据/限制和实际行号，不凭截断摘要判定通过。

NOT_RUN：真实 Loader/profile、v2 运行时/keyless Session/浏览器消费、真实用户迁移、人工受控恢复、rename 故障注入、断电/杀进程、跨进程/多 Host、T06 quota、全量 test/coverage/lint/test:docs/doc-sync/build/hygiene。named pairing 不等于全仓文档 green；源码相关验收不等于集成或发行资格。没有阻塞本轮源码验收的环境/资产缺口。

报告写入后本地链接/行号和命令 JSON 读取校验退出 0；作者 git status 仍干净，主目录仅新增本轮报告且保留原 R 修改。该检查首次沙箱未启动、host 同命令重试完成，已追加到命令记录。

## Dev Note

本报告由独立审查者写入主目录，只新增第四轮报告和本轮证据；保留作者与用户修改及全部历史结果。R 接线与最终包资格须另行审查。
