# 里程碑与验收清单

## Summary

本参考区分作者证据、独立审查、集成与包资格。当前只有 T00 基线五文件/29 测试 PASS，其余阶段 NOT_RUN。T00 文档在集成分支形成提交也不等于独立审查已经完成。

## Table of Contents

- [检查清单](#检查清单)
- [阶段](#阶段)
- [回退](#回退)
- [Dev Note](#dev-note)

## 检查清单

| 检查 | 当前状态 | 放行条件 |
|---|---|---|
| Electron 独立 Git 根、初始改动检查 | PASS | 仅 roadmap 资料未跟踪，外层仓库不写入 |
| 五文件 29 测试重跑 | PASS | [基线](baseline.md) 实际命令，退出 0；仅现状 |
| 文档/lint 聚合 | FAIL（既有问题） | doc-sync 42/43、test:docs 20/21；旧资料术语与 locales.ts 引号错误需另行排期，详见 handoff |
| 六类接口/唯一 owner/文件归属/接线队列 | READY_FOR_REVIEW | 独立核对语义与消费者，不由作者自行 INTEGRATED |
| T01/T03/T25 输入/接口/验收/回退登记 | READY_FOR_REVIEW | registry 条目完整；实际依赖和环境准备待 R |
| 内部 worktree 与独立依赖准备 | NOT_RUN | 依赖 frozen 安装、helper 构建需要时执行、最小测试通过 |
| T00 独立审查 | NOT_RUN | 无未关闭问题，并留下 reviews/T00 记录 |
| T00 集成确认 | NOT_RUN | 检查实际文件、文档门禁限制与全部消费者；发布首批 READY |

## 阶段

依赖图唯一数据源为 [tasks.json](dispatch/tasks.json)，这里给跨任务验收义务。各阶段都需要独立记录受测代码/配置/未提交内容、命令、结果及未执行项；G-E 可选项排除须写明，不能以未启用功能获得 PASS。

| 阶段 | 依赖范围 | 跨模块必须验证 | 当前 |
|---|---|---|---|
| S0 | T00 | 当前基线、六接口、独占归属、首批输入、隔离准备和复核 | REVIEW 待进入 |
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

“代码已写”“29 单测通过”“作者 READY_FOR_REVIEW”均不能替代最终包验收。状态只有相应 owner 的真实证据到位才能推进。
