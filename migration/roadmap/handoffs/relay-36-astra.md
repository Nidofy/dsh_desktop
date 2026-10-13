# Relay 36：当前设置只读检查、ACL 恢复与完整便携交付

## 当前交付

工作目录 D:/Documents/FeiyangChen/devApps/dshWinUi/electron。完整便携目录 .build/p36f，入口 Start DSH.exe；ZIP .build/p36f.zip 为 403501800 字节，9997 个文件名与长度一致，未校验 SHA。唯一新候选为 apps/desktop/.desktop-build/targets/win-x64/candidates/relay-36-final。本轮在同候选内修正实际包发现的启动问题后重打，未另造中间完整候选。沿用 portable marker、专用稳定绝对数据根和拒绝接管逻辑，不注册协议。

## 本轮行为

T22 增加明确“读取当前设置”：复用原 style/read、readPets 与 attention，显示当前 scope 的下一回合口吻、关注会话、桌宠总开关及所选实例启用／绑定／静音快照和读取时间。点击读取不创建预览、不执行动作或请求模型。读失败撤下旧值；scope、所选实例、指令变化和取消撤下旧快照；迟到响应不覆盖新目标。取消等待不声称撤销 owner 已提交动作，丢失回执后可读取实际状态，新的预览仍须用户明确选择。保留十二项有限动作、原 owner 权限与期限。

整合 ACL 作者交付的写前持久快照、session/runner 租约、最后释放与崩溃恢复。本棒将 journal append 改为数组参数，131072 条记录不再触发 JS 实参数上限，完整批次仍只 fsync 一次且先于 ACL 写入。实际包验证发现纯 readSecurityState 多申请 WRITE_OWNER 导致恢复目录 NtOpenFile Win32 5；纯读改为 READ_CONTROL+FILE_READ_ATTRIBUTES，写授权／恢复句柄保留原权限，逐级 fixed-parent／reparse／identity 检查不变，只读句柄显式拒写。启动恢复基础设施异常记录为 pending，不阻止 provider 注册；每次 workspace-write admission 仍强校验恢复目录、Medium integrity、legacy、路径与租约并失败关闭。

整合性能作者的离线 Session 分析 CLI、生产 Anthropic stream decoder 复用与真实 adapter/SDK loopback wire 测试。本棒补 TPS 相同 coverage 子集：缺失 usage 不作零，未覆盖时 TPS=null，输出覆盖 steps 与 decodeMs。没有改变生产 provider、loop、默认压缩或模型设置；CLI 不进入产品 UI。性能结论与原始证据在 [performance-investigation.zh.md](../../../.build/dispatch/evidence/relay-36/performance-investigation.zh.md)。

T26 同步便携 README 和双语 [支持矩阵](../support-matrix.zh.md)：当前 active 1–20／archive 0–80 配额、记录筛选／归档／预算／导出、T16 已读快照与 T22 当前读取、当前包路径和真实限制。历史发行资格不冒充当前包资格。

## 验证

证据根 .build/dispatch/evidence/relay-36，原始失败均保留。此前 build:official 全 Host/Client 类型与 351 Client artifacts 通过（build-official-1791862343571）；后续 ACL 两包修复完成后跑两包类型、精确 lint、官方 tsdown 配置的两包 build，未冒称再次全仓官方构建。README 三对配对检查通过，文案所有权 958 项通过。ACL journal/recovery 11 项，最终 native 九组 84 项（含 fixed-parent/reparse 替换、runner/lease 和真实 Modify-only 只读回归），provider 11 项通过；性能分析器 19 项通过。相应 JSON/log 使用完整时间后缀保留。

T22、原 owner 与 companion 的最终准确三文件组合 26/26 通过（settings-client-fixture-fixed-1791864988895），未使用 -u，原超时与行为断言未放宽，随后精确 lint 和 Client 类型通过。此前组合失败保留在 focused-tests-1791861834179 与 settings-client-final-1791864675532：后者 owner 文件名误写，owner 未执行，companion 首项5000ms超时、后续 Recent facts 按钮缺失、窄屏 aria-expanded=false 与角色 slot 数量0。源码确认 fixture 只在启动完成后登记 client，超时可使 afterEach 先恢复 globals、晚到 client 污染后续用例；本棒仅在该 spec 按 createClientTest 模式先登记 pending，清理时 closed→await→dispose 后恢复 globals，晚到 fixture 拒绝继续，并在 beforeAll 预加载生产 roster 模块。冷导入造成首次超时是与证据相容的推断，资源生命周期缺陷已修复，组合通过；不称变更前已有失败。该修复只影响测试，无需重打已验证包。companion 未跟踪快照在首次失败 -u 后丢失，未找到原字节副本；根据单独通过行为重新生成并审阅五个原名快照（2事实、3HTML），不声称恢复原字节。

完整包重打四个运行时包：desktop-host、desktop-extras、sandbox-windows-acl（含 assets 和 journal）、sandbox-local。固定 primary runtime/Electron 与其他未变化包复用 p35 候选，正常完整物化；registry 依赖下载不涉及模型计费。初次八阶段和修复后六阶段全部通过，最终见 relay-36-final-repair-build/build-commands.json。electron-builder --dir --publish never；未签名或发布。portable-post-repair-1791864546910 与 zip-p36f-completeness.json 记录当前完整交付。

初次实际便携 native／runtime、DOCX／XLSX／PPTX→PDF、Office CLI 和 Host smoke 通过（runtime-smoke-1791863326078，实际 runtime Node24.18.1）；修复后完整物化再次执行 runtime smoke。built-acl-repaired-1791864409909 从当前候选真实依赖加载，在新系统临时目录执行 grant→join→release，最后独立读取 DACL/label/control 与原值一致。未在真实项目根授权，未调用诊断重置。

最终实际 Electron UI 证据 [settings-sXArmi/result.json](../../../.build/dispatch/evidence/relay-36/settings-sXArmi/result.json) 与七张截图：取消等待前 owner 已提交后读取、丢失真实 owner 回执后读取、失败撤旧值、明确刷新、attention 原 owner、双实例绑定／静音、目标变化清空、scope 切换拒绝迟到读、中文窄屏、冷重开无弃置操作重放通过。合成 profile 为 C:/Users/enxi1/AppData/Local/Temp/dsh-relay36-profile-4v1eev，证据和数据保留。pageerror=0、外部模型请求=0、计费=0、草稿未发送且未改、sandbox=true/contextIsolation=true/nodeIntegration=false、注册表未变。Host 日志仍保留验证 reload 期间的 mandatory-status handler 与 document-refused 信息，不称 Host 日志零错误。

官方构建后单独准备 benchmark workers，现有 request-history 场景五个 fresh process 的40请求 total 中位95.6081ms，已有预算297ms；详见性能报告和原始 request-history-selected-1791862481438.log。这是6,553,600工具历史字符压力，非用户322K任务；仅生产loop+JSONL局部路径+最终flush，无shipped checkpoint-policy/真实adapter/HTTP/服务端/GUI，resume计时外，不排除实际fsync或UI热点。开发与基准Node24.16.0。首次全skip筛选不算通过。

## 保留、限制与下一步

已授权清理45项释放62.594GiB，根目录 ../.build/cleanup-20261013 有 plan/results/summary/README。保留p35f、p34f及各ZIP、relay-35-final2与失败relay-35-final；旧“所有更早包均保留”已不适用，全部evidence/scripts/worktrees/源码资源保留。当前未提交修改未reset/clean，无push/合并/发布。

两个真实项目根存在无原始记录的旧S-1-4授权，用户确认没有或不确定原备份。本轮保留现状；更新后新workspace-write授权会拒绝对此类旧树自动重标，需核验原备份或审阅不复制安全描述符的新内容工作区，未自动拷贝/迁移/修复，也不建议降沙箱。见 [ACL升级指南](../../../docs/upgrade-guide/v0.2.0-rc.2/windows-acl-workspace-leases/guide.zh.md)。

当前最近交接中的可实施T16主要流程、T22当前状态和T26本地说明已交付；没有据旧清单制造新功能。T15缺实际非Idle美术动作、美术接缝和显存峰值测量，Live2D公开分发权利未认证；正式安装身份、NSIS、签名、干净机/物理休眠/混合DPI/企业现场与完整恢复资格继续延期。真实用户profile、GLM与ZCode3.14.2串行付费对照未执行。本轮具体组合测试生命周期缺陷已修复，当前就绪实现和必要交付验证完成；不从旧 PARTIAL 状态人为生成下一功能，不重跑已通过全包或重开已解决决定。

最终十份具名文档的相对链接与支持矩阵双语行结构检查通过（docs-local-1791865084979）；精确改动路径 git diff --check 通过。final-validation.json 汇总最终结果，process-completion.json 记录本轮匹配的构建／测试／实际UI进程为空，已释放唯一活动写入权。
