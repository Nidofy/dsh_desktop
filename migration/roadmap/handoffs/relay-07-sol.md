# Relay 07 / Sol → Astra

日期：2026-10-08（Asia/Shanghai）。目录：D:/Documents/FeiyangChen/devApps/dshWinUi/electron；分支 codex/roadmap-integration；工作未提交。

完成官方 JSONL 后继的实际 raw/zstd 字节测量、逐写限制、可信 constructor writer 接线、提交前取消排空和提交后真实结果。isolated importer 接有界复制、转换和 JSON 内容 writer；协调锁、产品持久操作关联及 adoption 未完成。认证产品执行拒绝和预览行为保留。真实 Windows helper 测试复现 sibling imports 写入拒绝、已存 imports 的计量、imported home 的嵌套账本拒绝。

final source 5 文件 301 项通过；final rebuilt artifact 另为 2 文件 2 项通过；正式类型、9 路径 lint、两 owner build、Session changes=[]、119 catalog freshness、公共 JSDoc、6 命名双语对、升级指南和字数检查通过。准确命令与早期失败→修复见 [commands.json](../../../.build/dispatch/evidence/relay-07/commands.json)。未重跑完整 doc-sync/全仓配对，旧用户 Live2D/禁用词缺口保留。未新建线程/代理/自动化、提交/push/合并/发布、调用计费服务或迁移真实数据。只更新 registry/tasks 的 T10 条目及 contracts-v1 的 T10 兼容细化；保留其余旧台账、ownership、用户资产及来源 worktree。

转交原因是新的具体跨模块持久化／权限决定，详见 [T10 dossier](ASTRA-T10-20261008.md)，按 CONTINUOUS 交 Astra 直接决定、实施和验证。不是上下文续棒，不原样重新提交 W04/Relay 05 问题，不是编译/lint失败或两轮修复失败。当前完整状态见 [NEXT_HANDOFF](../dispatch/NEXT_HANDOFF.md)。

## 发出的完整下一棒 prompt

以下是当时副本，与 NEXT_PROMPT.txt 完全一致。

```text
请切换到 Astra，继续 DSH Electron 持续开发，处理 Relay 07 的新 T10 物理导入根、持久操作恢复与显式 adoption 决定，并直接实施验证后交回 GPT-6.1-Sol。这不是同模型上下文续棒，也不是重开已解决的 W04/T06 账本决定。

工作目录：D:/Documents/FeiyangChen/devApps/dshWinUi/electron，沿用 codex/roadmap-integration 和主目录。保留全部未提交修改、来源 worktree、用户 Live2D 素材及历史台账；不校验 SHA、不初始化、不重复接收 T02/T04、不重新审查已完成单元。Relay 07 只更新 T10 的 registry/tasks 条目；ownership 及其他旧修改不归本棒。

完整读取 AGENTS.md、适用下级规则、docs/architecture.md、packages/AGENTS.md、docs/defensive-patterns.md、migration/roadmap/dispatch/CONTINUOUS.md、migration/roadmap/dispatch/NEXT_HANDOFF.md、migration/roadmap/handoffs/relay-07-sol.md、migration/roadmap/handoffs/ASTRA-T10-20261008.md、native/nidofy-protection/README.md。contracts-v1.md 的数据与消费义务继续适用，旧状态以实际源码为准；需要账本细节再读 relay-05-astra.md，需要管理页面/快照/CA 前棒证据再读 relay-06-sol.md。

第一项动作：对照 apps/desktop-host/tests/import-storage-root.spec.ts 的真实 Windows helper 复现、apps/desktop-host/src/connections/import.ts、packages/session/session-persistence-jsonl/src/generation.ts 与 src/index.ts、packages/nidofy/desktop-extras/src/storage.ts、native/nidofy-protection/src/quota.rs，决定并实现 sibling imports 的物理根准入、产品 import operation 与 quota grants 的持久关联、以及显式 adoption 的可恢复 home 绑定。需要实际代码和验证，不只提出接口或再找 R。

Relay 07 已提供 PreparedJsonlMigration.measure 的实际 raw/zstd 只读编码计量，publish 的逐写字节上限，可选可信 JsonlMigrationWriter 的 write-open 接线；普通 Loader Config 不变。准备和发布取消独立，提交前取消等待 stage close/verifier terminate，独占发布开始后的取消不否定已提交成功。超限是 SESSION_MIGRATION_WRITE_LIMIT，不冒称源损坏。隔离 importLegacy 的第五个参数 LegacyImportExecution 接 write/signal；复制以 64KiB 缓冲且写前限制清单长度，复核打开后的源长度/mtime/摘要；Session 转换和完整 JSON 元数据接同一内容 writer。root/owner 的 withFileLock 协调锁字节尚在 callback 外，whole-import peak 尚无资格。不要将 sourceBytes、后继 bytes 或这些 callback 当完整产品额度。

真实复现证明：现有 StorageService.write 对 sibling imports 内容路径以 STORAGE_PATH_REFUSED 拒绝；当前 home native recover 能计量 imports 副本，但 imported harness 打开实际 owner 以 STORAGE_IMPORTED_HOME_REBIND_REQUIRED 拒绝且不建嵌套账本。产品 API 仍 IMPORT_QUOTA_MIGRATION_UNSUPPORTED，UI 执行禁用，只读 preview 保持。READY 只表示 standalone 隔离副本完成，不能称产品选中/激活。

需裁决的具体问题和选项已写 ASTRA-T10-20261008.md：如何由原物理发行根授权 import writer；如何持久记录阶段、quota operation、取消/排空、ACK 丢失和 pending/final 恢复并覆盖协调锁/转换/原子元数据/rename 峰值；adoption 选择原位管理还是明确移动到发行根 sibling home，如何保持根身份、只计量一次、处理 Session/attachment 排除项和 patch 的绝对 root。不得自动重绑 journal/Notebook、用进程内 Map 当持久权限、绕过原生身份检查、删除旧代或自动重放 unknown。改变独立 native 持久格式时更新真实 schema/serde/兼容策略；没有 Session 类型变更就不造 acknowledgement。

Relay 05/06 的协议保持：canonical home 父目录为物理发行根；Windows volume/file identity、共享 SHA-256 JSONL upsert ledger、4MiB 单记录/128MiB journal、share_mode(0) 和 write-through/sync ACK；HostEpoch 用实际 PID/创建 FILETIME/wait，unknown 不回收；秘密 capability 只在 Host WeakMap，磁盘只有 hash。普通/terminal/真实磁盘余量计入 admission，实际 Node/native/worker 排空及完整 scan 后结算。普通 atomic rename 没有新增断电回执。status 不 sweep，recover 明确确认；归档 expectedRevision 和逐文件恢复规则保持；清理仍无执行器。

当前 final source 5 文件 301 项通过，包含官方 JSONL 和真实 Windows root 拒绝；额外 provider 回归曾因旧取消断言失败，已修正并在 final source 的 jsonl 183 项覆盖。当前构建、plain-Node migration worker、完整 Node-mode profile、正式 Host 类型/lint及文档的准确执行结果见 .build/dispatch/evidence/relay-07/commands.json，不合并不同命令为一次全绿。Session persistence 检查仍 63 roots/9 history、changes=[]；未新增 npm/crate 依赖或 Config/manifest/lock/exports 变更。终端 sandbox setup refresh 多次失败，窄范围本机重试完成；不是架构问题或两轮修复失败。旧 Live2D 英文配对/禁用词缺口保留，完整 doc-sync/全仓配对未重跑。新增双语升级指南说明 migration 的取消行为变化。

W04/T05 physical generation、raw durable prefix、Notebook 队列/LRU/readSelected/synchronize 保持，不自动重绑新 scope；完整冷读和 decode 内存仍无峰值资格。T02 只用显式 overlay，不默认启用凭据 provider。T01/T09 已有 Node-mode/profile/本地 proxy/CA 证据不代表 Electron 页面、企业网关、Office conversion/runtime preparation、安装或正式顶层 recorded-session snapshot。T11/T12 未发布回执/通知 owner，T13 不据草案猜接口。T06/T10 整体未完成，真实满盘/断电/独立 SID/PID 重用等未验。

你负责决定、实现、共享接线、所有消费者、配置/构建、必要双语文档和有效验证。只用隔离数据、合成 Key、本地 provider；不调用计费服务、不迁移真实数据、不创建线程/代理/定时器、不 push/合并主线/发布。完成本问题后继续实际就绪单元，或按 CONTINUOUS 写交回 Sol 的完整 prompt。结束前更新 migration/roadmap/dispatch/NEXT_HANDOFF.md、NEXT_PROMPT.txt，保存下一个未使用 relay-NN-astra.md，最终贴出同一完整 prompt 与具体原因。
```
