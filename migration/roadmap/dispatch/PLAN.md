# DSH Electron 连续开发计划

## Summary

当前流程为 Astra 整理或解决关键问题 → GPT-6.1-Sol 连续开发 → 必要时 Astra 直接开发 → Sol 继续。全部代码、测试、UI、构建和接线由 Codex 当棒模型承担，GLM 仅文档。Txx 保留为功能清单，不再逐项要求独立 review、R integration 或新 worktree。

## Table of Contents

- [开始下一棒](#开始下一棒)
- [模型分工](#模型分工)
- [功能清单](#功能清单)
- [推进顺序](#推进顺序)
- [Dev Note](#dev-note)

## 开始下一棒

在 Electron 主目录选择 GPT-6.1-Sol，发送 [SOL_CONTINUE](prompts/SOL_CONTINUE.txt)。当前依据为 [状态盘点](STATUS-2026-10-07.md) 与 [NEXT_HANDOFF](NEXT_HANDOFF.md)，所有执行和交接规则归 [CONTINUOUS](CONTINUOUS.md)。下一棒 prompt 始终保存在 [NEXT_PROMPT](NEXT_PROMPT.txt)；Astra 通用入口为 [ASTRA_CONTINUE](prompts/ASTRA_CONTINUE.txt)。

## 模型分工

| 角色 | 职责 |
|---|---|
| GPT-6.1-Sol / Codex | 25 个非 T00/T26 功能与测试任务的默认推进者，同时接线、修复、验证并跨任务继续 |
| Astra / Codex | T00 已完成设计；今后按具体持久化/安全/难题触发，直接解决与开发，必要最终候选资格判断 |
| GLM-5.3 | T26 与文档支援，不能承担源码、测试、配置、执行台账或技术验收 |

只保留一个活动代码作者；文档如并行，限定未被代码作者编辑的文件。Sol 实现卡在普通注册/编译/共享入口时自行处理；Astra 解决具体语义问题后交还确定的下一步。模型选择不是自动切换或后台承诺。当前分工参考 [OpenAI Docs](https://learn.chatgpt.com/docs/models)，具体按用户资源和实际验收安排。

## 功能清单

以下“前置”是实际能力依赖，不是提交号或单独审查审批；可跨清单项实施共享接线。状态以 NEXT_HANDOFF 和实际代码为准，历史 registry 保留追溯。

| 任务 | 内容 | 默认执行者 | 前置能力 |
|---|---|---|---|
| [T00](prompts/T00-baseline-contracts.txt) | 基线、接口约定与派工登记 | Astra（已完成） | 无 |
| [T01](prompts/T01-connection-recovery.txt) | 连接退化启动与凭据保留 | GPT-6.1-Sol | T00 |
| [T02](prompts/T02-secure-credentials.txt) | Windows 安全凭据后端与转换 | GPT-6.1-Sol | T01 |
| [T03](prompts/T03-notebook-v2.txt) | Notebook 活动集、历史与 v2 转换 | GPT-6.1-Sol | T00 |
| [T04](prompts/T04-compaction-budget.txt) | 压缩证据预算与提交游标 | GPT-6.1-Sol | T03 |
| [T05](prompts/T05-notebook-incremental.txt) | Notebook 增量同步与长历史测量 | GPT-6.1-Sol | T04 |
| [T06](prompts/T06-storage-quota.txt) | 受管存储计量、配额与跨进程预留 | GPT-6.1-Sol | T02、T05 |
| [T07](prompts/T07-native-cleanup-snapshots.txt) | 原生安全清理与快照操作接线 | GPT-6.1-Sol | T06 |
| [T08](prompts/T08-storage-snapshot-ui.txt) | 存储与快照管理界面 | GPT-6.1-Sol | T07 |
| [T09](prompts/T09-advanced-settings.txt) | 高级连接、缓存与部署网络设置 | GPT-6.1-Sol | T02 |
| [T10](prompts/T10-migration-wizard.txt) | 旧数据迁移向导与恢复回执 | GPT-6.1-Sol | T07、T09 |
| [T11](prompts/T11-verification-records.txt) | 任务验证回执与过期判断 | GPT-6.1-Sol | T07、T10 |
| [T12](prompts/T12-durable-notifications.txt) | 持久通知偏好与统一去重 | GPT-6.1-Sol | T11 |
| [T13](prompts/T13-companion-scope.txt) | 显式会话绑定与轻量角色状态 | GPT-6.1-Sol | T05、T12 |
| [T14](prompts/T14-companion-ui.txt) | 静态角色、动态说明与窄屏入口 | GPT-6.1-Sol | T13 |
| [T15](prompts/T15-live2d-renderer.txt) | 固定单模型 Live2D 渲染插件 | GPT-6.1-Sol | T14 |
| [T16](prompts/T16-pet-coordination.txt) | 角色与桌宠关注、互动协调 | GPT-6.1-Sol | T12、T13、T14 |
| [T17](prompts/T17-local-history-search.txt) | 中文历史检索与显式项目分组 | GPT-6.1-Sol | T05、T10 |
| [T18](prompts/T18-hints-return-card.txt) | 规则 Hint 与项目返回卡 | GPT-6.1-Sol | T11、T12、T14、T17 |
| [T19](prompts/T19-selftest-center.txt) | Electron 自检中心 | GPT-6.1-Sol | T10、T11、T23 |
| [T20](prompts/T20-ab-experiments.txt) | 任务级 A/B 实验与有界矩阵 | GPT-6.1-Sol | T11、T19 |
| [T21](prompts/T21-side-analysis.txt) | 受控侧边分析 | GPT-6.1-Sol | T18、T23 |
| [T22](prompts/T22-natural-settings.txt) | 自然语言设置与可选口吻 | GPT-6.1-Sol | T09、T16、T21 |
| [T23](prompts/T23-egress-policy.txt) | 工作区出口策略与网络边界 | GPT-6.1-Sol | T02、T09 |
| [T24](prompts/T24-release-qualification.txt) | 候选构建、升级回退与发行证据 | GPT-6.1-Sol | 选定功能已验证，原 G-E 清单 |
| [T25](prompts/T25-independent-acceptance.txt) | 独立验收场景与故障注入 | GPT-6.1-Sol | T00 |
| [T26](prompts/T26-docs-capability-matrix.txt) | 用户文档、支持矩阵与交付核对 | GLM 文档 | T24 |

## 推进顺序

近期先把 T02/T04 已有成果带入主目录，完成 T02 正式项目登记和 T01 实际产品入口。T04 公共物理代次与持久前缀是已识别 Astra 候选；先完成普通接线准备，交 Astra 一次性解决并实现后，继续产品 v2 激活与 T05。此时 T09 的独立配置单元可穿插，不能用未完成的契约猜测后续实现。

随后按实际依赖推进存储/清理/快照、迁移、验证/通知、角色/检索、Live2D/Hint、自检/实验/出口以及最终包。T21/T22 保持可选；资产/现场限制单列，不能把未知写成通过。G-A 至 G-F 是检查表，不产生六次独立审批。

## Dev Note

2026-10-07 前的逐任务多作者派工流程被用户要求的连续开发取代。已有源码、审查、证据和未提交资料保留；没有因流程切换宣称业务完成或清理工作树。
