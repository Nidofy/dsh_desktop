# R / T01、T03、T25 源码集成与后继准备

## Summary

R 为本轮唯一集成人员。T01 审查允许的源码、T03 第四轮通过的 v2 存储库与 T25 第二轮通过的测试已受控接收。集成 14 文件 109/109、全量 typecheck、17 文件 scoped lint 和 README 配对通过。R 改动为 READY_FOR_REVIEW；整体产品、真实入口和包资格仍未通过。T02 实施可启动，T04 第一单元可启动，正式提交仍 DEPENDENCY_BLOCKED。

## Table of Contents

- [身份与接收依据](#身份与接收依据)
- [实际改动与接线](#实际改动与接线)
- [验收证据](#验收证据)
- [数据与恢复](#数据与恢复)
- [后继与限制](#后继与限制)
- [交给审查者](#交给审查者)
- [Dev Note](#dev-note)

## 身份与接收依据

- 工作目录：`D:/Documents/FeiyangChen/devApps/dshWinUi/electron`，分支 `codex/roadmap-integration`；作者入口为当前单一会话，未启动其他模型或子代理。
- 执行依据：[INTEGRATE](../dispatch/prompts/INTEGRATE.txt)、当前 AGENTS/下级规则、SCOPE/contracts/ownership/wiring/HANDOFF_TEMPLATE，以及实际代码、未提交文件和消费者。采用 dsh-doc / prose-standard 文档规则；无需提交号或 SHA 校验。
- 最新独立审查：[T01-review-3](../reviews/T01-review-3.md)、[T03-review-4](../reviews/T03-review-4.md)、[T25-review-2](../reviews/T25-review-2.md)。T25 首轮 NEEDS_FIX、T03 先前修复失败和 R 预检 WAIT_AUTHOR_STOP 均保留为历史。
- 人工指定唯一 R 串行处理交付；接收前核实三作者目录干净、已交付 READY_FOR_REVIEW，登记临时排他租用。作者目录保持原样，未在原目录构建、改写或重装。
- 实际范围：[reception-plan](../../../.build/dispatch/evidence/R-integration-20261005/reception-plan.json) 和[接收结果](../../../.build/dispatch/evidence/R-integration-20261005/reception-result.json) 共 21 个文件。本地提交仅接收允许的业务、测试、README 配对和 handoff；作者分支复制的 R 资料全部排除。主目录原资料已备份，当前 R 更新与原有未提交修改保留。

## 实际改动与接线

| 交付 | 实际采用 | 整项状态与未完成项 |
|---|---|---|
| T01 | connections store/API/UI、测试与 handoff；runtime/index 本来相同，不重复接收 | 源码 REVIEWED 并集成；整项 PARTIAL，F5/F6/W01 真实 profile/Loader/Desktop、认证、ready/unload、DOM/keyless 及 owning README/升级指南仍未验收 |
| T03 | notebook.ts、shared/notebook-types、v2 测试、双语 README/i18n 与 handoff | v2 库 REVIEWED 并集成；产品 context/config/compaction/Panel 仍 v1，整体 PARTIAL；W02/W04/W05 待接线 |
| T25 | 三个 owner-local 正式验收测试与 handoff，保留真实 JSONL writer/AgentLoop、持续 flush 失败不发布和落盘后冷恢复 | 第二轮修复交付 REVIEWED；R 仅调整连接缺首/缺后和修复的三个断言，Notebook/compaction 保持现状；R 适配需另行独立复核 |

连接消费者接口已登记：cleanupRecord 区分 none/ledger/journal；journal 尚未恢复时 CONNECTION_RECOVERY_PENDING，不自动重发保存；GC retirement fence 拒绝新 acquire，已有租约继续排除回收；appliedRevision 只表示已发布健康视图，路由注册可能仍需 reconciliation；未知提交先 inspect 原 operationId。旧 wire Key 请求仍由原测试覆盖；未知副作用不自动换 ID 重发。

Host 源码接线已复核：派生 patch 下安装 Connection API 在 ready 之前被 await，ready URL 使用正式 authenticatedUrl；owner 初始化失败安装 503/诊断路径，外层非 owner 安装错误继续 fatal。没有加宽泛 catch 或更改 store 已审查语义。模块测试与入口源码检查不替代真实认证请求、Desktop IPC ready 和卸载验收，F5/F6 保持待办。

R 修正集成测试类型：事件 source 保留 user/system-prompt 判别联合；四个 cleanup 回调返回 Promise<void>；日志 wrapper 使用正式 warn 参数类型。首次 lint 的两行过长随后格式化。业务 store/runtime 语义未重写。文档门禁发现接收 handoff 的提交号引用违反规则，主目录 T01/T25 省略该引用，原作者 handoff 保留；此为接收文档修正，历史审查不变。

W02/W04 归属见[队列](../wiring-queue.md#本轮接线安排)与[ownership](../ownership.md#当前移交)。T04 获 compaction/候选适配与对应测试范围；R 保持 context/config/Panel/公共类型/官方 seam 独占。T03 只提供已审查库，不承担 T04 的压缩算法前置。

## 验收证据

完整精确命令、cwd、环境、时间、退出码和日志均保存在[runs.json](../../../.build/dispatch/evidence/R-integration-20261005/runs.json)。运行 helper 为同目录 run.mjs，每次创建独立 TEMP/TMP/DSH_HOME、DSH_AGENTS_HOME，清除继承的秘密环境项，仅使用合成凭据。以下为摘要，不能替代完整日志。

| 运行 tag / 命令 | cwd | 退出码 / 实际结果 | 限制 |
|---|---|---|---|
| t25-before-update / vitest 三个 T25 文件 | Electron 主目录、接收后的源码 | 1；11 PASS / 3 FAIL | 三条旧启动拒绝断言已过时；失败保留后按真实新行为更新 |
| focused / vitest 14 文件 | 主目录 | 0；109/109 | 包含 T01 原九文件、v2/history 与 T25 三文件 |
| typecheck / pnpm run typecheck | 主目录 | 2；六条相关测试类型错误 | 属于本轮集成问题，已修复，不标无关失败 |
| typecheck-fixed / 同命令 | 主目录 | 0；host build/typecheck 和 client typecheck PASS | 当前源码检查；真实 Loader NOT_RUN |
| focused-final / vitest 14 文件 | 主目录、类型修正后 | 0；109/109 | 真实 Session 持久化测试保留；不替代 Windows 后端或浏览器 |
| scoped-lint / run-oxlint 17 文件 | 主目录 | 1；两条 max-len | 修复格式后再跑 |
| scoped-lint-fixed / 同命令 | 主目录 | 0；17 文件、90 规则、零诊断 | 非全仓 lint |
| readme-pairing / verify-translation-pairing README | 主目录 | 0；1 对 PASS | 接收 T03 README/zh/i18n |
| source-commit / git commit | 主目录 | 0；21 明确文件；提交 hooks PASS | 本地提交，无 push/主线合并/发布 |
| t02-install、t04-install / pnpm install --frozen-lockfile --offline | 对应独立工作树 | 各 0；342 workspace 项目 | pnpm 11.7.0；CLI bin ENOENT 和循环 workspace 警告保留 |
| t02-minimum / vitest 五连接文件 | T02 | 0；44/44 | 已集成 T01 前置；真实 Windows backend NOT_RUN |
| t02-provider-contract / vitest 四官方凭据文件 | T02 | 0；42/42 | 官方 service/local baseline，不证明未来 secure provider |
| t04-minimum / vitest 六文件 | T04 | 0；52/52 | v2 库与现有 v1/压缩边界；不证明已接 v2 产品 |
| doc-quick / pnpm run test:docs | 主目录 | 1；19/21，2 FAIL | 本轮 handoff 引用已修正；旧 concrete terms 失败保留，最终单项重验另登记 |
| doc-references-fixed / verify-repository-references | 主目录、handoff 修正后 | 0；PASS | 相关新增引用失败已关闭；历史审查未改 |
| doc-links-final / 错误脚本名探查 | 主目录 | 1；ERR_MODULE_NOT_FOUND | 失败保留，改用实际 verify-md-links.ts |
| doc-links-fixed / verify-md-links | 主目录 | 0；2316 文件链接 PASS | 标准语料不含 roadmap，另用下面的精确范围检查 |
| roadmap-check / 复用仓库 Markdown AST 链接检查 | 主目录 | 0；12 文件零断链，27 任务/6 gates、状态同步、历史 NEEDS_FIX 和租用释放确认 | 包含新增 R 交接/启动输入及主目录必要 handoff |
| prepare-inputs / 实际文件与独立目录检查、输入复制 | 主目录及 T02/T04 | 0；3 作者干净、10 历史审查字节不变、21 接收文件核对，各目录 30 输入同步 | 源码差异只包含已登记 R 测试/文档适配 |
| handoff-reference-commit / git commit | 主目录 | 0；两份 handoff 引用修正 | 仅本地提交；原作者与历史审查未改 |
| t02/t04-stage-inputs、t02/t04-preparation-commit | 对应任务工作树 | 各 0；明确 R 准备输入形成本地基线 | 历史审查副本作为只读未跟踪输入保留，不混入作者交付 |
| successor-final-check / 输入与实际依赖源码核对 | T02/T04 | 0；tracked 干净，各 30 输入字节一致、六个关键依赖源码一致 | 唯一未跟踪目录为 R 提供的 reviews；不自动 stage 或返回主台账 |

旧 concrete terms 失败位置为 migration/m2/m3/m4/personal 的既有资料，本轮未改。最终本轮新增引用失败单项复验通过；test:docs 完整套件未再次运行，原 19/21 失败保留。doc-sync、全仓 lint 未重跑；历史 42/43 与 locales 诊断不冒充本轮结果。脚本路径探查中的缺文件也保留：registry.md、错误的 HANDOFF_TEMPLATE/persistence 路径已改用 rg 查找实际 registry.json、dispatch 模板及 packages/session/session-persistence；不据此记 PASS。

## 数据与恢复

本轮未迁移真实 home 或用户数据。连接未知回执保留原 operationId；journal 未恢复阻止新保存，ledger 清理和 journal 提交不混淆。既有路由租约/秘密回收语义保持作者已审查实现；非 owner 失败仍 fatal。

Notebook v2 库是新增并存格式，不把产品强行切 v2；原 v1 字节及 v2 journal/immutable twin 的恢复规则保持。readActive/readHistory 可能触发 lazy 迁移，调用者不能把它们当纯只读；不同现存 twin 字节拒绝 NOTEBOOK_IMMUTABLE_CONFLICT，不能覆盖旧证据。未来恢复/回退使用合成副本与升级前数据备份，不自动原地降级或清理工作树。

## 后继与限制

T02：READY_FOR_MANUAL_BINDING，独立目录 `.build/dispatch/worktrees/T02`。可开始完整 CredentialProvider/平台适配及合成迁移；真实 Windows 隔离身份与 W03 另验收。T01 源码前置可用，不借本轮测试宣布安全后端通过。

T04：READY_UNIT1_FOR_MANUAL_BINDING，独立目录 `.build/dispatch/worktrees/T04`；整体 DEPENDENCY_BLOCKED。预算/证据/候选可实现；正式 publish 仍需要 R 暴露实际持久化物理代次及连续原始事件前缀，并接 W02/W04。SessionPersistence revision 是同实例缓存令牌、header.version 是格式版本；官方 JSONL 内部 generation 迁移并非 Notebook 公共代次。cold prepared observation 可补合成中断终态，不能当落盘成功。不得用常数代次或私扫日志路径绕过缺口。

两目录的必要输入、独立依赖/隔离根和本地准备基线见[START_READY](../dispatch/START_READY.md)及各自 preparation.json。任务模型由人工选择，当前未绑定、未启动其他会话。T05 不启动。F5/F6、W03、Windows 后端、真实浏览器/profile、安装包及 G-A–G-F 均保持 NOT_RUN/PARTIAL，不因测试通过改成通过。

后继目录的 R 准备文档已形成本地基线；只读历史 reviews 副本明确保持未跟踪状态，不是未归属的作者改动，后继不得整目录 stage。最新输入与目录检查见[successor-final-check](../../../.build/dispatch/evidence/R-integration-20261005/successor-final-check.json)，完整命令/本地准备提交日志同在 evidence 中。

## 交给审查者

请人工指定独立审查者复核本轮 R 的三个连接特征化断言、测试类型修正、handoff 引用修正和 contracts 的消费者语义登记；对照原作者目录及最新审查，不重新打开已关闭 store 路径或把库接收理解为产品 v2。最短验证为主目录 runs.json 的 focused-final、typecheck-fixed、scoped-lint-fixed 与新的文档单项检查；确认持久化/失败期/冷恢复测试仍真实。R 不自行宣告独立审核通过或安装包合格。

## Dev Note

状态 READY_FOR_REVIEW 仅指本轮 R 交付已可复核。历史 NEEDS_FIX、过程失败、原作者交付及未执行项均保留；不推送、合并主线、发布或自动启动其他模型。
