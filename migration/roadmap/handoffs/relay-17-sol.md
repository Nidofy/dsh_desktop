# Relay 17 Sol：正式隔离本机自检

## 当前交付与结束原因

工作目录 D:/Documents/FeiyangChen/devApps/dshWinUi/electron，codex/roadmap-integration，沿用主目录。保留既有未提交修改、来源 worktree、Live2D 素材及历史证据。本次结束原因为同模型会话容量续做，下一棒 GPT-6.1-Sol；没有新 Astra 裁决。T19 本机 runner/report/UI 已接线，完整 Node-mode Host 已验证；连接模式、完整前缀分类、真实 renderer/安装/现场仍未发布或 UNKNOWN，总资格 PARTIAL。

## 实际实现

- apps/desktop-host/src/selftest 的 types/catalogue、store、runner、local provider 和双语 HTML dashboard 接入 WorkbenchOwner 与认证 API。Personal extensions 导航正式页面，旧六行 presence endpoint 明确拒绝；共享 manifest/lock/leaf tsconfig/bundle 更新，不安装依赖或增加 safe-export 例外。官方 filesystem Skill provider 从明确构建产物打入 Host，保持 Cordis 与官方服务原身份。
- 原 native quota 普通/终态租约，持久意图先于构造、逐项 RUNNING 先于执行、结果仅提交后发布；未知 checkpoint 停止后续副作用且不自动再写。取消/卸载等命令、输出与 provider 排空。冷读 INTERRUPTED/UNKNOWN 不改原字节、不重放。64KiB/20份，目录80项与22×64KiB+4KiB完整上限含临时/锁/残留；损坏/未来/链接保留拒绝。白名单 JSON/Markdown 去内部id和敏感内容。
- 随机隔离 root/canonical marker，只在正常排空与身份重验后清本次安全root；十个崩溃残留拒绝新建，冷启动不接纳/删除旧root。实际原子写/冷读/真实quota拒绝、固定Shell、仅显式合成Skill目录、信任/变更拒绝、实际TAP及动作冷读、取消已启动长命令、Git/Hg依赖检查和差异、产物失效、只读报告恢复、私有通知去重。Hg未安装为SKIPPED。Synthetic Session prefix只观察实际raw追加/physical generation，完整Notebook/cache rewrite与route分类UNKNOWN；本地失败provider只在official准备入口拒绝并停止后续，真实send零，不认证流式retry。
- 本次 registry 仅T19对象及ownership对应一行有实质更新，tasks原文未改且T19仍PARTIAL；脚本以本会话原文快照核对其他对象/top fields保持。T17/T18/T23对象未改。必要四组双语、旧入口升级指南、contracts-v1/测量映射随行为更新。

## 精确验证

.build/dispatch/evidence/relay-17/commands.json、summary.json 保存全部命令及分层结果。最后 selftest-retention-source 同次3文件11项，含 native quota/Shell 与临时残留字节上限；consumers 另一次3文件14项，含相同两项UI，不相加。最后 selftest-retention-host 当前 Host bundle 的完整 profile 在 retention-host/：同源认证/错误origin拒绝、正式本机结果、实际主Host llm/stream=0与agent/created=0、正常重启冷读、初始意图后隔离Host强制退出冷读INTERRUPTED、原字节不改、无重放。保留 root=dsh-selftest-host-AWzcGt 和原日志；这不是命令中途崩溃、真实Electron renderer、安装包或现场资格。

类型、窄lint、6新源码/17顶层导出JSDoc和无unknown断言AST、4双语pair、升级指南、11指定文档链接与列入预算检查通过。UI两份owner-local静态期望保存且只读回放通过，不伪装顶层recorded-session或真实窗口。全仓doc-sync、依赖政策、Summary/unknown未重跑；32/5/15及旧文档缺口保留。

保留首次lint及修复lint失败、prefix未flush即observeDurable的NotFound、首次Host缺早期skill-filesystem runtime import、指南相对路径pair失败及全部修复日志。首次沙箱setup refresh失败原文在sandbox-setup-refresh.txt，随后只作有依据窄主机执行。新fixture全部独立物理root/home；此前共享TEMP与mock残留不删除、不猜测回写。既有T11/T12日志/验收、T06/T10物理根/quota/import、T17/T18scope/generation/偏好与通知独立义务、Relay16实际HTTP受控入口和所有排除范围保持。

## 下一步

直接继续T19连接模式：固定模型、ConnectionStore实际修订和T23策略修订、五次/64token预算、逐发送检查、无retry/failover/未知补发，以及官方完整model-visible输入日志。当前SELFTEST_MODE_UNAVAILABLE须保持到真实consumer发布。旧cache Probe不能替代日志义务。后续补完整prefix/Notebook/cache route分类，不重开W04决定；真实Electron/安装/现场仍需相应入口证据。普通缺owner/台账NOT_STARTED不阻塞作者接线，只在新的具体公共持久语义或权限冲突准备Astra。

## 发出的完整后继 prompt

```text
请使用 GPT-6.1-Sol 继续 DSH Electron 持续开发，接 Relay 17 Sol。这是同模型会话容量续做，没有新的 Astra 裁决；不要重开 Relay05/08、W04/T05、T10 adoption 或 Relay13 单 Conversation root 决定。

工作目录 D:/Documents/FeiyangChen/devApps/dshWinUi/electron，沿用 codex/roadmap-integration 和主目录。保留全部未提交修改、来源 worktree、Live2D 素材、原日志和历史证据。不校验 SHA、不初始化、不重复接收 T02/T04、不重审完成单元。Relay17 仅改 registry 的 T19 对象和对应 ownership 行，tasks 原文未改；其他 registry 对象及顶层字段已断言保持。T17/T18/T19/T23 总资格仍 PARTIAL。

完整读 AGENTS.md、适用下级规则、packages/AGENTS.md、packages/client/AGENTS.md、docs/AGENTS.md、docs/architecture.md、docs/defensive-patterns.md、migration/roadmap/dispatch/CONTINUOUS.md、NEXT_HANDOFF.md、handoffs/relay-17-sol.md、contracts-v1.md。Client 工作先读 docs/subsystems/web-client.md、slots.md、conversation.md。Relay16/15及更旧记录只按实际需要补细节，以当前源码、配置、测试及未提交修改为准。

第一项动作：继续 T19 连接模式，先读 dispatch/prompts/T19-selftest-center.txt、probes/T19-electron-map.md 和 apps/desktop-host/src/selftest/README.md、types.ts、catalogue.ts、store.ts、runner.ts、local.ts、ui.ts。正式隔离本机 runner/report/UI 已接入 WorkbenchOwner、认证 API 和 Personal extensions；旧六行 presence endpoint 改以 SELFTEST_USE_FORMAL_RUNNER 拒绝。不要重新照搬旧 Probe 或把 COMPLETED 当全部 PASS。连接模式现在明确 SELFTEST_MODE_UNAVAILABLE，不能登记已实现。

连接模式必须由当前作者完成定义/provider/全部消费者及 UI：固定模型、真实 ConnectionStore 修订和 T23 策略修订、最多五次确认的合成请求及64-token输出预算，逐请求检查预算/权限，不自动重试/故障转移，失败或未知即停、不补发。所有实际 model-visible 输入必须消费官方可重建 Session 日志义务，不能只存摘要/哈希或直接复用未记输入的旧 cache Probe；不执行模型生成命令。只用本地合成 provider/Key 和隔离数据验证，不创建真实用户会话、不计费。普通缺接口/NOT_STARTED/缺 owner 不停工；只有新的具体公共持久语义或权限冲突才准备 Astra 问题。

本机现有语义必须保持：原 native quota 普通检查点及独立终态额度；意图先于 provider 构造，逐项 RUNNING 先于执行，结果仅提交后可见；未知检查点停止后续副作用且不盲目写第二次。取消与卸载排空实际命令/输出/provider。冷读 RUNNING 为 INTERRUPTED，执行中 UNKNOWN、待执行 SKIPPED，只读不改原字节、不重放。每份报告/导出64KiB，保留20份，只裁剪已知终态；目录80项与22×64KiB+4KiB完整字节上限含锁/临时/残留，损坏/未来/链接拒绝并保留。导出白名单省略内部id，不含地址/路径/模型/账户/Key/正文/原异常。随机隔离root marker/canonical身份重验、只清本次安全root；十个崩溃残留拒绝新分配，不猜测删除。

已测原子写与真实quota拒绝、固定Shell、仅显式目录的官方Skill provider、动作信任/变更/实际TAP与冷读、取消已启动命令、Git差异、产物失效、只读报告恢复、私有通知去重。Hg本机缺失为SKIPPED。prefix只实际观察raw JSONL追加/physical generation，Notebook/缓存改写与路由完整分类仍UNKNOWN；probe-failure只观察官方准备入口本地拒绝、后续准备停止、真实发送零，不当流式重试资格。node/dsh/modules/webview未取得真实安装/renderer载体证据保持UNKNOWN，现场两项始终UNKNOWN。

准确新证据在 .build/dispatch/evidence/relay-17/commands.json、summary.json：最终 selftest-retention-source 同次3文件11项；consumers 另一次3文件14项，含相同两项UI，不相加。当前最后 Host bundle 的 retention-host/ 是完整Node-mode profile：认证、实际llm/stream=0与agent/created=0、完整本机报告、隔离Host强制退出后原字节不变且冷读INTERRUPTED、无重放。它不认证真实Electron renderer、安装包或现场；强制退出发生在初始意图后，不包装成命令中途崩溃资格。类型、窄lint、6新源码/17顶层导出JSDoc及unknown AST、4双语、升级指南、11文档链接/列入预算检查通过。静态UI两份owner-local期望已保存，不伪装顶层recorded-session或真实renderer资格。

保留首次lint/修复lint、prefix未flush即observeDurable的NotFound、首次Host缺早期skill-filesystem依赖、指南相对链接失败及全部修复日志。Host把官方filesystem Skill provider从明确lib/types产物打入bundle，没有安装/下载或safe-export例外。沙箱setup refresh原始失败已留存，后续仅有依据的窄主机执行，无安全拒绝绕过。新fixture全部独立物理root/home；历史共享TEMP和旧mock残留保留，不删除或猜测回写。

T23继续消费已发布 HttpEgressPolicy/HttpEgressLease 与 DesktopEgressPolicy、Loader前 outboundHttp。先读 connections/README.md、egress.ts、runtime.ts、store.ts、ConfigEditor.registerValidator、probes/T23-egress-coverage.md、docs/subsystems/boot.md，不猜API。checkConfiguration只准共享定义保存；check/fetchFor才准真实发送。固定distribution/profile修订，准确Workspace/attachment/provider与完整策略变化撤销，最后读取及fetch前同步重验，origin变化和所有redirect拒绝。无scope/合成Session标签/MCP应用所有更窄规则。旧ConnectionStore Revision.policyRevision是连接发布计数，不是T23lease修订。安装策略时PiAi仅显式credential的completions/messages SSE，其他native auth/API/WebSocket拒绝。HTTP保证不覆盖Shell/Git/任意socket/worker/web-search/fetch/其他插件/账号登录/包管理器/MCP stdio，网关UNKNOWN，不冒称全局零外联。

T17/T18及T11/T12/T06/T10的既有义务保持：真实scope/mainBinding、准确Workspace关联CAS、physical generation/raw连续前缀及最后caller-stat撤销；Hint偏好/返回展示与通知identity/claim/游标/handled/验收独立；未知副作用或OS ACK不补发；唯一物理发行根、原位imports adoption、私密quota token/逐写消费/取消排空；新scope不重绑或删除旧Notebook。T02仍显式overlay，不改默认credentials provider。Relay16的15文件419项、另一组3文件17项及Relay15的4文件31项/另一次Electron1项仍仅原历史资格。全仓doc-sync/依赖政策/Summary/unknown未重跑，32/5/15及旧文档缺口保留。禁止改 scripts/package-dependency-policy.ts 增safe-export例外，不用--fix/pnpm exec，不下载Electron替代资格。

承担实现、共享配置/构建、所有消费者、必要双语文档和有效验证。保留用户数据，只用隔离合成输入；不创建Codex聊天/代理/定时器、不push/合并/发布。每个单元验证后继续，仅CONTINUOUS真正交接条件或会话硬限制才结束，容量续做交同模型。结束前更新NEXT_HANDOFF.md、NEXT_PROMPT.txt，保存下一个未用relay-NN-sol.md，最终贴出同一完整prompt和具体原因。
```
