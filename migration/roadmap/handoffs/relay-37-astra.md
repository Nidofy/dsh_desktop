# Relay37：三份 UI review 修复与 p37f

## 交付

工作目录 `D:/Documents/FeiyangChen/devApps/dshWinUi/electron`。完整便携入口 `.build/p37f/Start DSH.exe`，ZIP `.build/p37f.zip`，398197305 字节、9991 文件。ZIP SHA256 为 `972B1762D9A5576DFF0C3D3EB0DBA23D6D93E751E15C88D198D6E38B1E96A0B6`；逐 entry 解压流 SHA256 与便携目录每个文件比较通过，包括文件名、长度、总数，未另展开副本。唯一候选 `apps/desktop/.desktop-build/targets/win-x64/candidates/relay-37-final`；未发布、签名、注册协议或调用收费模型。

全部105编号处置见 [逐项矩阵](relay-37-ui-disposition.md)，三份源报告未修改。矩阵保留误判、现有设计、部分改善与明确延期，不把所有条目都标为新修复。DS013仍有高级JSON；DS069同源第三方Core的隔离架构未实施、没有已证漏洞；DS071按更新报告保留Idle设计。

## 行为与持久化

稳定providerIdentity修复托管连接revision造成的选择/notice/pending错配；实际请求、重试、header和观测仍用revision，旧日志缺字段不猜身份。真实JSONL序列化再冷回放覆盖新字段及旧语义。OpenAI completions特定session缓存策略使用私有稳定connection+credentialPartition，替换凭据轮换、keep继承；其他hooks和observedPayload保留实际revision，不声称Anthropic性能改善。metadata缓存不保留请求租约闭包。外部普通provider可用相同前缀，托管hook只认成功持有的路由；保存前/提交前预检与最终原子注册拒绝不等于全局预留锁。

全局断连、树行键盘/IME、搜索失败重试、草稿跨布局、Settings密钥Keep/Discard与credentialError、危险确认默认取消、欢迎主题、窗口边界/并发复用、管理页主题/可读错误、图标与Notebook组织、pet失败/陈旧授权/焦点尺寸/轮询、SDK取消生命周期均已落实。保留slot、滚动锚点、权限预览期限与opt-in默认关闭；独立桌宠不因主窗隐藏停止。Notebook生产roster无companion依赖的真实组装已测，无模型请求。长代码块仅限容器高度与滚动，完整内容/复制保留。

通知v2新增job source与终止reason；读取旧v1且不重写旧字节，去重/epoch隔离、内部工程任务和子代理过滤。仅处理registry观察到的终态，进程死前未落盘终止无法重建。p36严格v1 reader不能无条件读取p37新v2记录；旧便携包不等于可在同一用户目录直接回退。见 [通知升级说明](../../../docs/upgrade-guide/v0.2.0-rc.2/verification-notifications/guide.zh.md) 与 [身份持久化记录](../../../docs/persistence-changes/2026-10-13-provider-selection-identity.zh.md)。usage三桶同分母，缺字段cacheRate未知，保留coverage；SDK零值不是服务端明确报告零。未确认工具结算不伪造成功；cancel仅由当前owner能力授予。

## 验证与包一致性

证据根 `.build/dispatch/evidence/relay-37`。正式全构建 `official-build-1791881231884` exit0，351 client artifacts；单一候选18个运行时包重打及desktop壳正式bundle，其他固定runtime/未改包复用relay36。`relay-37-final-build/build-commands.json`所有步骤0；runtime Node24.18.1、koffi/sharp/pty/HTML/pnpm/grep/glob、Office roundtrip与DOCX/XLSX/PPTX→PDF和skill CLI通过。开发Node24.16.0。没有把所有历史脏文件当本轮包增量。

代表回归：UI502、凭据336、窗口20+17、provider waterfall40（不是完整AgentLoop请求）、真实identity存储2、route ownership7、pet21与loader10、通知/取消42及v2/coverage9、Notebook独立roster1（其余11为筛选skip）、Notebook分组10、小UI117与确认快照14。具体日志和原始失败均保留。没有在失败混合suite上盲目更新快照。后续仅fixture类型/lint与JSDoc注释修正，不改变已打包运行行为。

DS035精确可逆归档748个未跟踪同源生成文件：564初始、92缺project reference引发新副本（reference已修）、38+8旧声明/map、46旧API JS/map。保留手写声明/源码；最后两批mtime为10/12，不是完整build新生。`generated-source-final.json`在client/nidofy/api-session/api-workspace扫描零残留。`artifact-source-and-assets.json`确认实际tgz内两个API client.js与本地构建逐字相同，映射内16+3 API sourcesContent与当前TS逐字相同；map可链式映射，未仅凭.ts后缀声称来源。两套pet运行资产均在包中，精确排除preview/staging未消费项，源素材保留。

最终实际Electron `settings-ub58eF/result.json` PASS，六张截图：真实本地Live2D SDK/GPU渲染与显式停止；SettingsRoot→Models自定义密钥输入后Esc/Close/换General均Keep，再换General Discard，无保存；当前设置只读；中文窄屏；Connections亮暗与完整URL复用。有限CSS动画完成后截图，根代理目视通过。pageerror=0、外部模型请求=0、计费=0、sandbox/contextIsolation=true、nodeIntegration=false、注册表未变。测试仅独立系统临时profile/workspace，未改真实数据。脚本前几轮入口/双密钥/URL locator错误保留，不冒充产品失败或通过。Host日志有验证reload的document-refused/mandatory-status信息，不声称Host日志零错误；临时token已脱敏。

Client contracts63、文案964、persistence63 roots/10 records、type-equiv471+471、精确lint/type、export JSDoc、README Model Experience320、doc budgets、14份本轮双语配对最终通过。全局doc-quick并非全绿：历史concrete terms、四份原README摘要超100词、既有Live2D中文单篇及capability-seams配对失同步三类仍失败；未改历史证据凑绿。最后完整doc-quick曾16pass/5fail，其中本轮尾节布局和architecture字数两类随后定向修复通过，其余三类如实保留。

## 限制与保留

GLM015真实Windows zoom标题栏、DS053真实更新弹窗、DS065系统级鼠标穿透/物理焦点未自动操作验证，源码/单元范围见矩阵。Live2D公开分发权利未确认；同源Core隔离架构、签名/正式安装身份/干净机/休眠/混合DPI/企业现场资格继续延期。未做真实用户profile或付费provider对照。

两个真实项目根有无原记录的旧S-1-4授权，用户确认无或不确定备份，保持现状；新workspace-write对该旧树会拒绝自动重标，需要核验原备份或经审阅不复制安全描述符的新内容工作区，未自动迁移/修复、不建议降低沙箱。见 [ACL升级说明](../../../docs/upgrade-guide/v0.2.0-rc.2/windows-acl-workspace-leases/guide.zh.md)。保留p36f/p35f/p34f及ZIP和既有候选/证据；此前已授权删除45项释放62.594GiB的事实仍有效（仓库外层`.build/cleanup-20261013`）。本轮无reset/clean/push，所有归档可恢复。

最终过程和文档检查见证据索引 `README.md`、`final-validation.json` 与 `process-completion.json`。本轮可实施范围已收敛，不重开报告误判或把发行资格延期当新功能。
