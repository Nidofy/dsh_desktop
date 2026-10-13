# T25 独立审查，第 1 轮

## Summary

结论：**NEEDS_FIX**。2026-10-05（Asia/Shanghai）独立复跑三个验收文件为 11/11，五文件基线为 29/29，退出码均为 0；这证明当前测试可复现，不证明 Session 持久提交边界、集成或安装包合格。发现 1 项 P1 和 2 项 P2，交回 T25 作者修复测试与交接，再按实际修改复核。业务源码未修改。

## Table of Contents

- [对象与实际状态](#对象与实际状态)
- [发现](#发现)
- [环境偏差结论](#环境偏差结论)
- [验收映射](#验收映射)
- [执行与限制](#执行与限制)
- [Dev Note](#dev-note)

## 对象与实际状态

待审目录为 Electron 内 `.build/dispatch/worktrees/T25`，分支 `codex/t25-independent-acceptance`。启动和测试后的 `git status --short --untracked-files=all` 均为空；staged/unstaged diff 为空。相对 `codex/roadmap-integration` 仅增加三个 `roadmap-acceptance-*` 文件与 `migration/roadmap/handoffs/T25.md`，共 376 行，无业务源码、原作者测试、锁文件、公共导出或配置改动。源码、锁和 helper 的 T00 指纹核对一致。提交记录仅保存在执行证据，不作为审查门槛。

已读取根与适用 packages/docs 规则、SCOPE、contracts-v1、HANDOFF_TEMPLATE、baseline、ownership、testing、architecture 和 defensive-patterns。worktree 与主 checkout 的六份规则/约定文件摘要相同；相关 apps/desktop-host、packages/nidofy 和 migration 子目录未发现额外 AGENTS。本轮没有启动其他模型、代理、真实 profile、计费服务、推送、合并或发布。

补充诊断位于独立 `.build/dispatch/worktrees/T25-review-1`，以已核查干净的待审实际分支创建 detached 副本，创建后 diff 为零，包含全部四个待审新增文件；没有相关未提交/未跟踪文件需要额外同步。副本独立安装依赖，只新增审查者诊断文件，不改业务源码或作者测试。该副本保留供复核。

## 发现

### F1 · P1 · 压缩测试未挂载 Session 持久化，不能验收持久提交

位置：[roadmap-acceptance-compaction-boundary.spec.ts:47-50](../../../.build/dispatch/worktrees/T25/packages/nidofy/desktop-extras/tests/roadmap-acceptance-compaction-boundary.spec.ts)，交接第 20、33 行。

触发：使用该文件的 composition 执行任何压缩用例。其调用的 agent-loop-testkit 第 67-76 行仅挂载 LLM、内存 SessionStore、projection、prompt、tools、agent registry，没有 sessionPersistence/provider/持久日志 writer。SQLite 查询 provider 在 index.ts 第 548-556、871-873 行可以直接从 live Session 的 snapshotEvents 取事件；SQLite 查询文件不是官方 Session 持久日志的替代品。

实际影响：审查诊断第 78-85 行实际证明 `ctx.get('sessionPersistence') === undefined`、`ctx.sessions.flush(agent.session) === false`，但 Notebook revision 仍从 0 发布为 1。SessionStore 的 flush 第 1194-1210 行在没有监听器时成功返回 false。已有文件数/Notebook read-back 断言只证明派生 Notebook 的发布，不能证明 summary/end 落盘、故障后可恢复或“已提交候选不丢失”。该组合测试结论为 **PARTIAL**；真实 AgentLoop/Session 对象存在不等于真实持久化接线存在。

最小修复：在测试组合挂载仓库现有官方 Session 持久化 provider 与其 writer，全部目录继续隔离；明确断言该能力存在且 flush 有真实持久化参与，从持久日志重新打开/冷读取确认 summary/end 与 Notebook 对应，补恢复后只发布一次的证据。交接把尚未完成的持久化/Loader 验收标成 PARTIAL，不能继续把 live observation 当持久提交证据。无需新增未来 API。

可复核测试：独立副本的 `roadmap-review-T25-diagnostics.spec.ts` 第一个用例（本轮实际通过，作为缺口复现）；作者修复后将真实 provider/冷重建行为写进其正式验收文件，再重跑三文件与相关基线。真实 Loader/profile smoke 仍未执行。

### F2 · P2 · flush 用例只观察恢复后状态，没有拒绝期不发布断言

位置：[roadmap-acceptance-compaction-boundary.spec.ts:103-120](../../../.build/dispatch/worktrees/T25/packages/nidofy/desktop-extras/tests/roadmap-acceptance-compaction-boundary.spec.ts)。

触发：单次抛错由 Notebook end 监听器或引擎 checkpoint 任意一个 flush 消耗，armed 随即变 false；用例还吞掉 compactNow 的全部拒绝，然后移除注入并通过 status（会主动 synchronize）等到 revision=1。

实际影响：用例没有观察 flush 失败仍持续时的 Notebook 状态，也没有区分预期 persistence 错误与其他异常。提前发布、随后恰好又有一次失败 warning 的实现仍可能满足其终态断言；它不能锁住“不成功 flush 就不发布”的边界。源码 context.ts 第 74-78 行的当前行为正确，不把此问题记成新业务缺陷。

最小修复：用当前公开 `session/flush` 事件维持可控失败，准确断言 persistence 分类；解除失败前通过 `ctx.nidofyNotebook.read` 直接读（不要用会同步的 status）断言 revision/current/revision 文件不变化；解除后再同步，断言只生成一次 revision 并可从真实持久 Session 恢复。单次失败场景可保留，不能替代此负向断言。

可复核测试：审查诊断第 88-100 行已经实际验证该注入能力无需 T04：持续失败时 compactNow 拒绝 code=persistence，Notebook revision=0，解除后 revision=1。其现有公开 API 覆盖的是 checkpoint 控制流，结合 F1 的真实 provider 才能形成完整持久验收。

### F3 · P2 · 差距登记把连接状态的顺序依赖写成无条件事实

位置：[handoffs/T25.md:28](../../../.build/dispatch/worktrees/T25/migration/roadmap/handoffs/T25.md)。

触发：先保存 backup 健康修订，再保存 primary 修订，重启时只丢失较后 primary 的秘密。store.ts 第 142-146 行在遇到缺 Key 前已把 earlier healthy key 写入进程内 Map；status 第 215-218 行的 configured 直接检查该 Map。

实际影响：publish 仍不会发生，open/repair 仍被阻断，但 backup.configured=true、primary.configured=false。审查诊断第 103-131 行实际复现；原测试丢的是首个秘密，其“所有 false”只对该排列成立。交接无条件写“所有连接 configured=false”会误导 T01 对当前状态与原子健康交换的判断。健康路由未发布与 configured 字段为 false 是不同事实。

最小修复：交接改为“发布被整体阻断；configured 可能呈现已加载的修订前缀，本用例缺首个 Key 时全部 false”，可添加丢首/丢后两个排列的特征化断言；不由 T25 修改 ConnectionStore。实际业务状态原子交换仍归 T01。

可复核测试：运行审查诊断第三个用例；作者修改后重跑 connections 验收，并核对交接不再作无条件 false 声明。

## 环境偏差结论

本轮**接受并追认机械环境准备的技术结果，限定为现有源码测试环境**：T25 worktree 和 node_modules/.pnpm 均是实际独立目录，helper 是普通文件，无链接到主 checkout；安装原始日志有 lockfile up-to-date、resolution skipped、postinstall 实际执行和 `Done in 34.5s using pnpm v11.7.0`。当前 Node=v24.16.0、本地 pnpm=11.7.0；锁文件 SHA-256 为 `c374c3d46a8cb07f12ceeb902c0cc5b669377e0f3b892079dcfe9fcd0f460955`，helper 为 `a785913d211c9a41c865b19bfc36d8838b32e33ea69d7f3c7f4c2271238156d9`，分别与主 checkout 和 baseline.json 一致，11/11、29/29 已独立复现。native 前置 helper 已存在，复跑前校验后使用，没有重复复制。

作者代行 R、越过“T00 复核后准备”仍是流程偏差；本报告不把 T00 标成 REVIEWED，也不更新 R 独占的 ownership/registry。R 应据本审查登记环境现状与测试路径租用。原目录有安装/测试失败与成功日志，但未发现独立的 worktree 创建、复制前后 digest 命令原始日志；不能把历史动作称为本审查已核验“全程留证”。当前摘要一致和独立复跑是本轮追认依据，不证明 helper 源码构建一致性或安装包资质。安装日志有 desktop-host/sdk-client/python-sdk-runtime 三类未构建 dsh bin 路径警告；源码 Vitest 可运行，Loader/构建入口仍未知。

独立审查副本另以同一锁定入口进行 `install --frozen-lockfile --offline`，退出 0，37.1s，pnpm 11.7.0，tracked 文件无变化。缓存包复用不等于共享 node_modules 可变目录；没有链接主 checkout 的 node_modules/lib。

## 验收映射

11 条正式用例均使用当前实际存在的 API，无 v1 草案未来接口导入。以下为当前行为特征化，需求合格与测试可复现分别记录。

| 验收面 | 当前实现与用例核对 | 结论 |
|---|---|---|
| 空连接首启 | open→recover→apply 发布空 state；connections 用例 1 | 当前行为准确 |
| 缺 Key 启动与 repair/inspect | store.ts:141-150、173、225-226；connections 用例 2/3 | publish/repair 阻断准确；configured 的普遍描述需 F3 修正 |
| 已撤销修订秘密丢失 | store.ts:143 跳过；connections 用例 4 acquire backup | 当前行为准确；秘密 backend 为合成 Map，OS 凭据验证 NOT_RUN |
| 退休条目/字节 | notebook.ts:37-39 计全部 entries 与完整 JSON；用例 1/2 实际重开 | 当前行为准确；不是活动投影或 1000 次循环已验收 |
| 退休 ID 与 UPDATE 恢复 | notebook.ts:55-65；用例 3 | 当前行为准确 |
| 成功 end + summary 候选 | context.ts:54-66 的 successful-end ID 与 baseRevision；compaction 用例 1 | live 流程/Notebook 幂等准确；Session 持久提交 PARTIAL（F1） |
| flush 失败后同步补发 | context.ts:48-51、74-78；compaction 用例 2 | 恢复终态可复现；拒绝期断言缺口 F2，持久恢复缺口 F1 |
| 超预算 basic 回退 | compaction.ts:49-51 分别约束 payload 与完整 instruction；用例 3 的 640 字节 fixture 超完整 instruction 预算 | basic 无附录/特定 warn 可复现；没有分别覆盖两个分支或所有诊断渠道 |
| 模型失败与后续成功 | 官方 region.ts:235-258；compaction 用例 4 观察 error-end、后续 revision=1 | 当前内存事件行为准确；不是 orphan-summary 或冷恢复验收 |

缺 Key、退休容量、静默跳过/回退的六条现状特征化用例仍应在 T01/T03/T04 集成时由 R 同批更新，保留差距和新的正式需求断言；不能把旧绿断言当成新需求通过。

两次 pending 候选竞态及 summary 缺成功 end/error-end 的候选拒绝仍 **NOT_RUN/待受控注入**，本轮未据官方正常顺序推断所有故障顺序不可达。官方 region.ts:491-509 在 end 之前追加 summary 与替换消息，237-258 再追加 end 和 flush；已覆盖的模型失败发生在 summary 之前。现有手工 compactNow 也有 busy 生命周期限制。正常入口不足以覆盖这两个目标，T04/R 应定义注入位置与场景口径；本报告不认证“公开 API 永远不可达”这一绝对结论。

## 执行与限制

全部 shell 命令、实际脚本、退出码、入口失败、读错路径和输出截断记录见 [执行索引](../../../.build/dispatch/evidence/T25-review-1/commands.json)。各脚本包含 cwd 与 TEMP/TMP/DSH_HOME 设置；没有把未启动的沙箱请求或读取错误计作 PASS。

| 实际执行 | 结果 | 原始证据 |
|---|---|---|
| T25 三文件验收 | exit 0；3 文件/11 用例通过；无 skip；1.19s | [acceptance.log](../../../.build/dispatch/worktrees/T25/.build/dispatch/evidence/T25-review-1/acceptance.log) |
| T25 五文件基线 | exit 0；5 文件/29 用例通过；无 skip；2.32s，含 Windows 真实 native 两例 | [baseline.log](../../../.build/dispatch/worktrees/T25/.build/dispatch/evidence/T25-review-1/baseline.log) |
| 独立副本冻结离线安装 | exit 0；37.1s；11.7.0；未构建 bin 警告保留 | [pnpm-frozen-offline.log](../../../.build/dispatch/worktrees/T25-review-1/.build/dispatch/evidence/T25-review-1/pnpm-frozen-offline.log) |
| 独立审查诊断 | exit 0；1 文件/3 用例通过；1.48s；这是缺口复现成功，不是需求合格 | [diagnostics.log](../../../.build/dispatch/worktrees/T25-review-1/.build/dispatch/evidence/T25-review-1/diagnostics.log)、[诊断源码](../../../.build/dispatch/worktrees/T25-review-1/packages/nidofy/desktop-extras/tests/roadmap-review-T25-diagnostics.spec.ts) |
| 三正式文件 scoped oxlint；待审 diff check | exit 0、exit 0 | 执行索引相应输出 |
| 最终状态/报告检查 | 见执行索引的最终校验记录 | 只新增本报告与独立副本诊断；作者状态干净 |

每个运行目录的 TEMP/TMP 为自身 `.build/dispatch/tmp/T25-review-1`，DSH_HOME 为自身 `.build/dispatch/test-home/T25-review-1`；native qualification 根在 T25 的 apps/desktop/.desktop-build/qualification，按基线测试自行清理。测试根已清理，隔离 TEMP 只保留工具可能生成的 node-compile-cache，日志与诊断留在 Electron 内。合成连接 URL 未拨号，无新监听器端口。诊断清理等待 fiber/ConnectionStore 后删除合成根。未对全系统子进程或机器级 pnpm 缓存作全面生命周期验收。

未执行：40 用例合并重跑（作者原日志存在，本轮只独立重跑 11 与 29）；全仓 typecheck/lint/test:docs/doc-sync、真实 Loader/profile/Shell 端到端、OS 安全凭据 backend、真实 LLM、Session 持久 writer 重启恢复、helper 源码重建、最终发行包；quota/native 新能力、验证过期、scope、IME、Live2D 与出口后续里程碑均不在此交付单元。没有把 mock、已知存量失败、未就绪依赖或资产状态折算 PASS；当前无阻止本轮复跑的环境/资产阻塞。

## Dev Note

本报告由本轮独立审查者写入；作者 handoff、业务代码、原作者测试、R 台账均未改。新增诊断仅用于交回作者复核，未提交、未接入正式验收。修复时不要并行修改业务 owner；T25 修测试和记录，T01/T03/T04 的现有需求差距另按文件归属处理。NEEDS_FIX 不代表已集成、已发布或安装包验收。
