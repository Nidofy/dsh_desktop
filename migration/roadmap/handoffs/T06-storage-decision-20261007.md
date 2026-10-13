# T06：跨 Host 配额账本与 native 租约消费的具体决定

这是 Relay 04 的新问题；W04 physical generation / raw durable prefix 已解决，不重新交回。当前目录仍为 `D:/Documents/FeiyangChen/devApps/dshWinUi/electron`，沿用现有分支、未提交源码和来源 worktree。本文不是 T06 完成证据，也不改变 registry/tasks/ownership。

## 已完成的独立切片

`apps/desktop-host/src/storage/measurement.ts` 和认证 `POST /api/nidofy/storage` 提供只读计量。实际 Notebook 根是 `$DSH_HOME/nidofy-extras/notebooks`，随 `nidofy-extras` 计入；搜索索引只计明确 SQLite/WAL/SHM 文件。共享 home、同物理普通文件不重复计量；未知 home/cache 条目、链接、读取失败或观察期间身份/长度改变使 `measuredBytes=null`，保留已知 `observedBytes`。官方 sessions/storages、工程、运行时和凭据内容不扫描。它不写文件、不授额度、不承诺跨 writer 的原子快照；不要直接把这个无锁观测当 reserve 的充分依据。

真实文件回归覆盖共享 home、硬链接、原生会话/运行时排除、未知条目、缺 home、managed junction/cache ancestor、取消和相对路径拒绝。完整 built Host fixture 还调用实际认证端点，检查已知文件长度与 unknown 项保留。

## 当前真实 writer 和缺口

| Writer / 源码 | 数据路径与现有约束 | 尚未覆盖的 T06 义务 |
|---|---|---|
| `connections/store.ts` | `nidofy-connections/`；连接修订、发布和恢复 journal | 临时替换峰值与恢复终态需要同 owner 预留；不能使缺 Key 修复入口不可达 |
| `connections/deployment.ts` | home `.env`；官方 file lock + CAS + atomic replacement | 保留非秘密环境值/既有认证值；不读取凭据内容；若纳入额度需说明 `.env` 与 `.credentials.yaml` 的排除差异 |
| `workbench/legacy/project-actions.mjs` | `desktop-actions/`；start 前进程内预留 3 MiB，保存 queued/running/终态及日志 | 它的 lease 无 operationId/ownerEpoch/terminalBytes，也无跨 Host 保守结算；finally release 可能早于新的全局重扫 |
| `workbench/legacy/desktop-artifacts.mjs` | `desktop-artifacts.json` 和 `desktop-artifact-exports/`；导出 staging 预留文件长度 | registry 写入未使用 storageAdmission；staging 和 registry 都需覆盖；外部目标工程不能计入/删除 |
| `workbench/legacy/change-review.mjs` | `desktop-changes/`；直接写记录 | 无统一额度接线 |
| `nidofy/desktop-extras/notebook.ts` | `nidofy-extras/notebooks/`；`NotebookStorageAdmission.admit(write)` 检查局部 history budget | 接口没有 lease/settle/release 生命周期。需保持现有双游标、CAS、代次保护和提交后诊断成功语义，reserve 不能冒充 Notebook commit 回执 |
| `nidofy/desktop-extras` Preferences/Probe/MeasurementStore/ScheduleImport | `nidofy-extras/` 其他文件 | 各 writer 需逐个配对；当前计量不等于准入覆盖 |
| 官方 `session-query-sqlite` | `cache/nidofy-session-query.sqlite` 及 WAL/SHM | 原 provider 创建/增大索引不消费 Host lease；关闭/重建不能重置 Notebook 代次 |
| `native/nidofy-protection/src/main.rs` / `task_snapshots.rs` | `desktop-snapshot-scopes.json`、`desktop-task-snapshots/`；native 局部 `MAX_STORE=256 MiB`/数量检查 | helper 每次独立进程；`Request::storage_reservation()` 当前未调用。begin/end/check 和 Ui 写命令没有 QuotaLease，不能自行各建全局额度 |
| `connections/import.ts` | `join(home,'..','imports')` 独立复制根 | 计量切片没有包含跨 home 的 imports。先定义发行根归属/排除，再接预留；不得迁移真实用户数据 |

`workbench/legacy/storage-admission.mjs` 的 `volumes` 是本模块内存 Map；Windows 以盘符键计进程内预留，只有磁盘 64 MiB 余量检查。两个 Host 不共享该 Map，磁盘 avail 的同时读不能阻止两者超授 managed limit。native 的固定局部总量也不是 Host owner。这是源码直接可复现的缺口，不是历史台账状态。

## 请 Astra 决定并实施

1. 明确唯一账本的位置和格式，以及发行根/规范 home 的 `ManagedRootId`。选择锁/事务与落盘确认策略；定义 reserve ACK 前已持久记录什么、丢 ACK 如何按 operationId 查询、settle/release 中断后如何保守保留。现有 `writeFileAtomic` 明确不提供 fsync 断电承诺，不能把 rename 当新增耐久回执。
2. 定义 `HostEpoch` 的生产身份与存活证明。Windows PID / 超时不够；请选择进程创建身份、保持的 OS handle/独占锁或等价官方机制。确认旧 writer 退出并排空后重扫才回收；PID 重用、未知权限、helper 崩溃和持锁者崩溃均需明确行为。不要用测试数字 epoch 或重启计数替代生产身份。
3. 定义 native 消费 Host 已授 lease 的可信入口。每命令进程需验证租约、根、命令范围、峰值与独立终态预算；认证 UI/model JSON 不能自行制造放大额度。native 与 Host 谁在提交前重验、未知输出谁负责 settle、Host 消失时如何停止新副作用并保留终态空间，需给出一个可执行答案。
4. 把 Notebook `admit(write)` 与至少 ProjectActions、native begin/end 的实际消费者改为完整生命周期，再逐个覆盖矩阵；不要引入只供测试的全局 owner 或只登记服务存在。降低 limit 不收回已有 terminalBytes，拒绝 reserve 时副作用尚未开始。
5. 运行真实多 Host/子进程竞争、reserve ACK 丢失、owner/helper 崩溃、PID 身份不明、降低额度、满盘/settle 失败和终态保留回归。新增持久类型需官方 acknowledgement/catalog/升级说明；所有消费者、依赖、lock、tsconfig、bundle 与必要文档由当前 Astra 完成。

无需重新审查 T00/T01/T03/T25；只读取现有配额消费义务和上述实际文件。普通类型、UI、fixture、登记问题自行修复。Astra 交回可运行实现和精确未覆盖路径，再写完整 Sol 续开发 prompt，继续实际进度，不仅给出设计意见。
