# T01 独立审查，第 3 轮

## Summary

结论：**PARTIAL**。本次作者修复单元的 **F3 残余、F7、F8 均 CLOSED，可接受为 REVIEWED 的源码交付**；F1/F2/F4 历史关闭路径未回退。整项 T01 的 F5（实际 Host 接线与启动）和 F6（页面行为、认证、可见输出及产品升级文档）仍 PARTIAL，不能登记为整体完成或安装包合格。2026-10-05（Asia/Shanghai）独立重跑 9 文件 **65/65**、正式 host/client typecheck、scoped lint 均退出 0；新独立副本的正式路由注册失败/恢复诊断 **1/1** 退出 0。没有新增必须交作者修复的实现缺陷。

保留 [第一轮](T01-review-1.md) 与 [第二轮](T01-review-2.md)。T03 的结论独立见 [第三轮](T03-review-3.md)，不影响本结论。本轮未修改作者业务代码、测试或 handoff，未合入实现、推送、启动其他模型或更新 R 登记。

## Table of Contents

- [对象与环境](#对象与环境)
- [发现复核](#发现复核)
- [失败发布与交接](#失败发布与交接)
- [集成与 T02 前置](#集成与-t02-前置)
- [验证与限制](#验证与限制)
- [Dev Note](#dev-note)

## 对象与环境

对象为 Electron 内 `.build/dispatch/worktrees/T01`，实际分支 `codex/roadmap-t01-connection-recovery`。作者目录检查前后干净，staged/unstaged 与相关未跟踪文件为空。按实际内容与第二轮审查副本实际代码状态比较，不匹配或校验 SHA；增量为 store.ts、三个测试文件与 handoff，共五文件。index.ts 相对实际集成分支 `codex/roadmap-integration` 净差异为 0；api/ui/runtime/connection-backend 本次未改。作者 handoff 的修复范围准确。

已读当前 AGENTS、适用 packages/docs 规则、REVIEW、SCOPE、HANDOFF_TEMPLATE、contracts-v1、ownership、wiring-queue、历史报告与当前 handoff；沿用本会话已读 architecture/testing/defensive-patterns 与 dsh-doc/dsh-prose-standard。主目录原有八个 R 修改、台账和历史报告全部保留。

沿用作者已经可用的独立依赖与普通 helper 复制件，不重复安装作者依赖、重建 native helper 或重新校验 digest；65 例中的两项真实 native 基线实际运行。原有环境技术接受只用于源码测试，不扩大为真实 Loader/发行资格追认。Node 24.16.0、锁定 pnpm 11.7.0、Vitest 4.1.8。

新增故障诊断仅在 `.build/dispatch/worktrees/T01-review-3`。创建前确认源干净、目标不存在，按实际作者分支创建并比较实现差异为空；没有遗漏待审脏文件。新副本自身 frozen/offline 安装退出 0（48.9 秒），独立 node_modules；dsh bin 未构建警告保留。第二轮与第一轮副本未改。作者与副本各用独立 TEMP/TMP/DSH_HOME，全部数据使用合成秘密和 Electron 内真实隔离 I/O。

## 发现复核

| 发现 | 第三轮状态 | 实际证据与边界 |
|---|---|---|
| F3 / P2：正式同步通知混合 appliedRevision | **CLOSED** | [apply:313](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L313) 同步交换 state/keys/health/healthRevision/appliedRevision，再于 :318 调 publish；此前异步解析继续保留旧完整视图。真实 LlmRuntime 通知内读取 status 的 [host:132](../../../.build/dispatch/worktrees/T01/apps/desktop-host/tests/connections-host.spec.ts#L132) 通过，全部通知 desired/applied 同版本。回调失败语义另见下文。 |
| F7 / P2：collect 双故障误报 ledger | **CLOSED** | [collect:491](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L491) 在退休引用 unset 失败且 ledger 未落盘时即时设置 journalObligation。store [recovery:442](../../../.build/dispatch/worktrees/T01/apps/desktop-host/tests/connections-recovery.spec.ts#L442) 与真实 HTTP [api:170](../../../.build/dispatch/worktrees/T01/apps/desktop-host/tests/connections-api.spec.ts#L170) 核对 collect 返回、直接 status、拒写、实际 journal/ledger 文件与解除后清理，均通过。 |
| F8 / P1：GC 发出新有效租约后删引用 | **CLOSED** | [collect:460](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L460) 筛选时排除已持租约，:463 在退休事务首个 await 前设置围栏，覆盖 journal/state/apply，finally 清除；[acquire:430](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L430) 同步拒绝围栏内新租约。受控门控 [recovery:406](../../../.build/dispatch/worktrees/T01/apps/desktop-host/tests/connections-recovery.spec.ts#L406) 和正式 [prepare:148](../../../.build/dispatch/worktrees/T01/apps/desktop-host/tests/connections-host.spec.ts#L148) 通过：期间 CONNECTION_RETIRING，完成后 archive 路由 NO_ADAPTER、store CONNECTION_RETIRED，当前连接可用，无账户/模型回退。预先已有租约测试继续通过。 |
| F1、F2、F4 | **CLOSED，保持此前对应路径范围** | keep 重读 backend、双故障恢复义务/冷启动、退休后 keys/health 剔除的回归均重跑。未发现本次增量回退；不是任意磁盘/进程故障均已验收。 |
| F5 / P2：Host 兜底与修复面整项 | **PARTIAL，未关闭** | 作者原宽泛 catch 未恢复，index 无净改动；API owner 失败 503 与非 owner 错误上抛的单元回放继续通过。实际 Loader/ready/认证/卸载、聚合诊断和部分安装清理仍归 R，未执行。 |
| F6 / P2：用户行为与升级文档整项 | **PARTIAL，未关闭** | HTTP/agent/prepare 消费者与文案测试有实际证据；页面 JS/DOM、正式认证、keyless 输出及 owning README/升级指南尚未完成。handoff 准确披露，不用 copy 检查替代用户行为。 |

没有新增作者实现修复项；关闭结论仅适用于上述具体路径。围栏拒绝新旧修订请求是明确、稳定的新行为，R 需登记 `CONNECTION_RETIRING` 的消费语义。

## 失败发布与交接

[apply JSDoc:285](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L285) 明确：公开观察先提交，publish 失败时路由注册可能滞后，下次 apply/recover 重注册。契约中 appliedRevision 表示已发布可用性视图，并不保证每条路由可发请求；不据“值已推进”单独判定缺陷。

新 [独立诊断:18](../../../.build/dispatch/worktrees/T01-review-3/apps/desktop-host/tests/roadmap-review-T01-round3.spec.ts#L18) 使用真实 Context/LlmRuntime/连接 owner，在首次正常 save 后由另一注册者占用 nidofy-two，迫使正式 registration.replace 在准备阶段抛 DUPLICATE_ADAPTER。实际 mutate 拒绝，durable state 与 journal 均为 revision2，status(operationId) 显示 committed=true、desired/applied=2、健康 available，但新 archive 路由 prepare 抛 NO_ADAPTER；移除冲突后 inspect 成功注册、清除 journal，持久 revision 仍为 2，没有第二次提交。此限定故障恢复与 handoff 一致，不能把 status ready/available 解释为注册成功，更不能以错误自动重发副作用。

handoff 的 65 例、类型与 lint 结果可复现。已撤回“对所有非 owner 安装失败再 catch”的建议；F5 的保持 fatal 或先交付真实降级诊断/清理/Loader 验收两个方案准确。F6 仍只有交 R 素材而非产品文档；没有发现当前交接把这些缺口无条件声明为完成。

## 集成与 T02 前置

可接受本次 store 修复和相关 API/runtime/测试源码交付，R 可安排受控集成；**本轮未合入**，不能直接登记整项 T01 已完成。继续集成前固定 cleanupRecord、CONNECTION_RECOVERY_PENDING、CONNECTION_RETIRING 等接口细化；W01/实际 Host 引导、F5 与 F6 验收必须单独完成，不能再用 broad catch 掩盖非 owner 错误。

T02 所需官方 CredentialProvider/get/set/unset 和 T01 正常/失败/租约消费者能力已在待审源码具备，本次 F3/F7/F8 不再阻塞其独立开发。集成主目录尚未合入这些修复，正式联验仍需 R 集成及 W03 注册；真实 Windows 后端、权限/身份/拒绝行为要由 T02 自身验收。没有自动启动 T02。

## 验证与限制

全部命令、cwd、退出码、异步完成及未启动错误见 [命令记录](../../../.build/dispatch/evidence/T01-review-3/commands.json)。原始测试/静态日志与新诊断分别保留在作者/审查副本自己的 evidence 目录。

| 检查 | 独立实际结果 | 证据 |
|---|---|---|
| 9 文件相关 vitest | **65/65，退出 0**；含两个真实 native 基线 | [focused.log](../../../.build/dispatch/worktrees/T01/.build/dispatch/evidence/T01-review-3/focused.log) |
| 正式 typecheck | pnpm run typecheck，host build/typecheck + client，退出 0 | [typecheck-full.log](../../../.build/dispatch/worktrees/T01/.build/dispatch/evidence/T01-review-3/typecheck-full.log) |
| Scoped lint | store/runtime/api/ui 与六个测试/helper 文件，退出 0 | [lint.log](../../../.build/dispatch/worktrees/T01/.build/dispatch/evidence/T01-review-3/lint.log) |
| 独立注册失败/恢复诊断 | 修正审查脚本后 **1/1，退出 0**；无实际网络请求 | [diagnostics-final2.log](../../../.build/dispatch/worktrees/T01-review-3/.build/dispatch/evidence/T01-review-3/diagnostics-final2.log) |
| 新副本依赖 | frozen/offline，退出 0 | [install.log](../../../.build/dispatch/worktrees/T01-review-3/.build/dispatch/evidence/T01-review-3/install.log) |

TEMP=TMP=`<cwd>/.build/dispatch/tmp/T01-review-3`，DSH_HOME=`<cwd>/.build/dispatch/test-home/T01-review-3`。初次 root tsc --noEmit 退出 0 但不替代正式构建检查；随后正式 pnpm typecheck 完成。新诊断首次把错误 code 当 message、第二次误用 prepareCall 参数签名，均退出 1，属于审查脚本错误；两个失败日志保留，按官方 code/config 签名修正后才得到最终 1/1。一次误写不存在的集成分支比较退出 1，随后按实际枚举分支重查为空。不存在 baseline 路径的读取错误虽整条 shell 最后退出 0，仍记读取失败，已从正确路径重读。沙箱 helper 初始化失败未执行，记 NOT_STARTED，同一只读命令经 host 重试。

NOT_RUN：真实 Loader/profile、ready/正式认证/卸载、浏览器 JS/DOM、keyless 输出、T02 真后端、跨进程/多 Host、断电/进程杀死、全量 test/coverage/lint/doc-sync/build/hygiene。合成 credential backend、工具 registration-only stand-in 和真实本机 HTTP 回放不证明产品整体集成；现有资源无阻塞本轮源码验证的环境/资产缺口。

报告写入后固定路径重读与两作者 git status 再检查退出 0，作者均仍干净，主目录仅增加本轮两报告并保留原修改。收尾自动链接/命令 JSON shell 解析检查因自动审批超过期限未启动（不是安全拒绝），记 NOT_RUN；简化为固定路径只读检查后完成。相关入口失败与成功命令均追加到命令记录，不将未知链接检查写作 PASS。

## Dev Note

本报告由独立审查者写入主目录，保留全部历史失败与限制。F5/F6 交 R 接线与补验收，T03 的缺陷交其作者；不与作者同时修业务代码。
