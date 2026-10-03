# 基于官方 DSH 0.2.0-rc.1 的迁移实施计划

原计划核实日期：2026-09-29，Asia/Shanghai。状态更新：**已于 2026-09-30 升级官方 rc.2 并完成 M4 Windows x64 个人版实现与本地验收；当前基线、插件化决策及后续升级流程见 [rc.2 / M4 实施记录](ELECTRON-RC2-M4-2026-09-30.md)。内网现场验收按用户指示暂缓，完整发行仍需 M5。**本文保留 rc.1 规划时的历史分析。

> 优先级调整：用户要求先保证外网环境功能。初始个人联网候选已验证公网连通与双协议模拟会话，见[联网阶段实施记录](ELECTRON-PERSONAL-IMPLEMENTATION-2026-09-29.md)。M2 已补齐连接租约、恢复、副本导入及最小保护切片，并完成最终包验收，见[M2 实施记录](ELECTRON-M2-IMPLEMENTATION-2026-09-29.md)。内网现场验收保留为后续企业交付门禁，不阻塞个人版开发。

> 实施进展：M0 已于 2026-09-29 启动，独立 fork checkout、官方 Windows 构建、接口测试和桌面首启已有实测；剩余完整切片与遗留失败见[M0 实施记录](ELECTRON-M0-IMPLEMENTATION-2026-09-29.md)。本文下方“本轮完成边界”指计划编写时的历史状态。

> M1 进展：独立内网发行策略、身份/数据隔离、本地入口、分析/反馈/更新隔离和目录包已实施并验证；企业网关及断网干净机仍待现场验收，见 [M1 实施记录](ELECTRON-M1-IMPLEMENTATION-2026-09-29.md)。

> M3 进展：工程工作台已接入官方 Shell、Session、工具与 composer；Git/Hg、草稿追加、构建/日志/产物、并行保护/恢复及通知已完成本地验证。独立候选包保留 M2/M1 运行目录，使用与验收边界见 [M3 实施记录](ELECTRON-M3-IMPLEMENTATION-2026-09-29.md)。

本文是当前执行计划，取代此前文件中的目标版本与阶段排期。[原源码分析](ELECTRON-MIGRATION-ANALYSIS-2026-09-28.md)、[持续演进设计](ELECTRON-UPSTREAM-EVOLUTION-2026-09-28.md)继续作为详细设计背景；其中 `0.1.7-rc.2` 是历史基线。版本、顺序或交付范围有差异时，以本文为准。

## 1. 基线与决策

直接以官方 **`dsh-v0.2.0-rc.1`、提交 `4878cdabd87d4041bdaff61d04c966883b9fd07a`** 建立 Electron 迁移候选，保留官方唯一 Agent Loop、Session writer、Host 生命周期和客户端主体。用发行策略、窄适配层与功能插件承接现有增量能力。内网本地底座已完成，当前从同一代码主线优先交付 Windows x64 个人联网候选包，企业现场验收后续恢复。

截至核实，最新官方公开发布是 `0.2.0` 系列首个**候选版**，发布于 2026-09-28；未核实到无后缀的 `0.2.0` 正式版。最新候选不等于已经过生产稳定性验收。[官方发布页](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.1)

| 对象 | 固定基线 | 用途 |
|---|---|---|
| 自有桌面 | `0.2.5-rc.1`，仓库 `1e8d84f813fafda00abf34b7b5c294d9b67ee3da` | 功能资产与行为依据；版本号不能与官方直接比较 |
| 自有 Harness | `0.1.7-alpha.2`，fork `5e2879f0478ba9336128312e715dee7a9f56c3db` | 两项必要补丁与旧格式样本 |
| 新官方目标 | `0.2.0-rc.1`，`4878cdabd87d4041bdaff61d04c966883b9fd07a` | 首个 Electron 开发基线，固定 tag、SHA、lockfile |
| 上次官方样本 | `0.1.7-rc.2`，`477b4f420553e8a52c2fbccc464d7561b239c443` | 差分与关键切片升级演练；不建设完整中间产品 |

本次取得新 tag 源码，两个官方提交间有 1109 个文件变化、20374 行增加、77957 行删除，其中包含文档、版本和生成内容，不能等同于 1109 项行为变化。检查集中于迁移接缝，没有全仓审计，也没有编译运行产品、访问凭据或迁移用户数据。本地依据：[版本锁](../versions.json)、[Harness 来源](../build-deps/harness-source.json)。本轮记录：[基线与差分证据](evidence/migration-2026-09-29/baseline.json)。

## 2. rc.1 带来的实际计划变化

### 产品行为分析前移到内网底座

新 `web-app` composition 对 Desktop 装载 `desktop-product-telemetry` 和 `product-analytics`，后者配置 `enabled: true`。它采集特定产品交互；文档声明不采集 prompt、response、API Key 或 token，不能与会话内容上传混为一谈。默认 exporter 目的地为 `https://dsh-otel-collector.deepseeksvc.com/v1/logs`。

内网版要求**从第一次启动就不采集、不排队、不发送未经允许的分析事件**。仅改 UI 开关不够：官方文档说明关闭新采集后，已挂载 exporter 仍可能完成排队记录；这也不控制另一条 session feedback 链路。

实施：在发行 composition 禁用分析与 exporter；Main/welcome/account 消费点使用明确关闭策略。Main 的初始 `analyticsEnabled()` 失败会回落 false，但账号 watcher 后续还可更新状态，不能依赖一次查询失败来禁用。验证服务缺失时初始化、订阅和退出；已有配置升级先阻断生产者和发送者，再处理队列，不能因关闭时 flush 而外发。

base composition 中会话遥测为 `FEEDBACK_ONLY`，另有 `DSH_TELEMETRY_MODE`；它与产品分析不是同一开关。反馈、会话日志上传、设备信息附带、崩溃上报、账号、更新、搜索、外链分别登记用途和目的地。内网默认本地脱敏导出，获准上传的场景走受控入口。

证据：[Desktop composition](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/bundle/web-app/cordis.patch.yml)、[产品分析语义](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/client/product-analytics/README.md)、[exporter](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/host/product-telemetry-otel/README.md)、[Main](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/apps/desktop/src/main.ts)、[base composition](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/bundle/base/cordis.patch.yml)。

### 自动化明确为可选能力

新 `@deepseek-ai/dsh-experimental-schedule-bundle` 组合 `time-context`、`schedule`、`ui-schedule`；Web 默认 composition 已移出这些条目。不能继续按旧默认条目找服务或仅恢复旧 `disabled` 值。

计划默认：内网包预置审核过的插件材料，自动化初始关闭，启用不下载依赖。如果导入发现历史计划，展示数量、时区、执行范围和权限，保持暂停，用户逐项恢复；没有历史计划则不制造迁移项。Host 重启、睡眠恢复和积压任务策略必须回放，避免复制计划文件后重复执行。

证据：[可选包声明](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/boot/app-boot/src/profile.ts)、[schedule composition](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/experimental/schedule-bundle/cordis.patch.yml)。

### 任务恢复采用新官方事实

新 `ToolCallRecovery` 区分 `TOOL_NOT_STARTED` 与 `TOOL_OUTCOME_UNKNOWN`，服务于失败调度、日志中断恢复及 fork 种子。自有任务状态、构建取消、Git 操作和产物面板必须保留“副作用未知”，不能将缺少结果视为未执行并自动重放。先核实进程、工程差异和产物，再决定后续动作。证据：[Session repair](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/core/session/src/repair.ts)。

### 配置与 UI 定向回归

`ConfigEditor.configuration()` 调整配置继承组合方式，并新增测试。迁移需验证 group/insert、无 override、显式 override、清除设置、bundle 升级后的 inherited 值；两个 `settings.replace()` 不等于原子事务。

`SessionRowOwnerProps.displayTitle` 无持久标题时可能为空，不能充当任务唯一键。新增上传/插件提示相关插槽占用，加上标题栏避让修复，工程浮层、桌宠需验证小窗口、全屏、缩放和多会话。按 session ID 关联数据，优先调用官方 slot/composer。

证据：[ConfigEditor](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/boot/config-editor/src/index.ts)、[继承测试](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/settings/settings/tests/configuration-inheritance.spec.ts)、[workspace slots](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/client/ui-workspace/src/client/contract/slots.ts)。

### 未变的接缝仍需集成验证

两个 tag 间 `llm-pi-ai/src`、`llm-retry/src`、Session `types.ts`、Desktop `host-protocol.ts`、`web-document.ts`、`mandatory-update-policy.ts` 无源码变化。原有 lease、认证桥接、整包升级和强制更新解耦设计继续适用；这不证明依赖、composition 或整机行为完全不变。

新 Desktop 声明 Electron `^44.0.0`、pnpm `11.7.0`；解析版、外置 Node、原生包和文件以 lockfile/运行时描述为准，不能照搬 Tauri 的 Node/WebView2 锁。官方 Windows 沙箱新增权限诊断，不代表本机 D 盘 ACL 失败已经解决，必须重新实测。证据：[Desktop package](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/apps/desktop/package.json)、[组合描述](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/apps/desktop/src/release.ts)。

## 3. 目标结构与三条核心契约

实施时建立官方仓库的独立派生 checkout，建议分支 `codex/electron-intranet`；当前 Tauri 仓库保留为功能来源和回退资产。本次未创建该产品 checkout/分支。首轮只承诺 Windows x64；macOS 单独验收，Linux npm 修复不代表 Desktop 支持 Linux。

| 层 | 责任与约束 |
|---|---|
| 官方发行组合 | Electron/Main、Host、Agent、Session、原生执行、Web client；整体跟随，保留完整性检查 |
| 发行策略 | 内网/个人、身份、账号、更新、网络、依赖、分析/反馈；优先 composition，Main 必需改动集中登记 |
| 适配层 | Connection、Task、Execution、Draft、Protection、Platform 窄契约；集中吸收官方内部变化 |
| 自有功能 | 连接、工程、保护、产物、诊断、桌宠；各自有生命周期、数据 schema 和故障边界 |
| 平台 helper | Win32 文件句柄/身份、受限凭据与文件操作；Main 管理，不运行第二个 Harness supervisor |

以上是拟议责任，不代表官方存在这些同名接口。Codex、用户指定的 `zai-org/ZCode`、OpenCode 继续沿用[上一轮固定源码样本](ELECTRON-MIGRATION-SOURCES-2026-09-28.md)中的边界设计参考；本轮未宣称它们仍是最新版本，不在首轮引入多个执行引擎。

**发行隔离契约**：独立 App ID、协议、Electron userData、`DSH_HOME`、profile、凭据、端口、锁、浏览器分区与更新源。默认 19387 可由 `webserver.config.port` 覆盖，先用配置再判断是否需 Host 补丁。无账号/Key 可以进入本地工作区；账号过期、外部更新失联、历史强制更新状态不能阻断内网工作。

**网络契约**：覆盖 Main/renderer、Node、模型、插件/MCP、外链和工具进程。Electron 拦截器约束不了 shell/Git/构建脚本，后者需可验证的 OS/企业出口策略；尚未实施强制出口约束的样本不得宣称“只访问允许服务”。规则记录用途、调用方、协议、主机和端口；重定向重新检查，不跨来源转发认证头。全断网与联网但受控出口都要验收。

**组合版本契约**：官方要求壳与 bundled DSH 的 release version 一致。先保持 upstream runtimeVersion 对齐，派生 productVersion、distributionRevision、channel 单独记录显示。若改 runtimeVersion，重建匹配包集，不关闭校验。升级单位是已验证的完整组合，不支持任意替换 Host/node_modules 或运行中热换引擎。

## 4. 功能迁移与验收口径

| 工作包 | 现有资产 | 目标与验收 | 阶段 |
|---|---|---|---|
| DIST | 独立目录、离线依赖、发布证据 | 官方打包 + 发行策略；空缓存首启；分析/反馈/账号/更新隔离 | M1 |
| CONN | `source-provider-control`、`source_providers`、目录继承 | 多连接同名模型、OpenAI/Anthropic、独立 Key；CAS、journal、路由 ACK | M2 |
| DATA | settings/workspace migration、事务 | 副本导入、schema、幂等恢复；未知格式不写；凭据重新绑定 | M2 |
| PROTECT | task snapshot、Rust 文件保护 | 保留启用后失败阻断；补子任务/工程动作，校验链接与身份 | M2 切片、M3 完整 |
| ENGINEER | Git 写、Hg 读、环境面板 | 官方执行/审批；保留预览与状态重检；Hg 写、在线 PR 不算已有迁移项 | M3 |
| REVIEW | change-review、change-draft | composer adapter；不覆盖草稿/附件，按会话与草稿修订幂等追加 | M3 |
| BUILD | project-actions、信任、排队/取消 | 信任绑定配置摘要和工程身份；取消不等于远端无副作用 | M3 |
| ARTIFACT | 来源/文件身份、打开/另存为 | 区分声明、发现、已验证产物；复用官方打开/定位并保留预检 | M3 |
| TASK | task-recovery、通知 | 以官方恢复事实投影，不自动重复工具，不建第二套执行状态源 | M3 |
| OBSERVE | observability、诊断/归档/A-B | 拆离核心装载；默认只读、本地脱敏；关闭后连接/保护仍在 | M4 |
| CACHE | source-cache、缓存实验/预算 | 请求局部 hook；bytes→tokens 做 schema 迁移，旧实验保留原单位 | M4 |
| VISION | 独立识图、自检 | 统一 lease/外联；本地检查与真实主动探测分开 | M4 |
| OPTIONAL | 桌宠、主题、可选 schedule | 可独立停用；离线启用、历史计划暂停；桌宠完整行为回归 | M4 |

### 热切换必须证明实际路由生效

首轮保证受支持的同一网络配置内地址、模型、Key、协议切换不重启 Host；跨代理/CA 热切换在隔离 transport 验证后另行承诺。

1. 请求取得不可变 `connectionRevision + credentialLease + transportLease + policyRevision`。A 流及同一逻辑请求重试保留 A，切换后新逻辑请求使用 B。
2. adapter 在流调用内解析凭据，须验证 Agent retry 边界；需要时加窄 seam，不能将模型快照等同凭据冻结。策略撤销/紧急吊销能够阻断后续发送，即使旧 lease 尚存。
3. 单 owner 串行发布，使用 expectedRevision/CAS、prepare/commit/reconcile journal。timeout 为 unknown，查询实际状态；保存成功不等于应用成功。
4. ACK 含 operationId、hostEpoch、desired/applied revision、routeDigest；不靠收费模型调用证明生效。敏感值不进 UI/日志，可枚举 Key hash 不作身份标记。
5. 修订在无配置引用、无在途/重试 lease 且满足回退窗口后退休，闭合现有 immutable map 无回收问题。
6. 两项 fork 行为分别保留或替代：`catalogProvider` 独立路由/目录继承；请求局部 `preparePayload`。先验证官方等价接缝，不整体 cherry-pick 旧 alpha fork。

### 保护与数据提前落地

当前启用的任务快照失败会阻断，但原代码跳过 subagent，pipe 禁用也不覆盖；审阅 diff 基线失败则继续。分别记录覆盖。父子任务继承保护 lease，工程动作使用同一准入；独立终端未纳管时不能显示已保护。并发写使用串行、独立 worktree 或明确拒绝。

保留 Win32 句柄、重解析点及文件身份校验，抽窄 Rust helper；不为换框架重写已验证行为。快照不能替代外部副作用核实。

旧 `0.2.0` 日用与 `0.2.5-rc.1` 候选数据分别制作脱敏 fixture，确认实际 writer/schema，通过新官方 reader/迁移链导入副本。两引擎不能共写活动数据库。首次续写前备份与 journal，失败可重入；回退用旧包与升级前副本，新任务/工程改动另行审阅合并。

## 5. 阶段、交付与排期

按一名熟悉仓库的开发者、Windows x64、已有基础构建环境估算；不是日历承诺，已包含长期适配工作。

| 阶段 | 人日 | 交付物与退出条件 |
|---|---:|---|
| M0 来源与最小切片 | 4–6 | 官方空白包、组合清单、补丁/耦合台账、seam 原型；干净环境取得输入，关键风险有实测结论 |
| M1 内网发行底座 | 8–13 | 独立身份、本地入口、发行策略、分析/反馈隔离、离线依赖；无账号/公网可用，受控网络与官方并存通过 |
| M2 连接与数据 | 8–13 | 已完成本地验收：凭据桥、lease、ACK、事务恢复、副本导入；两协议不串 Key，中断/冲突/重试/退休通过，源数据未写；真实 provider 与企业现场另验 |
| M3 工程闭环 | 10–16 | 已完成 Windows x64 个人版本地验收：Git/Hg、官方草稿、构建、产物、保护、恢复和通知；保护失败阻断，未知副作用不重放；发布与现场门禁仍属 M5 |
| M4 诊断与可选能力 | 6–11 | 诊断/缓存/识图、自检、桌宠/主题、schedule；故障隔离、脱敏、单位迁移、离线启用、视觉检查通过 |
| M5 发行与升级演练 | 5–10 | 完整受控离线包、干净机与现场证据、回退包；所有必需 Gate PASS，跨官方版本演练完成 |

合计 **41–69 人日**，加约 20% 不确定性为 **49–83 人日**。新增分析和 schedule 适配已计入阶段调整，M0 后按实测改算。证书/企业镜像/出口等待、额外平台、Google 许可和外部后端开发不包含在内。

关键路径 M0→M1→M2→M3→M5。M4 可分批，但完整迁移不能省略。M2 是连接试用候选；M3 加核心发行门禁才进入工程日用试用。旧 Tauri 保持可回退，直到现场验收及数据导入确认。

### 首批任务的具体顺序

| 顺序 | 任务 | 可评审结果 |
|---|---|---|
| 1 | 建 rc.1 派生 checkout，封存两项 fork 补丁与可取得来源 | upstream lock、源码/hash、补丁说明；来源不再仅依赖本机 |
| 2 | 构建官方 Windows 目录包，记录依赖和运行时 | 构建日志、文件摘要、空 home 首启结果 |
| 3 | 发行 composition 与 Main 策略，去掉内网账号/更新依赖，禁用分析/反馈 | 网络清单、首次启动/退出观测证据 |
| 4 | 认证 RPC、合成 mock、最小 lease 与路由 ACK | 暂停流换 Key、retry、新请求、CAS 回放；替代旧 Origin 桥 |
| 5 | 最小保护 helper、任务恢复与历史副本 | 工具前保护拒绝、未知结果不重放、重开历史、导入幂等 |
| 6 | 同一切片做 rc.2→rc.1 演练 | 触点差分、适配工时、数据与回退证据，修订后续估算 |

这些是连续小提交/评审单元，可跨 M0–M2 完成；不要求 M0 内交付完整策略和连接产品。正式产品直接从 rc.1 开发；rc.2 仅在隔离样本实现最小契约，不建设第二条产品线。

## 6. 必需验收门禁

每项关联源码/集成 SHA、build ID、包 hash、OS、策略摘要、输入、预期、实际与日志。状态 PASS / FAIL / UNKNOWN / SKIPPED；必需项的后两者不能放行。

| Gate | 场景与通过标准 |
|---|---|
| NET-01 | 空 home/缓存、无账号/Key、全断网首启与重开；本地功能可用，无首启下载和远端更新阻断 |
| NET-02 | 联网只准 mock/内网，覆盖页面/Host/插件/工具/外链；无未授权外联尝试，出口确实覆盖子进程 |
| TEL-01 | 首启、设置、异常、退出、升级旧配置；产品分析不采集/入队/上传，反馈独立关闭，本地脱敏导出可用 |
| ISO-01 | 官方并存、端口占用、安装更新；数据/凭据/锁/协议不互相覆盖，失败可诊断 |
| CONN-01 | 两协议同名模型、暂停流、换 Key、retry、新请求；修订与凭据不串，无 Host 重启，旧 lease 可回收 |
| CONN-02 | CAS、继承/reset、保存中杀进程、ACK 丢失；可查实际生效，不静默丢更新或误报成功 |
| AUTH-01 | dsh-app 请求、伪造/缺失身份、Host 重启；使用官方认证路径，不放开所有无 Origin 请求 |
| DATA-01 | 两代样本、未来格式、重复/中断导入；源目录未写，未知格式拒绝，恢复幂等，无凭据泄露 |
| SAFE-01 | 主/子任务、工程动作、并发、链接替换、磁盘满/无权限；严格保护失败阻断，覆盖范围真实 |
| TASK-01 | 调度失败、工具已启动但无结果、取消/超时/强杀；不自动重复写入、提交或上传 |
| ENG-01 | Git/Hg、草稿附件、构建取消、旧/新产物；重检与信任生效，草稿保留，来源标记真实 |
| OPT-01 | 插件缺失/不兼容、离线 schedule、旧计划；核心不受影响，无安装外联，计划暂停且无重复执行 |
| PKG-01 | 无开发工具干净机、D 盘受限目录、睡眠/重启、现场内网；完整依赖，不扩大 ACL 范围绕过失败 |
| UPG-01 | 旧组合→新组合的关键切片与回退；连接、保护、数据、打包均留证，不共写活动数据 |
| UPG-02 | 必需/可选契约不兼容、未知 writer/protocol；阻断受影响执行，保留本地查看，可选模块明确停用 |
| UPG-03 | 空构建环境按清单重建验证；不依赖开发机残留，签名/时间戳等不确定字段单独记录 |

历史候选有本地离线 mock PASS，但现场为 NOT_TESTED、SDK text-turn feedback 回放有未闭合失败、D 盘 ACL 失败与临时目录通过并存。它们是 M0/M5 跟踪项，本计划未将其重标 PASS。[原发行证据](evidence/0.2.5/distribution-verification.json)

## 7. 持续升级与后续开发

每次官方发布走同一流程：固定 tag/SHA/lock → 差分分类 → 隔离候选适配 → 上游相关测试和自有契约 → 数据副本升级 → 整包/出口/现场验收 → 发布及回退准备。可每周评估发布，本计划不创建自动更新或定时任务；内网只安装验收后的整包。

组合清单记录 upstreamTag/Commit、integratedCommit、产品版本/发行修订、壳/Host/DSH/Web、Host protocol、Session writer/read 范围、Node/Electron/pnpm、lockfile hash、插件、补丁、策略、构建目标、产物 hash、测试证据。不以 `>=0.2.0` 代替兼容结论。

依赖台账分 A 公开配置/服务、B 内部接口、C 自有补丁、D 文本/DOM 锚点；每项有消费者、触点、行为测试与删除条件。变动应集中在发行/适配层；连续升级需要大改业务模块时先修依赖方向。保留原两项补丁的行为合约，上游有等价能力后删除重复实现。

先完成当前 M0，后续发布进入独立候选；除阻断修复外不在阶段中反复追浮动分支。rc 不自动交付，正式版也不能免除回归。正在运行的任务先排空/停止，完整组合切换后重启；连接热切换不受此流程替代。

新功能先说明执行后端、数据/网络范围、写入与审批、上游契约、故障影响和升级验证方法。经 adapter 接入，新增 seam 有实际消费者，不先造通用多引擎框架。建议后续顺序：跨代理/CA 热切换、工程/Hg 写、保护与并发隔离、诊断效率、条件成熟的外部后端。

Google AI Pro/Antigravity 订阅接入保持独立条件项：实施时重新核实许可、官方接口和实际权益；Gemini API Key 接入不能算订阅额度需求完成。当前不承诺可直接消费该额度，也不阻塞内网主线。此前来源与安排见[原分析](ELECTRON-MIGRATION-ANALYSIS-2026-09-28.md)。

首三轮可预留 20%–30% 开发容量用于适配；常规升级暂按 1–3 人日，格式/协议/运行时变化按 4–8 人日，重大重构另算。用首次演练和后续两轮实测替换规划数值。跟踪升级滞后、B/C/D 耦合数、补丁寿命、修复工时、回归问题和未知 Gate。

## 8. 本轮完成边界

已完成发布核实、固定 rc.1 源码、关键差分分析、任务/验收/升级演练规划与证据记录。尚未创建派生产品分支、构建产品、移植补丁、运行迁移测试、导入数据、推送或发布。文档和来源检查证明可追溯性，不代表产品 Gate 已通过。
