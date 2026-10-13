# Relay 29 Astra

本棒增量与必要证据如下。历史来源不覆盖。

## 当前目录与停止原因

D:/Documents/FeiyangChen/devApps/dshWinUi/electron。保留当前全部未提交内容。本棒完成首个候选的数据、权限与升级回退资格决定，以及可在当前账号安全完成的 T24 单元和 T26 必要说明。接棒 Sol；不再需要首包 Astra 审查。剩余必要资格要求专用干净 Windows 用户/VM、完整物理快照及现场/权利条件，本会话没有这些输入；可独立的当前本地单元已完成。不是因 PARTIAL 或一次测试失败停止。

## 本棒实现与候选

- Main 新增显式 --nidofy-desktop-portable，要求私有发行版与绝对数据根；不注册 nidofy-dsh/dsh，取消浏览器登录回跳，隐藏系统命令安装菜单。普通行为保持。真实 Main 与协议回归 2 文件 122 项通过，受影响 Host strict、源码 lint 通过。
- 小型 Windows 安装测试的配置明确使用每次唯一协议名。mjs 被现有 oxlint 路径忽略，该限制及失败日志保留；node --check 通过。没有将语法检查称为 lint 通过。
- 当前目录载荷为 apps/desktop/.desktop-build/targets/win-x64/candidates/relay-29/personal-unsigned/win-unpacked（同字节短副本 .build/q29），app.asar 120626142B；最终内部 NSIS 位于相邻 personal-unsigned-retain-data，290125821B。personal-unsigned 原 NSIS 290126036B 有下述私有数据清理风险，保留但不得执行；Relay28 NSIS 同样排除。重打当前第一方 archives、Main/Host bundle，复用未改动 Electron/primary runtime/vendor/native。归档 Main/Host 与当前 bundle 精确相同，包含 Relay 28 后续未知 spill 修补。Relay 28 原产物未改。
- 原包 Playwright 90秒超时诊断复现了不完整模拟 Windows profile 的启动失败；受控导入复现 Failed to get appData。完整 USERPROFILE/AppData/Roaming、Local 与匹配环境让原 Playwright API 296ms 连接、3128ms 界面就绪。旧 .nidofy-character 选择器也已失效，真实静态头像路径为 assets/companion/bluewhale/avatar.png，解码 290×296。
- 长候选目录的 Python/lxml 原生导入报路径过长；原失败保留。完整字节不变短路径 .build/q29 的 ASAR、payload、Office DOCX/XLSX/PPTX 往返、skill CLI 和 Host smoke 通过。没有假称长路径已修复或关闭沙箱。

- 修复实际数据风险：私有默认 Harness 位于产品数据根内，OS 启动卸载器不会继承 Main 的 DSH_HOME。私有 NSIS 现在包含 installer-private.nsh，跳过全部用户数据/缓存清理；上游路径不变。3 文件 23 项回归通过，上游中英小型 NSIS 编译通过；私有真实安装/启动/卸载及三根合成数据原样保留通过。新增中英升级指南，README 双语配对与 8 文档定点链接/段落检查通过。生产 NSIS 的 Authenticode 为 NotSigned。

## 资格证据与限制

根目录 .build/dispatch/evidence/relay-29；candidate-evidence.json 是当前汇总，source-binding.json / packaged-metadata.json / build-input-status.txt / build-input.diff 绑定源码和配置；commands.json、build-commands.json 记录命令。

| 要求/任务 | 本棒证据 | 结论 |
|---|---|---|
| T24 首次启动与重启 | portable-DpH2wt/result.json、两张 PNG；playwright-YVOQH3/result.json | 同一目录载荷通过，真实 sandbox/contextIsolation=true、nodeIntegration=false，0 模型提交 |
| T24 隔离安装/卸载 | isolated-install-retain-resume-result.json；.build/if29/run-hTAQ9h/resume-result.json；portable-xWv5ZV | 唯一 GUID/产品名/包名/协议配置的修正测试 NSIS，同 ASAR/EXE 安装、已安装 portable 启动/重启、卸载通过；无 DSH_HOME 时产品根、包数据根、更新缓存三份合成标记原样保留；正式注册未变，测试安装目录与卸载键已移除 |
| T24 新旧合成数据 | data-copies-kRXU5d/result.json | 同 semver 的 Relay28→29 源码候选；新旧 Host 都能读原 Session 字节与偏好。复制改变物理代次，Notebook 拒绝；旧 Host 读未被新版打开的原物理文件含 Notebook 通过。不是完整副本恢复或原地降级 |
| T24 runtime | short-runtime-smoke.log、packaged-runtime-smoke.log | 短路径通过；长路径明确失败，不删除原输入 |
| T26 使用限制 | Desktop README 中英、support-matrix 中英、docs/upgrade-guide/v0.2.0-rc.2/private-desktop-uninstall 中英 | 说明 portable/安装边界、私有卸载保留策略、AppData、路径限制和 Notebook 物理身份；后续最终支持仍须现场证据 |

修正安装器首次构建因未引用的 NSIS 清理函数触发 warning-as-error，已用同一私有条件排除该函数，没有降低编译要求。修正夹具随后因安装器已合法创建唯一 updater 缓存而拒绝继续；resume 先核验缓存 installer.exe 的精确摘要，再补新标记并完成卸载保留验证。两次失败与原输入保留，不能改记通过。旧本地隔离安装结果只覆盖外置 portable 根，不覆盖默认私有卸载，已被当前结果取代。

最初隔离安装断言误期望 NSIS 注册测试协议；实际 pinned NSIS 无协议注册代码，注册属于 Main。原 assertion 失败和 result.json 保留，即使命令进程退出 0 也不计通过；resume 独立核验真实卸载键、精确载荷、协议不变与卸载结果。data-copies-BySIjK 的 Notebook 原失败、所有 portable/import 失败目录和原脚本版本保留。private offline preload 的 mandatory-status 缺 handler 日志被既有消费者捕获，保留在进程日志；不影响此次观察到的启动。Computer Use 内核因沙箱初始化错误不可用，未以它认证原生 UI；实际图像和窗口证据来自包 Playwright。

生产身份 NSIS 从未在当前账号运行；其安装/卸载及旧程序 GUI 恢复 BLOCKED_CLEAN_ACCOUNT_OR_VM。干净机、物理快照恢复、真实休眠、混合 DPI、企业网络为 NOT_RUN；签名 UNSIGNED，许可 UNCONFIRMED。T15/T16/T20 和可选 T21/T22 范围沿用 [Relay28](relay-28-sol.md)，无新公共持久化格式变化、真实凭据迁移或外部计费。

## 下一完成条件与 prompt

获得干净用户/VM 后执行生产身份与完整恢复资格，并绑定同一产物；不因切换模型重复本地通过项。完整下一棒文字见 [NEXT_PROMPT](../dispatch/NEXT_PROMPT.txt)，当时副本保存在 [Relay29](relay-29-astra.md)。

## 下一棒完整 prompt

```text
请使用 Sol 继续 DSH Electron，承接 Relay 29。

工作目录：D:/Documents/FeiyangChen/devApps/dshWinUi/electron。先读 AGENTS.md、适用下级规则、migration/roadmap/dispatch/CONTINUOUS.md、NEXT_HANDOFF.md、prompts/T24-release-qualification.txt 和 prompts/T26-docs-capability-matrix.txt。以代码和未提交状态为准，不校验 SHA，不重接 T02/T04，不盘点全仓。保留用户修改、历史证据、失败输入、全部旧产物及 Live2D；不创建聊天、代理、定时器，不计费，不迁移真实数据，不 push、合并或发布。

第一项动作：读取 .build/dispatch/evidence/relay-29/candidate-evidence.json、source-binding.json、fixed-installer.json、isolated-install-retain-resume-result.json 和 data-copies-kRXU5d/result.json。首个数据/权限/升级回退决定已完成，无需重复 Astra 审查。Relay29 目录含未知 spill 保留修补和 portable 注册保护；同字节短路径 .build/q29 已通过首次启动、重启、原 packaged Playwright、沙箱观察及 runtime/Office/Host。正式注册未变。

发现并修复了私有卸载风险：默认 Harness 嵌套在产品数据根，OS 卸载器不继承 Main 的 DSH_HOME。当前 NSIS 是 apps/desktop/.desktop-build/targets/win-x64/candidates/relay-29/personal-unsigned-retain-data/nidofy-dsh-personal-0.2.0-rc.2-win-x64-unsigned.exe，保留全部私有数据根和缓存。唯一测试 NSIS 身份已通过同 ASAR/EXE 安装、已安装 portable 启动/重启、无 DSH_HOME 的卸载及三根合成数据原样保留。Relay28 和 Relay29/personal-unsigned 的旧 NSIS 存在数据清理风险，只保留历史证据，不得执行；不把旧外置根测试当默认数据资格。全部产物仍无签名或发行资格。

下一完成条件：获得专用干净 Windows 用户/VM 后，验收修正 NSIS 的生产身份安装/卸载、普通协议、旧安装替换与旧程序 GUI 配升级前数据恢复。当前账号不得直接运行正式安装器或旧包 GUI。私有根不隔离 HKCU；新目录包只有显式 --nidofy-desktop-portable 配绝对数据根才抑制正式协议注册。模拟 USERPROFILE 必须包含 AppData/Roaming、AppData/Local 与匹配环境；长路径 Python 原生导入真实失败，使用完整同字节短副本，保留原输入。不得关闭产品沙箱。

Session/偏好副本在新旧 Host 可读，但复制改变物理代次，Notebook 正确拒绝 NOTEBOOK_SCOPE_CONFLICT；旧 Host 已读未被新版打开的原物理文件含 Notebook。完整副本/物理快照恢复仍未认证，不重绑 sidecar、不改历史代次、不声称新版数据原地降级。T20 本阶段、T16 静态协调、W04/T05、T10 和 Relay13 决定沿用；T15 缺 Core/Framework 与许可，保持静态回退；T21/T22 可选。

继续明确就绪且未完成的工作及 T26 必要说明，不增加独立 review/integration。干净机、完整恢复、休眠、混合 DPI、企业网络、签名和许可逐项保留 BLOCKED/NOT_RUN 等真实状态。无新现场条件或明确就绪范围时，停止原因是外部资格输入不足，不为交棒重建或重复验证。结束更新 NEXT_HANDOFF.md、NEXT_PROMPT.txt，保存下一个未使用 relay-NN-sol.md，最终贴出同一下一棒 prompt 与实际停止原因。
```
