# T03 独立审查，第 2 轮

## Summary

结论：**NEEDS_FIX**。首轮 F1/F2/F3/F4 的原始路径均 **CLOSED**；新增 F5 / P2：底层不可变文件写入留下半文件后，同一候选在同实例和冷重启均无法重试。当前不能整体集成 v2 库。运行时仍是 v1，整个 Notebook 需求继续 **PARTIAL / W02、W04 未接线**。2026-10-05（Asia/Shanghai）相关测试 **38/38**、Host face tsc、scoped lint 与一个 named README pairing 检查退出均为 0；独立副本 **1/1 诊断成功复现新缺陷**，不构成恢复通过。

保留 [首轮报告](T03-review-1.md)。本轮没有修改作者业务代码、测试或 handoff，未合入实现、推送、启动其他模型或更新 R 登记。T01 的结论独立见 [第二轮报告](T01-review-2.md)。

## Table of Contents

- [对象与环境](#对象与环境)
- [首轮发现复核](#首轮发现复核)
- [新增发现](#新增发现)
- [文档与交接](#文档与交接)
- [运行证据与限制](#运行证据与限制)
- [集成与 T04 前置](#集成与-t04-前置)
- [Dev Note](#dev-note)

## 对象与环境

对象为 Electron 内 `.build/dispatch/worktrees/T03`，实际分支 `codex/roadmap-t03-notebook-v2`。作者前后工作树干净，没有待审 staged/unstaged 或相关未跟踪文件。按真实文件和首轮副本实际 HEAD 的 diff 检查，不匹配或校验 SHA。修复差异仅 notebook.ts 的 v2 部分、notebook-v2.spec.ts、双语 README/pairing 与 handoff；v1、共享类型、context/compaction、working-notebook settings/Config/Panel 未改。初始受控同步 R 资料不算 T03 业务成果。

已读当前 AGENTS、适用 packages/docs、REVIEW、SCOPE、HANDOFF_TEMPLATE、contracts-v1、ownership、wiring-queue、首轮报告和当前 handoff；沿用本会话已读架构/测试/防御规则及 dsh-doc/dsh-prose-standard。相关业务目录无额外下级规则。主目录原有 R 修改、台账、历史审查均保留。

作者现有独立依赖实际可用，沿用 Node 24.16.0/pnpm 11.7.0，没有重复安装。新增独立副本 `.build/dispatch/worktrees/T03-review-2` 前确认源干净、目标不存在，按实际作者分支复制并确认实现差异为空。副本自身 frozen/offline 安装退出 0（49.1 秒），仅新增诊断；dsh bin 未构建警告保留，不能推为 profile 可启动。首轮技术接受仅用于源码测试，作者环境流程偏差与真实产品资格限制继续保留。

## 首轮发现复核

| 首轮发现 | 第二轮状态 | 当前实际证据 |
|---|---|---|
| F1 / P1：失败/取消后同实例重试错误 history 前缀 | **CLOSED，限定原始路径** | [notebook.ts:475](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L475) stat 实际日志并截断到 committed historyBytes；:497–500 在追加/immutable/current 失败后失效缓存。正式测试:342 三排列和 :376 相同候选重试均通过，冷读 active/history 一致。新半文件阻断另列 F5，没有复现原来的错误前缀提交。 |
| F2 / P2：峰值当净增、重启预算不同 | **CLOSED** | :485–489 分开 peak，:511–512 按 journal、新 immutable 和 current 新旧差计算净增。测试:393 在 ==/−1 边界核对重启同判，:424 核对真实目录增长和失败残留后计量，均通过。 |
| F3 / P2：迁移 current 失败反复新增副本 | **CLOSED，限定完整 immutable 已写窗口** | :293–324 内容派生名与相同字节复用，:593–605 相同 journal/immutable 跳过额外写入预留；测试:447 连续两次 pointer 失败仍一份 revision，恰容预算重试成功且 v1 字节不变。半 immutable 写入不是该测试覆盖范围，见 F5。 |
| F4 / P2：迁移 admission 等待取消仍提交 current | **CLOSED** | :396 将 signal 传入 loadScope/migrateScope；:573/:599/:604 分别检查读取后、admission 后与 pointer 前。测试:483 等待期间 abort，v2 目录不存在、v1 不变，无取消重试完成。纯读触发转换无 signal 的行为已明确写进 JSDoc。 |

首轮四条 CLOSED 不表示“任意写失败均可恢复”。正常循环、退休 ID、来源校验、单实例 CAS、UTF-8 预算及 v1 回归继续通过；候选成功 flush/连续事件前缀和正式 generation 属 T04/R 消费者责任，未由库单测替代。

## 新增发现

### F5 / P2：半写的内容寻址 immutable 残留永久阻断相同候选重试

位置：[notebook.ts:310](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L310)（writeStateFile 310–324）、stateFileMatches:299–301、publish:494–500、migration:603。直接 writeFile(..., flag:'wx') 在最终内容派生路径写入；底层可能创建文件并写入部分字节后拒绝。失败失效缓存只能重测目录，不能修复这个命名残留。

触发：已提交 revision1；发布 revision2 的不可变文件实际写入短 JSON 前缀后抛错；解除底层故障，再用相同候选重试。实际旧 current 仍合法且 readActive=1，但 stateFileMatches 返回 false；writeStateFile 的 wx 遇 EEXIST/EPERM，读回短文件后抛 NOTEBOOK_CORRUPT_STATE。同实例与冷重启均重复拒绝。原数据未被错误发布，但正常重试无法前进；lazy migration 复用同一 helper，存在同类风险。作者注入只在 writeFile 前抛错或完整写完后 abort，漏掉文件已创建、内容不完整的失败窗口。

最小修复：不可变修订先写完整临时文件，再以不覆盖已提交文件的协议发布最终名，使最终路径不出现半文件；对已经存在的 malformed 残留，仅在可靠证明未提交时隔离/重建，不能无条件覆盖 EEXIST 文件或改写旧已提交代次。保留有界 retry 与准确 peak/net 计量。

可复核测试：[独立诊断:25](../../../.build/dispatch/worktrees/T03-review-2/packages/nidofy/desktop-extras/tests/roadmap-review-T03-round2.spec.ts#L25) 已复现：限定 wrapper 真实写入 `{"schemaVersion":2` 后拒绝，再解除，检查 current 保持 revision1、相同候选在 warm/cold 均 CORRUPT。修复后应验证同候选最终成功、cold active/history/immutable 一致、原 v1 不变，并补迁移的同类部分写。该模拟不宣称真实断电实测，文件创建与残留读取都是实际隔离 I/O。

## 文档与交接

handoff 的 v2 21 例＋相关 17 例=38、Host tsc、scoped lint 可复现；双语 README named pairing 独立检查通过。README 当前顺序为 append→内容寻址 immutable→原子 current，与源码一致；runtime 仍 v1、events/actor 由可信适配层提供、generation 获取/重绑定待 R/T04、W02/W04/W05 未执行的表述准确。

“任何磁盘阶段失败/中止同实例即恢复”“内容寻址 immutable 重试有界幂等”应收窄或在 F5 修复后再保留。history.jsonl 仍是固定路径文件，其字节重用不等于文件名内容寻址，不应将 journal 和 revision 的命名机制混为一谈。

handoff 的“v2 命名空间可整目录删除重迁”需加限制：仅未提交转换副本或明确放弃新版数据的独立试验；一旦 v2 已继续发布，删除会丢失 v2 新内容，不能作为产品回退操作。根规则要求保留已提交代次，旧程序应使用升级前副本/原 v1，不能承诺删除新版后无损重迁。这是 **P3 文档建议**，本轮未执行删除或真实用户迁移。

:575–580 只凭较高 revision 文件名判断 missing pointer，无法证明文件已提交而非 failed publish orphan；保守拒绝有利于不覆盖未知数据，但 handoff/JSDoc 应称“较高修订文件存在，提交状态未知”，不要以名字作已提交证据。没有单凭此处宣称跨进程或极端丢文件恢复通过。

作者记录 test:docs 20 过/1 败仍为其证据，本轮未重跑全仓 test:docs/doc-sync，不能写作本次独立结果；named pairing 通过不代表全仓文档 green。

## 运行证据与限制

全部 shell 命令、cwd、退出码、异步完成、初始沙箱未执行项见 [命令记录](../../../.build/dispatch/evidence/T03-review-2/commands.json)。两次初始作者只读命令 helper 初始化失败记 NOT_STARTED，同命令 host 重试。截断读取已针对相关源码重读；不存在路径的 rg 错误保留，未算 PASS。

| 检查 | 实际结果 | 证据 |
|---|---|---|
| 5 文件相关 vitest | notebook/notebook-v2/context-integration/history-evaluation/settings；38/38、退出 0 | [focused.log](../../../.build/dispatch/worktrees/T03/.build/dispatch/evidence/T03-review-2/focused.log) |
| Host face 类型 | tsc -b desktop-extras/tsconfig.host.json，退出 0 | [typecheck.log](../../../.build/dispatch/worktrees/T03/.build/dispatch/evidence/T03-review-2/typecheck.log) |
| scoped lint | notebook、shared types、v2 test，退出 0 | [lint.log](../../../.build/dispatch/worktrees/T03/.build/dispatch/evidence/T03-review-2/lint.log) |
| 双语记录 | verify-translation-pairing.ts 指定 desktop-extras/README.md，一个 named pair 一致，退出 0 | [pairing.log](../../../.build/dispatch/worktrees/T03/.build/dispatch/evidence/T03-review-2/pairing.log) |
| 独立诊断 | 新副本 1/1、退出 0，断言缺陷仍存在 | [diagnostics.log](../../../.build/dispatch/worktrees/T03-review-2/.build/dispatch/evidence/T03-review-2/diagnostics.log) |
| 副本依赖 | frozen/offline 独立安装，退出 0 | [install.log](../../../.build/dispatch/worktrees/T03-review-2/.build/dispatch/evidence/T03-review-2/install.log) |

各目录使用 TEMP=TMP=`<cwd>/.build/dispatch/tmp/T03-review-2`、DSH_HOME=`<cwd>/.build/dispatch/test-home/T03-review-2`。精确命令与文件列表在 JSON。故障测试只在新副本新增文件；mock 限定 revision 写入阶段，其他 I/O 和真实 store 不替换。

NOT_RUN：真实 Loader/profile、v2 运行时模型输入/keyless Session 输出、真实用户迁移、断电/进程杀死、跨进程/多 Host、全量 test/coverage/doc-sync/build/hygiene/T06 quota。单实例独占声明保持，不能把 quota owner 默认理解为已实现文件并发治理。

## 集成与 T04 前置

当前可接收类型/API 细化输入与审查材料，库整体须先修 F5、补 warm/cold/迁移部分写回归后复核，不能直接集成。events/actor 细化有实际验证用途，仍需 R 固定 contracts 版本；不存在自动获得官方 generation 或连续持久前缀的能力。

T04 已有可编译、正常路径可运行的 readActive/readHistory/publish 类型与库，以及官方 Session/原 v1 压缩代码，可做独立适配设计和测试原型；正式依赖的失败可重试持久提交仍有 F5，且 v2 尚未集成，因此不能标正式消费者联验前置已满足。T01 的结论不改变此判断。

W02 仍需 R 同批切换 Config/预算、context/status 活动投影、Panel/history、指令包装预算与可重建输入日志，并更新 T25 退休预算现状断言。W04 仍需候选 baseRevision/双游标、官方成功 end/summary/provider/writer/flush、稳定 generation、pending/orphan 受控注入；W05 默认 local admission 不等于 T06 多 Host quota。整体运行时需求保持 PARTIAL。

## Dev Note

本报告由独立审查者写入主目录，首轮报告与诊断副本保留。新增缺陷交原作者修复，后续只针对实际修复顺序复核，不与作者共写业务代码。
