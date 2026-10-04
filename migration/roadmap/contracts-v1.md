# Roadmap 接口约定 v1

## Summary

本参考冻结首批 T01/T03 的最小实现义务，以及后续模块的消费关系。它是设计交付，不声明以下新类型已存在于运行时代码。作者状态为 READY_FOR_REVIEW；经独立审查和集成人员确认后供实施使用。接口修改只由集成人员登记版本、暂停相关写入并同步全部消费者，任务作者不得各自改名或改变语义。

## Table of Contents

- [共同规则](#共同规则)
- [连接可用性](#连接可用性)
- [Notebook 活动投影与双游标](#notebook-活动投影与双游标)
- [配额租约](#配额租约)
- [验证回执](#验证回执)
- [Companion 作用域](#companion-作用域)
- [通知身份](#通知身份)
- [版本与数据恢复](#版本与数据恢复)
- [Dev Note](#dev-note)

## 共同规则

草案用 `text` 代码块表示待实现字段，不是可导入 API。跨域身份使用已有 `Branded`；SessionId、SessionSeq 复用官方类型；其余 ID 由对应 owner 声明，不新增公共万能 ID 包。边界解析拒绝未知版本；同进程已类型化调用不重复伪造校验框架。所有数值预算为非负安全整数、字节为 UTF-8 实际字节，时间为 epoch 毫秒，空值明确表示未知或无对象。

Session 日志、Agent Loop、Shell、prepared-call/重试、权限及压缩事务仍归官方 owner。模型可见输入必须能从实际官方日志还原，摘要或哈希不能替代原输入。所有注册可释放；卸载先拒绝新请求，取消并等待在途工作排空。提交前取消无发布；进入不可逆持久提交后以 operationId 查询真实结果，不用取消错误断言未发生，也不自动重放副作用。

## 连接可用性

唯一 owner：T01 的 `ConnectionStore`；T02 只提供官方 CredentialProvider，T09/T10/T23 消费配置与状态，不能维护第二份 key 映射。当前证据见 [store](../../apps/desktop-host/src/connections/store.ts)、[runtime](../../apps/desktop-host/src/connections/runtime.ts)。现有 apply 遇缺 Key 抛错，status 仅有 configured；v1 草案要求配置加载与逐修订健康分开。

```text
RevisionAvailability =
  | { kind: 'available' }
  | { kind: 'missing-credential' }
  | { kind: 'backend-unavailable'; diagnosticCode: string }
  | { kind: 'revoked' }
RevisionHealth = { revisionId: RevisionId; availability: RevisionAvailability }
ConnectionObservation = {
  hostEpoch: HostEpoch; desiredRevision: number; appliedRevision: number;
  healthRevision: number; revisions: readonly RevisionHealth[];
  recovery: 'ready' | 'cleanup-pending' | 'invalid-state';
}
CredentialEdit = { mode: 'keep' } | { mode: 'replace'; value: string }
SaveConnection = {
  action: 'save'; operationId: OperationId; connection: ConnectionId;
  expectedRevision: number; profile: PiAiProviderProfile; credential: CredentialEdit;
}
```

`healthRevision` 只在本 hostEpoch 中单调；健康变化不写配置 revision。配置与所有修订可诊断，即使全部不可用也保持修复入口。生成完整新 key/health 映射后同步交换并发布，不能逐行暴露半应用映射。`appliedRevision` 表示已发布该配置的可用性视图，不表示所有连接可发请求；不可用路由稳定拒绝，不切账户、模型或环境凭据。已撤销项不读秘密；非活动/保留修订的缺 Key 不拖累健康连接。

keep 只针对 CAS 命中的该连接当前修订，创建新修订自己的秘密引用并复制解析到的值；不得让两个修订共享可被 GC 删除的秘密引用。keep 无当前修订、缺 Key、后端不可读则明确拒绝，需要 replace 修复；replace 必须为非空合法秘密。旧 wire `key` 由唯一 API 适配为 replace，混用 `key` 与 `credential` 拒绝；新请求不允许省略模式。秘密只停留在 Host/provider，状态/日志/导出不含秘密。

沿用 journal→stage secret→durable state→publish 的 operationId/CAS 顺序。未提交候选的 unset 失败保留待清理引用和诊断，可重试幂等清理而不阻断健康路由；不得清理已提交/current/在途租约仍引用的秘密。损坏目录保留原字节，以 invalid-state 暴露诊断并禁止覆盖保存；不能把解析失败当空目录。旧 A 请求与重试继续持有 A，新请求用 B；撤销在每次实际发送前检查。释放幂等，GC 等最后租约和保留窗口结束。未知提交先 inspect；超出 operationId 保留窗口只能 UNKNOWN，不能据“不在列表”自动重发。

## Notebook 活动投影与双游标

唯一格式/store owner：T03；候选选择与持久提交适配归 T04；增量消费归 T05。现有 [types](../../packages/nidofy/desktop-extras/src/shared/notebook-types.ts)、[store](../../packages/nidofy/desktop-extras/src/notebook.ts)、[context](../../packages/nidofy/desktop-extras/src/context.ts) 的 schemaVersion=1 只有 sourceThrough；退休项仍在 entries 内并参与完整 JSON 预算。新草案在 T03 先定义存储/投影，T04 再实现双游标推进，T05 不重定义语义。

```text
NotebookScope = { sessionId: SessionId; generation: SessionGeneration }
NotebookCursors = {
  evidenceThrough: SessionSeq | -1;
  commitThrough: SessionSeq | -1;
}
NotebookV2 = {
  schemaVersion: 2; scope: NotebookScope; revision: number;
  cursors: NotebookCursors; active: readonly Note[];
  historyRevision: number;
}
ActiveNotebookProjection = {
  scope: NotebookScope; revision: number; entries: readonly Note[];
}
NotebookBudgets = {
  maxActiveEntries: number; maxActiveBytes: number; maxDeltaBytes: number;
  maxEvidenceBytes: number; maxHistoryBytes: number;
}
NotebookRead = readActive(scope) -> committed ActiveNotebookProjection
NotebookHistory = readHistory(scope, pageToken?, limit) -> bounded page
NotebookCommit = publish(expectedRevision, scope, candidate, signal) -> committed NotebookV2
```

`generation` 标识实际观察的 Session 日志代次，不能用连接 ID 或进程 PID 代替。T04 必须从官方 Session/query 实际 API 取得或为其建立最小适配；缺能力登记接线，不假设 range API 存在。活动投影只包含 active 笔记，按 id 的固定序排列；同一已提交 revision 的投影字节稳定。模型快照完整包装/指令计入活动输入预算；历史只按需查询，不拼进注入。来源保留原 session/generation/seq/quote，退休、恢复、人工修正均可追溯；退休 ID 永不作为新事项复用。历史维护已用 ID 索引及修订记录，计入局部磁盘预算；达到上限拒绝新写并提供诊断，不删除旧证据来伪造无限容量。

`evidenceThrough` 是已经检查的连续原事件前缀；首版按序选取，不跳过未读的大事件推进水位。非证据事件可检查后越过；有截断摘录但未看完整原事件时不得宣称整条消费。超大单条明确 budget-skipped 并保留水位，等待用户调整或后续有版本的分片协议。`commitThrough` 是已持久判定的连续日志前缀，需等待关联 compaction/end 成功且 Session flush 完成；它不能表示“最近扫描到哪里”。不要求两水位大小关系，二者语义独立；同代次只能单调前进。若未来跳选，先版本化显式已处理区间，禁止把最大 seq 冒充连续前缀。

T04 以已提交 summary+end 为候选证据，验证 scope、baseRevision、policyRevision 和预算，再把活动集、历史索引与双游标作为一次原子发布。CAS 冲突、模型失败、取消、flush 拒绝、设置中途变更均不推进游标；终态中有效的“无变化”可提交空 delta，但仍有明确处理依据。失效候选诊断与消费确认不能混为成功发布。输出 no-new-evidence/budget-skipped/invalid-fallback/persisted 及额外调用数；任何重试沿用官方机制。

T03 保留 v1 `current.json` 与 revision 文件，复制验证后在独立 v2 命名空间发布选择指针。迁移不能无条件把旧 sourceThrough 视为已连续消费：它是旧机制的最大来源而非连续覆盖证明；保存 legacy 水位为迁移元数据，新 evidenceThrough/commitThrough 从 -1 开始，T04 对旧已发布候选按迁移映射去重。v2 历史含旧 revision/id 身份，未知格式或证据范围不全则拒绝发布，保留可修复诊断。重启识别已完整发布版本；半写临时文件不成为 current。历史空间预检包含临时双份字节，给 T06 留单一存储准入适配点，T03 不自建跨进程配额。

## 配额租约

唯一 owner：T06 的 Host storage owner；T07 native/helper 和 Notebook、ProjectActions、诊断等写入者是消费者。当前 [storage-admission](../../apps/desktop-host/src/workbench/legacy/storage-admission.mjs) 只有进程内 volumes 预留，不提供跨 Host 总配额。以下仅冻结消费义务；持久格式、IPC 和锁实现留给 T06 设计审查。

```text
QuotaRequest = { operationId: StorageOperationId; rootId: ManagedRootId;
  ownerEpoch: HostEpoch; maxWriteBytes: number; terminalBytes: number }
QuotaLease = { id: QuotaLeaseId; operationId: StorageOperationId;
  rootId: ManagedRootId; reservedBytes: number; terminalBytes: number }
QuotaObservation = { measuredBytes: number | null; reservedBytes: number;
  limitBytes: number; scan: 'complete' | 'incomplete' }
reserve(request, signal) -> QuotaLease | explicit refusal
inspect(operationId) -> reserved | settled | unknown
settle(leaseId, measuredResult) / release(leaseId) -> durable observation
```

以发行数据根/profile 的规范身份计量，同 home 多连接只算一次；纳入列表需显式列路径和 writer，排除原生 Session、工程和运行时，未知项使扫描 incomplete，不能显示零。maxWriteBytes 含临时替换峰值，terminalBytes 为独立终态保留；准入同时满足受管额度与磁盘安全余量。降低额度不剥夺在途终态空间。多 Host 共享一个可串行持久账本/所有权协调点，helper 每命令携带已获准租约，不私自初始化独立额度。

reserve ACK 丢失按 operationId 查询；取消停止新写但保留已发生/未知字节直到重扫结算。release 幂等；超时或 PID 重用不是 owner 已死的证据。确认进程身份退出、排空 writer 并重扫后才能回收崩溃租约。settle 失败保守保留预留；清理只输出只读预览交 T07，不能由 quota 删除工程。

## 验证回执

唯一 owner：T11 verification；事实生产来自官方 Shell/ProjectActions/Artifacts，T12/T13/T18/T19/T20 只消费。当前运行记录和 turn/end 不等价于验证通过。

```text
VerificationReceipt = { schemaVersion: 1; id: ReceiptId; runId: RunId;
  intent: string; sourceFingerprint: string | null; inputFingerprint: string | null;
  coverage: 'complete' | 'unknown'; configRevision: number;
  command: SanitizedCommand; exitCode: number | null;
  cancelled: boolean; timedOut: boolean; interrupted: boolean;
  log: { digest: string; complete: boolean; parserVersion: string | null };
  tests: 'NOT_RUN' | 'PASSED' | 'FAILED' | 'UNKNOWN';
  artifacts: readonly RunArtifact[]; acceptance: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  freshness: 'CURRENT' | 'STALE' | 'UNKNOWN' }
```

指纹覆盖相关源码、脏文件、未跟踪输入、配置、工具链及显式算例/容差；范围不完整就 UNKNOWN。exitCode=0 只记录执行事实，测试 PASSED 必须由具版本的解析器对完整真实日志得到；用户验收单列。取消、超时、退出码独立记录，不能互相覆盖。源码/输入改变使旧回执 STALE，不改写历史事实；无完整日志或未实际执行不得生成通过。相同产物字节不代表未运行，产物须由实际 run 观察关联。意图先持久化，结果提交后才发通知；重启未完成为 INTERRUPTED/UNKNOWN，无自动重放。

## Companion 作用域

唯一 owner：T13 companion core；T14 静态 UI、T15 renderer、T16 pet、T18 Hint、可选 T21/T22 消费。当前 Environment 使用第一条 retained mainView 记录，需要 T13 消费官方 SessionBinding/SessionReference/Workspace 公共能力，必要 seam 经集成人员接线。

```text
CompanionScope = { hostEpoch: HostEpoch; windowId: WindowId; viewId: ViewId;
  workspaceId: WorkspaceId | null; sessionId: SessionId | null;
  turn: number | null; revision: number }
CompanionView = { scope: CompanionScope; connected: boolean;
  state: 'idle' | 'working' | 'waiting' | 'disconnected';
  notebook: 'available' | 'disabled' | 'unavailable';
  receiptId: ReceiptId | null; noticeIds: readonly NoticeId[] }
ScopedAction = { actionId: ActionId; scope: CompanionScope;
  operationId: ActionOperationId; expiresAt: number; parameters: RegisteredParameters }
```

所有异步结果比较完整 scope 和 revision；切视图、session、工作区、Host 重连或权限变化递增 revision 并取消旧操作。晚到结果既不显示也不执行。不同 window/view 独立绑定，固定关注旧 Session 独立于前台 scope；禁止 DOM 扫描、私有 mainReference 或 retained-first 猜测。订阅已提交事件生成有界视图，只读 T05 已提交活动投影；冷读取按需，断线状态明确。scope 当前绑定是瞬态；重启持久关注意图需重新授权和绑定，不复活旧 epoch。renderer 不读 Session 库/秘密、不调用执行服务；UI 行为只委托原 owner，默认额外模型请求为零。

## 通知身份

唯一 owner：T12 Host 通知 owner；Electron Main 消费系统弹出，Companion/pet/Hint 消费同一提示身份。持久事件产生于真实终态提交之后；不能由 UI 轮询发现状态变化才创建通知。

```text
DurableNotice = { id: NoticeId; sourceId: ReceiptId | RunId | ApprovalId;
  kind: 'completed' | 'failed' | 'cancelled' | 'awaiting-acceptance' | 'approval';
  sequence: number; scope: DurableSourceScope; createdAt: number; expiresAt: number | null }
NoticeDelivery = { noticeId: NoticeId;
  system: 'unclaimed' | 'claimed' | 'sent' | 'failed' | 'unknown' | 'suppressed';
  visibleToCompanion: boolean; handled: boolean }
NoticePreferences = { revision: number; enabled: boolean }
```

sourceId+kind+终态修订在 owner 中映射到唯一持久 NoticeId，UUID 单独生成不得使重放重复；不得用窗口 ID 或文案作为身份。系统 claim 和消费游标持久 CAS，多窗口共享 owner；首次启动/重连不补弹历史。OS 通知 ACK 未知不承诺 exactly-once，也不自动补发，记 unknown。系统弹出、角色可查看、用户已处理三个状态分开；通知失败、禁用或过期不能吞审批或删除回执。迟到提示展示仍需 T13 当前 scope 校验；取消生产者不抹掉已经提交终态。

## 版本与数据恢复

T00 不修改任何持久类型或运行时格式，README/JSDoc 与升级指南无需伪造行为更新。后续 owner 修改已声明 Session 持久类型时按 [确认流程](../../docs/cookbook/reviewing-persistence-type-changes.md) 生成记录，遵循 [版本状态](../../docs/session-format-status.md) 与相邻迁移；已发布旧代不改写。Notebook v2 是派生存储版本，不是 Session writer 版本。SQLite 版本只递增，派生索引可重建不等于源日志可删。

格式/行为变化与对应 README、JSDoc、消费者、快照、升级说明同一交付完成；跨 owner 由 [接线队列](wiring-queue.md) 承接。任何需要额外字段或新公共 API 的任务先登记最小差异与兼容性，再由集成人员发布 contracts-v2 或兼容 v1 修订。回退一律使用升级前副本和旧程序，不承诺旧程序原地读新版数据。

## Dev Note

T06/T11/T12/T13 草案只约束本方案唯一 owner 及其消费者；未创建相关包、服务、协议或测试替身。字段细化在对应任务启动前审查，缺依赖仍为 DEPENDENCY_BLOCKED。
