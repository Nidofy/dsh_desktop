# T03 独立审查，第 1 轮

## Summary

结论：**NEEDS_FIX**。v2 存储库已经存在可调用实现，活动投影/退休日志、普通 CAS 与来源校验有测试依据，但半写后重试会破坏 durable history（F1 / P1）；磁盘计量、迁移幂等和迁移取消另有 F2–F4 / P2。修复前不可整体集成。**运行时切换仍为 PARTIAL / 未接线**，W02/W04 不因库测试通过而完成。2026-10-05（Asia/Shanghai）独立重跑作者相关 **30/30**、Host face tsc 与 scoped lint，退出均为 0；独立副本 **5/5 诊断用例成功复现缺陷**，并非功能验收通过。

没有修改作者业务代码、测试或 handoff，没有合入实现、推送或启动其他模型。T01 独立审查另见 [T01-review-1.md](T01-review-1.md)，本结论不依赖 T01 的结果。

## Table of Contents

- [实际对象与环境](#实际对象与环境)
- [发现与修复项](#发现与修复项)
- [接口、消费者与交接](#接口消费者与交接)
- [运行证据](#运行证据)
- [集成与 T04 前置能力](#集成与-t04-前置能力)
- [Dev Note](#dev-note)

## 实际对象与环境

作者目录为 Electron 内 `.build/dispatch/worktrees/T03`，实际分支 `codex/roadmap-t03-notebook-v2`。开始及验证后的 staged/unstaged 和相关未跟踪文件为空；按实际文件和相对 `codex/roadmap-integration` 的 diff 检查，没有校验 SHA。该 diff 中已同步的 R roadmap 资料不算 T03 业务能力。T03 自有变更为 notebook.ts（保留原 v1、新增 v2 类）、shared/notebook-types.ts、notebook-v2.spec.ts、desktop-extras 双语 README/pairing 和 T03 handoff。context/compaction、working-notebook settings/index 和 Panel 均未切换。

已读当前 AGENTS、适用 packages/docs 规则、REVIEW、SCOPE、contracts-v1、ownership、wiring-queue、HANDOFF_TEMPLATE 和实际交接；沿用本会话已读 architecture/testing/defensive-patterns、dsh-doc/dsh-prose-standard。相关业务目录无额外下级 AGENTS。主目录预有 R 修改、台账和 T00/T25 报告均保留。

作者 node_modules/.pnpm 已是独立普通目录且实测可用，没有重复安装。Node 24.16.0/pnpm 11.7.0 实际确认；保留作者现有安装日志中的成功结果与未构建 dsh bin 警告。**技术接受现有环境用于源码测试**；作者先行建 worktree/同步 R 资料/装依赖的流程偏差保留，不推为 R 完整历史预检已执行或 Loader 已可启动。

增补故障测试位于 Electron 内 `.build/dispatch/worktrees/T03-review-1`。创建前确认源干净、目标不存在；按实际分支复制并检查源实现差异为空，没有相关未提交文件遗漏。副本独立 frozen/offline 安装退出 0（58.8 秒），没有共享可写依赖链接；仅新增 [诊断测试](../../../.build/dispatch/worktrees/T03-review-1/packages/nidofy/desktop-extras/tests/roadmap-review-T03-diagnostics.spec.ts)。各目录测试拥有独立 TEMP/TMP/DSH_HOME，未使用真实用户 Session 数据。

## 发现与修复项

### F1 / P1：半写或取消后的同实例重试可提交错误 history 前缀

位置：[notebook.ts:436](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L436)（436–452）、[loadScope:464](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L464)（464–466）。publish 在追加 history 后才写不可变 revision、检查取消、提交 current；journalSize/diskBytes 缓存只在全部成功后更新。部分写失败而 current 未变时，下一次 loadScope 仅比较 current 字节，复用旧 journalSize，未发现实际追加的未提交尾部，所以不会截断。

触发：已有活动 a/b；REMOVE a 追加历史后，在 immutable 写失败或 immutable 完成后取消；同一 store 随后 REMOVE b 成功。实际内存记录退休 b，而新 current.historyBytes 覆盖的磁盘前缀却退休 a；current.active 仍含 a。冷 load 因活动与退休矛盾拒绝 NOTEBOOK_CORRUPT_STATE。当前指针虽最后原子写，仍不能保证其引用的 history 内容正确。

最小修复：任何部分写失败/取消都失效或重新读取磁盘缓存；重试必须按 committed current 的 historyBytes 检查并截断实际 journal 尾部，再追加本次记录，同时保持准确磁盘计量。不要靠重启才能恢复。可复核测试：[诊断:46](../../../.build/dispatch/worktrees/T03-review-1/packages/nidofy/desktop-extras/tests/roadmap-review-T03-diagnostics.spec.ts#L46) 两种排列均已复现；修复后分别检查失败时不发布、同实例重试成功、冷 current/immutable/history/退休索引一致，再补 current 写失败窗口。

### F2 / P2：把写入峰值当作提交后净增长累加，预算随重启改变

位置：[notebook.ts:430](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L430)（430–432、452）。maxWriteBytes 的两份 stateBytes 是峰值预留；成功后 loaded.diskBytes 加上整个峰值，未扣掉被 current 替换的旧字节。触发：同实例连续空 delta 发布，maxHistoryBytes=1024。实际目录为 543 字节，下次写峰值额外 362 字节，共 905；缓存却为 724，按 1086 拒绝。关闭并重开相同目录、相同预算后完全相同操作成功。用户在额度内被误拒绝，长期高频会提前触顶。

最小修复：区分暂时写入峰值预留与提交后净磁盘量，或成功/失败后测量真实受管目录；同一事实在重启前后必须得到相同 admission 结论。可复核测试：[诊断:66](../../../.build/dispatch/worktrees/T03-review-1/packages/nidofy/desktop-extras/tests/roadmap-review-T03-diagnostics.spec.ts#L66) 已复现；修复后检查边界第三次发布、含 history 的净增及失败残留计量。

### F3 / P2：迁移指针失败后的重试不断复制同一不可变修订

位置：[notebook.ts:494](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L494)（494–529，尤其 524–525）。触发：v1 legacy revision1，转换写入 revision 后 current.json 原子写失败，重试两次再成功。随机 UUID 文件名使每次都创建新的不可变文件；实际留下三个内容相同的 revision1 文件，v1 原字节虽未变，v2 空间随失败次数增长，可使接近上限的迁移永远无法重试成功。handoff/JSDoc 的“重放相同文件、幂等”不能覆盖此窗口。

最小修复：使用可恢复的迁移事务身份，验证并复用相同 pending revision，或其他有界、保留已提交代次的恢复协议；不删除/改写已提交旧数据。可复核测试：[诊断:80](../../../.build/dispatch/worktrees/T03-review-1/packages/nidofy/desktop-extras/tests/roadmap-review-T03-diagnostics.spec.ts#L80) 已复现；补连续 current 写失败、相同空间预算下最终成功、原 v1 字节不变、迁移不累计多份相同修订。已有“只有 history、尚无 pointer”的用例不覆盖 immutable 已写窗口。

### F4 / P2：publish 在迁移 admission 等待中取消后仍提交 v2 current

位置：[notebook.ts:350](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L350)（350–353、483、500–525）、signal JSDoc :347。publish 首次检查 signal 后进入 lazy v1 conversion，但 loadScope/migrateScope 没有 signal；admission 返回后无条件写 history/revision/current。触发：已有 v1，迁移 admission 等待期间 abort，再解除等待。实际 publish 最终拒绝 aborted，但 abort 之后已经创建 v2 current 指针，违反“首次磁盘写或 commit pointer 前取消”的 API 描述。此处没有推进本次候选游标，但取消仍产生可见迁移提交。

最小修复：把 signal 传入 lazy migration，在异步读取/admission 后与指针提交前检查；若要将迁移定义为独立不受取消的事务，必须经 R 明确该契约并修正文档与用户行为，不能继续宣称取消不发布。可复核测试：[诊断:96](../../../.build/dispatch/worktrees/T03-review-1/packages/nidofy/desktop-extras/tests/roadmap-review-T03-diagnostics.spec.ts#L96) 已复现；修复后等待中取消应保留 v1、没有新 v2 current，后续无取消重试可完成。作者预先 aborted 的用例只覆盖入口检查。

## 接口、消费者与交接

| 要求 | 实际代码和测试 | 结论 |
|---|---|---|
| active 与 history 分离、退休 ID | active 排序投影；normal retire/restore 时间线、已用 ID 索引、readHistory 有界；1000 次增退/2001 发布通过 | 正常路径可运行，F1/F2 限制持久一致性与容量 |
| 来源与预算 | 原始 user/assistant/tool 来源校验、quote/seq 与 evidenceThrough、UTF-8 active/delta/evidence 上限；model 不能修改 pinned 或恢复退休项 | 已有库内路径；完整连续前缀/指令包装预算仍由消费者负责 |
| CAS、generation、并发 | 单实例队列 allSettled 一胜一败、条目修订、代次冲突通过 | 单实例内通过；跨 owner/进程写不是本结论 |
| current/不可变/history | pointer 最后原子写，冷读按 historyBytes 围栏 | F1 部分写重试未满足一致性 |
| v1 复制转换 | 原 v1 字节未改，未知格式拒绝，legacy sourceThrough 仅作迁移元数据，双游标从 -1 开始 | 普通路径通过；F3/F4 未关闭 |
| runtime | index/context 仍使用 NotebookStore；compaction、Panel、Config 未接 v2 | **PARTIAL / W02、W04 未执行**，不能称整个功能完成 |

`publish(expectedRevision, scope, candidate, events, actor, signal?)` 增加 events/actor 有实际用途：来源检查需要原始事件，model/user 权限用于 pinned 和 RESTORE。可作为合理接口细化交 R 固定契约版本；必须由可信适配层提供完整官方事件及 actor，不能允许 renderer/模型自行声称 user。scope.generation 的数字字段与草案相容，但当前测试使用合成代次；从官方 Session/query 获取稳定代次、重绑定策略和事件连续前缀证明仍需 T04/R。不得用进程 ID 或数据库全局计数代替官方能力。接口新增不构成官方 SessionEventMap/持久 Session schema 修改；无需把新 Notebook 格式误记成 Session 格式升级。

handoff 的 13 个 v2 用例加 17 个相关用例共 30 可复现，其“仍是库导出、runtime v1”和 W02/W04/W05 清单准确。settings 保持 v1 是范围事实，不能据此宣称 v2 配置已经消费。必须修正迁移完整幂等、取消不发布、残留尾部下一次发布可靠截断等无条件描述，分别对应 F3/F4/F1；磁盘风险描述应包含 F2 的缓存过计量。双语 README 声称写入顺序为 immutable 然后 append，而代码 :441–442 是 append 然后 immutable；应按修复后的协议同批调整 pairing。本轮不替作者修改文档，也没有独立重跑其全仓 1168 pairing 记录。

## 运行证据

所有 shell 命令、cwd、退出码及异步完成见 [命令清单](../../../.build/dispatch/evidence/T03-review-1/commands.json)。初始作者目录只读命令遇到沙箱启动失败，记录 NOT_STARTED；同命令窄范围 host 重试成功。无关不存在路径的 read/rg 错误与输出截断保留，相关实际路径已重新读取，不算功能测试失败或 PASS。

| 验证 | 实际执行及结果 | 证据 |
|---|---|---|
| 作者相关回归 | vitest run notebook、notebook-v2、context-integration、history-evaluation、settings；5 文件 30/30，退出 0 | [focused-baseline.log](../../../.build/dispatch/worktrees/T03/.build/dispatch/evidence/T03-review-1/focused-baseline.log) |
| 类型 | `node node_modules/typescript/bin/tsc -b packages/nidofy/desktop-extras/tsconfig.host.json`；退出 0 | [tsc-host.log](../../../.build/dispatch/worktrees/T03/.build/dispatch/evidence/T03-review-1/tsc-host.log) |
| lint | oxlint --config .oxlintrc.json，notebook.ts、shared/notebook-types.ts、notebook-v2.spec.ts；退出 0 | [oxlint.log](../../../.build/dispatch/worktrees/T03/.build/dispatch/evidence/T03-review-1/oxlint.log) |
| 独立故障复现 | review 副本 vitest run roadmap-review-T03-diagnostics.spec.ts；初版 4/4、增加迁移等待取消后最终 5/5，均退出 0 | [最终日志](../../../.build/dispatch/worktrees/T03-review-1/.build/dispatch/evidence/T03-review-1/diagnostics-final.log) |
| 审查副本依赖 | 主目录锁定 pnpm 入口 install --frozen-lockfile --offline；退出 0 | [安装日志](../../../.build/dispatch/worktrees/T03-review-1/.build/dispatch/evidence/T03-review-1/pnpm-frozen-offline.log) |

各测试设置 `TEMP=TMP=<对应目录>/.build/dispatch/tmp/T03-review-1`、`DSH_HOME=<对应目录>/.build/dispatch/test-home/T03-review-1`，命令完整文件列表与步骤在 JSON。诊断限定 mock writeFile/atomic-write 故障阶段，其他真实目录 I/O 保留；取消用真实 AbortController 和受控 admission。mock 不能证明真实断电、跨进程、Loader 或产品消费者已集成。

未执行：真实 Loader/profile、用户真实迁移、T04/T05/T06 消费端行为、全量 test/coverage/doc-sync/build/hygiene、跨进程并发与断电恢复。文档 pairing 全量及 v2 的 model-visible keyless Session 输出也 **NOT_RUN**；运行时未换 v2，原 integration 测试只证明 v1 未回归。

## 集成与 T04 前置能力

类型/API 细化与正常 active/history 行为可作为 R 的设计和适配输入，审查材料及复现可接收；**NotebookV2Store 整体业务交付须先修 F1–F4 并更新交接/双语协议描述，再独立复核**。当前不能把 library 可调用写成 library 已可靠验收。根规则不允许把只存在新类视为完整功能，整条 Notebook 需求仍 PARTIAL。

W02：由 R 同批切换 working-notebook Config/预算传入、context readActive/status、Panel 类型/history 展示、模型输入包装字节与可重建日志，并串行更新 T25 退休预算特征化断言。W04：由 T04/R 把候选 baseRevision、成功 end/summary、官方持久 Session provider+writer/flush、双游标消费及稳定 generation 接入；提供两 pending 候选及 orphan-summary 受控注入。W05 的全局 quota owner 尚未就绪；默认 local admission 是适配点，不等于多 Host 全局额度实现。

T04 已有可研究/编译的 v2 类型和 publish/readActive/readHistory 接口、原 v1 context/compaction 及官方 Session 能力源码，可做候选提交设计与独立适配原型。其正式依赖的可靠 v2 durable CAS/history/cursor 提交前置尚未通过（F1–F4，且未集成），官方 generation 与成功持久提交的实际消费接线也未完成，**不能标 T04 依赖已满足或正式联验可启动**。先修库并经 R 接收，再落实 W04 所需真实能力和隔离环境；本报告不自动启动 T04。T01 的失败不改变这个独立判断。

两份新报告的 scoped AST 链接/anchor、段落换行、concrete-terms 和维护引用检查退出 0；校验未解析或匹配提交号。主目录 git diff --check 退出 0，作者 T01/T03 工作树最终仍干净；两个审查副本各仅新增自己的诊断测试。见 [文档检查日志](../../../.build/dispatch/evidence/review-T0103-doc-validation.log)。此检查不替代未执行的全仓文档校验。

## Dev Note

本报告由独立审查者写入主目录，作者工作树未修改。故障副本与日志保留在 Electron 内，后续按作者实际修复重跑相应窗口；本报告不代表安装、发布或主线集成。
