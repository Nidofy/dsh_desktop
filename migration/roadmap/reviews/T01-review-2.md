# T01 独立审查，第 2 轮

## Summary

结论：**NEEDS_FIX**。首轮 F1、F2 和 F4 的原始复现路径已关闭；F3 的异步路由窗口已修，但同步通知仍可读到混合 appliedRevision，保持 PARTIAL。F5、F6 的整项验收仍 PARTIAL。新增 F7 / P2（cleanupRecord 失实）和 F8 / P1（GC 期间新租约的引用被删除）须交回作者修复。2026-10-05（Asia/Shanghai）独立重跑作者相关测试 **60/60**、host/client typecheck 与 scoped lint，退出均为 0；独立副本 **3/3 诊断成功复现问题**，不构成功能通过。

保留 [首轮报告](T01-review-1.md)。本轮没有修改作者业务代码、测试或 handoff，没有合入实现、推送、启动其他模型或更新 R 登记。T03 的结果另见 [第二轮报告](T03-review-2.md)，不影响本结论。

## Table of Contents

- [对象与环境](#对象与环境)
- [首轮发现复核](#首轮发现复核)
- [未解决及新增发现](#未解决及新增发现)
- [交接与集成条件](#交接与集成条件)
- [运行证据与限制](#运行证据与限制)
- [Dev Note](#dev-note)

## 对象与环境

对象为 Electron 内 `.build/dispatch/worktrees/T01`，实际分支 `codex/roadmap-t01-connection-recovery`。审查前后作者工作树干净，staged/unstaged 和相关未跟踪文件为空。以当前源码、配置及相对首轮独立副本实际 HEAD 的 diff 检查，不匹配或校验 SHA。修复差异为 store/api/ui、撤回 index 变更、connection-backend、新 API 测试及 recovery/host/UI 测试、handoff；index.ts 相对集成分支净差异为 0。相对集成分支的 R 资料同步部分不算 T01 实现。

读取当前 AGENTS、适用 docs/packages 规则、REVIEW、SCOPE、HANDOFF_TEMPLATE、contracts-v1、ownership、wiring-queue、首轮报告及当前 handoff；沿用本会话已读的 architecture/testing/defensive-patterns 与 dsh-doc/dsh-prose-standard。相关业务目录没有额外下级规则。主目录原有八个 R 修改、台账和 T00/T25/首轮报告保留。

作者现有依赖可用且独立，沿用 Node 24.16.0/pnpm 11.7.0/helper 普通复制件，没有重复安装作者依赖、重建 helper 或校验其 digest。首轮技术接受仅覆盖源码测试环境，流程偏差与 Loader/发行资格限制继续保留。

新诊断只写入 `.build/dispatch/worktrees/T01-review-2`。创建前确认源干净、目标不存在，按实际作者分支创建并比较源实现差异为空，没有待审脏文件遗漏。副本独立 frozen/offline 安装退出 0（47.4 秒）；安装的 dsh bin 未构建警告保留。没有动首轮副本。作者与审查副本各设独立 TEMP/TMP/DSH_HOME，诊断使用合成秘密和真实隔离文件 I/O。

## 首轮发现复核

| 首轮发现 | 第二轮状态 | 当前证据 |
|---|---|---|
| F1 / P1：keep 从缓存复活失效秘密 | **CLOSED** | [store.ts:321](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L321) 从 desired 当前引用重新 get，缺失/拒绝统一 KEEP_CREDENTIAL_UNAVAILABLE；在 journal/stage 前执行。recovery:184/199 覆盖删除、get 拒绝、持久状态不变、replace 修复，普通独立引用和旧租约测试通过。 |
| F2 / P1：双故障丢失 staged-secret 回收义务 | **CLOSED，限定首轮路径** | [recover:264](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L264) 先记录 pending，再尝试 ledger；失败保留 journalObligation 并发布 committed，mutate:347 拒绝覆盖唯一 journal。recovery:293/323 同实例和冷重启路径通过。collect 另有 F7 观察失配，但未复现原来的义务丢失。 |
| F3 / P1：新 current 早于 keys/health | **PARTIAL / 未完全关闭** | desired 与公开 state 分离，apply(target) 最后交换，recovery:231/259 和 host:98 的延迟 save/revoke/真实 agent/request 通过，首轮无 Key 窗口消除。但 :307 的同步 publish 早于 :308 appliedRevision，正式 LLM 通知可见混合版本，见下。 |
| F4 / P2：collect 后健康含已退休项 | **CLOSED，限定首轮路径** | collect:454 经 apply(next) 同步剔除 keys/health 并递增健康版本；recovery:368/386 覆盖普通回收和预先存在的租约。此关闭不覆盖 GC 计划之后新 acquire 的竞态，新增 F8 未解决。 |
| F5 / P2：Host 宽泛 catch 假就绪/无修复 handler | **PARTIAL / 未关闭** | 旧 catch 已撤回；api:61 先注册 handler、:119 owner 安装失败保留 503 页面，API:135 真实文件故障回放通过；非 owner 错误上抛，API:159 通过。实际 Loader/ready/认证/卸载的 R 接线仍未执行，handoff 已准确保留 PARTIAL；其建议的新 catch 尚不能接受，见下。 |
| F6 / P2：用户行为与升级文档缺口 | **PARTIAL / 未关闭** | 4 个真实 HTTP 回放已补 keep/replace/legacy/409/400/invalid-state/503；UI 测试准确降为文案检查。没有执行页面 JS/DOM 用户流程或 keyless 可见输出记录，owning README/升级指南仍只有 handoff 提案，未落入实际产品文档。 |

CLOSED 只确认对应旧缺陷路径修复，不将整任务或包验收改成通过。源码测试的 HTTP listener 回放绕过正式 connection 认证入口，tools 为 registration-only stand-in，不能称已验证整条认证/Workbench/Loader 组合。

## 未解决及新增发现

### F3 / P2 残余：正式同步路由通知先看到新视图、旧 appliedRevision

位置：[store.ts:303](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L303)（303–308）、[runtime.ts:98](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/runtime.ts#L98)（98–102），官方 [LLM 通知:355](../../../packages/llm/llm/src/index.ts#L355) 与 commitRoutes:463–470。apply 交换 state/keys/health 后调用 publish，publish 调 registerAdapter/replace，官方同步触发 llm/adapters-updated，返回后才更新 appliedRevision。

触发：真实 Context+LlmRuntime 安装连接 owner，订阅 llm/adapters-updated，并在首次 save 的通知中调用 store.status。实际观察到新 current/available key、desiredRevision=1，但 appliedRevision=0；通知结束后才变成 1。完整视图的原子发布契约和 handoff 描述仍不成立，观察者会误判应用状态。此问题不是原来的异步 missing-key 窗口，残余优先级降为 P2。

最小修复：在调用任何外部发布/通知回调前提交全部公开观察字段，明确回调失败的 reconciliation 语义；回调读 status 必须属于同一版本。可复核测试：[诊断:29](../../../.build/dispatch/worktrees/T01-review-2/apps/desktop-host/tests/roadmap-review-T01-round2.spec.ts#L29)，已用正式 LLM 通知复现，修复后断言通知中 desired/applied 与路由/健康一致。

### F7 / P2：collect 双故障后误报 ledger，而唯一记录仍是 journal

位置：[store.ts:460](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L460)（460–471）、cleanupRecord getter:159–163。触发：旧无租约修订待收集，unset 失败，cleanup.json 写入也失败且此前没有 ledger。collect 保留 journal，但没有设置 journalObligation；实际 immediate status 为 cleanup-pending/ledger，文件系统却没有 cleanup.json。下一次 mutate 先 recover 后才改成 journal 并拒绝新保存。HTTP collect :102 直接返回这份失实视图，消费者无法准确观察当前新写限制。

最小修复：ledger 未落盘且 journal 是唯一恢复记录时立即设置相应 obligation/cleanupRecord；后续状态发布必须与实际持久记录一致。保留 journal，不依靠下一次调用修正观察。可复核测试：[诊断:43](../../../.build/dispatch/worktrees/T01-review-2/apps/desktop-host/tests/roadmap-review-T01-round2.spec.ts#L43) 复现；补 collect 返回、直接 status、下一次拒写和冷恢复一致性。没有发现该窗口已丢失引用，不能把 F7 写成原 F2 再次丢数据。

### F8 / P1：GC 决定退休后，仍发放有效租约并删除其秘密引用

位置：[store.ts:444](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L444)（444–458）、[acquire:414](../../../.build/dispatch/worktrees/T01/apps/desktop-host/src/connections/store.ts#L414)（414–434）。collect 一次性按 counts 选择 retired；随后 state 写盘、apply(next) 都异步，而 acquire 不经过该队列或退休围栏，仍从旧公开视图发放新租约。

触发：A→B 后 A 无租约可收集；collect 在 apply(next) 的 B get 等待时，另一请求 acquire(A) 成功；解除等待。实际 activeLeases=1，但 A 的修订和 backend 引用已经被 GC 删除。预先已有租约测试不能覆盖此排列，retention+lease 回收保证被破坏；晚到的旧修订请求/准备调用可能找不到保留 profile，引用也不能按租约保持。

最小修复：协调 acquire 与退休事务；在整个退休提交期间，要么将新租约纳入计划并保留修订/引用，要么在明确退休围栏下稳定拒绝 acquire，不能发出有效 lease 后再删其对象。仅在筛选前检查一次 counts 不足，简单把异步发布移回旧顺序也不能满足 F3。可复核测试：[诊断:64](../../../.build/dispatch/worktrees/T01-review-2/apps/desktop-host/tests/roadmap-review-T01-round2.spec.ts#L64) 已复现；补正式 old-revision prepare/request 与收集交错，租约成立期间 revision/profile/ref 均保留，release 后才回收。

## 交接与集成条件

handoff 的 60 例、类型与 lint 可复现；index 净差异 0、F5 待 R、工具 stand-in、浏览器/真实 Loader/Windows provider 未执行的披露准确。F1/F2 原始路径的修复描述可接受，但“同步交换全部字段”和“有效租约阻止回收”的无条件声明需按 F3/F8 修复后更新；cleanupRecord 也需覆盖 collect 双故障。

handoff 建议 R 对所有非 owner 安装错误再加 catch 的补丁不能直接采纳。api:125–126 的导入清单失败会上抛，而其现有 API 测试 :159–176 明确验证 status 仍返回 200/recovery=ready；没有聚合安装失败诊断。建议补丁注释“surface reports the failure”与当前事实相反，再 catch 会重新隐藏不可恢复错误。R 需保留 fatal 或先交付实际可见的安装降级诊断/清理与真实启动验收，不能只有 console.error。此为 F5 未决提案，不算已经改入代码的重复缺陷。

业务单元当前不可整体集成，先交作者修复 F3/F7/F8。F5/W01 与 F6 归属外文档提案继续交 R，不能因文件归属而免除整项验收。当前可接收审查资料与接口输入，未集成 store 不能作为已通过的消费者前置。

T02 官方 CredentialProvider 与 get/set/unset 能力已存在，可开展独立 provider 和身份/拒绝测试；T01 回收与完整发布尚未可靠验收，正式消费者联验前置仍未满足。T02 自身真实 Windows backend、W03 注册、环境与租用需另行验证，不自动启动。

## 运行证据与限制

全部命令、cwd、退出码、异步完成和沙箱错误见 [命令记录](../../../.build/dispatch/evidence/T01-review-2/commands.json)。初始两作者目录的只读命令因 helper 初始化失败未执行，记 NOT_STARTED；按根规则同命令 host 重试。一次不存在 registry.ts 的 rg 路径错误保留，真实 index.ts 重新读取；输出截断处重读相关源码，不算测试通过。

| 检查 | 实际结果 | 证据 |
|---|---|---|
| 9 文件相关 vitest | 60/60、退出 0；原八文件再加 connections-api | [focused.log](../../../.build/dispatch/worktrees/T01/.build/dispatch/evidence/T01-review-2/focused.log) |
| host/client typecheck | 锁定 pnpm run typecheck 完成、退出 0 | [typecheck.log](../../../.build/dispatch/worktrees/T01/.build/dispatch/evidence/T01-review-2/typecheck.log) |
| scoped lint | store/api/ui 和六个测试/helper 文件，退出 0 | [lint.log](../../../.build/dispatch/worktrees/T01/.build/dispatch/evidence/T01-review-2/lint.log) |
| 独立诊断 | 新副本 3/3、退出 0；断言缺陷实际存在 | [diagnostics.log](../../../.build/dispatch/worktrees/T01-review-2/.build/dispatch/evidence/T01-review-2/diagnostics.log) |
| 副本依赖 | frozen/offline 独立安装、退出 0 | [install.log](../../../.build/dispatch/worktrees/T01-review-2/.build/dispatch/evidence/T01-review-2/install.log) |

测试在对应目录设置 TEMP=TMP=`<cwd>/.build/dispatch/tmp/T01-review-2`、DSH_HOME=`<cwd>/.build/dispatch/test-home/T01-review-2`。精确文件列表与命令在 JSON。F3 使用真实 LLM runtime，F8 使用真实 store/文件与受控 get 门控，F7 限定模拟 ledger write 和 backend unset 拒绝；这些诊断不证明真实 Windows 后端或整机断电恢复。

NOT_RUN：真实 Loader/ready/认证、浏览器 JS/DOM、keyless 输出记录、T02 provider、多 Host 并发、断电/杀进程、全量 test/coverage/lint/doc-sync/build/hygiene。历史失败和流程偏差保留，不把源码 green 折算为集成或包资格。

## Dev Note

本报告由独立审查者写入主目录；首轮报告和副本保留。修复交回作者后再针对实际修改复核，R 接线需单独证据。
