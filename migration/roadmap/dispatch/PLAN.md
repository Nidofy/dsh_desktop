# DSH Electron 人工多模型派工计划

## Summary

本派工包把既有实施方案拆为 27 个有文件范围、前置依赖和验收要求的任务，并提供逐任务启动 prompt。你选择模型、准备工作目录并分派任务；GPT-6.1-Sol 负责日常审查与集成，GPT-6 Astra 负责高风险设计、关键阶段和最终验收判断。T00 已形成基线、接口草案和文件归属，状态见 [派工登记](../registry.json) 与 [T00 交接](../handoffs/T00.md)；尚未启动后续任务或修改业务代码。

## Table of Contents

- [如何使用](#如何使用)
- [模型分工](#模型分工)
- [任务总表](#任务总表)
- [实施顺序](#实施顺序)
- [共享文件与接口](#共享文件与接口)
- [额度与节奏](#额度与节奏)
- [完成标准](#完成标准)
- [来源与假设](#来源与假设)
- [Dev Note](#dev-note)

## 如何使用

第一次先在 Codex 选择 Astra，打开指定的 Electron 主目录，将 [T00 完整 prompt](prompts/T00-baseline-contracts.txt) 发给它。T00 固定实际基线、接口与任务归属，并把本派工包纳入本地集成分支。不要让其他开发者在 T00 完成前独立发明公共接口。

随后按 [执行手册](EXECUTION.md) 准备位于 Electron 目录内部的 worktree，每个模型会话绑定一个任务目录。执行依据是该目录的实际代码、配置、接口和测试结果，包括相关未提交改动；Git 提交号仅用于可选追溯，不作为开工或验收门槛。打开总表中的 prompt 文件，确认实际工作目录后发送，无需填写提交号。任务文件已经包含共同约束，不需要再拼一个超长总 prompt。模型应在客户端选择，提示词中的模型名称不会自动切换模型或调度其他套餐。

每个任务先独立 [审查](prompts/REVIEW.txt)，通过后由唯一集成人员 [集成](prompts/INTEGRATE.txt)，再把集成提交交给后继任务。每阶段使用专门的收口 prompt；最后用 [G-F](prompts/G-F.txt)。后继任务应确认所用目录实际包含依赖实现及所需接线，不能仅凭作者完成声明判断就绪。

## 模型分工

这是按项目风险与现有资源制定的初始派工策略，不是这些模型在本仓库的实测排名。首批任务之后按一次通过率、返工、耗时和套餐实际消耗调整；不为消耗额度而制造任务。

| 模型/入口 | 主要角色 | 使用原则 |
|---|---|---|
| GLM-5.3 / DeepSeek Harness | 16 个任务：多数业务实现、故障测试、迁移、自检、实验、发布脚本与文档 | 每次一个边界清晰的任务；接口已冻结；复杂状态/权限由独立模型复核 |
| Sonnet 5.5 / Antigravity | 5 个任务：设置、存储、角色 UI、Live2D、自然语言操作界面 | UI 可做较完整纵向切片，但不自行更改 Host 权限/数据语义 |
| Opus 5.5 / Antigravity | 3 个任务：安全凭据、压缩提交、可选侧边分析 | 将额度集中到少量高风险实现；不承担重复全仓扫描 |
| GPT-6.1-Sol / Codex | 2 个核心实现：原生清理/快照、会话绑定；另负责日常集成与问题修复 | 一个固定集成会话维护全局状态；审查可新开干净会话 |
| GPT-6 Astra / Codex | T00、关键审查、里程碑与最终发布判断 | 困难设计和跨模块不变量；常规合并修复交给 Sol |

OpenAI 的当前说明把 Sol 用于反复、长时间的复杂工作，把 Astra 留给最困难的工作；这是此分工的依据之一。Sol 日常审查先用默认/medium，原生与多模块集成用 high；Astra 普通审查可从默认开始，G-A/G-B/G-F 用 high，确有难题再提高。不要全部使用最高推理或加速档。[官方模型说明](https://learn.chatgpt.com/docs/models)

如某入口限额或不可用：Sonnet UI 任务改给 GLM，保留 UI 证据；Opus 的复杂任务改给 Sol，仍由 Astra 审查；GLM 的连续失败任务保留最小复现后交给 Sol。优先削减可选 T21/T22 或延后吞吐，不削掉独立审查。

## 任务总表

点击任务 ID 可直接打开对应启动 prompt。阶段表示推荐调度批次；依赖列是必须已集成的最低前置项。T25 随每个阶段续跑，不是一次执行全部未来功能。

| 任务 | 工作内容 | 首选开发模型 | 前置依赖 | 阶段 |
|---|---|---|---|---|
| [T00](prompts/T00-baseline-contracts.txt) | 基线、接口约定与派工登记 | GPT-6 Astra | 无 | S0 |
| [T01](prompts/T01-connection-recovery.txt) | 连接退化启动与凭据保留 | GLM-5.3 | T00 | S1 |
| [T02](prompts/T02-secure-credentials.txt) | Windows 安全凭据后端与转换 | Claude Opus 5.5 | T01 | S1 |
| [T03](prompts/T03-notebook-v2.txt) | Notebook 活动集、历史与 v2 转换 | GLM-5.3 | T00 | S1 |
| [T04](prompts/T04-compaction-budget.txt) | 压缩证据预算与提交游标 | Claude Opus 5.5 | T03 | S1 |
| [T05](prompts/T05-notebook-incremental.txt) | Notebook 增量同步与长历史测量 | GLM-5.3 | T04 | S1 |
| [T06](prompts/T06-storage-quota.txt) | 受管存储计量、配额与跨进程预留 | GLM-5.3 | T02、T05 | S2 |
| [T07](prompts/T07-native-cleanup-snapshots.txt) | 原生安全清理与快照操作接线 | GPT-6.1-Sol | T06 | S2 |
| [T08](prompts/T08-storage-snapshot-ui.txt) | 存储与快照管理界面 | Claude Sonnet 5.5 | T07 | S2 |
| [T09](prompts/T09-advanced-settings.txt) | 高级连接、缓存与部署网络设置 | Claude Sonnet 5.5 | T02 | S2 |
| [T10](prompts/T10-migration-wizard.txt) | 旧数据迁移向导与恢复回执 | GLM-5.3 | T07、T09 | S2 |
| [T11](prompts/T11-verification-records.txt) | 任务验证回执与过期判断 | GLM-5.3 | T07、T10 | S3 |
| [T12](prompts/T12-durable-notifications.txt) | 持久通知偏好与统一去重 | GLM-5.3 | T11 | S3 |
| [T13](prompts/T13-companion-scope.txt) | 显式会话绑定与轻量角色状态 | GPT-6.1-Sol | T05、T12 | S3 |
| [T14](prompts/T14-companion-ui.txt) | 静态角色、动态说明与窄屏入口 | Claude Sonnet 5.5 | T13 | S4 |
| [T15](prompts/T15-live2d-renderer.txt) | 固定单模型 Live2D 渲染插件 | Claude Sonnet 5.5 | T14 | S4 |
| [T16](prompts/T16-pet-coordination.txt) | 角色与桌宠关注、互动协调 | GLM-5.3 | T12、T13、T14 | S4 |
| [T17](prompts/T17-local-history-search.txt) | 中文历史检索与显式项目分组 | GLM-5.3 | T05、T10 | S3 |
| [T18](prompts/T18-hints-return-card.txt) | 规则 Hint 与项目返回卡 | GLM-5.3 | T11、T12、T14、T17 | S4 |
| [T19](prompts/T19-selftest-center.txt) | Electron 自检中心 | GLM-5.3 | T10、T11、T23 | S5 |
| [T20](prompts/T20-ab-experiments.txt) | 任务级 A/B 实验与有界矩阵 | GLM-5.3 | T11、T19 | S5 |
| [T21](prompts/T21-side-analysis.txt) | 受控侧边分析 | Claude Opus 5.5 | T18、T23 | S5-可选 |
| [T22](prompts/T22-natural-settings.txt) | 自然语言设置与可选口吻 | Claude Sonnet 5.5 | T09、T16、T21 | S5-可选 |
| [T23](prompts/T23-egress-policy.txt) | 工作区出口策略与网络边界 | GLM-5.3 | T02、T09 | S2 |
| [T24](prompts/T24-release-qualification.txt) | 候选构建、升级回退与发行证据 | GLM-5.3 | G-E | S6 |
| [T25](prompts/T25-independent-acceptance.txt) | 独立验收场景与故障注入 | GLM-5.3 | T00 | S0起贯穿 |
| [T26](prompts/T26-docs-capability-matrix.txt) | 用户文档、支持矩阵与交付核对 | GLM-5.3 | T24 | S6 |

开发模型与审查模型不同的建议写在各自 prompt 中。T00/T25/T26 是设计、验收、文档角色，不应按实现任务要求它们重写业务代码。

## 实施顺序

每条箭头都表示前项先通过独立审查并进入集成分支。并行只在文件归属不重叠、依赖满足时使用；最多三个实施会话加一个审查/集成会话起步。

| 阶段 | 推荐并行的三条工作线 | 阶段收口 |
|---|---|---|
| S0 | T00；完成后初始化 T25 | T00 接口与台账核验 |
| S1 可靠性 | 连接 T01→T02；笔记 T03→T04→T05；T25 独立测试 | [G-A](prompts/G-A.txt)：Astra |
| S2 数据安全与配置 | 存储 T06→T07→T08；设置 T09→T23；待 T07/T09 后启动 T10 | [G-B](prompts/G-B.txt)：Astra |
| S3 可信状态 | 验证 T11→T12→T13；检索 T17；T25 增量验收 | [G-C](prompts/G-C.txt)：Sol，高风险再交 Astra |
| S4 角色体验 | T14→T15；T14 后 T16；T14/T17 等就绪后 T18 | [G-D](prompts/G-D.txt)：Sol |
| S5 完整工具/可选智能 | T19→T20；可选 T21→T22；T25 | [G-E](prompts/G-E.txt)：Sol；侧边权限 Astra 复核 |
| S6 最终候选 | T24 构建验收→T26 文档；最后独立审查 | [G-F](prompts/G-F.txt)：Astra，Sol 修复与重新构建 |

P6 单模型可行性调查可以提早只读进行，但 T15 正式实现等待 renderer 接口和已选资产。T13 是共享状态基础，不与多个 UI 作者同时争改 Environment。T06/07 文件系统和配额协议必须串行评审。

第一批只开 T01、T03、T25。每个“交付单元”应能在约半天至两天人工监督周期内审完，这是调度粒度目标，不是模型完成时限；超过一个单元就按任务文件中的子目标拆提交。每完成 2–3 个可审交付就集成一次，不能等所有任务结束后才让 Astra 读一大堆 diff。

原方案 56–89 人日仍作为范围估计。模型并行可缩短日历时间，但单人调度、原生调试、真实 UI、资产和发行验收构成瓶颈；此时不承诺缩短到某个周数。完成 S1 后，再根据合格交付速度滚动估计。

## 共享文件与接口

| 高冲突区域 | 所有者与排期 |
|---|---|
| connections/store、runtime、api、ui | T01→T02 必要接线→T09→T10；T23 的发送策略由集成人员合入 |
| Notebook types/store/compaction/context | T03→T04→T05；T17 的 query 接线等前序稳定；T06 配额接入单独排期 |
| workbench/owner.ts 和大 ui.ts | T07/T08、T11、T12 等由集成人员逐个接线，禁止不同作者重排全文件 |
| Environment/index/locale | T13→T14；T15 拥有独立 renderer，T16 拥有 pet 协调，T18 独立规则；共同入口集中接线 |
| package.json、pnpm-lock、tsconfig、bundle、导出聚合与官方 seam | 集成人员独占；任务提交精确接线要求，必要时暂停其他相关作者后完成完整接线 |
| 运行证据与 handoff | 每任务专属文件和目录，不共写一个大日志；总台账只由调度/集成人员维护 |

“只改自己文件”不代表可以漏改必须同步的消费者。公共接口改变先在台账登记新版；集成人员暂停相关写入、完成所有消费者更新，再发布新基线。不得同时合入三套名称不同的 quota、receipt 或 scope 接口。

依赖接线若是任务编译/集成验收的必要条件，应由集成人员先提供最小骨架或一次性完成该接线；纯局部 mock 验证的任务只能标 PARTIAL，不能标已集成。

## 额度与节奏

GLM 团队“每周约 3 亿 token”采用你的账户信息，未把公开 Coding Plan 规则当成团队合同。团队共用额度先扣除其他成员用量，再设置本项目上限。建议本项目可用额度分为实现 50%、独立测试/回放 20%、检索语义评估 10%、返工预留 20%；只是内部预算上限，不是需要耗满的目标。

Pro 5x 的可用工作额度建议分配：50% 日常审查/集成，20% 架构和阶段审查，15% 难题修复，15% 最终候选储备。不要将订阅换算成 API token 或固定任务数，客户端剩余额度决定下一批任务。[官方额度说明](https://learn.chatgpt.com/docs/pricing)

Antigravity 先保留可用 Claude 工作预算约 60% 给 Sonnet UI、40% 给 Opus 高风险任务；实际由两者消耗和 UI 显示修订，不假设每个模型有独立满额池。接近周上限时把普通实现转给 GLM，保留复杂审查；不默认开启额外付费。[官方套餐说明](https://antigravity.google/docs/plans?hl=en)

每天建议只有两个短调度窗口：开始时选择 2–3 个依赖已满足的任务；结束时收 handoff、独立审查、合入合格结果并更新下一批可用目录与能力说明。后台只保留正在有效推进的会话，避免多个长上下文来回传整仓。

首轮登记：任务 ID、模型/入口、实际模型标识（可见时）、套餐消耗增量、墙钟时间、修改规模、审查发现、返工次数、集成验证。一个任务最多两轮同根因失败后升级诊断；小问题由原模型修，不立刻让最贵模型重做整项。

优先观察每个合格交付的总消耗和人工返工时间。token 数不同模型/服务计量不可直接当成质量或价格比较。

## 完成标准

一项任务依次经过 NOT_STARTED→IN_PROGRESS→READY_FOR_REVIEW→REVIEWED→INTEGRATED→QUALIFIED。ASSET_BLOCKED、DEPENDENCY_BLOCKED、ENVIRONMENT_BLOCKED、PARTIAL 和 DEFERRED 单独保留，不能计入通过数。

作者交付文件见 [HANDOFF 模板](HANDOFF_TEMPLATE.md)。复核发现要有文件/位置、触发条件、影响和验证方式；无问题也要说明检查范围和未执行项。集成需要实际运行相关行为测试、类型/文档检查及必要的 UI/原生验收，不以作者摘要为证据。

最终结论可以是合格的有限范围候选，而不是强行全通过。T21/T22 后置、真实网关未验收、Live2D 资产未准备等都应清楚标在支持矩阵。G-F 的结论必须对应实际受测代码、配置和安装包；不要求反复校验 Git 提交号。

## 来源与假设

OpenAI Docs 已核对 Astra/Sol 当前定位及订阅/API 额度区别。Google 当前模型表列出非试用 Google AI Pro 的 Sonnet 5.5 与 Opus 5.5；实际访问与剩余额度以你自己的入口为准。[Antigravity 模型表](https://www.antigravity.google/docs/models/)

GLM-5.3 按你已经在 Harness 使用的连接进行分派，不在本计划中改变供应商、代理或套餐。公开产品资料不能证明本团队具体周限额，也不据此计算确定完成时间。各任务的模型选择是可调整的工程安排，尚无本仓库同题对照结果。

## Dev Note

这是当前人工派工安排，不是产品功能说明。实际实现后应把稳定行为写回对应 package README，将本目录作为执行输入和交付索引保留，避免它成为第二份运行时事实来源。

派工包包含 27 个任务、6 个阶段门槛和 35 个 prompt；T00 对当前实际文件验证依赖图、登记与链接，并运行指定功能基线和文档/lint 检查。实际命令、通过项及既有失败统一保存在 [T00 交接](../handoffs/T00.md)，不把旧派工检查结果当成当前通过证据。后续未执行的功能、环境准备和发行验收仍保持未完成。
