# T00 独立审查，第 1 轮

## Summary

结论：**REVIEWED**，范围限定 T00 的现状基线、接口设计、文件归属和派工资料。独立在 Electron 主目录隔离重跑五文件 29 用例，退出 0，29/29，无 skip；资料结构核查为 27 任务、6 门槛、无环依赖。未发现需要交回 T00 作者修复的阻断项。T25-review-1 只用于 T25 状态与环境登记，不作为本次 T00 审查通过依据。

本结论不代表未来功能、端到端持久化、完整集成或安装包通过。R 采用已复核的 contracts-v1 作为首批设计输入；T00 状态只推进为 REVIEWED，包资格仍 NOT_RUN。T01/T03 的输入和设计可用，但各自 worktree、冻结依赖安装和最小测试未准备，当前不能正式启动实现。

## Table of Contents

- [对象与证据](#对象与证据)
- [逐项核对](#逐项核对)
- [发现与限制](#发现与限制)
- [R 登记与启动判定](#r-登记与启动判定)
- [命令与结果](#命令与结果)
- [Dev Note](#dev-note)

## 对象与证据

审查目录为 `D:/Documents/FeiyangChen/devApps/dshWinUi/electron`，分支 `codex/roadmap-integration`；实际 Git 根相符。本轮启动时 tracked/staged diff 为空，仅已有 `reviews/T25-review-1.md` 未跟踪，已保留。T00 原交付的实际 diff 为 49 个 migration/roadmap 文件，无业务源码改变；使用符号父版本查看范围，没有匹配提交号或计算/校验 SHA。

先读取 REVIEW.txt、根 AGENTS、适用下级规则、SCOPE、HANDOFF_TEMPLATE，再读取 handoffs/T00、contracts-v1、ownership、registry、wiring-queue、milestones 与 T00/T01/T03 原 prompt。文档和生命周期规范沿用本会话已读 dsh-doc、dsh-prose-standard、docs/AGENTS、architecture、defensive-patterns；migration 和相关业务目录无更具体 AGENTS。T00 author handoff、baseline.md/json、旧证据和 T25 报告均未改写。审查先于本轮 R 元数据同步；R 同步不包含业务语义变化。

本轮独立证据为 [baseline.log](../../../.build/dispatch/evidence/T00-review-1/baseline.log) 与 [commands.json](../../../.build/dispatch/evidence/T00-review-1/commands.json)。历史 doc/lint 聚合原日志核对了失败路径和计数，未把历史日志当作本轮新执行。T25 正式测试及 handoff 只存在于其 worktree；主目录未合入这一 NEEDS_FIX 交付。

## 逐项核对

| T00 要求 | 独立核对的实际依据 | 结果及边界 |
|---|---|---|
| 独立 Electron 根、来源与改动范围 | 实际根/分支、交付 diff、未提交/未跟踪文件；baseline 的来源说明明确只核本地 refs | 满足；未 fetch，不推断远端最新 |
| 实际能力与格式 | store.ts:129-150、162-202、225-270；notebook.ts:15-16、37-39、55-72、87-103；context.ts:48-78、122-127；settings.ts；Session types.ts:89、SQLite schema.ts:8、Preferences schema=2 | 符合现状/未来分离；keep/replace、v2、双游标均待实现 |
| 发行与工程能力 | distribution.ts 和 desktop-distribution.mjs；ProtectionOwner configure 白名单；WorkbenchOwner 真实 Shell/Protection 路径、内存 notices、Environment retained-first | personal/intranet/offline 与 Node/子进程出口限制分开，未伪造完整清理/Live2D/回执能力 |
| 29 项功能基线 | 主目录五文件完整命令实际运行，含 Windows 两个 native 用例；Notebook context 用例为真实内存服务组合 + 合成 LLM | 29/29 exit 0；源码行为基线，持久 Session/Loader/发行资质不在此结果内 |
| 六类最小接口草案 | 所有草案为 text，不可导入；owner 与 W01–W13 消费范围；下表安全义务 | 满足设计交付；后续更细协议要审查，不预造业务框架 |
| 文件归属与席位 | 3 实施+1 R、所有 shared manifests/lock/聚合/R 独占；T03→T04→T05 串行，T01→T02→T09→T10 顺序 | 规则有优先级和移交义务；T01 prompt 中 Host index 最小接线仍必须交 R，不授予并行写权 |
| 输入/验收/回退与状态层次 | 27 prompt 的 objective、scope、acceptance、focus 与 registry 逐条一致；依赖图和完整性脚本；六阶段均保留 NOT_RUN | 满足原交付；T25 开展后的过期状态由本轮 R 同步，不判作 T00 原始实现缺陷 |

六类设计重点已独立核对如下。

| 设计 | 核对的义务及消费者 | 结论 |
|---|---|---|
| 连接/T01，provider/T02 | CAS keep 复制为新修订自己的秘密引用；原子 key/health 发布；不可用稳定拒绝；journal cleanup 不阻断健康连接；A/B 租约与实际发送前撤销；有界 operationId 外 UNKNOWN | 与 store/runtime 当前差距对应；W01/W03/W07/W13 清楚，没有宣称已实现 |
| Notebook/T03，提交/T04，增量/T05 | active/history 独立预算；完整指令计字节；不可复用退休 ID；session/generation 来源；两个连续前缀游标语义独立；失败/取消/CAS/policy/flush 不推进 | 设计明确；旧 sourceThrough 不当连续覆盖证明，新游标 -1，旧候选迁移映射去重、v1 原字节保留 |
| quota/T06，native/T07 与其他 writers | 单 owner/跨 Host 账本；临时峰值与终态预留；ACK 查询/保守结算；PID/超时不推断死亡；覆盖矩阵；清理仅只读预览 | 只定消费义务，细协议待审；现有进程内 Map/statfs 不是跨 Host 总配额 |
| receipt/T11 | 官方执行事实，完整日志解析测试结果；退出码/取消/超时独立；源码和脏输入使 STALE；coverage 不全 UNKNOWN；重启不重放 | W08/W12 消费明确，不从 turn/end 或产物字节推导验收 |
| scope/T13 | 公共绑定能力、完整 scope/revision 校验，迟到结果不显示/执行，双窗口隔离，取消/卸载排空，renderer 只读 | W10/W11 明确 current retained-first 差距；未来公共观察点不足须登记而非私有猜测 |
| notice/T12 | 持久 source+kind+终态修订身份，CAS claim/游标；首次连接不补弹；OS ACK unknown 不重发；禁用不吞审批/回执 | W09/W11 和 scope 消费明确，不把 UI 轮询视作持久通知机制 |

## 发现与限制

没有发现阻断 T00 本交付的实现/设计缺陷，因此本轮不要求作者修改接口或业务代码。下列是已登记限制，不标作新功能 PASS。

1. 原 test:docs=20/21、doc-sync=42/43，失败为旧 migration 七处术语；lint 的 locales.ts 有 108 条引用风格诊断。旧日志中 pnpm 自动依赖维护实际用了 11.19.0，T00 已明确申报，不能据本地 version 11.7.0 宣称隔离安装通过。旧验证不全绿，完整集成/发行仍须处置或明确资格范围；本轮未修改封存资料或 locales.ts。
2. 基线 context-integration.spec.ts 与 T25 初版组合均没有 SessionPersistence writer；SQLite 可读 live Session。本轮 29/29 是控制流/快照/现状证据，不能证明日志落盘和冷恢复。contracts-v1 把“官方成功 flush 后提交”列为 T04 义务是合理设计要求，尚待真实接线验收。
3. Session writer=4、状态文档 latestReleasedVersion=3 的差异仍保留，按已冻结/潜在发布的旧代保护，不依据本次本地核验判断 v4 未发布；无格式变化，不生成虚假的 acknowledgement/升级指南。
4. Generation 实际来源、候选迁移映射、两个 pending 候选及缺成功 end 的故障注入由 T04/R 细化；quota/native 持久协议、真实凭据/Live2D 资产和发行资质还没有现场验证。现有设计明确禁止猜测不存在的公共 API。
5. T00 原 verify-roadmap.mjs 固定当时状态（T00 READY_FOR_REVIEW，其余 NOT_STARTED）；本轮更新前实际运行成功。它是历史快照验证脚本，不能用于强迫后续状态退回原值。R 新的状态一致性检查保留旧脚本和旧结果，不覆盖历史证据。

## R 登记与启动判定

R 仅更新自身所有的 registry、dispatch/tasks、ownership、milestones、PLAN/EXECUTION、wiring-queue、contracts 的审查状态说明，并新增 [integration-ledger.md](../integration-ledger.md)。接口设计语义和依赖图没有变化。

T00 作者 READY_FOR_REVIEW 与历史 validation 保留，追加本轮 independent-review=REVIEWED；任务当前状态为 REVIEWED，不标 INTEGRATED/QUALIFIED。R 已采用主目录中的 v1 设计输入，不把这件事表述成已实现未来功能。T25 记录已开展、作者交付 READY_FOR_REVIEW、独立审查 NEEDS_FIX、三个未关闭发现，以及当前实际交付路径。保留原作者 11/29/40 和审查 11/29 的不同层次历史；40 只记作者报告，不称本轮执行。主目录不合入待修复测试，实际 handoff 用其 worktree 路径索引。

T25 环境机械准备的现状按已有独立审查技术追认登记：独立 worktree/node_modules，锁定 Node 24.16.0、pnpm 11.7.0，冻结安装，普通 helper 复制件，隔离数据根；范围仅源码测试。越过“T00 复核后”属保留的流程偏差；未证明历史全程留证、helper 源码构建、Loader 或包合格。本轮没有再校验任何 SHA。三个正式验收文件预留 T25 修复写权，T25 reviewer 的诊断另归审查者，均不租给 T01/T03。

| 任务 | 实际可用项 | 正式启动判定与具体阻塞 |
|---|---|---|
| T25 修复首批交付 | 自有 worktree/依赖/合成数据/正式测试与 NEEDS_FIX 报告；按 F1/F2/F3 顺序修复 | 可由人工续派作者；新持久化测试必须验证官方 provider+writer，两个新故障场景仍待 T04/R；未自动启动会话 |
| T01 | 当前 store/runtime/api/ui、公开 CredentialProvider、v1 草案、8 条连接基线、明确自有路径与回退 | 当前 NOT_STARTED / WAIT_ISOLATED_ENV：目标目录不存在，尚无独立 frozen 安装、TEMP/TMP/DSH_HOME 或任务最小测试。环境准备后可实施现有 owner，W01 Host 聚合由 R 串行；真实安全 backend 的后续 T02不阻断 T01 合成后端实施，但阻断相应最终资格 |
| T03 | 当前 v1 store/types/settings、活动/历史/游标草案、5+2 相关基线、自有路径与回退 | 当前 NOT_STARTED / WAIT_ISOLATED_ENV：目标目录不存在，独立依赖/数据根/最小测试未验证。环境准备后可实施 store/投影/复制迁移；不等待未来 quota 实现，只留适配点；context/compaction/Panel 的 W02 与 T04 generation/提交接线未完成，届时只能局部/PARTIAL |
| 其余任务/阶段 | 原 prompt 和登记保留 | 仍按实际前置能力等待，G-A–G-F NOT_RUN；不借 T00/T25 测试放行未来功能 |

本轮没有创建 T01/T03 环境，因为用户要求是判断启动条件；R 下一步应在 Electron 内准备两份独立 worktree，受控带入本轮未提交但必需的登记/规则，锁定工具链并 frozen 安装，分别跑连接与 Notebook/settings 最小测试，再登记 READY 和人工绑定作者。仅 checkout 当前分支不能包含本轮未提交的 R 资料。

## 命令与结果

| 本轮实际执行 | 结果 |
|---|---|
| 五文件 Vitest，隔离 TEMP/TMP/DSH_HOME | exit 0；5 文件/29 用例；3.71s；无 skip |
| 更新前 T00 历史结构脚本 | exit 0；27 任务/6 门槛/11 文档/99 本地文件链接；无 failures |
| 27 prompt 与登记逐条比对 | exit 0；objective/allowedScope/acceptance/focus 无不一致 |
| R 更新后的结构/状态/归属/文档检查 | exit 0；27 任务/6 门槛；依赖图不变且无环；13 文档/187 链接及段落、术语检查通过；包括相关未跟踪报告 |
| git diff --check 与最终范围核对 | exit 0；仅 R 资料及新审查/台账变更；T25 作者 worktree 仍干净 |
| 历史 doc/lint 原日志读取 | 非新执行；旧失败和旧通过均保留 |

完整命令、退出码、cwd、非终止读取错误、截断与入口重试见执行索引。执行入口多次 helper setup refresh 在进程创建前失败，逐次记录为 NOT_STARTED；原样宿主重试成功，不算验证失败或自动审批拒绝。误读 T00-baseline.txt 和 Session version.ts 的请求有错误，不算通过，后续从正确 prompt 和 types.ts 核对。

未执行：全仓 test/coverage/typecheck/lint/test:docs/doc-sync、真实 Loader/profile/Shell 端到端、OS 秘密后端、真实 LLM、Session writer 冷恢复、helper 重建、T01/T03 独立安装与最小测试、业务接线、发行/签名/网关/资产资格。只读业务代码，不额外修改测试；没有使用子代理或自动启动其他模型。

## Dev Note

本文件只由本轮独立审查者写入。独立审查结论覆盖 T00 原设计交付；本轮随后以 R 身份同步元数据，不自行审查新业务语义。未覆盖/待实现的职责仍由其作者交付，再由独立审查与 R 逐层验收。T25 三个发现继续交回 T25 作者，T25-review-1 不改、不替换为 T00 的审查证据。
