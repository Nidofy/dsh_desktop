# Relay 08：Astra / T10 物理导入、恢复与接纳

日期：2026-10-08，Asia/Shanghai。目录和分支保持 D:/Documents/FeiyangChen/devApps/dshWinUi/electron / codex/roadmap-integration。此次只更新 T10 registry/tasks，所有历史未提交工作保留；不修改 ownership，不创建线程/代理，不提交或发布。

## 决定及交付

采用原物理发行根管理的原位 adoption，避免跨根搬迁、Session patch 二次重写和第二账本。一个 import operation 绑定一个 grant；精确 stage 的 private capability 逐写持久扣减用户确认的累计上限。覆盖副本、真实编码后继、完整临时元数据；产品不再写 owner/takeover 协调锁。目录分配开销、RAM 不在文件字节上限内，原生日志另有每次追加的磁盘安全检查。

采用 native v2 upsert 记录并保留 v1 前缀；真正 schema/serde/兼容测试已更新。五个持久阶段中，publishing 持有目录/home identity 和 receipt digest，显式恢复只能完成这项已记录发布。未知 ACK 不自动重放，旧 owner 实际退出才回收；copying 中断保留且不续写。Native sync 回执不提升普通消费者文件/rename 的断电资格。

Adoption 原位且独立确认，核对物理身份并排空 grants，原根持久登记 home。现有排除项变固定保留费用防止接纳时计量消失；managed 文件计一次，后续官方排除项增长按普通 home 策略。固定费用暂不释放。workspace/scopes 放 review，凭据和计划不自动激活。原库 standalone 行为仍可显式使用，但 HTTP 修改缺少 owner 拒绝。产品导入 home 层 patch 已由当前完整 Host 实际加载，含 raw 旧 Session 冷读。

详细当前路径、限制和下一步见 [本棒交接](../dispatch/NEXT_HANDOFF.md)，协议见 [native README](../../../native/nidofy-protection/README.md)。[历史 dossier](ASTRA-T10-20261008.md) 的三个问题已解决，不改历史复现记录。

## 验证

[commands.json](../../../.build/dispatch/evidence/relay-08/commands.json) 保存各自命令、日志和修复链。最终 source 7 文件 65 项；另行 Rust 6 项；另行 current built Node-mode 全 profile 1 文件 1 项；正式类型、10 路径 lint、当前 bundle/helper、2 UI 快照、5 英中配对和相关登记通过。不同执行不相加。Built 冷读揭示 per-profile patch 被发行 profile 绕过，修为 home patch；Windows 返回路径也修复，探针读 header 改按真实 handle。早期失败日志均保留。

整体 T06/T10 仍 PARTIAL：产品类别复核/选择体验、信任与未来计划恢复、清理/固定费用释放/journal维护、真实环境资格未完成。完整 doc-sync/全仓配对未跑；旧用户素材/禁用词缺口保留。没有新 Session acknowledgement、默认凭据切换或 npm/crate/manifest/lock/Config/exports 变化。

## 转交原因

跨模块持久化与权限决定已经亲自实现、审查并验证，按 CONTINUOUS 交回 GPT-6.1-Sol 继续产品流程及后继 owner/消费者。不是同模型上下文续棒，不是尚未解决的架构阻塞。用户需手动切模型；没有后台运行。

## 发出的完整 prompt

```text
请使用 GPT-6.1-Sol 继续 DSH Electron 持续开发。Relay 08 的 Astra 已决定、实现并验证 T10 物理导入根、持久操作恢复和显式原位 adoption；本次交回常规产品开发，不是同模型续棒，也不重开 W04/T06 原账本决定。

工作目录：D:/Documents/FeiyangChen/devApps/dshWinUi/electron，沿用 codex/roadmap-integration 与主目录。保留全部未提交修改、来源 worktree、用户 Live2D 素材及历史台账。不校验 SHA、不初始化、不重复接收 T02/T04、不重新审查已完成单元。Relay 08 只更新 registry/tasks 的 T10 条目为 PARTIAL；ownership 和其他旧修改不归本棒。

完整读取 AGENTS.md、适用下级规则、docs/architecture.md、packages/AGENTS.md、docs/defensive-patterns.md、migration/roadmap/dispatch/CONTINUOUS.md、NEXT_HANDOFF.md、migration/roadmap/handoffs/relay-08-astra.md、native/nidofy-protection/README.md。再按需读取 contracts-v1.md 的实际消费义务、T10-migration-wizard.txt、relay-07-sol.md；ASTRA-T10-20261008.md 是已解决问题的历史输入，不能重新当阻塞。账本细节读 relay-05-astra.md，管理/快照/CA 前棒证据读 relay-06-sol.md。以当前源码、配置、测试和全部未提交改动为准。

第一项动作：从当前已启用的认证 import preview/execute/inspect/recover/adopt 和双语 UI 继续 T10 产品闭环。核对逐类别映射与复核报告，补实际支持版本、拒绝/保留/待复核说明、返回 home 的显式选择/后续启动体验，以及隔离工作区信任和计划清单的独立确认流程。复用已发布 ImportLease 和 native operation；不要把 ready/adopted 当当前 Host 已切换，不自动激活计划或信任。没有真实接口的功能先确定 owner 并实现全部消费者，不能猜草案。T10 后按实际依赖继续 T11/T12/T13 或其他就绪单元，不因一次测试/一个 Txx 停止。

本棒决定和实现：原 canonical home 父目录是唯一物理发行根，imports/<operation>/harness 显式原位接纳；Windows root、目录和 home 身份必须匹配原账本。一个 import operationId 就是一个 quota grant ID；秘密 token 只在 Host WeakMap。Native 原子登记 grant/operation/新 stage，逐内容写前持久扣减显式累计上限，覆盖有界复制、实际编码后继和完整原子元数据。产品不再建立 owner/takeover 文件锁；账本记录另有逐追加磁盘余量检查。sourceBytes 不是整体预算，文件额度不含文件系统分配开销或解码 RAM。

Native v2 schema/serde 已更新：保留并读取 v1 前缀，追加 v2，旧 helper 拒读 v2；不重写旧日志、不自动降级、没有 Session 类型变更或新增 Session acknowledgement。阶段 copying/publishing/ready/interrupted/adopted 持久化。发布先 sync intent、目录/home identity 和 READY receipt 摘要，再同父目录 rename、再记 ready。丢 ACK 只查询；unknown 不授权重放。显式 recover 先确认原 writer 实际退出，未完成 copying 保留为 interrupted 且不续写；已记录 publishing 可从匹配 pending 或 final 完成。取消等待写入/转换排空；晚取消和 release 失败不推翻已提交结果。普通文件和 rename 没有新增断电耐久回执。

Adoption 独立确认并在 grants 排空后持久登记原根 home，绝不开嵌套 ledger。既有 Session/attachment/配置等排除项字节转为可见的固定 retainedExcludedBytes，后续官方排除项增长沿用普通 home 规则；managed 文件只计一次，父目录 review/receipt 继续计量。固定费用即使对应文件消失仍保留，暂无释放/清理机制；inventory 只报实时文件长度，不等于账本费用。工作区信任和保护范围复制到 review/harness，未激活。既有 standalone 副本不能伪造 operation 来接纳。新 home 的 cordis.patch.yml 正式 home 层保存绝对 Session root/编码；返回 DOS/UNC home 可供后续启动，原生仍校验 canonical identity。HTTP 修改缺少 Storage owner 时拒绝，不能回落到无配额 standalone 导入。

验证与修复：最终源码同次 7 文件 65 项通过；另行 Rust 6 项通过；另行当前 built 完整 Node-mode profile 1 文件 1 项通过，含认证产品导入、原位 adoption、新 Host 同根账本、实际旧 Session 经官方 Loader 冷读和源字节保留。原两个真实 Windows 拒绝探针保持严格，新增精确/少 1 字节额度、越界路径、源变化、取消、实际 owner 退出、丢回复、降低额度、目录替换与计量案例。Rust 发布前后故障重开验证不是物理断电或强杀资格。完整 built 曾暴露 per-profile patch 不被 Desktop 加载及长路径 HMR 错误，已改 home patch/返回路径并验证；后续探针 header 读取错误也已修复。不同命令不能相加称一次全绿。

准确命令、失败修复链和日志在 .build/dispatch/evidence/relay-08/commands.json。正式 Host 类型、10 路径正式 type-aware lint、当前 extras/Host bundle、locked native helper、2 个双语迁移 UI 快照、5 组双语配对、catalog 119 fresh、JSDoc/i18n/升级指南/字数及定向链接/换行/diff 检查有记录。Session 检查仍 63 roots/9 history，changes=[]。无新增 npm/crate 依赖或 Config/manifest/lock/exports 变更。直接使用现有 node_modules 的 Node 入口，不用 pnpm exec 隐式同步。完整 doc-sync/全仓配对未重跑；用户 Live2D 英文配对和历史禁用词缺口保留。

保持 Relay 05/06 ordinary/terminal、实际 PID/创建 FILETIME/wait、unknown 不回收、writer 排空后完整 scan、status 不 sweep、明确 recover、归档 expectedRevision 和独立逐文件恢复规则。清理仍无执行器。W04/T05 physical generation/raw durable prefix/readSelected/synchronize/队列/LRU 保持，Notebook 新 scope 不自动重绑或删除旧代。T02 仍显式 overlay，默认 credentials provider 不变。T01/T09 Node-mode/profile/local proxy/CA 证据不代表 Electron renderer/preload/页面网络、企业网关、Office conversion/runtime preparation、安装或正式顶层 recorded-session snapshot。T06/T10 整体未完成；真实满盘、断电、独立 SID、实际 PID 重用、冷搜索和 decode 内存峰值未获资格。

你承担实现、共享接线、所有消费者、配置/构建、必要双语文档和有效验证。只用隔离数据、合成 Key、本地 provider，不调用计费服务、不迁移真实数据、不创建线程/代理/定时器、不 push/合并主线/发布。普通 UI、类型、fixture、lint、注册和文档错误自行修复。遇到真正新的高风险持久化/权限决定才按 CONTINUOUS 给出具体文件和复现交 Astra；会话限制只写同模型续做 prompt，不冒称架构阻塞。结束前更新 NEXT_HANDOFF.md、NEXT_PROMPT.txt，保存下一个未使用 relay-NN-sol.md，最终贴出同一完整 prompt 与具体转交原因。
```
