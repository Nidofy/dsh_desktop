# 共享接线队列

## Summary

本参考登记只有集成人员 R 可以写入的共享入口。以下全部为 PLANNED / NOT_RUN；没有任何业务接线在 T00 实施。完整行为更新必须连同消费者一起交付，否则只能 PARTIAL。

## Table of Contents

- [执行规则](#执行规则)
- [队列](#队列)
- [Dev Note](#dev-note)

## 执行规则

每项开始时记录实际依赖能力、待改文件、消费者和获暂停的作者；一次只给共享文件一个写入者。完成后记录实际差异、相关命令与结果，复核通过再发布新接口版本。R 不预造未来模块骨架；必要接线可作为 owner 同批交付的串行阶段。未知执行结果先查询，回退保留日志与升级前数据副本。

## 队列

| ID | 提出方→消费者 | R 的最小接线范围 | 完成前验收 |
|---|---|---|---|
| W01 | T01→Host/UI | desktop-host index 就绪；connections API/UI credential mode；路由可用性发布 | 全不可用仍进入修复；健康连接可用；旧 wire 兼容、无秘密 |
| W02 | T03→T04/T05/UI | context/compaction 读取 active 投影，working-notebook Panel 字段适配；发布后同批更新所有类型消费者 | 退休内容不进入下一请求；现有 integration 快照同步，不能单测通过但消费者不编译 |
| W03 | T02→credentials 消费者 | 派生 bundle/provider 注册及迁移引用 | CredentialProvider 全接口，Windows 隔离身份，T01 后端拒绝回归 |
| W04 | T04→context/T05 | 候选和官方成功 flush 接线、Notebook 双游标存储适配 | 取消/flush/CAS/policy 失败不推进；模型输入日志可重建 |
| W05 | T06→所有受管 writers | 现有 workbench storage-admission、ProjectActions/DesktopArtifacts；Notebook、快照、诊断、迁移新增准入清单 | 覆盖矩阵、多 Host 竞争、终态预留；未覆盖写入明确列出 |
| W06 | T07/T08/T10→Workbench | workbench owner.ts/ui.ts，Host 白名单、picker 和 native 管道 | preview 身份复核；导出/验证/导入/恢复分开；部分失败回执 |
| W07 | T09/T23→请求入口 | connections schema/runtime、部署重启、官方/vision/probe/MCP 策略 | 高级字段往返；旧在途租约权限不扩大；本地重定向 sink |
| W08 | T11→T12/T18/T19/T20 | WorkbenchOwner/ProjectActions/Artifacts 真实 run 回执、终态事件 | 源码脏输入指纹、STALE、截断 UNKNOWN；退出码不等于通过 |
| W09 | T12→Main/Companion/pet | Main 独立通知 consumer、prefs、删除 UI 旧轮询触发 | 关工作台/重启/多窗口、OS ACK 未知、审批保留 |
| W10 | T13→T14/T16 | 官方公共 SessionBinding/Reference/Workspace 观察点和 Environment；共享 client index/locale | 双窗口/快速切换、Host 重连、scope 失效、插件独立关闭 |
| W11 | T14/T15/T16/T18→UI | single renderer 管理、pet 动作、Hint 入口；locale/appearance/index | 静态回退、IME/窄屏、离线资产、零展示模型请求 |
| W12 | T19/T20/T21/T22→官方执行服务 | 有界自检/实验/独立分析 Session；白名单 action 委托 | 取消/预算/日志重建；无任意 shell；可选项不启用就明确 DEFERRED |
| W13 | 全部→包构建 | 新依赖、package manifests、pnpm-lock、tsconfig、bundle/导出、schema catalogs | 锁定工具链；类型/文档/快照及实际受支持 profile smoke |

## Dev Note

队列不授予任务作者修改其他 owner 文件的权限；任务 handoff 提供精确文件/符号与期望行为，R 在接线时补充当前实际路径。本轮没有执行上述项目。
