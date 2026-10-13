# R 集成与启动登记

> 当前执行规则（2026-10-07）：用户要求 Sol↔Astra 连续开发，GLM 仅文档。下面旧多作者、R 独占、逐任务审查和分离集成安排已停止作为执行门槛；当前代码作者承接共享接线权限，历史事实和功能验收要求保留。以 [CONTINUOUS](dispatch/CONTINUOUS.md)、[NEXT_HANDOFF](dispatch/NEXT_HANDOFF.md) 和实际代码为准。

## Summary

当前：唯一集成人员 R 已受控接收 T01 审查允许的源码、T03 第四轮通过的 v2 存储库和 T25 第二轮通过的验收测试，集成源码检查通过。T01 整项仍 PARTIAL；T03 存储库已集成，产品仍用 v1。R 的测试适配与接口登记为 READY_FOR_REVIEW，独立复核和包资格 NOT_RUN。详见[本轮交接](handoffs/R-integration-20261005.md)。以下原状态、失败及准备记录保留为历史，不作为当前派工决定。

## Table of Contents

- [状态与历史](#状态与历史)
- [环境与文件归属](#环境与文件归属)
- [启动条件](#启动条件)
- [验证与剩余工作](#验证与剩余工作)
- [当前集成和后继准备](#当前集成和后继准备)
- [Dev Note](#dev-note)

## 状态与历史

[registry.json](registry.json) 记录实际交付、审查、环境与文件预留；[dispatch/tasks.json](dispatch/tasks.json) 保留原依赖图和推荐派工。T00 的作者 READY_FOR_REVIEW、原 validation 和本轮独立审查分开记录。T00 REVIEWED 是设计审查结论；R 采用设计输入不代表未来实现已集成或安装包合格。

T25 的初始 NOT_STARTED 保留在历史中，当前状态推进为 NEEDS_FIX，作者交付状态仍为 READY_FOR_REVIEW。原作者 11/11、29/29、40/40 与独立审查 11/11、29/29 分别记录；40/40 仅为作者证据。失败日志保留，三个审查发现仍 OPEN，不能用测试通过覆盖它们。T25 的正式交付仍只在 [任务 worktree](../../.build/dispatch/worktrees/T25/migration/roadmap/handoffs/T25.md)，主目录没有三个 roadmap-acceptance 测试。

| 未关闭项 | 修复责任与复核要求 |
|---|---|
| F1 / P1 | T25 作者加入官方 SessionPersistence provider/writer，flush 后冷恢复验证；live Session 查询不能作为日志落盘证据 |
| F2 / P2 | T25 作者在 flush 持续失败期间断言不发布/不推进，再验证恢复成功；只检查最终恢复态不足 |
| F3 / P2 | T25 作者修正 configured=false 的全称声明，覆盖缺失凭据在不同修订顺序时的真实缓存行为 |

两个 pending 候选竞态及没有成功 end 的摘要路径继续登记为未执行，待 T04 提供受控观察/注入点；它们不妨碍先修复 F1/F2/F3。T01/T03/T04 新行为接入时，六条现状特征化断言由 R 同批更新，避免把已修复行为当成回归。

## 环境与文件归属

按既有 T25 独立审查，R 技术追认其独立 worktree、独立 node_modules/.pnpm、Node 24.16.0、pnpm 11.7.0 frozen 安装、隔离 TEMP/TMP/DSH_HOME，以及普通文件形式的现有 helper 复制件。用途限定源码测试。作者提前代行准备和历史创建/复制命令留证不完整仍是流程偏差；没有追认为 helper 源码构建、真实 Loader/bin 或安装包验收。T00 的工具链版本偏差也保留，不以 T25 环境证明其他任务环境已准备。

正式验收三个测试文件和任务 handoff 的 T25 修复预留见 [ownership.md](ownership.md) 与 registry.fileLeases。T01/T03 不获得这些文件写权；Host 聚合、共享配置/lock 和消费者接线由 R 串行处理。[T25-review-1 审查 worktree](../../.build/dispatch/worktrees/T25-review-1/packages/nidofy/desktop-extras/tests/roadmap-review-T25-diagnostics.spec.ts) 的诊断仅归独立审查者，保留证据，不混入作者交付。

## 启动条件

| 任务 | 设计/代码输入 | 实际环境 | 当前决定 |
|---|---|---|---|
| T25 作者修复 | 已交付现状测试、独立审查及明确修复项 | 自有目录和依赖已用于源码测试 | 可人工续派修复；NEEDS_FIX，不授予通过或新功能 READY |
| T01 | store/runtime/api/ui、公开 CredentialProvider、v1 草案和归属已核对 | `.build/dispatch/worktrees/T01` 不存在；frozen 安装、隔离数据根、最小连接测试 NOT_RUN | NOT_STARTED / WAIT_ISOLATED_ENV；环境完成后可实施 T01，真实安全后端资格仍待 T02 |
| T03 | v1 store/types/settings、活动/历史/双游标草案和归属已核对 | `.build/dispatch/worktrees/T03` 不存在；frozen 安装、隔离数据根、Notebook/settings 最小测试 NOT_RUN | NOT_STARTED / WAIT_ISOLATED_ENV；环境完成后可实施 store/迁移，context/compaction/Panel 与 T04 接线仍待后续 |

下一次由 R 在 Electron 内创建两份独立任务目录，先受控同步本轮必要的未提交资料，检查实际源码与归属，再按锁定 Node/pnpm frozen 安装并运行各自最小测试。只从现有分支 checkout 不会带入这些未提交文件。成功后才能登记环境 READY 和人工绑定作者；本轮只判断条件，没有执行准备或启动。T03 的未来 quota 仅为适配义务，不假装已有 API，也不作为 store 实施的额外前置项。

## 验证与剩余工作

本轮主目录隔离五文件基线 29/29、exit 0；更新前历史结构脚本核对 27 任务/6 门槛/11 文档/99 本地链接，exit 0；27 prompt 与 registry 的目标、范围、验收和重点逐条一致。更新后状态、依赖图、历史保留、归属、相对文件链接和 Markdown 结构的具体命令与退出码见 [执行索引](../../.build/dispatch/evidence/T00-review-1/commands.json)，实际基线见 [baseline.log](../../.build/dispatch/evidence/T00-review-1/baseline.log)。

旧 test:docs 20/21、doc-sync 42/43 和 locales.ts lint 108 条诊断仍为历史 FAIL_EXISTING，本轮未重跑完整门禁或修复这些资产。G-A–G-F、真实 Session 冷恢复、OS 凭据后端、Loader、原生重建、Live2D/网关/发行资格均未完成。具体后续消费者责任保留在 [wiring-queue.md](wiring-queue.md)；队列仍 PLANNED / NOT_RUN，[milestones.md](milestones.md) 未将任何阶段收口。

## 2026-10-05 R / T01–W01 预检

本轮已只读核对 T01 第三轮实际源码和消费者，独立隔离重跑作者九文件 65/65、结构化 scoped lint 10 文件零诊断，均退出 0；完整证据见 [R 交接](handoffs/R-T01-W01.md)。作者源码对应关闭路径可接收，但本轮未接收、未接线、未运行真实启动/认证/浏览器/keyless，也未授予包资格。T01 整体 PARTIAL，R 当前 WAIT_AUTHOR_STOP；人工确认 T01/T25 停写及连接测试移交尚未收到，业务租用未激活。T25 历史 NEEDS_FIX 保留；原登记的未启动事实保留为历史，本条反映实际 T01 工作树已存在且具有源码测试能力。

## 当前集成和后继准备

| 层次 | T01 | T03 | T25 |
|---|---|---|---|
| 作者交付 | READY_FOR_REVIEW；原目录保留 | READY_FOR_REVIEW；原目录保留 | READY_FOR_REVIEW；首轮 NEEDS_FIX 历史保留 |
| 最新独立审查 | review-3：源码 REVIEWED；F5/F6 PARTIAL | review-4：v2 存储库 REVIEWED，全部修复关闭 | review-2：修复交付 REVIEWED；F1/F2/F3 CLOSED |
| 主目录接收 | store/API/UI 及测试已接收 | v2 库、类型、测试、双语 README 已接收 | 三个正式测试已接收 |
| 接线 | W01 部分；真实启动/认证/浏览器未验收 | W02/W04/W05 待接；context/config/compaction/Panel 仍 v1 | 仅三条连接旧断言随实际行为更新；Notebook/压缩原断言保留 |
| 集成验证 | 共享 14 文件 109/109、全量 typecheck、17 文件 scoped lint 通过 | 同左，含 29 条 v2 测试 | 同左，保留官方 writer、持续 flush 失败不发布和冷恢复 |
| R 独立复核 / 包资格 | NOT_RUN / NOT_RUN | NOT_RUN / NOT_RUN | NOT_RUN / NOT_RUN |

只按实际差异接收 21 个明确文件；T01/T03 分支的旧 R 登记、审查和主目录未提交资料均未整支覆盖。接收前主目录资料保存于 `.build/dispatch/evidence/R-integration-20261005/preserved-main/`。业务文件形成本地集成提交；主目录 R 登记与已有修改保留。原作者目录不写入、不 reset，历史审查不改写。当前 T25 依据为 review-2，T03 依据为 review-4，不沿用旧 NEEDS_FIX 状态。

Host 入口复核：派生发行 patch 下 `await installConnectionApi` 位于 IPC ready 之前；owner 初始化失败的诊断/503 已存在，非 owner 安装失败继续 fatal。没有新增吞错路径，也没有用模块测试证明真实 Desktop 已 ready。`cleanupRecord`、`CONNECTION_RECOVERY_PENDING`、`CONNECTION_RETIRING`、已发布健康视图和路由注册差异，以及未知提交按原 operationId inspect 均已登记到 contracts-v1。

过程失败保留：T25 原断言在接收后的代码上 11/14 通过、3 失败，随后按缺首/缺后和缺凭据修复的真实行为更新。首次 typecheck 的六条相关测试类型错误和 scoped lint 的两条行长错误已修复并重验。test:docs 首次 19/21，除旧 concrete-terms 失败外，本轮 handoff 的提交号引用也失败；主目录 handoff 已移除该引用，作者原件未改。各命令/cwd/退出码/隔离根/完整日志在[运行登记](../../.build/dispatch/evidence/R-integration-20261005/runs.json)，最终文档结果见交接，不伪装全绿。

| 后继 | 实际可用目录 | 决定与前置限制 |
|---|---|---|
| T02 | `.build/dispatch/worktrees/T02` | READY / 待人工绑定；冻结离线安装通过，连接最小回归 44/44、官方凭据契约基线 42/42。仅获得 provider/平台适配实施权，W03 bundle 由 R；真实 Windows 隔离身份验收另做 |
| T04 | `.build/dispatch/worktrees/T04` | 第一单元 READY / 待人工绑定，整项 DEPENDENCY_BLOCKED；冻结离线安装通过，存储/现有压缩边界 52/52。可实现预算、证据选择和候选；正式发布须等 R 的 W04 官方 generation/持久化连续前缀与 W02 消费接线 |

两目录各自拥有 node_modules/.pnpm、测试 TEMP/TMP/DSH_HOME 与输出目录；未共享主目录可变 lib/target。安装的 CLI bin ENOENT 警告真实保留，Loader 构建和原生重建未运行。必要输入由 R 从主目录受控同步；[准备说明](dispatch/START_READY.md) 明确范围、命令、原始输入和剩余限制。没有自动启动作者、其他模型或会话。

最终文档单项复验：repository references exit 0；标准 2316 文件链接检查 exit 0；精确 roadmap 12 文件零断链、27 任务/6 gates、状态同步、历史保留与租用释放检查 exit 0。test:docs 完整 19/21 的原失败仍保留，未再次跑全套；旧 concrete terms 失败未修复。错误链接脚本名产生的 MODULE_NOT_FOUND 已留证，随后使用实际脚本通过，不隐藏过程失败。

T04 不需要 T03 实现压缩算法才能开始第一单元。官方 JSONL 内部已有迁移 generation 机制，但公共 SessionPersistence/SessionObservation 没有供 Notebook 使用的物理代次标识；revision 仅为同实例缓存变化令牌，header.version 为格式版本。prepared cold observation 可能添加内存中断终态，不能当作已持久化成功。该公共 seam 由 R 负责，T04 不私扫路径或用常数代替。

## Dev Note

本文件由 R 维护。原作者 handoff、baseline、旧日志和 T25-review-1 不改写；业务缺陷交回作者修复，再针对实际文件复核。本轮仅有本地未提交登记更新，没有推送、主线合并、发布或自动模型调度。
