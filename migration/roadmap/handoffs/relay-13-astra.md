# Relay 13 Astra：单 Conversation root 权限与检索读取取消

## 决定与交付

沿用 D:/Documents/FeiyangChen/devApps/dshWinUi/electron、codex/roadmap-integration；保留全部既有修改、worktree 和素材。接棒为 GPT-6.1-Sol：新的 Main 权限问题已完成决定、实施及验证，剩余为 T17 等常规开发。

- 支持一个 Main 创建的完整 Conversation root 与辅助工作台。第二完整 root 无产品创建/选择入口；菜单、Platform、浏览器 guest、更新、退出和麦克风等保持原 primary owner，不扩成任意同源窗口。源码见 [Main](../../../apps/desktop/src/main.ts)，正式行为见 [Desktop README](../../../apps/desktop/README.md) 与 [升级指南](../../../docs/upgrade-guide/v0.2.0-rc.2/desktop-owned-document/guide.md)。
- boot/locale/stream 核对真实 primary、顶层 frame、准确 app 根路径。导航/销毁作废待返回文档读取；Host 停止/替换作废 locale 和认证结果并取消旧地址流，包括旧 cookie。内网认证前登记已启动地址，认证后才发布 cookie。辅助页面的既有 HTTP 和导航继续可用，不宣称全部同源 HTTP 已逐窗隔离。
- [真实载体](../../../apps/desktop/tests/fixtures/companion-carrier.mjs) 将第二 root 拒绝变为正式必跑回归，覆盖重载、销毁、辅助 bootstrap/产品 IPC 拒绝、child stream 拒绝、主页面重载旧 scope 失效和流恢复。旧 Host cookie 与迟到 locale 则由源码回归覆盖；真实 Host 重启不在本次原生资格内。
- [Notebook Panel](../../../packages/nidofy/working-notebook/src/client/NotebookPanel.tsx) 为搜索、预览、显式引用增加可被下一次选择取消的读取生命周期。检索词/范围改变和卸载也取消；迟到原文不能覆盖新选择或插入草稿。英中乱序回归与两项所属 UI 快照已保存。T17 仍缺全历史子串索引、显式 worktree 分组与冷读峰值资格。

## 验证与失败修复链

[命令记录](../../../.build/dispatch/evidence/relay-13/commands.json)、[归纳](../../../.build/dispatch/evidence/relay-13/summary.json)。最终 source-lifecycle-final 同次 6 文件151项通过；native-ready-final 另行真实 Electron 1文件1项通过，不能相加。最终载体 carrier-nPXOwf，第二完整 root 的结果明确为 REFUSED_UNOWNED_CONVERSATION_ROOT，不是双完整窗口通过。

首次原生检查因认证之前未向内网过滤器登记 Host 地址而失败；恢复登记并保留 cookie/代次检查后通过。正式 lint 发现箭头括号及泛型只在回调出现一次，改成类型由 operation/accept 两端关联后通过。一次重连正向工作台打开被后续实际 scope 更新取消；载体增加 Session open、Workspace ready 和准确选定 scope 条件，严格取消断言保留，随后通过。自动 lint 审批曾超时，未执行，按工具说明原样重试一次；这不是安全拒绝或架构问题。

Desktop Host/Notebook Client 叶类型、最终 Main/preload 与 Notebook Client bundle、5路径正式 type-aware lint、JSDoc、i18n、四组双语配对、升级指南、文档预算与定向链接/换行有独立日志。无 manifest、依赖、lock、exports、Config 或持久 Session 类型变更。Panel 快照不代替正式顶层 recorded-session harness。

## 保留限制与下一步

T13/T17 仍 PARTIAL。registry 仅更新这两个对象，tasks 状态仍适用而未写，ownership 未写；旧证据保留。全仓依赖政策32处、五个旧 Summary 超限、十五个旧 unknown 与历史文档缺口仍在，本棒不重跑或宣称全仓通过。Session 63 roots/9 history、changes=[] 为 Relay12结果，本棒不造新 acknowledgement。完整 doc-sync 未跑。系统真实 IME、跨显示器、安装/OS通知、企业网关、Office转换和顶层 recorded-session 资格不新增。

Sol 首先按 T17 验收继续显式项目关联与可重建索引的增量/取消/损坏恢复，保持 exact cwd 默认和真实来源检查；随后按真实依赖推进 T18。已解决的单 root、账本、adoption、Notebook 物理代次不重新交 Astra。完整后继 prompt 见 [NEXT_PROMPT](../dispatch/NEXT_PROMPT.txt)。

## 交回 GPT-6.1-Sol 的完整 prompt

```text
请使用 GPT-6.1-Sol 继续 DSH Electron 持续开发，接 Relay 13 Astra。转交原因是本次新的 T13 Main 窗口权限决定已实施并验证，后续属于常规持续实现，不是会话容量续做。不要重开第二完整 root 的支持范围、Relay 05/08、W04/T05 或 T10 adoption 的已解决决定。

工作目录：D:/Documents/FeiyangChen/devApps/dshWinUi/electron，沿用 codex/roadmap-integration 和主目录。保留全部未提交修改、来源 worktree、用户 Live2D 素材和历史证据；不校验 SHA、不初始化、不重复接收 T02/T04、不重新审查已完成单元。Relay 13 只修改 registry 的 T13/T17 对象；tasks 仍 PARTIAL，ownership 和其他对象未写。

完整读取 AGENTS.md、适用下级规则、packages/AGENTS.md、packages/client/AGENTS.md、docs/AGENTS.md、docs/architecture.md、docs/defensive-patterns.md、migration/roadmap/dispatch/CONTINUOUS.md、NEXT_HANDOFF.md、migration/roadmap/handoffs/relay-13-astra.md、contracts-v1.md。Client 工作先读 docs/subsystems/web-client.md、slots.md、conversation.md。Relay 12/11/10 只按实际需要补前棒细节，当前源码、配置、测试和全部未提交修改优先。

第一项动作：对照 dispatch/prompts/T17-local-history-search.txt、desktop-extras/src/history-search.ts、context-v2.ts、history-search.spec.ts、working-notebook 的 Panel/registration 和现有 Workspace/SessionQuery 服务，推进 T17 尚缺的显式项目/worktree 关联与可重建索引增量、取消及损坏恢复。先查真实 owner 和授权字段再接线；默认当前 Session/exact cwd，禁止凭相同路径前缀、仓库名或模型自述扩大来源。候选载入、返回、预览、引用均复核实际权限、分组和物理代次。没有现成公共 owner 时自行完成定义、provider、消费者、持久恢复与必要验证；仅遇到新的具体公共持久语义或权限冲突才准备新 Astra 问题。T18 待实际依赖齐备后继续规则/去重/失效/返回卡，消费真实 T11/T12/Notebook，不猜 Hint 或持久 ScopedAction API。

T13 已裁决并落地：产品支持一个由 Main 创建的完整 Conversation root 加工作台等辅助窗口，不支持第二完整 root。boot、locale 与 Host WebSocket 要求当前 primary 顶层文档及准确 app 根路径；Main document revision 在导航/销毁时使未完成读取失效。Host revision 阻止停止后的认证结果复活，停止清除可用 cookie/注入，应用页面向旧 Host 地址发出的流请求即使携带旧 cookie 也取消。认证前仍登记刚启动 Host 的地址供内网请求过滤器使用，认证完成才发布 cookie。没有扩大 origin 权限，也没有修改其他 primary-only 产品 IPC；辅助 HTTP/导航原能力保留，不能声称所有同源 HTTP 按窗口隔离。

真实 Electron 已验证主页面/工作台、第二完整 root 在重载前后的 boot/locale/product/stream 拒绝及销毁、同源 child frame 流拒绝、主页面重载旧 scope 拒绝与流恢复，且保留 Relay 12 的全部载体行为。第二 root 为 REFUSED_UNOWNED_CONVERSATION_ROOT，不是双完整 root 通过。迟到 locale 的重载/销毁/Host 停止及旧 cookie 在停止/替换时拒绝属于源码回归，不冒称真实 Host 重启载体验证。重连正向打开工作台需等待实际 Session open 和 Workspace ready；connected 本身不表示所有投影已恢复。不要删除严格取消断言。

T17 另修复 Panel 请求竞态：检索词/范围改变、选中其他预览和卸载会取消旧 search/source/citation 读取；即使传输忽略取消后完成，旧响应也不能覆盖新结果或插入草稿。只在显式点击引用后重新验原文，经完整 CompanionScope/mainBinding 写入现有 composer，保留附件、不自动发送。英中乱序/取消回归和所属 UI 空结果快照已保存。既有 unicode61 词语/文件名/错误码召回与有界中文单字/两字/长子串退路保持；没有全历史中文子串索引、跨 worktree 分组或全面冷读峰值资格，T17 仍 PARTIAL。

准确证据见 .build/dispatch/evidence/relay-13/commands.json 和 summary.json：最终 source-lifecycle-final 同次 6 文件151项；native-ready-final 另行真实 Electron 1文件1项，不能相加；当前载体 carrier-nPXOwf。当前 Desktop Host/Notebook Client 叶类型、Main/preload 和 Notebook Client bundle、5路径 type-aware lint、JSDoc、i18n、四组配对、升级指南、文档预算和定向链接/换行均有记录。两个双语快照是 Panel 所属 UI 快照，不是正式顶层 recorded-session harness。保留首次内网认证地址登记顺序失败、两处 lint 修复和一次重连未就绪的载体失败链。自动 lint 审批曾超时未执行，原样窄重试执行后通过；没有权限扩大补丁或审批绕过。

本棒没有 manifest/依赖/lock/exports/Config/Session 格式变更，没有新增 unknown 断言或政策例外。Session 63 roots/9 history、changes=[] 是 Relay 12 的历史通过结果，本棒未重跑。完整 doc-sync、全仓依赖政策和 Summary/unknown 门禁未重跑；继续保留 32 个未分类 Host 导出使用、五个未触及 README Summary 超限、十五个历史 unknown 断言及旧文档缺口。scripts/package-dependency-policy.ts 禁止代理新增 safe-export 例外，需人审；不改政策、不用会隐式安装的 --fix/pnpm exec。用现有 node_modules 的 Node 入口及保留的本地 Electron，禁止下载替代资格。

保持 T11/T12 持久意图、原始日志、独立验收 CAS、未知结果不重放、NoticeId/claim/游标/角色可见/已处理分离和未知 OS ACK 不重发。保持唯一物理发行根、原位 imports adoption、quota operationId、Host 私密 token、逐写消费、取消排空、physical generation/raw durable prefix/readSelected/synchronize。新 scope 不自动重绑或删除旧 Notebook。T02 仍显式 overlay，不改默认 credentials provider。Node-mode/当前设备 Electron 开发载体不等于安装包、跨显示器、系统实际中文 IME、企业网关、Office conversion/runtime preparation 或顶层 recorded-session 资格。

承担实现、所有消费者、共享接线、配置/构建、必要双语文档和有效验证。只用隔离数据、合成 Key、本地 provider；不计费、不迁移真实用户数据、不创建聊天/代理/定时器、不 push/合并/发布。普通类型、UI、fixture、lint、登记和文档错误自行修复。每个行为单元验证后继续，按 CONTINUOUS 只在真正交接条件满足时结束；容量续做交同模型，不把旧问题再交 Astra。结束前更新 NEXT_HANDOFF.md、NEXT_PROMPT.txt，保存下一个未用 relay-NN-sol.md，并在最终贴出同一完整 prompt 与具体原因。
```
