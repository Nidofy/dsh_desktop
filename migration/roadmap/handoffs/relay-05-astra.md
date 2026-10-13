# Relay 05 — Astra，T06 跨 Host 账本与 native 租约实施

- 目录：D:/Documents/FeiyangChen/devApps/dshWinUi/electron；当前分支 codex/roadmap-integration。
- 本棒实现并验证 T06 跨 Host 账本、生产 owner 证明、native capability 消费及实际 writer 接线。T06 整体仍 PARTIAL；交回原因是本次具体决定已落地，下一步为 Sol 持续完成管理 UI、清理/迁移与后续就绪任务，不存在已知需要再次转交的相同架构阻塞。
- 所有工作未提交，保留来源 worktree、用户修改/素材和旧台账。未校验 SHA、初始化、重复接收 T02/T04，未改 registry/tasks/ownership；未创建聊天/代理/定时器、push/合并/发布、迁移真实数据或调用计费服务。
- 必读：[CONTINUOUS](../dispatch/CONTINUOUS.md)、[本棒记录及完整 prompt](../handoffs/relay-05-astra.md)、[下一棒 prompt](../dispatch/NEXT_PROMPT.txt)、[native 账本协议](../../../native/nidofy-protection/README.md)。旧输入见 [Relay 04](../handoffs/relay-04-sol.md)。

## 实际决定与实现

canonical home 父目录为发行根，Windows volume serial/file index 标识物理根；兄弟 home 与 imports 共用 .nidofy-storage-v1/ledger.jsonl。imports 内 home、复制后根身份冲突明确拒绝，不自动重绑。native v1 upsert 日志有 SHA-256 损坏检测，真实 share_mode(0) 排他锁和祖先句柄保护，write-through + sync_all 后 ACK。完整坏记录保留拒绝，未完成尾行锁内截断；完整丢 ACK 记录查询前同步确认。每记录 4 MiB、账本 128 MiB，到限拒绝，无在线压缩/自动删除。

HostEpoch 绑定实际 PID/创建 FILETIME/wait；未知不回收，锁等待不等于 owner 过期。native 子进程先落自身身份，再消费 Host 私有 stdin capability；公共 lease 不含秘密，磁盘仅 token hash。原始 mutator 拒绝，storage_reservation 与逐写检查已接通；begin/end 使用同一 grant 的独立 terminalBytes，unknown 不重放。账本预算含未结算 ordinary/terminal、真实可用空间、安全余量和每未结算操作五个最大账本记录。

release/settle 等 Node 作业与 native child 排空，先持久标 finished；其他 writer 未退则不回收，完整重扫才能结算，失败保留 charge。新 Host 在同一 home 扫描失败时仍可 inspect。降低 limit 不缩减已授 terminal。Notebook 实际 publish/转换通过 lease.run 跟踪，拒绝先于尾行截断，后续 settle/logger 诊断不逆转已提交结果；W04 generation/settings guard 不变。

## 消费者与明确限制

| 范围 | 当前产品行为 |
|---|---|
| Notebook/settings | product owner admission/run/settle；本地 history budget 仍保留 |
| Connections/ProjectActions | 事务/行动租约，独立 terminal；release 在作业外避免自等 |
| artifact/change/staging/preferences/probe/诊断/paused schedules | 产品 adapter 接公共 writer；staging 有界流实际关闭后结算 |
| pets/native | 导入删除计量与有界写；导出必须发行根外；native 每次变更必须消费可信 grant |
| official SQLite query | 产品使用 :memory: 和内存临时表；真实 built 搜索通过，旧磁盘索引计量保留；冷重建/内存未获性能资格 |
| legacy home import | API 含 preview 明确拒绝 IMPORT_QUOTA_MIGRATION_UNSUPPORTED；官方 Session migration 缺有界 admission/adoption，T10 接通后再解禁；已有 imports 保留计量 |
| measurement | 仍只读观察，兄弟 imports 计入一次；未知/链接/不可读/改变时 measuredBytes=null，不承担准入 |
| 非产品库/旧入口 | 保留显式 standalone 行为，不称跨 Host 参与者 |
| T06 未完成 | 认证管理状态/配置/恢复 UI、T07/T08 清理衔接、T10 有界迁移、账本长期容量与真实发行资格 |

实际代码：[StorageService](../../../packages/nidofy/desktop-extras/src/storage.ts)、[native quota](../../../native/nidofy-protection/src/quota.rs)、[Notebook](../../../packages/nidofy/desktop-extras/src/notebook.ts)、[产品配置](../../../packages/nidofy/desktop-bundle/cordis.patch.yml)、[升级指南](../../../docs/upgrade-guide/v0.2.0-rc.2/nidofy-quota/guide.md)。登记包含 exports/paths/bundle/Cargo feature/catalog 与双语文档；无新增 npm/crate 依赖或本棒 lock 变动。

## 证据与边界

准确日志、复跑命令及失败修复链见 [commands.json](../../../.build/dispatch/evidence/relay-05/commands.json)。不同修订和命令不能相加成一次全绿。

| 范围 | 实际结果 |
|---|---|
| 较早 source 组合 | 9 文件 141 项通过 |
| 最终相关生命周期/私有 capability/根复制/Notebook 组合 | 5 文件 66 项通过 |
| 最终当前 built 完整 profile | 另有 1 文件 1 项通过；真实 arm/native begin/end、内存搜索、导入拒绝与原生命周期 |
| Rust / 原 W04 buffered 探针 | 分别 3 项 / 1 项通过，后者仍严格 [0] |
| 正式 Host 类型 / 20 路径正式 type-aware lint | exit 0 |
| 当前 4 owner bundle / 最后 Notebook 补构建 / locked native helper | exit 0 |
| 正式 Loader config | 215 项通过 |
| Session persistence | 63 roots 对应 9 history，changes=[]；native 格式不伪造 Session ack |
| 文档 | 5 命名双语对、升级指南、8 budget docs、公共 JSDoc、定向链接/换行通过 |
| 全仓 doc-sync/配对 | 未重跑；用户 Live2D 英文配对缺口和历史 7 处禁用词保留 |

跨 Host 竞争、实际 owner 退出回收、丢 ACK、扫描失败、降低额度 terminal、native 消费失败与关闭排空有回归。helper kill 在接受完整命令前，sync 故障由 Rust 注入，空间拒绝用不可能满足的 safety margin；不称真实写后 crash/满盘/断电。未取得独立 SID、实际诱发 PID 重用、Electron/安装包资格。ACP 既有 tracked symlink 被 Windows checkout 展开成路径文本，核实文件 mode/目标后恢复原相对链接，目标内容与 Git diff 均未改；未校验 SHA。最后 built 复验首命令目录错误返回“无测试”，改为 apps/desktop/tests 后通过，空跑不算资格。沙箱 setup-refresh 故障沿用窄范围宿主执行；一次 patch 自动审查超时经核对未应用后重试成功，不是策略拒绝。

## 前棒事实与下一步

W04/T05 已实现部分不重复审查；完整 observation、冷加载及身份重取仍可能全量，无所有路径增量/峰值资格，T13 待接 Companion API。v1 保留源、数字旧 v2 与新 physical scope 明确拒绝，不自动重绑/删代/重置。提交后诊断不逆转成功，Notebook 原子指针/persisted 无新增断电承诺。T02 默认 credentials provider 不变，仍显式 overlay；备份/导出排除、迁移修复 UI 与发布资格未完成前不默认启用。

T01 Node-mode/本地 SSE/认证英中 jsdom/Office 注册已验，顶层 recorded-session harness、Electron renderer/preload、Office 转换/runtime preparation 和安装仍缺。T09 .env proxy/bypass 保存/在途请求/重启路由已验，自定义 CA TLS 与 Electron 网络未验，仍 PARTIAL。Sol 从 T06 管理与 T07/T08/T10 接口继续，再推进上述剩余、T11/T12/T13/T17 等实际就绪项；不用新后台聊天接棒，由用户选择模型。

## 发出的完整 Sol prompt

```text
请使用 GPT-6.1-Sol 继续 DSH Electron 持续开发，从 Relay 05 的实际 T06 实现继续，完成常规接线、UI、恢复与后续就绪任务，不重复交回已解决的 W04/T06 决定。

工作目录：D:/Documents/FeiyangChen/devApps/dshWinUi/electron；沿用 codex/roadmap-integration 和主目录。保留全部未提交修改、来源 worktree、用户素材及现有台账；不校验 SHA、不初始化、不重复接收 T02/T04，不重新审查已完成的 T00/T01/T03/T25 单元。registry/tasks/ownership 本棒未改；不能把全目录旧 diff 都归于本棒。

完整读取 AGENTS.md、适用下级规则、migration/roadmap/dispatch/CONTINUOUS.md、NEXT_HANDOFF.md、migration/roadmap/handoffs/relay-05-astra.md、native/nidofy-protection/README.md；修改 packages 前读取 docs/architecture.md 和 packages/AGENTS.md。contracts-v1.md 的消费义务继续适用；T06-storage-decision-20261007.md 的旧 writer 矩阵、STATUS-2026-10-07.md、ASTRA-W04-20261007.md 仅作历史输入。需要 T01/T09 前棒细节再读 relay-04-sol.md。以实际源码、配置、接口、测试和所有未提交改动为准。

第一项动作：核对 desktop-extras/src/storage.ts、native/nidofy-protection/src/quota.rs、实际 product writer 与只读 measurement 的边界，接通 T06 认证配额状态/配置/保守恢复 UI，再按依赖继续 T07/T08 预览清理和 T10 有界迁移。现有 StorageService 已提供 configure、inspect、recover 和完整 lease 生命周期，不另建进程内授权 Map，不把只读 inventory 当准入快照。UI 必须区分 measuredBytes、observedBytes、reservedBytes、未排空/扫描失败及操作 unknown；降低额度保留已授 terminalBytes，不用自动重放或删除解决未知结果。调用 recover 可能同步账本状态，不能伪装成纯观察；只读 measurement 仍无预留/结算权。

本棒已决定并实现唯一 native 账本：canonical home 父目录为发行根，.nidofy-storage-v1/ledger.jsonl；根身份来自 Windows volume serial/file index。注册的兄弟 home 共用账本，兄弟 imports 整体计入一次并按物理文件去重；imports 内 home 拒绝 STORAGE_IMPORTED_HOME_REBIND_REQUIRED，不开嵌套账本。复制账本到不同物理根拒绝，不自动重绑。账本是带 SHA-256 损坏检测的 v1 JSONL upsert，真实 Windows share_mode(0) 排他锁、祖先目录句柄保护、write-through 与 sync_all 后 ACK；不是 rename 耐久承诺。完整坏记录拒绝保留，未完成末行锁内截断；完整丢 ACK 记录查询前同步确认。每记录 4 MiB、账本 128 MiB 上限；暂无在线压缩，不能清账本逃避上限。

HostEpoch 随机身份绑定实际进程 PID、创建 FILETIME 与 wait 状态；未知/无权限不回收，不凭 PID 或超时判死。native 每命令进程先持久记录自身创建身份，再消费 Host 私有 stdin capability，磁盘只存 token hash；公共 lease 的秘密保存在私有 WeakMap，不进入 JSON。原始 mutating command 拒绝，storage_reservation 与逐写 budget 检查已启用；native begin/end 共享原 grant 的独立 terminal 容量，unknown end 不可重放。旧 native MAX_STORE 仅保留为下层防线。

reserve 同时检查已计量、所有未结算 ordinary/terminal、真实可用空间、安全余量与每未结算操作五个最大账本记录的空间。settle/release 先持久标 finished，待实际 Node 作业及 native child 排空；任何未完成 owner 或 worker 仍活着则保留预留，只在全体排空并完整重扫后回收。失败/unknown 保守保留。新的 Host 可在扫描不完整时注册同一 home 并 inspect；新 home 在未结算 grant 存在时拒绝加入。不要把 journal 的同步 ACK 说成 Notebook/普通 writer 文件的断电耐久。

产品已接 Notebook 发布/转换和 settings、Connections 事务、ProjectActions、change review、artifact registry/staging、preferences、probe/诊断归档、paused schedules、pet import/delete 与 native mutators。Notebook admission 现在返回 run/settle，真实写作业由 owner 跟踪，拒绝先于 crash-tail 截断；物理 generation/settings guard 继续保护 admission 至提交。提交后 settle/logger 诊断失败不把已选中 Notebook 报成未发生。独立库/未挂产品 owner 的旧入口不冒称跨 Host 配额参与者。

两项明确产品取舍不能静默撤销：official SQLite provider 现在 path=':memory:'，temp_store 也在内存；当前 built Host 真实搜索通过，旧磁盘索引计量并保留，但冷重建和内存成本未取得性能资格。持久索引重新启用前须有有界 writer 接口。旧 home import API 当前明确拒绝 IMPORT_QUOTA_MIGRATION_UNSUPPORTED，包含 preview 路径；原因是官方 Session write migration 尚无有界 admission 接线。已有 imports 保留计量；T10 应完成可信预览、有界迁移与显式 adoption，再解除相应拒绝，不能猜预算直接恢复导入。Pet 导出必须在发行根外。T06 整体仍 PARTIAL：配额管理 UI、清理/迁移衔接、账本长期容量处理和真实发行资格未完成。

本棒证据在 .build/dispatch/evidence/relay-05/commands.json。9 文件 141 项是较早组合；后续生命周期/私有 capability/根复制/Notebook 修复的最终定向组合为 5 文件 66 项；最终当前构建完整 profile e2e 另为 1 文件 1 项，不能相加冒称一次全绿。Rust 3 项、W04 原严格 [0] 探针 1 项、正式 Host 类型、20 路径 type-aware lint、当前包构建和 locked native helper、正式 Loader 215 配置、5 组定向双语配对、升级指南/字数/JSDoc/定向链接换行/diff 检查通过。Session 持久化检查为 63 roots/9 history、changes=[]；native 新格式由独立 schema/README 与真实 serde 测试登记，不造 Session acknowledgement。Windows checkout 的既有 ACP tracked symlink 从路径文本恢复为原相对链接，目标内容和 Git diff 均未改。manifest/exports/paths/bundle/Cargo feature/catalog 有本棒接线，无新增 npm/crate 依赖或 lock 变动；现有 lock 的旧修改保留。

测试实际覆盖跨 Host 同时竞争、真实旧 owner 退出后回收、丢 ACK 查询、尾行/坏记录、扫描失败保留、降低额度 terminal、native 消费失败、关闭排空及真实 built Host arm/begin/end/搜索/导入拒绝。helper kill 用例是在接受完整命令前，不能称写后 crash；sync 失败为 Rust 注入；磁盘不足用不可能满足的 safety margin，不是真实塞满磁盘。未取得真实断电、独立 SID、实际诱发 PID 重用、写后杀 native、Electron/安装包资格。完整 doc-sync/全仓配对未重跑；用户 migration/assets/live2d/README.md 英文配对缺口及历史 7 处禁用词保留，不标完整 PASS。直接调用现有 node_modules 的 Node 入口，避免 pnpm exec 隐式同步；保留失败→修复链，不把空跑算通过。

W04 已解决：SessionDurableObservation 同次给 branded physical generation、durableThrough 和原始耐久前缀；JSONL writer 队列/跨进程 lease 保护 observation 与提交。T05 readSelected、显式 synchronize、同次 observation、commitThrough 后扫描、会话队列/LRU 已有；Companion API 待 T13。启动/完整 observation/冷 JSONL/query/淘汰后身份取得仍可能全量，无 range durable API/峰值或真实工程性能资格。v1 复制转换保留源；数字旧 v2 拒绝 NOTEBOOK_GENERATION_REBIND_REQUIRED，新物理 scope 拒绝 NOTEBOOK_SCOPE_CONFLICT；不删已提交代、不重置游标、不自动重绑。兼容诊断不阻止会话启动，persisted 不是新增耐久回执。

T02 继续显式 overlay、默认 credentials provider 不变，备份/导出排除、迁移修复 UI 与发布资格未完成前不默认启用。T01 已有当前完整 Node-mode Host 的本地 SSE/keyless/认证英中页面/Office 注册/生命周期证据；顶层 recorded-session snapshot harness、Electron renderer/preload、Office 转换/runtime preparation 与安装资格仍未完成。T09 home .env proxy/bypass 的 CAS 保存、在途请求保持和重启实际代理路由已验；CA 仅启动环境声明，自定义 CA TLS、Electron 页面网络未验，仍 PARTIAL。当前用户 DPAPI 不能称独立 SID/断电/安装资格。继续这些剩余及 T11/T12/T13/T17 等就绪任务，不重审已完成单元。

你同时承担所有消费者、原 R 接线、依赖/lock/tsconfig/bundle/exports、普通编译/UI/fixture/登记修复、测试与必要双语文档。只用隔离数据、合成 Key、本地 provider；不调用计费服务、不迁移真实用户数据、不创建线程/代理/定时器、不 push/合并主线/发布。每个行为单元验证后继续，不因一次测试、提交或一个 Txx 停止。只有新的具体持久化/恢复/权限决定才交 Astra，给出文件、行为、证据和所需决定；会话限制就写同模型续做 prompt，不冒称架构阻塞。结束前更新 NEXT_HANDOFF.md、NEXT_PROMPT.txt，并保存下一个未使用 relay-NN-sol.md；最终贴出同一完整续开发 prompt 和具体转交原因。
```
