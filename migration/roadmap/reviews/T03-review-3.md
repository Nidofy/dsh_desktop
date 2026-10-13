# T03 独立审查，第 3 轮

## Summary

结论：**NEEDS_FIX**。F1–F4 原始路径保持 CLOSED；F5 的新临时文件协议已关闭正常半写失败阻断重试路径，但“既存畸形文件可安全替换”的恢复条件仍不成立，**F5 整项 PARTIAL / 未关闭**。独立回放复现：实际已提交的修订事后被截断或改为未知版本，丢失 current 指针后冷恢复会覆盖它，违反保留已提交代次和拒绝未知版本的规则。须交作者修复后再接收库整体。2026-10-05（Asia/Shanghai）作者相关测试 **44/44**、Host face tsc、scoped lint、指定 README pairing 均退出 0；新独立诊断 **2/2 复现覆盖缺陷**，退出 0 不表示恢复安全通过。

保留 [第一轮](T03-review-1.md) 与 [第二轮](T03-review-2.md)。运行时仍 v1，整体 Notebook 需求维持 **PARTIAL / W02、W04、W05 未接线**。T01 的结果另见 [第三轮](T01-review-3.md)，不受本结论阻塞。本轮不改作者业务代码、测试或 handoff，未合入实现、推送、启动其他模型或更新 R 登记。

## Table of Contents

- [对象与环境](#对象与环境)
- [历史发现复核](#历史发现复核)
- [F5 残余与最小修复](#f5-残余与最小修复)
- [交接与文档](#交接与文档)
- [集成与 T04 前置](#集成与-t04-前置)
- [验证与限制](#验证与限制)
- [Dev Note](#dev-note)

## 对象与环境

对象为 Electron 内 `.build/dispatch/worktrees/T03`，实际分支 `codex/roadmap-t03-notebook-v2`。审查前后作者工作树干净，没有 staged/unstaged 或相关未跟踪文件。按实际代码、配置与第二轮副本实际代码状态比较，不匹配或校验 SHA。增量六文件：notebook.ts、notebook-v2.spec.ts、双语 README、pairing 记录及 handoff；未改 v1、共享类型、context/compaction、working-notebook settings/Config/Panel。历史 R 资料同步不是 T03 实现。

读取当前 AGENTS、适用 packages/docs、REVIEW、SCOPE、HANDOFF_TEMPLATE、contracts-v1、ownership、wiring-queue、前两轮报告与当前 handoff；沿用本会话已读架构/测试/防御规则及 dsh-doc/dsh-prose-standard。主目录用户/R 修改和前两轮报告、副本保留。

沿用作者现有独立可用依赖，无重复安装；Node 24.16.0、pnpm 11.7.0、Vitest 4.1.8。环境技术接受限源码测试，不扩大到真实 profile/发行资格。新增故障诊断只在 `.build/dispatch/worktrees/T03-review-3`：创建前确认源干净、目标不存在，按实际作者分支创建并确认源代码差异为空；新副本 frozen/offline 独立安装退出 0（43.8 秒），dsh bin 未构建警告保留。没有遗漏源脏文件，也没把第二轮旧副本误作当前实现。测试数据在各自 Electron 内隔离 TEMP/TMP/DSH_HOME。

## 历史发现复核

| 发现 | 第三轮状态 | 实际证据与边界 |
|---|---|---|
| F1：失败后同实例提交错误 history 前缀 | **CLOSED，限定原路径** | publish 重测/截断 committed historyBytes、失败失效 cache 的实现保留；原三排列及同候选 current 失败重试重跑通过，冷读 active/history 一致。 |
| F2：峰值当净增、重启预算不同 | **CLOSED** | peak/net 分离实现保留；==/−1、实际目录净增、失败残留与冷重启同判测试通过。本次临时文件/近限计量回归也通过。 |
| F3：迁移 pointer 失败反复新增 immutable | **CLOSED，限定原完整文件窗口** | 内容派生名、相同字节复用、有界 pointer 重试与恰容预算测试保持通过，v1 原字节不变。 |
| F4：admission 等待取消仍迁移提交 | **CLOSED** | 迁移仍接收 signal，在 admission 后与 pointer 前检查；取消零写入回归通过。plain read 完整执行转换的语义已明确。 |
| F5 / P2：半 immutable 最终文件阻断同候选重试 | **PARTIAL，整项未关闭** | [writeStateFile:357](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L357) 已先写完整专属临时文件再 rename；warm/cold/迁移临时部分写、近限计量、完整异内容文件拒绝的六个新用例通过。原来的普通部分 writeFile 失败不再产生半最终名。但已有畸形文件的替换没有可靠未提交证明，见下。 |

正常循环、活动预算、退休 ID、来源校验、取消、单实例 CAS、v1 回归也重跑通过。已有 green 不覆盖 committed 文件损坏后的恢复分类，更不证明真实断电或运行时切换。

## F5 残余与最小修复

**优先级 P2 / 实现与持久数据恢复缺陷。** 位置：[completeStateShape:304](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L304)（304–330）、[writeStateFile:357](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L357)（359–365）、[migrateScope:623](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L623)（623–651）。任何解析/字段验证失败或 schemaVersion!=2 都返回 false；writeStateFile 仅拒绝“完整 v2”，其余存在文件由 rename 直接覆盖。迁移 missing pointer 只拒绝较高修订名，同于 legacy.revision 的实际已提交文件无法被该条件保护。源码“malformed file is never a committed artifact”的前提错误。

触发与实际证据：[新独立诊断:18](../../../.build/dispatch/worktrees/T03-review-3/packages/nidofy/desktop-extras/tests/roadmap-review-T03-round3.spec.ts#L18)。先由真实 NotebookStore 写 v1，再由真实 NotebookV2Store.readActive 完成 revision1 转换，验证 immutable 字节等于已发布 current，关闭；然后分别将该 immutable 截断为 18 字符或保留完整 JSON 但设 schemaVersion=99，再移除 v2 current 指针。冷实例 readActive 自动重迁，同名旧修订被换成 v2 候选，损坏/未知版本原字节不再保留。两个排列 **2/2 实际复现**；没有 mock 文件 API，损坏与恢复都是隔离真实 I/O。v1 原字节仍保持，因此不夸大为本例已丢失 note 内容。

实际影响：修订曾提交这一事实不能由其当前可解析性推断；数据损坏或未知版本可能被静默改写，破坏已提交代次保留、取证与拒绝未知格式的保证。该路径没有可靠 current 链可供证明，handoff “可从 current 链与 journal 重建，不丢事实”在此条件不足。问题延续第二轮 F5 修复要求中“不覆盖已提交文件、仅可靠证明未提交时重建”的未满足部分，不是原半写仍永久阻断的重复宣称。

最小修复交原作者：保留临时文件优先协议；对已存在且异内容的最终文件，不能仅凭 parse/schema 验证失败决定替换。无法可靠证明未提交时保留原字节、明确拒绝并交人工诊断；若设计受控修复需独立可信的未提交证据，不能用名字或“当前不完整”替代。未知版本必须拒绝、不得自动降写为 2。修正 JSDoc/README/handoff 中“畸形即未提交”与无条件已提交文件不改写的表述。

可复核测试：保留普通 warm/cold/迁移临时部分写能重试的六项；增加上述实际已提交后损坏+pointer 丢失两项，期望冷读拒绝并保留 immutable 原损坏/未知字节，不生成新 current、不改 v1/history。仍可复用完全相同字节的既存文件；继续验证完整异内容文件拒绝及峰值/净增/近限预算。新诊断当前断言“缺陷被复现”，作者回归应改成安全期望，不能把现有诊断 2/2 当通过。

## 交接与文档

handoff 的 44 例、Host tsc、scoped lint 与 named README pairing 均可复现；运行时仍 v1、events/actor 需可信适配层、generation 归 T04/R、未执行产品验收的披露准确。删除整个 v2 的回退建议已限定为未提交副本或明确放弃数据的隔离试验；该文档建议已落实。

F5 “已提交代次文件不改写”“畸形最终残留可安全修复”仍与上面的实际路径矛盾；风险段虽提及事后截断，但将自动重建当作不丢提交事实，不能代替未提交证明。应更新交接，不登记 F5 整项已关闭。

另有 **P3 文档残余**：[migrateScope JSDoc:608](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/notebook.ts#L608) 仍称 journal 与 immutable 都 content-addressed，:610/:623 仍称 higher committed revisions；实际 history.jsonl 固定路径，较高文件名只能说明提交状态未知。handoff/README 已修正文案但 JSDoc 未同步；最小修复为一致使用“journal 字节复用 / immutable 内容派生名”“较高修订文件，提交状态未知”。这不另行推导已经提交或丢失数据。

## 集成与 T04 前置

当前可接收 API/类型与审查资料作为设计输入；**库整体须先修 F5 残余并复核，不建议把当前自动覆盖恢复协议集成**。正常 v2 库可编译、可调用，但故障恢复资格未满足；本轮未合入任何实现。

T04 所需 readActive/readHistory/publish、官方 Session、原 v1 压缩路径均已存在于相应源码，可继续独立适配设计与受控原型；正式使用可靠持久提交的前置仍受 F5 阻塞，且主目录未合入 v2。T01 通过与否不改变这一独立判断。events/actor 细化和官方 scope generation 获取尚需 R 固定契约及接线；不能将手填 generation、模型自称 user 或普通单元的 events 数组当官方成功 flush 前缀。

[context.ts:40](../../../.build/dispatch/worktrees/T03/packages/nidofy/desktop-extras/src/context.ts#L40) 仍构造 NotebookStore（v1）；Config/settings/Panel、活动投影/status、指令包装预算与可重建模型输入日志待 W02；候选 baseRevision/双游标、成功 end/summary/provider/writer/flush、官方 generation、pending/orphan 注入待 W04；T06 quota 待 W05。这些明确列为运行时范围缺口，不能因库测试 green 把整个功能判完成。T25 特征化断言需要 R 同批更新，没有本轮回写或虚构该联验。

## 验证与限制

全部命令、cwd、退出码、异步完成及入口未执行项见 [命令记录](../../../.build/dispatch/evidence/T03-review-3/commands.json)。诊断只新增在独立副本，作者目录保持干净。

| 检查 | 独立实际结果 | 证据 |
|---|---|---|
| 5 文件相关 vitest | notebook/notebook-v2/context-integration/history-evaluation/settings，**44/44，退出 0** | [focused.log](../../../.build/dispatch/worktrees/T03/.build/dispatch/evidence/T03-review-3/focused.log) |
| Host face 类型 | tsc -b desktop-extras/tsconfig.host.json，退出 0 | [typecheck-host.log](../../../.build/dispatch/worktrees/T03/.build/dispatch/evidence/T03-review-3/typecheck-host.log) |
| Scoped lint | notebook/shared types/v2 test，退出 0 | [lint.log](../../../.build/dispatch/worktrees/T03/.build/dispatch/evidence/T03-review-3/lint.log) |
| 双语记录 | 指定 desktop-extras/README.md，一个 named pair 一致，退出 0 | [pairing.log](../../../.build/dispatch/worktrees/T03/.build/dispatch/evidence/T03-review-3/pairing.log) |
| 独立故障诊断 | **2/2 复现缺陷，退出 0**；不算恢复安全通过 | [diagnostics.log](../../../.build/dispatch/worktrees/T03-review-3/.build/dispatch/evidence/T03-review-3/diagnostics.log) |
| 新副本依赖 | frozen/offline，退出 0 | [install.log](../../../.build/dispatch/worktrees/T03-review-3/.build/dispatch/evidence/T03-review-3/install.log) |

TEMP=TMP=`<cwd>/.build/dispatch/tmp/T03-review-3`，DSH_HOME=`<cwd>/.build/dispatch/test-home/T03-review-3`。早先 root tsc --noEmit 退出 0 不替代 Host face 检查，后者已独立完成。初次作者只读命令及后续一次主目录读取因 sandbox helper 初始化失败未执行，记录 NOT_STARTED，host 同命令重试；一次错误 baseline 路径读取保留为 READ_FAILED，后续读取正确文件。命令记录也保留同批 T01 诊断脚本错误，未算产品失败或 PASS。

NOT_RUN：真实 Loader/profile、v2 模型输入/keyless Session、用户数据迁移、跨进程/多 Host、断电/杀进程、全量 test/coverage/doc-sync/build/hygiene/T06 quota、受控 rename 拒绝/重试耗尽。已验证 Windows 本机普通 rename 与替换，但不将部分 writeFile 注入宣称覆盖所有文件系统失败。没有阻塞本轮源码审核的环境/资产缺口；阻塞是实际恢复实现缺陷及后续运行时接线范围。

报告写入后固定路径重读与两作者 git status 再检查退出 0，作者均仍干净，主目录仅增加本轮两报告并保留原修改。收尾自动链接/命令 JSON shell 解析检查因自动审批超过期限未启动（不是安全拒绝），记 NOT_RUN；简化为固定路径只读检查后完成。相关入口失败与成功命令均追加到命令记录，不将未知链接检查写作 PASS。

## Dev Note

本报告由独立审查者写入主目录，历史报告与诊断保留。F5 残余与 P3 JSDoc 一致性交原作者修复，再针对实际修改复核，不与作者共写业务代码。
