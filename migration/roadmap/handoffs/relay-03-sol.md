# Relay 03 / Sol / 2026-10-07

接棒依据为用户的新连续授权；沿用 codex/roadmap-integration 与 Electron 主目录，未初始化、重复接收 T02/T04、检查 SHA、提交、push、发布、创建线程/代理/定时器或触及真实数据。原来源、用户修改、registry/tasks/ownership 台账和 Live2D 材料保留。

本棒实现 T05 的轻量选定指针读取、显式启动/压缩补齐、候选后缀重建、按会话元数据队列/LRU、source/search 分流、真实最近事件窗口和英中 Panel 整理状态。共享 Service 已供后续 Companion 使用，T13 消费者未接线。readSelected 无惰性转换或历史扫描，显式恢复/history/publish 负责历史验证；实际生产代次保护每次读取仍执行。数字旧 v2 不阻止 Agent 启动、不改文件。候选使用真实 commitThrough，不新增游标。公开文档/Config/Cordis 类型登记、产品 Host/Client 与所有当前安装消费者更新。

随后补 T01 真实 Loader/WebServer/BrowserAuth/Tools 隔离回归和实际 HTML 的 DOM 回放；初次 503 显示稳定诊断、未加载状态禁用保存/撤销。完整 Electron Host/profile/office/ready IPC 尚未验收。T09 高级连接字段、目录覆盖、缓存保留、期望/应用修订、pendingReview、未编辑字段/Key 保留及验证已接线；网络只有真实部署配置说明和重启提示，环境编辑未实现，整项仍 PARTIAL。

| 合成事件 | 原双观察中位 ms | 热 committed 中位 ms | 启动 ms |
|---|---:|---:|---:|
| 1k | 11.22 | 2.01 | 25.63 |
| 10k | 44.46 | 1.95 | 66.29 |
| 100k | 479.67 | 1.80 | 500.28 |

Node v24.16.0 / Windows x64 / 每项 5 样本。完整数据含结束 heap/RSS 变化和事件循环延迟，见 [notebook-performance.json](../../../.build/dispatch/evidence/relay-03/notebook-performance.json)。100k 最大样本结束 heap Δ 从 135,551,456 B 到 231,960 B，事件循环最大观察约 241.83 / 18.61 ms。before 是旧读取配方，不是历史 checkout；未测峰值。启动、durable observation、冷解码/查询和淘汰后身份观察仍全量；没有 range durable API、真实工程或安装包资格。

最终组合 10 文件 80 项通过；后续真实复制代次/缓存等 7 项、目录编辑 13 项、双语 Panel 3 项、连接/目录/Probe 40 项各自通过。Host/Notebook Client 类型、18 路径正式 scoped lint 与后续定向 lint、offline frozen、3 包 Host + Notebook Client 构建、真实 child-process built 选定指针冷读、公共 JSDoc/i18n/目录/约束及 6 组配对通过。不同命令不能相加称一次全绿。失败修复链和准确日志在 [commands.json](../../../.build/dispatch/evidence/relay-03/commands.json)。

全仓配对实测失败于用户 migration/assets/live2d/README.md 缺英文配对，未覆盖改写该材料。完整 doc-sync 未重跑，前棒 40/43 及历史 7 处禁用词不改成 PASS。pnpm exec 隐式同步已中止；offline lockfile-only 有远端 HEAD 警告后 exit 0，最终 offline frozen 跳过解析并通过，后续调用现有 Node 入口。

Astra 的 W04 已解决且本棒保护回归通过，没有新 Astra 技术阻塞。T02 继续显式 overlay，默认 provider 不变；备份排除、迁移修复 UI、独立 SID/断电/安装发布资格仍未完成。v1/数字 v2/不同物理 scope 的保留与明确拒绝策略不变，无静默重绑、删已提交文件或游标重置。

转交原因：本棒上下文容量，同模型续做。下一棒先做完整隔离 Host/profile ready/fatal/unload、认证 DOM/keyless 记录，再继续 T09 实际部署入口和 T06 等就绪单元。完整 prompt 已保存 [NEXT_PROMPT.txt](../dispatch/NEXT_PROMPT.txt)，[NEXT_HANDOFF](../dispatch/NEXT_HANDOFF.md) 是最新进度。
