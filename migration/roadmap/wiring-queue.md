# 共享接线队列

> 当前执行规则（2026-10-07）：用户要求 Sol↔Astra 连续开发，GLM 仅文档。下面旧多作者、R 独占、逐任务审查和分离集成安排已停止作为执行门槛；当前代码作者承接共享接线权限，历史事实和功能验收要求保留。以 [CONTINUOUS](dispatch/CONTINUOUS.md)、[NEXT_HANDOFF](dispatch/NEXT_HANDOFF.md) 和实际代码为准。

## Summary

本参考登记集成人员 R 的共享入口。当前 T01/T03 源码与 T25 测试已受控接收；W01 PARTIAL，W02/W04 的文件和顺序已登记但产品仍用 v1，W03 与其他接线未验收。下方原队列和预检为历史；当前决定见[本轮接线安排](#本轮接线安排)及[台账](integration-ledger.md)。完整行为更新必须连同消费者一起交付，否则只能 PARTIAL。

## Table of Contents

- [执行规则](#执行规则)
- [队列](#队列)
- [本轮接线安排](#本轮接线安排)
- [Dev Note](#dev-note)

## 执行规则

每项开始时记录实际依赖能力、待改文件、消费者和获暂停的作者；一次只给共享文件一个写入者。完成后记录实际差异、相关命令与结果，复核通过再发布新接口版本。R 不预造未来模块骨架；必要接线可作为 owner 同批交付的串行阶段。未知执行结果先查询，回退保留日志与升级前数据副本。

## 队列

| ID | 提出方→消费者 | R 的最小接线范围 | 完成前验收 |
|---|---|---|---|
| W01 | T01→Host/UI | desktop-host index 就绪；connections API/UI credential mode；路由可用性发布；与 T25 串行更新缺 Key 现状断言 | 全不可用仍进入修复；健康连接可用；旧 wire 兼容、无秘密；缺首/缺后修订均核对 |
| W02 | T03→T04/T05/UI | context/compaction 读取 active 投影，working-notebook Panel 字段适配；发布后同批更新所有类型消费者和 T25 退休预算现状断言 | 退休内容不进入下一请求；现有 integration 快照同步，不能单测通过但消费者不编译 |
| W03 | T02→credentials 消费者 | 派生 bundle/provider 注册及迁移引用 | CredentialProvider 全接口，Windows 隔离身份，T01 后端拒绝回归 |
| W04 | T04→context/T05 | 候选和官方成功 flush 接线、Notebook 双游标存储适配；定义两个 pending 候选及缺成功 end 的受控注入；串行更新 T25 跳过/回退现状断言 | 真实 Session provider+writer 和冷恢复；持续 flush 拒绝期不发布；取消/flush/CAS/policy 失败不推进；模型输入日志可重建 |
| W05 | T06→所有受管 writers | 现有 workbench storage-admission、ProjectActions/DesktopArtifacts；Notebook、快照、诊断、迁移新增准入清单 | 覆盖矩阵、多 Host 竞争、终态预留；未覆盖写入明确列出 |
| W06 | T07/T08/T10→Workbench | workbench owner.ts/ui.ts，Host 白名单、picker 和 native 管道 | preview 身份复核；导出/验证/导入/恢复分开；部分失败回执 |
| W07 | T09/T23→请求入口 | connections schema/runtime、部署重启、官方/vision/probe/MCP 策略 | 高级字段往返；旧在途租约权限不扩大；本地重定向 sink |
| W08 | T11→T12/T18/T19/T20 | WorkbenchOwner/ProjectActions/Artifacts 真实 run 回执、终态事件 | 源码脏输入指纹、STALE、截断 UNKNOWN；退出码不等于通过 |
| W09 | T12→Main/Companion/pet | Main 独立通知 consumer、prefs、删除 UI 旧轮询触发 | 关工作台/重启/多窗口、OS ACK 未知、审批保留 |
| W10 | T13→T14/T16 | 官方公共 SessionBinding/Reference/Workspace 观察点和 Environment；共享 client index/locale | 双窗口/快速切换、Host 重连、scope 失效、插件独立关闭 |
| W11 | T14/T15/T16/T18→UI | single renderer 管理、pet 动作、Hint 入口；locale/appearance/index | 静态回退、IME/窄屏、离线资产、零展示模型请求 |
| W12 | T19/T20/T21/T22→官方执行服务 | 有界自检/实验/独立分析 Session；白名单 action 委托 | 取消/预算/日志重建；无任意 shell；可选项不启用就明确 DEFERRED |
| W13 | 全部→包构建 | 新依赖、package manifests、pnpm-lock、tsconfig、bundle/导出、schema catalogs | 锁定工具链；类型/文档/快照及实际受支持 profile smoke |

## W01 预检（2026-10-05）

W01 仍 PLANNED / NOT_RUN，R 处于 WAIT_AUTHOR_STOP；共享文件租用尚未激活。已核实连接健康/清理/退休字段的作者源码含义、正式 client-connection 认证层、Desktop Host ready 前安装点和 T25 旧断言。非 owner 安装错误继续 fatal，未增加 catch。源码预检九文件 65/65 与 scoped lint 通过不代表接线完成；[逐项缺口与证据](handoffs/R-T01-W01.md) 待停写确认后实施。其他 W02–W13 状态不变。

## 本轮接线安排

| 项 | 当前实际状态 | 独占文件 / 下一次实施顺序 |
|---|---|---|
| W01 | PARTIAL；连接 store/API/UI 已接收，健康连接隔离与 keep/replace 回归通过。Host ready 前 await 及 non-owner fatal 已复核；真实 profile/Loader、认证、DOM、keyless 和产品文档仍 NOT_RUN | R：`apps/desktop-host/src/index.ts`、`apps/desktop/README*` 和升级项；连接文件已结束本次租用。T25 connections 三条旧断言已随实际行为更新，R 改动待指定独立复核 |
| W02 | PLANNED；v2 库可用，context/config/Panel/压缩当前仍 v1 | R：desktop-extras `src/context.ts`、`src/index.ts`、公共类型及 README；working-notebook `src/index.ts`、`src/settings.ts`、`src/client/NotebookPanel.tsx`。T04 候选交付审查后，R 串行切活动投影和配置，编译全部消费者并更新真实产品断言 |
| W03 | PLANNED；T02 provider 实施可开始，Windows 后端与注册仍未验收 | T02 独占新 secure-credentials 内实现/测试；R 独占 manifests/lock/bundle/API 聚合和 T01 消费改动 |
| W04 | DEPENDENCY_BLOCKED（正式提交）；T04 预算/证据/候选单元可开始 | T04：`compaction.ts`、预留 `notebook-evidence.ts`/`notebook-commit.ts`、context-integration 测试/快照和新 compaction tests。R：官方 session-persistence/session-query 公共 durable prefix/generation seam、context/公共类型和配置。先界定真实持久事件、代次及 actor，审查候选适配，再接官方成功 flush；不得把逻辑格式 version/缓存 revision/合成中断终态当作持久代次或成功 |

路径均相对 `packages/nidofy/` 对应包，官方 seam 相对 `packages/session/` 与 `packages/session-query/`。未来文件只预留归属，本轮不预造模块。T03 notebook.ts 与 notebook-types.ts 的已审查实现对 T04 只读；修改公共类型先移交 R。T05 尚未启动。T25 Notebook/压缩特征化原断言只有在 W02/W04 实际改变产品行为后才串行更新；保留真实 writer、失败期不发布和冷恢复能力。

## Dev Note

队列不授予任务作者修改其他 owner 文件的权限；任务 handoff 提供精确文件/符号与期望行为。此前 T25 首轮修复请求和 W01 WAIT_AUTHOR_STOP 记录保留为历史；第二轮审查已关闭 F1/F2/F3，本轮唯一 R 授权及串行接收另登记。源码集成不等于包资格。
