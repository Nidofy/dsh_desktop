---
description: "比较保留回执，并确认隔离工程 turn 和有界矩阵。"
---

# 任务回执比较

[English](README.md) | 中文

## 概述

比较已有回执输入和独立验收，或确认独立隔离工程任务及有界矩阵。工程请求保留完整官方输入和实际保护动作关联。缺失计数仍未知；读取或验证报告不执行任务。

## 目录

- [选择与比较](#select-and-compare)
- [记录与导入](#records-and-import)
- [单次任务请求](#single-task-request)
- [隔离工程任务](#isolated-engineering-task)
- [有界矩阵](#bounded-matrix)
- [实现](#implementation)
- [已知限制](#known-limitations)
- [开发备注](#dev-note)

<a id="select-and-compare"></a>
## 选择与比较

从工程工作台的**构建与测试**页打开**比较任务回执**。输入已有工作区，加载保留回执，选择 A 与 B，并选择 Notebook 或缓存作为计划比较的因素。读取不创建目录、票据、提供方调用或执行。页面创建显式 experiment／case 分组 ID；这些标签不证明运行属于同一任务，也不证明实际使用了不同因素设置。

读取方为每个准确的规范工作区／run 引用调用实际 [VerificationOwner](../workbench/verification.ts)。它比较已提交身份、意图、源码／输入指纹、执行配置、输入覆盖、当前新鲜度和日志可用性。配置修订仅在同一工作区内可比。已知差异、过期结果或重复选择同一次执行会拒绝直接任务比较。不可用观察保持未知。解析的测试、验收和新鲜度分别保留；两次验收通过不证明质量相同。

表格将所选原运行链接到其保留回执，并显示各计数的缺失侧数。解析的测试数按侧独立取得，只来自完整可用的 T11 日志。模型调用、输入／输出 tokens 和缓存读取 tokens 为 null，缺失侧数为二，因为 T11 不拥有这些测量。回执输入匹配不证明完整任务可比或效率提升。完整比较超过 64 KiB 时明确拒绝，不裁剪或归档。

**检查 A/B 的模型选择 step**仅在显式操作后读取私密证据。原始 T11 执行来源限制 Session；唯一已提交的 `run_project_action` 结果、匹配回执和调用身份共同确定选择动作的 turn／step。官方持久读取方及物理代次保护使用实际已注册的消息解释器，重建每次已结算尝试的完整日志历史、调用配置和工具声明。视图保留原文，可能包含敏感任务内容。读取不会发送、flush、修复或发布 Session。桌面运行、继承结果、缺失或歧义关联保持未知。官方读取后扫描超过 4,096 条事件或 2 MiB 时拒绝；完整响应超过 64 KiB 时拒绝，不裁剪。

Step usage 来自官方内嵌流，包括已结算的失败尝试。任一尝试缺少某 token 计数时，该项仍为 null；明确的零保持零。这些计数仅覆盖选择动作的 step，不代表整个任务或所有提供方网络请求。历史日志不保留发送截点，因此重建的结算前日志前缀与尚未观察的实际发送输入分别标记。每个尝试从匹配请求 route／model 的受支持官方 finish replay 元数据读取提供方报告的模型；缺失或不受支持时保持未观察。报告的标识与请求 alias 都不认证不可变模型版本。历史 Notebook／缓存策略保持未知；当前偏好或笔记文本不能证明当时设置。读取不改变比较表格或 schema-version-1 选择检查点。

<a id="records-and-import"></a>
## 记录与导入

**保存选择记录**在 `nidofy-extras/experiments/records-v1` 下提交独立的 schema-version-1 `receipt-task-comparison` 记录。记录保留分组／run 引用、时间和小型回执检查点，包括独立验收修订。读取同时显示已保存检查点和新检查事实，并明确标记变化。它不会改写已保存记录或重建未完成回执。保存响应未知时，页面重载仍保留调用方生成的身份；显式查询不会自动重新提交缺失记录。

完整 UTF-8 JSON 每份记录最多 64 KiB，最多保留二十份。目录最多八十个条目，总字节最多 `22 × 64 KiB + 4 KiB`，计入锁和临时残留；准入包含发布峰值空间。现有原生发行配额覆盖锁元数据和独占同步发布。容量不足、损坏、链接或不受支持版本拒绝后续写入，保留原字节。记录不会自动裁剪。Host 卸载取消未发布操作，在 T11 关闭前排空全部当前读取／写入；发布后取消不会否定已提交记录。

导出产生包含工作区路径和回执身份的私密选择 JSON。它不含模型正文或凭据，也不是脱敏诊断导出。导入检查完整大小、版本、允许字段、来源分类和身份，再独立读取两个本机已提交 T11 回执。规范选择和每项检查点都必须与当前观察一致；不能单独信任来源字符串。外部、已变化、伪造、旧式或未完成证据拒绝，不执行任务、不发送模型，也不自动修复。已有记录 ID 拒绝替换，应查询该身份。旧诊断／Probe 报告不会导入或静默升级。

<a id="single-task-request"></a>
## 单次任务请求

同一页面提供独立的**单次任务请求**，用于私密分析文本。选择受管连接／模型，输入完整文本和输出 token 预算，可选显式 Notebook 源 Session，再预览完整任务、已提交笔记、物理代次、笔记／设置修订及渲染限额。准备不 flush 或同步源、不读取凭据、不分配日志、不发送；缺 owner 拒绝所选输入。确认显示的输入和修订后，仅授权一次请求，提供方重试为零，输出最多 8,192 tokens，生命周期为三分钟。请求没有工具、Agent、工程写入或回执；分组标签不证明属于共同验收任务。启动未确认时，页面重载仍保留运行身份，应显式读取，不重新提交。取消等待提供方及 writer 排空。关闭页面取消未确认的预览读取，不取消已提交工作。

[任务 owner](task-requests.ts)在发送前重验实际受管连接修订、独立 T23 HTTP lease 及所选 Notebook 捕获；源代次、笔记／设置修订变化时拒绝，不静默刷新已确认内容。[输入日志](task-inputs.ts)通过官方 Session writer 写入完整 header 和私密文本，以及带两个前导换行的独立笔记文本块，flush 后冷读重建请求，再提交准确前缀截点，在同一物理代次下调用绑定的 prepared-call。`preparedInput` 独立保留；`dispatchInput` 需要已提交终态证明 stream 已被调用。准备与终态发布之间进程丢失时保持 INTERRUPTED，dispatch 数未知。截点标识交给 prepared-call 的 Harness 请求，位于提供方 wire 投影之前；它不证明准确 wire 字节或提供方网络调用数。显式笔记输入不等于完整 Agent prompt assembly 或工程任务因素实验。

每次请求在 `nidofy-extras/experiments/task-requests-v1` 下使用全新的独立 schema-version-1 日志。完整文本最多 16 KiB，捕获流最多 2,048 chunks 和 24 KiB，完整读取响应最多 64 KiB，保留 root 字节最多 256 KiB，包含发布峰值。准入允许二十个 root、十个未终结 root、每个 root 八十项，目录总字节最多 `22 × 256 KiB + 4 KiB`，包含准入锁。原生普通和独立终态额度覆盖各 writer。未知残留、链接、hardlink、损坏或未来记录拒绝，不裁剪。输出拒绝或取消在能容纳时保留明确不完整的流；终态提交未确认时保持 interrupted。读取不修复日志或补发。

独立 schema-version-1 的 `notebook-input.json` 和 `execution-observation.json` sidecar 保留可选源捕获、实际已应用 Desktop 缓存提示、捕获的偏好修订及官方响应模型标识。响应标识必须匹配冷读官方流；观察方不保留缓存键或凭据。准入验证既存 sidecar 并拒绝未知 root 残留。旧日志缺 sidecar 仍可读取，不补造历史观察。终态发布未确认不认证已应用因素；缺 transform 保持未知，原生／移除／会话键仅描述路由提示，不证明提供方缓存启用或命中。

计数来自官方捕获流。缺失计数保持 null，包括被 adapter 省略的零；明确报告的零保留为零。输入与缓存读取计数保持官方含义，不从 wire prompt 总数重新计算。请求保留显式 Notebook 输入和实际缓存路由提示观察；提供方缓存行为及准确模型版本仍保持未知。质量、回执关联和任务 A/B 效率仍未资格化。原比较表、选择记录、T11 回执和 T19 报告保持各自独立语义。

<a id="isolated-engineering-task"></a>
## 隔离工程任务

**隔离工程任务**预览显式完整的相对输入闭包、已在本机信任的构建／测试动作、完整任务文本，以及独立的请求／输出／工具／动作／时间预算。实验／算例 UUID 可在分别显式确认的因素试验中复用；空白字段只生成一次本机标签，修改标签使预览失效。标签本身不证明输入相同。确认后创建保留的新工作区副本和一个官方 Agent turn。Agent 只能列出选定动作并执行已审阅 ID；不能提交 Shell 命令、使用 PTC、更改设置或验收回执。副本配置只从本次显式确认取得信任。每次请求和动作执行前重验源信任／配置、受管连接修订和实际 T23 lease。确认输入变化时拒绝；失败和未知结果不重试或故障转移。全访问 profile 拒绝准备；请求和动作前重验实际 Session 沙箱模式及副本边界，只读保持只读。

[复制 owner](project-copy.ts)读取每个选定文件，包括脏文件、未跟踪文件和二进制输入。链接、硬链接、重叠输入根、VCS 元数据、越界路径和 Windows 路径别名均拒绝。复制到独占目标前后检查物理身份与完整字节。限额为 512 项、总计 16 MiB、单文件 1 MiB，覆盖选定的传入闭包，不覆盖后续已审阅动作的全部输出。失败时保留部分副本和原来源，不覆盖源文件。

目录预览采用有界迭代，只保留剩余项数额度内的名称后再排序；选定目录嵌套超过 128 层时拒绝。恰好达到限额的闭包保留相同的有序观察和指纹。拒绝枚举不返回部分预览，也不分配目标。

独立[资源 owner](engineering-resources.ts)要求每份新工程预览显式提供 `resourceBudget`，矩阵行也相同。`workspaceBytes` 和 `workspaceEntries` 覆盖整个复制项目，包括后续输出；`retainedWorkspaceBytes` 在创建另一副本前计入每个保留分配的完整工作区上限，运行结束不返还这些费用。每项目最多允许 128 MiB 和 4,096 项，保留工作区上限总计最多 512 MiB。准入检查既存物理分配 owner 及完整当前文件长度；旧日志缺分配记录仍可读取，资源保持未知，但拒绝新资源准入。身份变化、链接、硬链接、不可访问树和不完整枚举会拒绝，不删除或裁剪证据。

独立 [Shell 观察者](engineering-shell.ts)要求显式提供 `shellBudget.outputBytes` 和 `shellBudget.retainedSpillBytes`。它在结算后从实际 Workbench handle 读取完整流字节坐标，不使用有界尾文本长度代替，并核对可用 spill 文件身份及长度。耗尽或未知观测会拒绝后续请求／动作，保留原动作结果和 T11 回执。每个保留运行至少持续计入完整输出额度；更大的已观测输出或实际 spill 增加保守费用。截断却没有可用 spill 或 spill 计量失败时，保留容量保持未知；独立已知的完整输出坐标仍保留，比较不会将未知 spill 容量显示为零。旧记录缺 Shell owner，或 spill 已变化／不可访问时拒绝新准入，不删除、接管或重放。每运行输出最多 64 MiB，保留 spill 费用最多 512 MiB。原生日志 quota 不覆盖这些文件；动作期间磁盘增长及解码／Host 内存峰值仍未知。

`sessionBytes`、`sessionDiskBytes` 和 `sessionEvents` 分别约束完整逻辑持久快照、官方实际 `stat().sizeBytes` 观察和事件数，上限为 2 MiB、2 MiB 和 4,096。请求检查点 flush 并观察官方 writer，再于同一代次内读取物理长度，随后才进入 prepared 分派。缺失物理长度会拒绝，不按零计算。副本检查位于请求前、工具执行前后及排空后。动作输出超额时保留实际 T11 事实和副本文件，并阻止后续工作。独立 schema-version-1 分配／结果 sidecar 保留原限额及成功或拒绝的检查点。冷读重验逻辑 Session 前缀和排空后物理长度；比较把排空字节与 turn 计数及缺失侧数分开显示。这些是协作检查点限额：动作期间磁盘增长、副本外 Shell spill、分配开销、解码 Session 内存和 Host 内存峰值仍未资格化；原生受管日志配额不覆盖它们。

每次工程 Session 读取在 `observeDurable` 前检查真实物理元数据；缺长度或物理超额会在完整解码前拒绝。完整逻辑字节和事件限额在构造分离 Session 前检查，元数据修订变化时拒绝。冷日志读取沿用原 2 MiB／4,096 事件扫描范围，包含因更小确认检查点限额而拒绝的运行。全部输入截点、结算和资源观察在每次读取中共享一次完整官方观察和一次代次保护；没有请求截点的资源 sidecar 也会重验原逻辑前缀及排空水位。这些观察只属于本次操作，不跨读取缓存。物理较小的压缩文件仍可能在官方解码器内扩展超过逻辑限额，其分配与克隆峰值保持未知。

[预算 owner](engineering-budget.ts)最多允许八次请求、每次 8,192 输出 tokens、总计 65,536 个已分配输出 tokens、十六个工具执行、四次动作尝试和三分钟。每个字段必须显式提供。每次发送预留全部输出上限，未用输出不返还权限。每个动作 ID 最多执行一次。缺失输出 usage、失败／未确认回执、权限拒绝、预算耗尽和取消都会阻止后续工作。官方缺失计数仍为 null，明确零仍为零。计数只覆盖独立拥有的 turn 已获准的 prepared-call 入口；更早被拒绝的 stream 入口不是 dispatch；提供方 wire 计数和不可变模型版本仍未观察。

[输入捕获](engineering-inputs.ts)在官方 checkpoint listener 之后运行。它 flush 实际 Session writer，用注册的消息解释器冷读完整前缀、比较完整请求、发布截点，再在该物理代次内进入原 registration-bound stream。输入超过 128 KiB、流超过 2,048 chunks 或 24 KiB 时拒绝，不裁剪。流在代次保护内排空后才把有界 chunks 交回 Agent。即使预算拒绝后续工作，官方 finish 和 usage 仍交给正常 Agent 结算。嵌套或无关调用不取得本次运行权限。

独立 schema-version-1 记录位于 `nidofy-extras/experiments/engineering-v1`；原分析、比较、T11、T19 和 Session 格式不变。独占发布使用原生配额中的独立 2 MiB 普通额度和 1 MiB 终态额度。准入最多二十个根、十个未终结根、每根八十项，含锁的目录记录总量为 `22 × 2 MiB + 4 KiB`；每根包含发布峰值最多 2 MiB。副本保留在应用 home 之外，传入文件另有限额；此日志配额不认证后续动作输出或官方 Session 的完整内存／磁盘峰值。完整读取超过 1 MiB 时拒绝。在途读取只显示 RUNNING 和未知计数；Agent／提供方／配额排空后的终态记录才认证发送观察。冷读按官方代次验证完整输入，并按官方结算验证观察。缺失终态保持 INTERRUPTED 和未知计数，不恢复或补发。

工程与矩阵日志目录在收集名称前使用有界迭代，未知锁和临时残留也计入限额。容量拒绝保留各 owner 原有的诊断码。工程日志的递归大小检查也在完整项数上限内迭代。已获准的终态 writer 在读取取消后继续扫描和发布，保留原排空义务。

回执关联要求实际唯一的官方 `run_project_action` call/result、调用身份、匹配的 T11 回执及原执行来源；Session 标签不能建立动作事实。测试、新鲜度和本机用户验收分别保留。可选 Notebook 和缓存输入分别保留；缓存提示观察不认证提供方缓存行为。未知启动跨重载保留身份供显式读取。关页只中止 HTTP／读取生命周期；显式取消停止并排空自有复制、Agent 和动作工作。

显式 Notebook 源由实际 owner 读取，不同步、flush、转换或写入源；完整文本作为独立 User 块追加。发送和动作执行前重验源代次、笔记／设置修订及限额。可选 schema-version-1 `notebook-input.json` 保留原捕获。可选缓存选择确认实际 `nidofyCacheInput` owner、启用／挂载状态、偏好修订和当前策略；不更改全局偏好。独立 `cache-input.json` 捕获必须匹配随后实际应用的 payload 观察。旧日志缺 sidecar 仍未观察，当前设置不补历史字段。

**比较保留工程 turn**通过工程 owner 读取原运行身份。独立[比较](engineering-comparison.ts)展示完整 prepared 输入、原 intent／终态时间和配置、观察到的提供方报告标识、复制输入闭包、Notebook／缓存捕获，以及当前因果 T11 回执。任务／代码／输入／模型／配置或完整上下文不同会拒绝直接比较；保留全部模型可见字段，Session 身份另作运行定位。表格报告整个 turn 的 prepared 分派、官方 usage 和缺失侧数，可显式读取原日志或打开准确保护回执。输入与缓存读取 tokens 分开，失败结算已有计数仍可见，缺失计数不从回执推断。独立双验收仅标 BOTH_ACCEPTED，不可变准确版本仍 null，efficiencyEligible=false。读取不验收回执，不改变旧比较表或 records-v1。

<a id="bounded-matrix"></a>
## 有界矩阵

[矩阵 owner](engineering-matrix.ts)预览同一实验、算例和任务文本的两到四行工程任务。显式总限额最多允许 32 次请求、262,144 个已分配输出 tokens 和 60 秒。每行准入前预留完整请求／输出上限，在新副本中顺序执行，归档排空后的状态、计数和原回执引用。失败、未知、超时或取消阻止后续行；取消保留已排空的当前轮。每行重验当前设置；不同缓存模式需要分别显式确认的试验。

独立 schema-version-1 记录位于 `nidofy-extras/experiments/matrices-v1`：最多二十个根、十个未终结根、每根十六文件及含发布峰值 2 MiB，目录准入为 `22 × 2 MiB + 4 KiB`，使用原生 2 MiB 普通／1 MiB 终态授权。读取重验完整原预览、连续轮次和对应工程日志。工程 owner 内串行读取官方代次；读取快照在终态发布期间保留原在途状态。完整读取和报告超过 1 MiB 时拒绝。完成的汇总要求每轮计数完整，否则仍为 null。提供方 wire 计数仍为 null，质量 UNKNOWN，efficiencyEligible=false。

**导出原矩阵报告**只保留原 intent、轮次和终态以及来源身份／开始时间。**按本机日志验证报告**检查版本、大小和准确保留来源后返回读取结果；不创建任务、不写导入日志，也不修复或重放缺失来源。冷读和导入保持原字节。

<a id="implementation"></a>
## 实现

[TaskComparisonOwner](owner.ts) 是工作台拥有的读取方和归档消费方，委托独立任务请求 owner。现有认证连接分派器提供 `/api/nidofy/workbench/experiments/ui` 以及 `experiments/compare`、`record`、`list`、`read`、`import`、`task-prepare`、`task-start`、`task-read`、`task-cancel` 和独立的 `engineering-prepare`、`engineering-start`、`engineering-read`、`engineering-cancel`、`engineering-compare` 和 `matrix-prepare`、`matrix-start`、`matrix-read`、`matrix-cancel`、`matrix-export`、`matrix-import`。只有本地用户 HTTP 路径暴露这些操作；没有模型工具或另一应用启动器。各操作拒绝无关字段。没有存储的修复组合仍可只读比较；缺少各自必要 owner 时拒绝归档和任务请求。

[比较](comparison.ts)投影实际 T11 事实，[记录](records.ts)验证独立归档格式，[模型关联](model-lineage.ts)读取准确的选择 step 证据，[UI](ui.ts)负责双语展示与拒绝迟到结果。认证 `experiments/model-step` 操作只接受选择和侧别。读取方不消费旧缓存 Probe 的发送路径，也不从诊断归档推断任务身份。built profile 证据和剩余资格见 [Desktop 测试参考](../../../desktop/tests/README.zh.md#verification-experiments)。

<a id="known-limitations"></a>
## 已知限制

有界矩阵不认证一般 Agent 任务计费、真实模型质量或 A/B 效率。独立单次分析日志不能使所选 T11 任务可比。历史发送输入、Notebook／缓存设置和准确模型版本仍未观察。嵌套 PTC 分派没有直接 `run_project_action` 结果，仍保持未知。T19 固定自检输入不作为任务 A/B 证据复用。沙箱 Shell 枚举可能使 T11 覆盖保持 unknown，即使真实 TAP 测试通过。回执工作区必须可达。已安装 renderer、真实崩溃和恶意并发文件系统替换仍未资格化；读取不授予修复或删除权限。

<a id="dev-note"></a>
## 开发备注

无。
