# Relay 04 / Sol / 2026-10-07

沿用主目录和 codex/roadmap-integration，保留未提交修改、来源 worktree、用户素材和旧台账。未校验 SHA、初始化、重复接收、提交/push/合并/发布、迁移真实数据、调用计费或创建聊天/代理/自动化。

T01 完整 built Node-mode Host/profile 验证使用官方 base/Web/Nidofy、真实 Office 资源、当前 native helper、合成 Key/本地 provider。keyless/有效路由真实 Agent 会话、认证英中页面修复、owner 降级保留文件、非 owner fatal、ready/quit/unload/端口关闭通过；修复 fatal 后 shutdown(0) 覆盖 exit 1。新 built e2e 已登记。未声称 Electron renderer、Office 转换、安装包或标准顶层 snapshot harness 通过。

T09 实施官方 home .env proxy/bypass 编辑和双语 UI，CAS/官方 lock/原子替换、无关字节/未编辑认证值保留、脱敏状态与继承覆盖、dirty 提交/非法输入拒绝。held request 跨保存完成，旧 dispatcher 不变；重启后本地代理完成 ManagedAdapter 请求，官方 loopback/bypass 路由确认。CA 保持启动环境-only，未测 TLS，整项仍 PARTIAL。

T06 实施只读计量与认证端点，共享 home/物理文件去重，明确 managed 根/排除项，未知/链接/不可读/观察改变返回不完整总量，没有额度或清理权限。实际 writer 矩阵见 [T06 新决定](T06-storage-decision-20261007.md)。workbench 内存 Map 和每命令 native 局部预算不能提供统一多 Host 额度，Notebook admission 缺完整租约生命周期。

最终 source 5 文件 32 项通过，完整 built profile 另有 1 文件 1 项通过，不累计成一次全绿。正式 Host 类型、9 路径 scoped lint、当前 Host/locked native build、2 组配对、i18n/字数/JSDoc、定向链接/换行、mjs 语法和 diff 通过。准确记录及失败链见 [commands.json](../../../.build/dispatch/evidence/relay-04/commands.json)。全仓 doc-sync/配对未重跑，用户 Live2D 和历史禁用词限制保留，无新依赖/manifest/lock 变动。

具体转交原因是 T06 的新跨进程持久化/恢复/权限决定：现有约定未定义唯一账本提交/ACK、生产 HostEpoch 存活证明和 native 消费 Host lease。邻接只读计量/测试、消费者矩阵已完成；请 Astra 决定并实施实际 owner、所有消费者和多进程回归，再交回 Sol。不是 W04 重复交接或普通 fixture/编译问题。

完整 prompt 见 [NEXT_PROMPT.txt](../dispatch/NEXT_PROMPT.txt)，当前限制见 [NEXT_HANDOFF](../dispatch/NEXT_HANDOFF.md)。下面保留同一 prompt 副本。

```text
请使用 Astra 继续 DSH Electron 持续开发，决定、实施并验证 T06 新出现的跨 Host 配额持久化与 native 租约消费问题，完成后写完整 prompt 交回 GPT-6.1-Sol 继续实际进度。

工作目录：D:/Documents/FeiyangChen/devApps/dshWinUi/electron。沿用当前 codex/roadmap-integration 分支和主目录，保留全部未提交修改、来源 worktree、用户素材与当前台账；不校验 SHA、不初始化、不重复接收 T02/T04，不重新审查已完成的 T00/T01/T03/T25 单元。registry/tasks/ownership 本棒未改，不根据旧状态重新开始。

完整读取 AGENTS.md、适用下级规则、migration/roadmap/dispatch/CONTINUOUS.md、NEXT_HANDOFF.md、migration/roadmap/handoffs/relay-04-sol.md、T06-storage-decision-20261007.md；需要前棒细节再读取 relay-03-sol.md 和 relay-02-astra.md。修改 packages 前按 AGENTS 读取 docs/architecture.md、packages/AGENTS.md。STATUS-2026-10-07.md、ASTRA-W04-20261007.md 是历史输入，以当前源码、配置、接口、测试和未提交改动为准。

这是新的 T06 具体持久化/恢复/权限决定，不是 W04 重复交接或普通编译/UI 问题。第一项动作：对照 contracts-v1.md 的配额消费义务和 T06-storage-decision-20261007.md 的实际 writer 矩阵，确定唯一账本的根/格式/锁/提交与 ACK、生产 HostEpoch 存活证明，以及 native 每命令进程消费 Host 已授 lease 的可信入口，然后直接实现。workbench/legacy/storage-admission.mjs 的 volumes 仅是进程内 Map；native 仍是独立局部 MAX_STORE，Request::storage_reservation() 未调用。不要用 PID/超时/测试数字代次证明旧 owner 已退出，也不要用 writeFileAtomic rename 冒充 fsync 耐久回执。明确丢 ACK 查询、unknown/settle 失败保守预留、writer 排空后重扫、降低额度时保留独立 terminalBytes。Notebook admit(write) 当前没有 lease/settle/release 生命周期；至少接通 Notebook、ProjectActions 和 native begin/end，再逐个覆盖其他 writer。imports 位于 home 的兄弟目录，需要明确发行根归属，不能被 home 计量遗漏后宣称全覆盖。

T06 本棒仅新增只读 measurement.ts 与认证 POST /api/nidofy/storage：明确管理路径、共享 home/同物理文件去重、未知/链接/不可读/观察期间改变返回 measuredBytes=null，保留 observedBytes；排除官方 sessions/storages、工程、运行时及凭据内容。它没有预留/删除/结算权，不能直接作为跨 writer 原子准入快照。真实文件 5 项回归通过，built 完整 Host 端点也已覆盖。后续按实际 writer 范围更新，不将 inventory 当 T06 配额完成。

T01 本棒从当前 apps/desktop-host/lib/index.js 启动完整 official base/Web/Nidofy profile，使用真实 Office 资源、当前源码构建的 native protection helper、合成 Key 与本地 SSE provider。缺 Key 重启、有效路由的真实 Agent 会话、全缺 Key 时实际认证英中页面 DOM 修复、owner 安装降级保留文件、非 owner fatal、ready/quit/unload IPC/端口关闭通过。修复了 fatal 后 shutdown(0) 覆盖 exitCode=1；启动 fatal 现在保持 exit 1。新 connections-profile.built.e2e.ts 已纳入现有 e2e 配置。实际 keyless/successful 会话记录已保存，但未执行标准顶层 recorded-session snapshot harness；jsdom 不等于 Electron renderer/preload。Office 仅资源/工具注册，无转换或完整 runtime preparation；无 Electron 壳或安装包资格。不要把旧 packaged candidate 当当前产品通过。

T09 本棒接通真实 home .env 的 HTTP(S)/fallback proxy 与 bypass 编辑：官方 file lock + 文档 CAS + atomic replacement，保留无关字节和未编辑认证值，状态脱敏并显示 saved/applied/来源/继承覆盖。拒绝带认证的新代理输入、非 HTTP(S)、路径/query/fragment、字段注入和过期修订。真实在途请求保存后连续完成，当前 dispatcher 不变；重启完整 Host 后官方 launch layer 生效，本地代理实际传输 ManagedAdapter 请求，回环/绕过路由按官方策略。英中 UI 只提交 dirty 字段。CA 仅显示启动环境声明，遵守 NODE_EXTRA_CA_CERTS 必须在启动 Desktop 前提供的规则；不向 .env 写信任、不改系统环境。自定义 CA TLS 和 Electron 页面网络资格未验证，T09 仍 PARTIAL；不要宣称 HTTPS/证书安装或连接级热切换。

W04 已由 Astra 解决：公共 SessionDurableObservation 同次返回 branded physical generation、durableThrough 和原始耐久事件前缀；JSONL observation/generation guard 复用 writer 队列与跨进程 lease，保护 admission 至提交。同文件追加/冷启动保持身份；复制恢复/fork/新物理写迁移改变身份；历史转换读保留源身份，派生提交前须官方 write-open 迁移。不得用格式版本、cache revision 或测试数字代次替代生产身份，原 buffered 探针仍严格 [0]。T05 已实现 readSelected 轻量选定指针读取、显式启动/成功压缩 synchronize、同次 observation 复用、commitThrough 后候选扫描、会话队列/LRU 和实际 generation guard。Companion API 已有，T13 未接线。启动、完整 durable observation、冷 JSONL/query 准备与淘汰后身份取得仍可能全量；没有 range durable API、内存峰值或真实工程/安装性能资格，不称所有路径增量。

数据决定不变：v1 复制转换保留原文件；数字 generation v2 拒绝 NOTEBOOK_GENERATION_REBIND_REQUIRED，新物理 scope 拒绝 NOTEBOOK_SCOPE_CONFLICT。不删已提交文件、不重置游标、不自动重绑；兼容诊断不阻止会话启动。提交后 logger/lease-release 诊断失败不改写 Notebook 成功；persisted 不是新增耐久回执，原子指针不承诺断电耐久。T02 继续显式 overlay，默认 credentials provider 不变；普通备份/导出排除、迁移修复 UI 和发布资格未完成前不得默认激活。

本棒命令与失败修复链在 .build/dispatch/evidence/relay-04/commands.json。最终 source 组合 5 文件 32 项通过；完整 built profile e2e 另有 1 文件 1 项通过，不能相加称一次全绿。Host 正式类型、9 路径正式 type-aware lint、当前 Host bundle、native locked helper、2 组定向双语配对、i18n/字数/JSDoc、定向链接/换行和 diff 检查的实际记录见同目录。无新 manifest/依赖/lock 变化；后续直接调用现有 node_modules 的 Node 入口，避免 pnpm exec 隐式同步。完整 doc-sync/全仓配对未重跑；前棒用户 migration/assets/live2d/README.md 缺英文配对和历史 7 处禁用词仍保留，不能宣称完整 PASS。

你承担决定、实现、所有消费者、共享接线、原 R、依赖/lock/tsconfig/bundle/exports、必要审查、验证和必要双语文档。只用隔离数据、合成 Key、本地 provider，不调用计费服务；不创建线程/代理/定时器，不 push/合并主线/发布，不迁移真实用户数据。普通 UI/编译/fixture/登记自行修复。每个行为单元验证后继续，不因一个测试/提交/Txx 停止；保留未覆盖路径和真实环境限制，不用测试替身资格代替产品。结束前更新 NEXT_HANDOFF.md、NEXT_PROMPT.txt，保存下一个未使用 relay-NN-astra.md，最终贴出同一完整 Sol 续开发 prompt 和具体转交原因。交回实现、验证与精确剩余项，不只输出设计建议。
```
