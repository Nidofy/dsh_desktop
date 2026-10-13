# Relay 12 Sol

真实载体和有界中文原文引用已交付，T13/T14/T17 保持 PARTIAL。新权限决定、精确复现和验证边界见 [NEXT_HANDOFF](../dispatch/NEXT_HANDOFF.md) 与 [Astra 定向输入](ASTRA-T13-WINDOW-20261009.md)。没有修改 Main 授权或重开旧架构问题。

## 发出的完整下一棒 prompt

```text
请使用 Astra 继续 DSH Electron 持续开发，接 Relay 12 Sol。这次转交有新的具体 T13 原生窗口权限决定，不是会话容量续做；不要重开 Relay 05/08、W04/T05 或 T10 adoption 已解决问题。

工作目录：D:/Documents/FeiyangChen/devApps/dshWinUi/electron，保留 codex/roadmap-integration、全部未提交修改、来源 worktree、用户 Live2D 素材和所有旧证据。不校验 SHA、不初始化、不重复接收 T02/T04、不重新审查已完成单元。Relay 12 仅更新 registry/tasks 的 T13/T14/T17 对象，ownership 未写，其他对象保持。

完整读取 AGENTS.md、packages/AGENTS.md、packages/client/AGENTS.md、docs/AGENTS.md、docs/architecture.md、docs/defensive-patterns.md、migration/roadmap/dispatch/CONTINUOUS.md、NEXT_HANDOFF.md、relay-12-sol.md、ASTRA-T13-WINDOW-20261009.md、contracts-v1.md 和 native/nidofy-protection/README.md。Relay 11/10 是已发布当前能力的输入，历史账本只按需读。以当前源码、配置、测试和未提交改动为准。

第一项：处理同 Host 第二完整 dsh-app://app/ 页面是否属于产品支持范围，以及 Main 对它的最小所有权/授权。读取 apps/desktop/src/main.ts、ipc.ts、preload-app.ts、companion-navigation.ts，以及 tests/fixtures/companion-carrier.mjs、companion-main.mjs、companion-host.mjs 和 companion-carrier.built.e2e.ts。最小复现：node apps/desktop/tests/fixtures/companion-carrier.mjs .build/dispatch/evidence/relay-12 --probe-second-app。真实第二 BrowserWindow ID=4，locale bootstrap 被拒为 unowned frame，实际 WebSocket refused；carrier-oDk2XZ/result.json 和 main.log 保存准确结果。此探针退出零是预期拒绝已观察，不能说第二完整窗口通过。

当前主页面/工作台双窗口已经真实通过，Main 原 primary 授权未改。把 WebSocket/locale IPC 放宽到任意同应用 BrowserWindow 的补丁被自动审批以安全边界扩大、缺准确影响范围批准拒绝，未落盘、未绕过。先裁决双窗口范围：若只要求现有主页面/工作台，明确范围后继续开发；若需两个完整 Conversation root，设计 Main 显式拥有的 root/document 生命周期和最小 locale/stream 权限，不能只按 origin 放宽，也不能机械放宽 browser guests、子 frame、独立工作台或其他 primary-only 产品 IPC。落实具体方案、全部消费者与实际同 Host 双 root/重载/销毁/跨 sender/旧 Host cookie 回归；不要只输出再找 R。

Relay 12 的真实载体使用保留的 Electron 44.0.0 / Chromium 152.0.7977.54 / Node 24.18.1，当前生产 Main/preload、打包 Web 和完整隔离 Host。正式 scope bootstrap、切换与重连时隐藏目标销毁、跨 sender 拒绝、真实 Notebook Host/Client 热停启、关注释放、宽窄焦点/草稿/实际附件/光标、合成 composition Escape 保护、中英文、浅深主题与当前设备 DPI/1.25 缩放已测。系统实际中文 IME、跨物理显示器、安装版/OS 通知和顶层 recorded-session snapshot 仍未资格化。Main 日志的未配置 mandatory-status 拒绝是旧观察，取消目标和跨 sender 的拒绝是预期。

T17 已有可用的有界中文退路：读取 desktop-extras/src/history-search.ts、context-v2.ts、history-search.spec.ts、working-notebook/src/client/NotebookPanel.tsx、registration.tsx、locales.ts，以及真实 Loader fixture。保留官方 SQLite unicode61 的词语/文件名/错误码召回，补中文单字、两字和长子串的近期原文窗口；实测 unicode61/trigram/字面匹配见 search-evaluation.json。trigram 不覆盖不足三字的查询，因此当前没有把 trigram 当完整中文方案。使用既有 maxCachedSessions/recentScanEvents/recentEventLimit/maxEvidenceBytes；UTF-8 完整原文加定位字段计费，限额明确返回 substringIncomplete。不新增索引 schema、Config、manifest exports、云 embedding 或 Session 格式。

候选只来自原始 durable Session，包含真实物理 generation/seq/role/原事件摘要；默认当前 Session，扩大范围仅 exact cwd。原文加载前、返回前及引用时重验范围/代次/provider，缺来源或旧代次拒绝。预览不改草稿；用户点击插入才再次读原文并经当前完整 CompanionScope/正式 mainBinding 写入原 composer，保留附件，不自动发送或调用模型。Notebook Panel 的完整 HTTP 1 MiB 上限现在在解码前执行。冷重开重建内存索引保持同一原来源；索引失败不伪造结果。还没有全历史中文子串索引、显式跨 worktree 分组和全面冷读峰值资格，T17 保持 PARTIAL。按真实依赖补齐后再推进 T18 规则/去重/失效/返回卡，消费实际 T11/T12/Notebook；不猜 Hint 或持久 ScopedAction API，不从模型自述生成 PASSED。

精确命令、失败修复链和当前归纳在 .build/dispatch/evidence/relay-12/commands.json、summary.json。最终同次源码 source-limit-final 为四文件十八项；另行真实 Electron native-limit-final 为一文件一项，两层不相加。Host/Client/Desktop 叶类型、两个实际 Client bundle、Host context bundle、type-aware lint、JSDoc、950 Client copy、Client/119 Cordis catalog、workspace constraints、预算、三个双语配对、定向链接/换行通过。Session 仍 63 roots/9 history，changes=[]。完整 doc-sync 没跑。

全仓非绿项准确保留：依赖政策 32 个未分类 Host 导出调用位置，31 个原位置加新 helper 使用同一个原先已未分类的 extractSessionEventText；新 SessionId 误标运行时 import 已改为 type-only。scripts/package-dependency-policy.ts 明确禁止自动代理新增 safe-export 例外、要求人审，未改政策，也未使用会隐式 pnpm install 的 --fix。另有五个未触及 README Summary 超限和十五个历史 unknown 断言；本棒没新增 unknown。新增一个已存在 ui-conversation workspace 的 dev/Client metadata/叶引用和锁文件一个 importer，没有依赖安装。最初 Electron npm 入口触发隐式下载尝试后已中止，未使用下载结果；后续只用已有 Node 入口与保留的本地 Electron，不用 pnpm exec 同步。

保持 T11/T12 的持久意图、真实 Node TAP/完整原日志、独立验收 CAS 和未知结果不重放；零退出不等于 PASSED，completed 不等于测试通过。NoticeId/claim/游标/角色可见/已处理独立，重连不补弹、未知 OS ACK 不重发。保持唯一物理发行根、原位 imports 接纳、配额 operationId、Host 私密 token、逐写扣减、取消排空、代次/raw durable prefix/readSelected/synchronize、保留旧 Notebook 物理代次和 T02 显式 overlay。新 scope 不自动恢复、同步、重绑或删除旧代次；不改默认凭据 provider。

承担实现、共享接线、所有消费者、必要双语文档及有效验证。只用隔离数据、合成 Key、本地 provider；不计费、不迁移真实数据、不创建聊天/代理/定时自动任务、不 push/合并/发布。普通 UI、类型、fixture、lint、注册和文档问题自行修复。当前新的窗口权限决定解决后持续推进就绪工作；容量续做交同模型，不把旧问题再交 Astra。结束前更新 NEXT_HANDOFF.md、NEXT_PROMPT.txt 和下一个未用 relay-NN-astra.md，在最终贴出同一完整 prompt 与具体原因。
```
