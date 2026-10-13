# T25 独立审查，第 2 轮

## Summary

结论：**REVIEWED**，限定 T25 修复交付单元。首轮 F1、F2、F3 均 **CLOSED**。2026-10-05（Asia/Shanghai）独立重跑三文件验收 **14/14**、五文件基线 **29/29**，退出码均为 0；为核对 handoff 的旧集合记录，补跑当前八文件共存 **43/43**，退出 0。三个正式文件 scoped lint 退出 0。没有新的 P1/P2 阻断发现；下列 P3 文档与失败清理建议不阻断本单元审查。

本结论不代表业务需求已实现、完整集成、真实 Loader/profile 或安装包验收。模型 adapter、凭据 backend 仍为合成实现；官方 Session writer/冷日志重放的源码测试通过，产品运行与发行资格仍 PARTIAL/NOT_RUN。首轮 [T25-review-1.md](T25-review-1.md) 保留不变，未修改作者测试、handoff、业务代码或 R 登记。

## Table of Contents

- [实际对象与范围](#实际对象与范围)
- [首轮发现复核](#首轮发现复核)
- [handoff 与非阻断建议](#handoff-与非阻断建议)
- [运行证据](#运行证据)
- [剩余限制](#剩余限制)
- [Dev Note](#dev-note)

## 实际对象与范围

审查对象为 Electron 内 `.build/dispatch/worktrees/T25`，实际分支 `codex/t25-independent-acceptance`。作者工作树在复核前后均干净；staged/unstaged 和相关未跟踪改动为空。符号父版本的修复 diff 仅三个文件：connections 验收、compaction 验收和 handoff，213 增/90 删；notebook 验收未改。相对集成分支仍只有三个验收文件与 handoff，无业务、原作者测试、manifest、lock 或公共接口改变。提交号不作为条件，没有计算或校验 SHA。

读取当前 AGENTS、适用 packages/docs 规则、REVIEW、SCOPE、contracts-v1、HANDOFF_TEMPLATE、首轮报告、当前测试和 handoff；沿用本会话已读取的 architecture/testing/defensive-patterns、dsh-doc 和 dsh-prose-standard。相关业务目录无额外下级 AGENTS。Electron 主目录原有 R 文档未提交改动和已有报告均保留；本轮只新增本报告及忽略目录中的隔离证据，没有创建新故障测试或改作者文件。

## 首轮发现复核

| 发现 | 状态 | 当前实际证据与结论 |
|---|---|---|
| F1 / P1：缺 Session provider/writer，live 查询不能证明持久提交 | **CLOSED** | [压缩验收:49](../../../.build/dispatch/worktrees/T25/packages/nidofy/desktop-extras/tests/roadmap-acceptance-compaction-boundary.spec.ts) 挂载官方 JsonlSessionPersistence；liveComposition:64–81 挂载 AgentLoop 并 create，官方 agent-loop index.ts:679–686、726–749 创建持久 handle。验收:129–130 检查 provider 存在、flush=true。冷用例:166–195 在拒绝期证明 Notebook revision/文件均为 0，dispose live 后，以官方 open(id,'read')/reader.read() 读回 summary 与无 error end，再恢复到 revision=1、一个 revision 文件；第二个全新上下文同步仍为 revision=1/一个文件。 |
| F2 / P2：仅检查解除失败后的终态 | **CLOSED** | [压缩验收:141](../../../.build/dispatch/worktrees/T25/packages/nidofy/desktop-extras/tests/roadmap-acceptance-compaction-boundary.spec.ts) 在 failing=true 整个窗口维持 session/flush 抛错；compactNow 的拒绝检查为 ManualCompactionError 且 code='persistence'。解除前直接 Notebook read=revision 0，revision 文件=0，status 本身拒绝相同注入错误；解除后一个 entry、revision=1、一个 revision 文件，多次同步不追加。未吞掉任意拒绝当成功。 |
| F3 / P2：configured 全 false 的无条件描述 | **CLOSED** | [连接验收:45](../../../.build/dispatch/worktrees/T25/apps/desktop-host/tests/roadmap-acceptance-connections.spec.ts) 丢第一个秘密时全部 false；:67–90 丢较后秘密时 primary=true、backup=false。两排列都检查 open 拒绝和无新 publish；后一排列 desired=2、applied=0。store.ts:141–150 顺序填 keys，:215–218 按 keys.has 投影，正好对应加载前缀。handoff:22、32 明确顺序依赖，不再作无条件全 false 声明。 |

F1 的 coldComposition:85–89 创建全新 Context，仅挂载 testkit、持久 provider、TokenMeter、SQLite query 与 Notebook hooks；没有 AgentLoop、模型 adapter、BasicCompactionEngine 或创建/恢复 Session。testkit index.ts:67–76 只安装空 SessionStore 等前置服务，SessionStore index.ts:926 的 Map 是每实例自己的空集合。保留已 dispose 的旧 agent 只用于读取 ID，没有注入 cold Context。

Notebook status→synchronize 的 context.ts:48–66 在没有 live Session 时通过官方 query 观察持久事件，只接纳同 compactionId 的成功 end+summary，并检查 baseRevision；Sqlite query index.ts:503–522 及 session-query/cold-read.ts:31–58 从官方持久 read handle 加载冷日志，不以 SQLite 搜索缓存代替。该冷上下文没有可生成新摘要的引擎，因此首次发布确来自已有持久日志。第二次重启时 baseRevision 已消费，不再次发布。

这里的恢复是**正常 dispose 排空后重新建 Context**。JSONL storage.ts:223–258、534–565 的 writer close 会 drain；测试没有证明杀进程、断电或底层磁盘失败。F2 注入的是公开 flush listener 的拒绝，不断言 JSONL provider 的磁盘写本身失败。

## handoff 与非阻断建议

F1/F2/F3 的核心描述、顺序差距、14/29 单独测试计数与实际路径吻合。待 T04/R 注入的两个 pending 候选/orphan-summary、预算阈值依赖文本以及真实 Loader/profile 未执行均有登记，没有把新需求或包资格标为通过。以下三项为 **P3 / 建议整理**。

| 项目、位置 | 触发与影响 | 最小建议及可复核方式 |
|---|---|---|
| N1：冷用例失败清理，[压缩验收:168](../../../.build/dispatch/worktrees/T25/packages/nidofy/desktop-extras/tests/roadmap-acceptance-compaction-boundary.spec.ts)–180；handoff:66 | liveComposition 返回后，首个 live.dispose 在:178；没有立即注册 onTestFinished(live.dispose)。若:171–176 的调用/断言失败，正常 dispose 不会执行，而 isolatedHome 已登记删除临时根。冷 reader 在 read 失败时也没有 finally close。handoff“每个用例经 onTestFinished 处置自身 fiber”对这些失败路径过强。当前成功复跑已清理；失败路径未注入，不称已验证。 | 作者立即登记 live 的幂等 dispose，reader 采用 try/finally 或公开 async dispose，并让资源释放先于目录删除。若补故障测试，在独立 review worktree 控制早期失败，观察 reader/Context 关闭和残留根，不在作者目录增改测试。 |
| N2：旧合并结果的适用版本，[handoff:53](../../../.build/dispatch/worktrees/T25/migration/roadmap/handoffs/T25.md) | 原 combined-unit2.log 为 08:01:10 的 42 条，其中 compaction=5；acceptance-unit2-final.log 08:02:06 才为 compaction=6/总14。该行虽明确写“13 旧集合口径”，被测状态“同上”和“与作者套件并发共存”仍易被当成当前14条全部并发证据。 | 保留42历史日志，把该行明确标为增加第六压缩用例前的历史结果；当前集合为29+14=43。本轮已实际补跑43/43；作者可引用该审查结果，不能改旧日志数字或声称作者已跑43。 |
| N3：首轮报告链接，[handoff:9](../../../.build/dispatch/worktrees/T25/migration/roadmap/handoffs/T25.md) | 作者 worktree 的 ../reviews/T25-review-1.md 实际不存在；首轮报告在 Electron 主目录。通过该链接无法取得声明的审查依据。 | 链接明确指向主目录已有首轮报告，或由 R 受控同步必要资料后再使用本地相对链接。以真实文件存在及 Markdown link checker 检查，不复制成作者自行改写的审查结论。 |

这些建议不改变本次 F1/F2/F3 关闭状态，也没有据静态失败清理分析声称发生了实际数据损坏或阻塞当前测试。

## 运行证据

所有测试在 T25 worktree 根执行，独立设置 TEMP/TMP=`<worktree>/.build/dispatch/tmp/T25-review-2`、DSH_HOME=`<worktree>/.build/dispatch/test-home/T25-review-2`，不复用作者 T25 测试根。Node=v24.16.0，本地 pnpm=11.7.0；已接受的独立依赖继续使用，未重新安装。native helper 已存在，作为普通复制件使用，没有重建、复制或摘要校验。

| 本轮实际执行 | 退出码与结果 | 原始证据 |
|---|---|---|
| 三文件 acceptance-unit2-final 命令 | 0；14/14，3文件，无 skip；3.69s | [acceptance-unit2-final.log](../../../.build/dispatch/worktrees/T25/.build/dispatch/evidence/T25-review-2/acceptance-unit2-final.log) |
| 五文件 baseline-unit2 命令 | 0；29/29，5文件，无 skip；2.58s，含现有 Windows native 两例 | [baseline-unit2.log](../../../.build/dispatch/worktrees/T25/.build/dispatch/evidence/T25-review-2/baseline-unit2.log) |
| 当前八文件共存 | 0；43/43，8文件，无 skip；3.58s | [combined-unit2-current.log](../../../.build/dispatch/worktrees/T25/.build/dispatch/evidence/T25-review-2/combined-unit2-current.log) |
| 三正式文件 scoped oxlint | 0；无 stdout/stderr | [oxlint.log](../../../.build/dispatch/worktrees/T25/.build/dispatch/evidence/T25-review-2/oxlint.log) |
| 作者 diff check、复跑后实际状态 | 0；作者 worktree 干净；本轮无作者业务/测试/交接修改 | 执行索引 |
| 本报告段落、术语、相对链接及最终状态检查 | 具体退出码见执行索引的最终记录 | [commands.json](../../../.build/dispatch/evidence/T25-review-2/commands.json) |

完整命令、cwd、退出码、异步执行最终状态、输出截断和非终止读取错误见执行索引。初次沙箱 helper setup refresh 在创建进程前失败，记 NOT_STARTED，原样宿主重试；不是测试失败或审批拒绝。误读 agent-loop-test、Session store.ts 和直连 @vitest/runner 路径的错误不算通过，已分别用实际 testkit、Session index.ts 与 .pnpm 路径核对。Vite 的 tsconfig-paths 提示保留，未修改配置。

## 剩余限制

- 两个 pending 候选竞态及 orphan-summary 异常组合仍 NOT_RUN，待 T04/R 定义注入位置与场景口径；不认证公开 API 永远不可达。
- 预算用例依赖当前来源截取、序列化和 instruction 文本；640/1000 是当前阈值，payload≈700、完整指令≈1400 是需校准的量级，不是本轮对所有边界的穷尽测量。
- 当前仍为 v1 现状特征化；六条旧行为断言在 T01/T03/T04 集成时由 R 同批更新。配额、scope、通知、UI、Live2D、出口与后续里程碑未由本单元验收。
- 全仓 typecheck/lint/test:docs/doc-sync、真实 Loader/profile/Shell、OS 凭据 backend、真实 LLM/计费、helper 源码构建、杀进程/断电恢复和最终发行包未执行。只把官方持久化源码组合的证据用于其实际测试范围。
- 没有修改 R registry/台账或合入待审文件；R 后续采用本轮结论时应保留首轮 NEEDS_FIX 与作者修复历史。本报告的 REVIEWED 不自动变为 INTEGRATED/QUALIFIED。

## Dev Note

本报告仅由本轮独立审查者写入。复核针对实际文件和消费者，不依赖作者摘要或提交号；没有启动其他模型、子代理、推送、合并或发布。历史作者失败/成功日志、第一轮报告和审查诊断均保留。
