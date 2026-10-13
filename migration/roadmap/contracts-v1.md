# Roadmap 接口约定 v1

## Summary

本参考冻结首批 T01/T03 的最小实现义务，以及后续模块的消费关系。它是设计交付，不声明以下新类型已存在于运行时代码。[T00 独立审查](reviews/T00-review-1.md) 为 REVIEWED，R 已采用为首批设计输入；作者原交付和历史限制见 [handoff](handoffs/T00.md)。这不表示未来功能或包资格通过。接口修改只由集成人员登记版本、暂停相关写入并同步全部消费者，任务作者不得各自改名或改变语义。

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

唯一 owner：T01 的 `ConnectionStore`；T02 只提供官方 CredentialProvider，T09/T10/T23 消费配置与状态，不能维护第二份 key 映射。当前 [store](../../apps/desktop-host/src/connections/store.ts) 已分离配置加载与逐修订健康；[runtime](../../apps/desktop-host/src/connections/runtime.ts) 发布当前和保留修订路由，缺凭据修订不能拖累其他健康连接。源码已受控接收，真实 Loader/认证/页面和包资格仍见 R 台账的未执行项。

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
  cleanupRecord: 'none' | 'ledger' | 'journal';
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

v1 兼容细化：`cleanupRecord='ledger'` 表示独立持久清理台账；`journal` 表示义务仍只在事务 journal 中，保存以 `CONNECTION_RECOVERY_PENDING` 拒绝，消费者先 inspect/recover，不重发副作用。`CONNECTION_RETIRING` 表示退休提交窗口内拒绝新租约；已有租约阻止其修订进入回收计划，围栏外健康连接照常可用。退休完成后 store 层可为 `CONNECTION_RETIRED`、LLM 层可为 `NO_ADAPTER`，不能回落其他账号或模型。`appliedRevision` 已交换健康视图后再调用路由发布；发布抛错不回滚持久提交，也不保证路由已注册，使用原 operationId inspect 协调恢复。API 原样返回稳定错误码，页面保留 operationId 并提供重新读取；非 owner 安装错误继续 fatal，owner 失败 503 的真实启动验收仍待 W01。

T23 当前发布可选 `HttpEgressPolicy/HttpEgressLease` type-only 定义、Desktop provider 与 Loader 前安装点。发行、profile 和准确 Workspace 限制取交集；准备固定修订与实际 attachment，实际 fetch 拒绝修订变化、origin 变化及所有重定向。共享连接定义保存使用不授予发送权限的 `checkConfiguration()`，发送使用真实 `check/fetchFor`。完整接口、持久策略和未覆盖范围见 [owner 参考](../../apps/desktop-host/src/connections/README.md)。T19 已发布[正式隔离本机／确认连接 runner/report/UI](../../apps/desktop-host/src/selftest/README.md)，身份、意图／逐项检查点、取消排空、只读 INTERRUPTED/UNKNOWN 与白名单导出由该 owner 负责。连接固定真实 ConnectionStore 发布／修订与独立 T23 lease 修订，以最多五次、每次 64-token 输出的单用确认发送；失败／未知停止，原始输入通过官方 JSONL writer flush 与冷读重建，不复用旧 cache Probe。schemaVersion 1 本机报告保留不改写，新增 schemaVersion 2 连接报告，不改变官方 Session 事件格式。前缀项仅认证 owner 参考中的本机 raw／Notebook／prepared-call／缓存键分类，不认证提供方缓存命中、loop 准入或回合渲染。[开发载体](../../apps/desktop/tests/README.md#verification-selftest)已测真实 Main／preload／本地协议及本机／合成连接 UI，报告仍缺逐运行 renderer／安装清单证据，安装及现场资格仍 UNKNOWN。[25 项映射](probes/T19-electron-map.md)不替代实际测量，旧六行 presence 入口改为拒绝。

## Notebook 活动投影与双游标

唯一格式/store owner：T03；候选选择与持久提交适配归 T04；增量消费归 T05。现有 [types](../../packages/nidofy/desktop-extras/src/shared/notebook-types.ts)、[store](../../packages/nidofy/desktop-extras/src/notebook.ts)、[context](../../packages/nidofy/desktop-extras/src/context.ts) 的 schemaVersion=1 只有 sourceThrough；退休项仍在 entries 内并参与完整 JSON 预算。新草案在 T03 先定义存储/投影，T04 再实现双游标推进，T05 不重定义语义。

T03 第四轮允许接收的 `NotebookV2Store` 已与 v1 并存集成；生产 context、compaction、Config/settings 和 Panel 仍消费 v1，不能据库交付声明运行时已切换。当前实际发布签名为 `publish(expectedRevision, scope, candidate, events, actor, signal?)`：可信适配层从官方持久观察提供同代次连续原事件，按 seq 保持索引；模型不得自报 `actor='user'`，只有认证的用户操作可使用 user 身份。`readActive`/`readHistory` 可触发 v1 复制转换，不是无副作用的磁盘读取。`NOTEBOOK_IMMUTABLE_CONFLICT` 保留同名异内容修订的原字节并拒绝写入，消费者不得当空目录、自动覆盖或降写未知版本。

W04 的正式 generation/持久前缀接线仍由 R 与 T04 顺序完成：当前官方 `SessionObservation` 提供 header/events/cursor 和可选不透明 revision，没有独立的日志代次字段；`header.version` 是逻辑格式版本，revision 是服务实例内的变化 token，二者均不直接充当物理日志代次。T04 可先实施预算/候选单元并保留明确接线需求；真实提交前必须取得官方 owner 支持的代次身份和无合成闭合事件的持久连续前缀，不能扫描私有路径或手填数字冒充生产能力。

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

唯一 owner：T06 的 Host storage owner；T07 native/helper、Notebook、ProjectActions 和产品导入是消费者。实际 [storage-admission](../../apps/desktop-host/src/workbench/legacy/storage-admission.mjs) 委托公共 owner；跨 Host 锁、物理根、同步 ACK 与原位导入接纳由[原生账本](../../native/nidofy-protection/README.md)定义。以下草案保留消费义务，不替代已发布源码。

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

唯一 owner：已发布的 T13 [Companion](../../packages/nidofy/desktop-extras/src/client/companion.ts)；T14 静态 UI、T15 renderer、T16 pet、T18 Hint、可选 T21/T22 消费。正式 Client 能力为 `ctx.companion`，从实际导航 owner 发布的 `UiSession.mainBinding/mainSelection` 观察真实 SessionBinding；导航在释放前任引用前调用 `selectMain(reference)`。根消费方改用 `useMainSelection`，显式 `bindingSource(reference)` 保留。Conversation 公开 `selectedView` 与 `select(target | null)`，后台 `activate` 不改变选择。标题、Workspace 行／搜索／快捷键、Environment、角色和 Notebook 消费同一实际接口，不从 retain 计数选择。

```text
CompanionScope = { hostEpoch: actual NidofyHostEpoch | null;
  windowId: actual BrowserWindow id | null; viewId: registered target/panel id | null; panelId: string | null;
  workspaceId: WorkspaceId | null; sessionId: SessionId | null;
  turn: number | null; revision: number }
CompanionView = { scope: CompanionScope; connected: boolean;
  state: 'idle' | 'working' | 'waiting' | 'disconnected';
  notebook: 'available' | 'disabled' | 'unavailable';
  model: 'known' | 'unknown'; receiptId: ReceiptId | null; noticeIds: readonly NoticeId[];
  actions: readonly CompanionAction[] }
using(scope, existingOwnerOperation, signal?) -> current result only
refresh(scope) -> at most 16 committed notice identities + existing Notebook read
follow(scope) / releaseAttention() / openAttention(scope) -> one explicit retained Session
open(scope, action) -> existing navigation owner; approval only locates official UI
```

所有异步结果比较完整 scope 和 revision；切视图、session、工作区、Host 重连或权限变化递增 revision 并取消旧操作。晚到结果既不显示也不执行。不同 window/view 独立绑定，固定关注旧 Session 独立于前台 scope；禁止 DOM 扫描、私有 mainReference 或 retained-first 猜测。订阅已提交事件生成有界视图，只读 T05 已提交活动投影；冷读取按需，断线状态明确。scope 当前绑定是瞬态；重启持久关注意图需重新授权和绑定，不复活旧 epoch。renderer 不读 Session 库/秘密、不调用执行服务；UI 行为只委托原 owner，默认额外模型请求为零。

兼容 v1 实际消费义务：缺身份保留 null，不造 Host/window/view ID；实际 Host epoch 由认证 bootstrap 提供，window ID 由 sender 校验后的 Main 提供。权限与待处理请求修订取消旧操作，操作忽略取消时仍拒绝迟到结果，卸载先撤订阅再取消并排空。Main 将完整 scope 绑定实际发送窗口，旧导航在隐藏目标窗口显示前取消并销毁。1 MiB HTTP 上限在完整解码前核对；近期事实读不推进通知游标、claim、处理或验收。角色 slot 收到 active/view/act，窄屏只测自身布局，不把 DOM 用作业务身份。静态素材只声明实际选用的两个 PNG。新 scope 不同步、重绑、恢复或删除旧 Notebook 代次。持久副作用仍由原 operation/preview/confirmation owner 管理，不以 UI 取消推断未提交。T18 已发布[证据与偏好类型](../../packages/nidofy/desktop-extras/src/shared/companion-facts.ts)及[Hint／返回卡](../../packages/nidofy/desktop-extras/src/client/hints.ts)；正式 `ScopedAction` 持久操作票据仍未发布，不能按旧草案调用。

## 通知身份

T17 的兼容细化已发布：`HistoryAuthority` 绑定显式项目 ID、准确 Workspace ID／路径与关联修订，成员仍须由实际 WorkspaceRegistry 验证 Session 归属。候选、预览及引用重验当前权限和物理来源；默认 Session／exact cwd 不扩大。持久关联 CAS、可重建三元组检查点与取消／损坏恢复见[工作笔记参考](../../packages/nidofy/working-notebook/README.md)。T12 历史通知的逻辑 Session/cwd 匹配不等价于当前物理代次或当前验证状态；T18 的[只读 owner](../../apps/desktop-host/src/workbench/companion-facts.ts)重验原始 generation／seq 并消费真实 receipt inspect。Hint 忽略／暂缓、准确 Workspace 静音与返回卡展示去重使用独立偏好 CAS，不替代 NoticeId、系统 claim、游标、角色可见、handled 或验收。具体恢复与拒绝语义见[Host 参考](../../apps/desktop-host/src/workbench/README.md#companion-evidence-and-hint-choices)。

唯一 owner：T12 Host [通知 owner](../../apps/desktop-host/src/workbench/notifications.ts)；Electron Main 消费系统弹出，Companion/pet/Hint 消费同一提示身份。当前实际 sources 包括 ReceiptId 和基于 Session/物理代次/seq 的 SessionNoticeSourceId；approval 草案仍未接入。持久事件产生于真实终态提交之后；不能由 UI 轮询发现状态变化才创建通知。

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

v1 兼容细化（T10）：实际 [JSONL 后端](../../packages/session/session-persistence-jsonl/README.md) 增加可选可信 constructor 参数 `JsonlMigrationWriter`，在历史后继写入前提供实际物理字节计量；callback 必须等待有界 publish 与清理。普通 `SessionPersistence` 服务签名、Loader Config、Session 格式和现有无 callback 消费方保持。后继限额不涵盖源副本、调用者元数据或解码内存；提交前取消排空，独占发布开始后不以迟到取消否定成功 open，详见[升级指南](../../docs/upgrade-guide/v0.2.0-rc.2/session-migration-cancellation/guide.md)。

`importLegacy` 的 `LegacyImportExecution.write` 保留独立库内容 writer；产品使用 `admit` 接 `ImportLease`，由原物理发行根登记同身份的操作/授予，并在逐写前持久扣减显式累计额度。产品不创建额外 owner/takeover 文件锁；发布先记录物理目录与回执摘要，未知结果只查询，显式恢复不重放复制。认证 API 分别提供 preview、execute、inspect、review、recover、adopt；review 按已登记的目录身份与完整回执摘要读取有界类别报告，旧回执缺报告返回 null，inspect 仍只观察账本。接纳保留原位和原 Session root，不切换当前 Host，现有排除项字节保留固定费用。下次启动选择、工作区命令信任、保护路径与暂停计划恢复独立确认；不授予 Notebook 或 journal 重绑权限。具体格式、兼容和恢复见[原生协议](../../native/nidofy-protection/README.md)。

当前[执行证据 owner](../../apps/desktop-host/src/workbench/evidence.ts)仍提供实际保留日志的 CommandFacts/ActionEvidence，只读计数不创建回执。正式[VerificationOwner](../../apps/desktop-host/src/workbench/verification.ts)已接 ProjectActions 的运行前意图、实际 resolver/provider/源码/输入观察、真实配置修订、运行关联产物、独立验收 CAS 与原日志保留；旧运行不补造结果。显式覆盖声明不能替代实际 provider 枚举；沙箱及不可重建的 agent 上下文保持 unknown，当前比较缺失保持 UNKNOWN。相关已观察变化得到 STALE，历史测试事实不改写。回执和日志不随 100 条动作历史裁剪删除，受原配额及有界目录发现约束。

T20 [回执比较 owner](../../apps/desktop-host/src/experiments/README.md)消费显式 experiment／case／A/B run 选择与实际 T11 inspect，分别显示回执匹配、任务可比、验收与缺失计数。独立 schemaVersion 1 选择记录不改 T11／Session／旧诊断格式，原配额下有界独占发布，导入逐项匹配当前本机 committed receipt；未知响应只查询，不重发。T11 新增只读 executionSource，不改原 intent/result 格式；它只限制原 source／Session。认证 model-step 另以唯一官方 tool/result、callId 和准确 receipt 确定选择动作的 turn/step，通过 observeDurable／withGeneration／实际消息解释器重建完整结算前日志输入与该 step 的 usage。结算尝试数不是提供方调用数，日志前缀不是实际发送截点；任一尝试缺计数则相应总值null。该历史 reader 的因素设置、准确模型版本、实际发送输入及完整任务计数仍缺失；回执匹配或双验收不授予效率结论。独立工程 runner 与矩阵由其下述自有记录提供观察，不反向升级旧日志。

T20 另有[独立单次分析请求](../../apps/desktop-host/src/experiments/README.md#single-task-request)，使用独立确认／预算和 schemaVersion 1 私密 task-requests-v1 日志；不修改 T11／Session／T19／比较记录格式。官方 writer flush 后冷读重建，在同一 generation 下提交截点并调用绑定 prepared-call，终态读取等待实际 provider／quota 排空；未知终态仅 INTERRUPTED，不补发。它不提供工具、Agent 或工程写入，既不关联 T11 验收，也不证明工程任务 A/B。截点位于 Harness prepared-call 入口，不能声称准确 wire 输入、网络调用数、不可变准确模型版本或提供方缓存行为。显式 Notebook 源以完整文本／代次／笔记和设置修订捕获并发送前复验，已应用 cache hint／偏好修订及官方响应标识使用独立可选 v1 sidecar 冷验；缺失修订保持 null，不读当前偏好补历史。普通 Agent 组装行为保持，缺失 usage 保持 null；这些观察不授工程任务关联或效率结论。

T20 的[独立工程任务／矩阵](../../apps/desktop-host/src/experiments/README.md#isolated-engineering-task)另有自己的完整输入闭包、副本、预算／权限和 v1 日志，不复用 T19／分析票据。实际 Agent 的官方全输入截点与唯一保护动作 call/result／T11 回执建立因果关联。显式 Notebook／当前缓存因素分别捕获实际 owner 并复验；每轮顺序排空归档，失败／未知／取消阻止后续。独立工程比较展示自有 turn 计量、缺失值、原始来源和当前独立验收；不同输入／上下文／模型拒绝直接比较，准确版本仍 null，效率 false。矩阵报告导入按本机原来源／版本／大小验证，不写替代日志、不修复或补发。工程 timeout 与 caller 取消通过实际 HTTP 响应体生命周期排空；旧分析计时和 T17／T18／T19／T20／T23 总资格不随此变更升级。

T00 不修改任何持久类型或运行时格式，README/JSDoc 与升级指南无需伪造行为更新。后续 owner 修改已声明 Session 持久类型时按 [确认流程](../../docs/cookbook/reviewing-persistence-type-changes.md) 生成记录，遵循 [版本状态](../../docs/session-format-status.md) 与相邻迁移；已发布旧代不改写。Notebook v2 是派生存储版本，不是 Session writer 版本。SQLite 版本只递增，派生索引可重建不等于源日志可删。

格式/行为变化与对应 README、JSDoc、消费者、快照、升级说明同一交付完成；跨 owner 由 [接线队列](wiring-queue.md) 承接。任何需要额外字段或新公共 API 的任务先登记最小差异与兼容性，再由集成人员发布 contracts-v2 或兼容 v1 修订。回退一律使用升级前副本和旧程序，不承诺旧程序原地读新版数据。

## Dev Note

T06/T10 以现有源码与原生 owner 为准。T11 正式持久回执与 T12 通知 owner 已发布实际消费 API，但整体资格仍 PARTIAL。通知来源是已提交回执，或官方 flush/原始持久前缀/代次保护下确认的 Session 终态；两者不能互相冒充。通知 ID、偏好 CAS、共享游标、系统 claim/settle、角色可见与已处理独立持久；重连不补弹，未知 OS ACK 不重发。官方审批尚未接为通知生产者。T13 显式 scope owner 与 T14 静态／窄屏接线已发布，源码和 built 分层验证不能替代真实浏览器、Electron 或安装资格。草案字段不作为可调用接口，消费细节见[owner 参考](../../apps/desktop-host/src/workbench/README.md)。
