# 里程碑与验收清单

> 当前执行规则（2026-10-07）：用户要求 Sol↔Astra 连续开发，GLM 仅文档。下面旧多作者、R 独占、逐任务审查和分离集成安排已停止作为执行门槛；当前代码作者承接共享接线权限，历史事实和功能验收要求保留。以 [CONTINUOUS](dispatch/CONTINUOUS.md)、[NEXT_HANDOFF](dispatch/NEXT_HANDOFF.md) 和实际代码为准。

## Summary

本参考区分作者证据、独立审查、集成与包资格。T00 已独立审查为 REVIEWED，主目录隔离重跑 29/29；T25 已交付且 NEEDS_FIX，独立重跑 11/11 和 29/29 不关闭其三个发现。R 已登记 T25 环境的源码测试现状，T01/T03 环境未准备；业务阶段及包资格仍 NOT_RUN。历史结果见原 handoff 和 [集成台账](integration-ledger.md)。

## Table of Contents

- [检查清单](#检查清单)
- [阶段](#阶段)
- [回退](#回退)
- [Dev Note](#dev-note)

## 检查清单

| 检查 | 当前状态 | 放行条件 |
|---|---|---|
| Electron 独立 Git 根、实际改动检查 | 已核对 | 主目录 R 资料和独立报告变更另列；原 T00 初始检查保留，不写外层仓库 |
| 五文件 29 测试重跑 | PASS | [基线](baseline.md) 实际命令，退出 0；仅现状 |
| 文档/lint 聚合 | FAIL（既有问题） | doc-sync 42/43、test:docs 20/21；旧资料术语与 locales.ts 引号错误需另行排期，详见 handoff |
| 六类接口/唯一 owner/文件归属/接线队列 | REVIEWED（设计范围） | [T00 独立报告](reviews/T00-review-1.md)，运行时义务仍待实现 |
| T01/T03 输入/接口/验收/回退登记 | 输入可用，启动待环境 | 各自 worktree 不存在；frozen 安装与任务最小测试 NOT_RUN |
| T25 作者交付与独立审查 | NEEDS_FIX | F1 持久化、F2 拒绝期断言、F3 顺序描述均 OPEN；不合入为完成 |
| T25 worktree 与独立依赖 | ACCEPTED_FOR_SOURCE_TESTS | 技术追认现状；流程偏差、helper 源码构建/Loader/包资格未确认 |
| T01/T03 worktree 与独立依赖 | NOT_RUN | R 准备、同步必要未提交资料、frozen 安装并跑任务最小测试后再登记 READY |
| T00 独立审查 | REVIEWED | 本轮单独审查 T00，不能用 T25 报告代替 |
| T00 设计输入采用 | 已由 R 采用 | 只采用主目录 v1 设计；不标 INTEGRATED/QUALIFIED，不放行未准备环境的任务 |

## 阶段

依赖图唯一数据源为 [tasks.json](dispatch/tasks.json)，这里给跨任务验收义务。各阶段都需要独立记录受测代码/配置/未提交内容、命令、结果及未执行项；G-E 可选项排除须写明，不能以未启用功能获得 PASS。

| 阶段 | 依赖范围 | 跨模块必须验证 | 当前 |
|---|---|---|---|
| S0 | T00、首批环境登记 | 当前基线、六接口、独占归属、首批输入、隔离准备和复核 | 设计 REVIEWED；环境 PARTIAL（仅 T25 技术现状接受），未全阶段放行 |
| G-A | T01–T05 | 缺 Key 可修复、在途租约、活动预算、双游标与取消/flush、模型输入重建 | NOT_RUN |
| G-B | G-A、T06–T10、T23 | 跨进程配额、原生身份、归档/复制恢复、配置不丢、实际出口执行 | NOT_RUN |
| G-C | G-B、T11–T13、T17 | 验证过期、持久通知、scope 竞态、中文引用权限范围 | NOT_RUN |
| G-D | G-C、T14–T16、T18 | 静态/Live2D/pet 独立关闭、固定真实资产、IME、去重和零展示调用 | NOT_RUN |
| G-E | G-D、T19/T20；可选 T21/T22 | 自检 UNKNOWN、有界实验、独立分析日志和动作权限 | NOT_RUN |
| G-F | G-E、T24/T26 | 具体安装包/原生 helper/app.asar 摘要、升级前副本回退、干净机/DPI/网关/签名/许可证据 | NOT_RUN |

T25 贯穿各阶段，在其工作树实际具备新接口前只做现状复现与验收设计。真实 Loader/Session/Shell 组合、用户/模型可见快照和打包 UI 各自提供证据；纯替身不能替代端到端验证。T15 缺资产保持 ASSET_BLOCKED；系统条件不足保持 NOT_RUN/UNKNOWN。

## 回退

T00 只新增设计与派工资料，回退是停止后继使用此版并撤回该文档交付，不涉及业务数据。其他任务回退策略按 registry：代码关闭/撤回不覆盖新格式数据；先保留失败证据、未知操作回执和升级前副本；旧程序只配旧副本，不能自动反向迁移。禁止自动清理 worktree、reset --hard、git clean 或重放未知副作用。

## Dev Note

2026-10-05 R 本轮源码接收和后继环境准备不关闭 G-A–G-F。T01 F5/F6、T02 Windows 后端/W03、T03 产品 v2 消费和 T04 W02/W04 仍未验收；T02 实施及 T04 第一单元可人工启动，详见 [当前台账](integration-ledger.md)。历史阶段记录保留。

“代码已写”“29 单测通过”“作者 READY_FOR_REVIEW”均不能替代最终包验收。状态只有相应 owner 的真实证据到位才能推进。
