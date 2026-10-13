# Desktop 本地验证

[English](README.md) | 中文

## 概述

Companion 源码夹具使用生产 Client Loader／Frame／Conversation／Workspace 组合、隔离 Remote 和预加载替身，验证双窗口身份、非首 retained 引用、快速切换迟到结果、权限变化、重连、固定关注释放、窄屏草稿／实际附件、共享 Modal 的 IME／焦点和单角色插槽卸载。Main 的临时导航 owner 拒绝其他真实窗口与旧 revision。完整 built profile 增加认证 Host epoch、重启换代、作用域通知与只读 Notebook 检查，不增加模型调用或修改通知状态。当前 Windows 开发载体另行覆盖生产 Main／preload、认证页面请求、延迟隐藏窗口取消、主页面／工作台跨 sender 拒绝、Notebook 实际 Host／Client 热生命周期、草稿／附件／光标、合成组合事件保护、语言、主题和缩放。受支持的原生组合为 Conversation 主窗口与辅助工作台。第二个完整 root 在重载前后均被拒绝；同源子 frame 流和辅助窗口启动权限被拒绝。主页面重载使旧 scope 失效并恢复其流。操作系统实际输入法及已安装资格仍未认证。

本地下载和强更弹窗证据与生产后端联调、视觉验收、已安装应用升级分开记录。运行 [Desktop README](../README.zh.md) 中的命令可生成新的隔离报告。

已安装应用验收可显式启用 `DSH_DESKTOP_UPDATE_JOURNAL_DIR`，使用安装目录树之外、两个版本共同保留的绝对路径。每个主进程将已安装版本、状态转换和人工操作标记刷新到单独的 JSONL 文件。原始诊断和请求数据被排除；存储错误会向上传播。[日志决策](../../../.agents/notes/implemented/testing/2026-09-14-desktop-installed-update-journal.zh.md)定义证据的局限。单元与主入口测试覆盖该日志；签名安装版升级仍未验证。

## 目录

- [Companion 载体](#verification-companion)
- [自检载体](#verification-selftest)
- [回执比较 profile](#verification-experiments)
- [单次任务请求 profile](#verification-task-request)
- [隔离工程 profile](#verification-engineering-task)
- [原生浮层可见性](#verification-overlay)
- [验证证据](#verification-evidence)
- [手动演练](#verification-interactive)
- [待验证事项](#verification-open)

<a id="verification-companion"></a>

## Companion 载体

构建当前 Desktop、desktop-extras Host 和两个 Nidofy Client bundle 后，通过 built e2e 入口使用既有本地 Electron 二进制。夹具创建独立 appData、Chromium 状态、Harness 数据和工作区目录，将结果及稳定 PNG 保留在 `.build/dispatch/evidence/relay-15/carrier-*`。逐包投影已安装依赖以保持 Windows 模块解析，不调用 Electron npm 入口的隐式下载器，也不使用计费服务。测试原文使用官方 Session writer 和真实 Workspace 归属。项目关联、未关联来源拒绝、原文预览、显式草稿插入和移除关联均经过完整 Panel 与 Host owner。

同一载体读取代次绑定事实与真实已提交笔记，通过认证 Notebook API 写入用户修正，验证 Hint 忽略、明确暂缓、准确项目静音／恢复、renderer 重载恢复及可见返回卡去重。英文与中文截图保留真实来源标签。源码测试另行覆盖真实 Shell 回执的 STALE／UNKNOWN、独立验收、冷偏好 owner、损坏／未来版本拒绝、并发 CAS、同 scope 迟到读取及双语预期输出。这些属于开发载体与所属 owner 证据，不资格化 Host 进程重启、OS 通知交付、顶层 recorded-session 回放或安装。

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/companion-carrier.built.e2e.ts --retry=0
```

<a id="verification-selftest"></a>

## 自检载体

构建当前 Desktop Main／preload 与 Host，并保留已构建的 Web／Client 资源、原生保护 helper 和既有 Windows Electron 二进制。[自检 fixture](fixtures/selftest-carrier.mjs)使用生产 Main，创建独立 TEMP appData、Chromium 存储、Harness 数据及独立 Node 资源副本。它使用官方 base／Web／Nidofy profile，禁用模型／标题／规则插件，通过已声明配置选择既有系统 PowerShell，并将首次 Documents 初始化指向会被真实 owner 拒绝的合成文件。这样阻止默认 Workspace／Agent 创建，不改变已发布默认值。不使用用户凭据、用户 Skills 或操作系统协议注册。结果、PNG、原生下载及私有 root 定位信息保留在 `.build/dispatch/evidence/relay-20/`，临时 root 与输入也保留。

本机场景通过个人扩展进入真实辅助自检窗口，观察 sandboxed preload 隔离与 Conversation 启动权限拒绝，读取双语容量，显式启动一次本机运行，重载报告而不重放，并通过 Electron `will-download` 保存实际 JSON／Markdown 下载。连接场景在零发送下预览准确路由／发布修订及独立 HTTP 修订，要求默认未勾选的确认，预算变更后撤销确认，再向自己的合成 loopback SSE 服务发送五次固定 64-token 请求。它取消第六次已启动流并等待排空，保留 CANCELLED 及独立 warning，重载不补发，并通过官方 JSONL reader 冷读重建全部六次完整私有输入。原报告字节保持。两个场景均观察到零 Agent，只有连接场景发送请求，计费提供方为零。测试退出请求生产 quit 并排空私有进程树。

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/selftest-carrier.built.e2e.ts apps/desktop/tests/selftest-provider-carrier.built.e2e.ts --retry=0
```

这认证当前 Windows 开发 renderer 及这些认证交互，不认证已安装资源清单、安装包、实际跨屏／休眠／窗口恢复、真实提供方缓存命中、顶层 recorded-session 回放或网关。runner 的 renderer／资源行仍保持 UNKNOWN，因为这些外部 fixture 结果不是逐运行产品证据。观察到 ACL 拒绝或命令退出却缺少独立输出时仍为失败，不能改用更宽沙箱模式。

<a id="verification-overlay"></a>

## 原生浮层可见性

在 macOS 上，编译 Desktop Host 源码后复用缓存的 Electron 运行时：

```sh
pnpm exec tsc -b apps/desktop/tsconfig.host.json
apps/desktop/.desktop-build/targets/mac-arm64/electron/Electron.app/Contents/MacOS/Electron apps/desktop/tests/fixtures/update-overlay-visibility.mjs
```

夹具使用独立 profile，在 `.desktop-build/qualification/update-overlay-*` 下写入 `result.json`。它对照所属测试目录中的预期输出，检查父窗口隐藏／显示、父窗口隐藏期间文档就绪两种顺序中的原生可见性、父页面不受模糊影响及监听清理。它不使用网络、产品登录或 dsh Host。这项验证覆盖原生窗口恢复，不覆盖完整的首次登录流程。

<a id="verification-interactive"></a>

## 手动演练

实际安装、启动后发布、失败重试与重启证据使用[已安装应用更新人工清单](installed-update/README.zh.md)。下方交互式运行器拦截安装，属于另一类验收。

Host、客户端与 Desktop 产物构建完成后，在 Windows 仓库根目录运行 `node --import tsx apps/desktop/scripts/test-workspace-updates.ts --interactive`。真实工作区持续打开，并提供独立控制窗口。其菜单可选择普通或强制更新、保持和放行下载、注入下载失败，以及添加或清空测试任务。失败模式须在开始下载前选择。确认安装并完成任务收尾后，fixture 消息提示安装器调用已被拦截；确认消息结束演练。关闭控制窗口也会退出。每次运行独占私有 profile 和回环服务器；载荷不是安装器。重新运行命令开始新一轮。省略 `--interactive` 则运行自动化场景，保留 120 秒截止时间和自动退出；交互模式下载的网络截止时间为十分钟。

<a id="verification-evidence"></a>

## 验证证据

在 Windows 上构建 Host 和锁定依赖的原生保护 helper 后，执行 `node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/connections-profile.built.e2e.ts`。[完整 profile fixture](fixtures/connection-full-profile.mjs) 使用官方 base／Web／Nidofy 层、私有 TEMP 数据根／home、真实 Office 资源、合成 Key 和本地 HTTP／HTTPS 服务，启动当前构建的 Desktop Host 入口。它记录 keyless 与成功的 Agent 会话，通过实际认证后的英中页面脚本修复连接，验证 Host 重启前后的代理编辑，拒绝不受信任的 TLS 签发者，再在设置 `NODE_EXTRA_CA_CERTS` 的子进程启动后完成真实 Agent 请求。Fixture 同时检查 ready／fatal、正常卸载回执与监听器关闭。证据保留在 `.build/dispatch/evidence/full-desktop-profile/`；子进程卸载后清除 fixture 凭据与依赖投影。它验证 Node-mode Host、本地 TLS、资源注册和 jsdom 页面回放；Electron renderer／preload 及页面网络、Office 转换、企业网关和安装仍未取得资格。

认证后的存储页面回放区分缓存账本总量、本次核算、显式恢复和未知操作查询。完整 Node-mode fixture 执行认证后的有界旧版导入，读取已提交类别报告，原位接纳，再由共享原根账本的第二个 Host 冷读实际旧 Session。它只准备后续启动参数，不切换第一个 Host，并将独立合成计划清单导入为暂停，未创建官方计划任务。源码页面回归另行覆盖当前快照选择、默认不勾选恢复、迟到预览丢弃、归档确认和未知结果保留；真实 Windows 原生测试覆盖采集／封存／导出／校验／导入及所选文件恢复。源码迁移回归核对独立确认、安全的类别／命名空间展示及过期预览丢弃。原生测试在独占打开已接纳 Desktop 运行文件时仍能完成受管核算。完整 profile 另通过认证后的 Workbench／Shell／原生保护执行 --test-isolation=none 的真实 Node 测试，提交保留验证回执，覆盖显式 Node TAP 解析、输入变化后的 STALE 与独立验收。它核对认证后的持久通知身份、唯一系统 claim、未知展示结算与原始持久 Session 终态引用；未执行已安装 OS 展示。该命令验证 Windows 沙箱报告的 partial enforcement，不证明嵌套进程启动或完整运行时准备。Fixture 在保留证据旁记录独立数据根。清理仅列出只读候选。`fixtures/connection-test-*` 下的 TLS PEM 和服务端私钥是一次性测试身份，有效至 2036 年 10 月；绝不用于生产凭据，也不加入系统证书信任库。

本地命令构建 Desktop，并在 Electron 44 中运行真实 HTTP updater、策略客户端、沙箱预加载和强更页面。它记录每个场景，并把报告保存在 `.desktop-build/qualification/local-updater-*`。安装器调用、外部浏览器和剪贴板均替换为观测记录；下载字节不是可执行安装器。

打包监督 fixture 控制自己的 Git 元数据，并使用真实文件哈希和无签名行为的子进程。Git 提交或工作区变化仍会拒绝打包；并发测试不会改变该 fixture 记录的 Git 输入。

| 层次 | 观测结果 |
|---|---|
| 常规 updater | 同版本／旧版本拒绝、用户授权完整下载、SHA-512 拒绝、传输中断、清单／下载停滞截止时间、显式重试、请求合并、同地址清单替换、就绪状态和独立安装交接通过 |
| 强更策略 | 扁平化 `40005`、完整发布头、游客请求、无需强更验证、失败保留、间隔／退避、超时和 dispose（资源释放）回归通过 |
| 常规调度 | 真实协调器配合模拟时钟的回归验证有上限的抖动／退避、手动复用、成功重置、不自动重试下载、不受系统时钟调整影响，以及 dispose。主入口测试验证聚焦／恢复节流、显式检查立即执行和退出清理 |
| 真实强更窗口 | 服务端纯文本内容、Windows 内嵌 shell frame、不创建额外原生窗口且主窗口保持启用、Esc 阻塞、直接下载、同弹窗任务确认、稍后更新、仅恢复态页面操作、导航／复制反馈和新策略解除通过；定向测试验证关闭时退出且不清除策略 |
| 真实常规弹窗 | 隔离预加载、380px 卡片、24px 圆角、黑色主按钮、父窗口模糊、Esc 取消后保留就绪，以及任务警告批准后的安装交接记录均通过 |
| 解锁后的 Windows 交互 | 对真实强更页面执行系统级点击并截图，确认 Esc 阻塞、用户发起下载、就绪、红色策略错误提示，以及弹窗解除后父窗口恢复可用。fixture 提供的原生任务警告弹窗在选择稍后更新后回到就绪态；任务活动为模拟，不是完整 Host 工作负载 |
| 主入口 | 已知阻塞拒绝插件修改和恢复，但不停止 Host；新成功响应关闭阻塞；打包策略忽略环境覆盖；正常停止后的安装器失败在下次确认前恢复 Host，并保留强更阻塞 |
| Host 任务保护 | 替换组合环境后的真实控制器识别运行中的 agent、排队的 turn／step、全局和 agent job；API 读取不触发警告。请求准入锁定向新请求返回 503，等待已有请求结束并复查任务；解锁恢复准入 |
| 可见输出 | 中文强更弹窗 DOM 预期输出和常规更新展示预期输出通过；账户行组件测试覆盖进度和持久重试 |
| 打包配置 | 元数据嵌入配置的应用 ID 和策略；构建后的打包前钩子拒绝 HTTP 策略源站，不执行打包或上传 |

弹窗、主入口、设置和侧栏的定向运行通过 119 个回归用例。五个载体测试覆盖共享更新状态源的全部语句、分支、函数和代码行。真实 Electron 命令通过 17 个场景，并捕获常规就绪、任务警告和强更错误弹窗。这些隔离检查不认证完整工作区或发布。全仓门禁结果及环境限制与这些定向证据分开记录。

Chromium headless shell revision 1228 已安装在忽略目录 `.desktop-build/playwright` 中。组装后的设置和侧栏浏览器套件通过 18 个用例。[Desktop 工作区浏览器场景](../../web/tests/desktop-updates.e2e.ts) 的中英文用例均通过，每种语言捕获六张截图，并验证底部账户行位置、紧凑进度及重复点击拦截、顶部展开按钮提示、带错误悬停详情的持久红色重试，以及独立的就绪操作。展示函数、Host Web 组合、客户端插件和 CSS 均为真实实现；Desktop 载体使用替身。这些用例不执行 Electron IPC、菜单、任务授权或安装。

[构建后 Host 场景](fixtures/host-update-qualification.mjs) 使用真实 profile Loader、standard agent 预设、任务服务和 Node 后台进程。它验证排队的轮次／步骤、运行中的模型请求、等待答复的提问／审批、运行／停止中的全局和 agent job、不会取消任务的准入锁定、准入恢复，以及 Host 释放后的检查拒绝。仅模型响应和人工答复使用替身。两个独立调用使用私有 profile 和会话数据并发通过；全部自有 agent、job 和 Host 完成后才写入成功报告。

[Electron 工作区运行器](../scripts/test-workspace-updates.ts) 在私有目录中执行编译后的主入口，使用真实预加载、工作区和独立 Host 进程。它确认首次启动声明，并通过 Electron 输入事件及嵌入式 Windows frame 的 Chromium 调试器输入操作页面按钮。私有应用复用已准备的目标运行时资源。十个场景通过，覆盖菜单反馈、下载失败与重试、独立安装确认、确认期间真实任务创建、推迟安装、强更阻塞和真实 Host 停止超时。普通与强更失败均恢复替代 Host，并要求重新确认安装；恢复不会清除强更策略。分发使用本地服务器，安装被拦截；这些不是签名已安装应用的验证结果。

[Windows 验签运行器](../scripts/test-windows-update-signature.mjs) 使用已安装的 electron-builder 元数据生成器和 `NsisUpdater` 验签器，输入为公开发布证书和真实可执行文件。发布者属性匹配时通过；同一有效签名在预期发布者不同时被拒绝，未签名可执行文件也被拒绝。缺少发布者的负对照确认验签被跳过。单元回归覆盖 DN 转义、不完整身份，以及显式或宿主默认 Windows 目标；移除发布者配置会使两条元数据用例失败。此检查不下载、安装或签名产物。

[签名下载运行器](../scripts/test-signed-updates.mjs) 连接真实 Electron HTTP、`NsisUpdater`、Windows Authenticode 和构建后的协调器。四个场景通过：哈希正确但发布者错误时拒绝、哈希正确但未签名时拒绝、传输损坏先于验签被拒绝，以及显式重试后签名文件就绪并单独交接安装。被拒绝的可执行文件缓存为空，自动检查不发送重试请求，已准备的下载保持可用，原始输入的 SHA-512 不变。合成清单和测试应用适配器不证明已安装版本兼容性；不会启动安装器或 Host。

提供旧安装器和两个原始 blockmap 后，同一运行器还会验证单段 Range、多段 Range 重建、缺少旧 blockmap 时回退，以及 Range 被拒绝时回退。重建的可执行文件通过 SHA-512 和 Authenticode 检查。请求记录区分差分负载字节与全量下载；全量回退不能满足差分成功断言。这些回环结果不证明 CDN Range 支持或已安装应用的缓存可用。

<a id="verification-experiments"></a>

## 回执比较 profile

[built 夹具](fixtures/experiments-full-profile.mjs)使用完整 base／Web／Nidofy profile 和全新私密 TEMP home，启动现有受支持 Desktop Host。它复制当前 Node 可执行文件，选择已有系统 PowerShell，在独立工程中通过生产保护／Shell／T11／原生配额执行两个本地信任的合成 TAP 动作。断言覆盖认证双语页面读取、包含 model-step 端点的 cookie／origin 拒绝、显式 experiment／case／run 选择、缺失模型计数、独立验收、不可变归档、源码变化导入拒绝与冷重启不重放。桌面来源的 model-step 读取保持未知，调用方自报计数会拒绝。两次 Host 生命周期均观察到零模型发送和零 Agent。当前 root、记录、回执与日志保留在 `.build/dispatch/evidence/relay-22/full-profile/`；更早 Relay21 证据保留。renderer 交互、任务 A/B 发送／矩阵、已安装资格和完整模型输入关联仍未验证。[比较语义](../../desktop-host/src/experiments/README.zh.md)由 owner 定义。

```sh
node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/experiments-profile.built.e2e.ts --retry=0
```

<a id="verification-engineering-task"></a>

## 隔离工程 profile

[工程夹具](fixtures/experiments-engineering-profile.mjs)以实际 Agent／保护 Shell／T11／原生配额和私密复制输入启动完整受支持 Node-mode Host。验证覆盖完整官方输入、因果回执、Notebook／缓存捕获、顺序矩阵、取消、冷读原字节、报告验证及不重试。独立资源场景因逻辑／物理 Session 预算在分派前拒绝，保留已执行 TAP 回执及超额副本输出，在分配副本前拒绝总容量，并只读缺失历史 sidecar 而不授予新准入；伪造峰值会拒绝。[测试专用持久化观察器](fixtures/experiments-session-resource-observer.mjs)确认完成或中断日志每次读取只用一次真实持久观察和代次保护，物理超额文件零解码拒绝，压缩逻辑超额在一次官方解码后拒绝，无请求截点的资源也会验证并在追加持久水位后拒绝。原 sidecar 字节保持。当前 Relay27 调用观察到二十次本机合成 HTTP、二十三个官方 stream 入口、十五个实际 Agent、九个保护动作、七个完成工程 turn 和一个完成矩阵，零计费；其中已包含三个资源拒绝场景。另两个超额 Session 和一个空白／追加 Session 是隔离合成持久化输入，不计作 Agent 或完成任务。重叠调用和较早的压缩夹具失败分别保留。证据位于 `.build/dispatch/evidence/relay-27/`，旧根仍保留。[资源语义](../../desktop-host/src/experiments/README.zh.md#isolated-engineering-task)区分物理长度、逻辑快照和未资格化峰值。独立[deadline 夹具](fixtures/experiments-engineering-timeout.mjs)保留此前真实 180 秒资格，本次工作不重跑或升级该时钟及原分析时钟。

```sh
node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/experiments-engineering-profile.built.e2e.ts --retry=0
```

[工程 renderer 夹具](fixtures/experiments-engineering-carrier.mjs)使用保留的物理 Electron binary、生产 Main／沙箱 preload 和完整隔离 profile。实际英／中文预览展示完整资源限额，编辑会撤销预览且零发送。显式确认完成一个 Agent／TAP 任务；资源表分别呈现排空长度、null 峰值及缺失侧数。完整私密输入／日志窗可滚动，不省略字节。随后两行显式确认完成顺序矩阵，选择其原 JSON 文件按保留来源验证报告，不重放。未来版本及来源变化的报告文件会拒绝，不重放。合成的已提交启动响应丢失后，renderer 重载保留身份，不自动读取或重启；显式取消排空该任务。矩阵取消保留单个排空轮次，不发送下一行。完成工作重载后须显式原身份读取；关闭辅助页保留日志，不创建更多工作。本次独立 renderer 调用观察到八次本机合成 HTTP／stream 入口、五个 Agent、三个保护 TAP 动作和一个完成矩阵，零计费。PNG、请求及原结果保留在 `.build/dispatch/evidence/relay-26/renderer/`。安装资格、恶意替换、一般模型质量和完整磁盘／内存峰值仍未知。

<a id="verification-task-request"></a>

## 单次任务请求 profile

[仅任务夹具](fixtures/experiments-task-profile.mjs)使用同一完整受支持 profile、全新私密 home 和原生配额。它检查双语控件及四项任务操作的 cookie／origin 拒绝，准备不发送，再从完整官方输入截点确认一次无工具请求。本机合成 SSE 服务独立观察四次请求：完成、取消、失败和 Host 进程丢失中断。取消排空；失败不重试或切换。冷 Host 读取未变的完成记录字节和中断的准备截点，不声称 dispatch 数，也不补发。夹具也通过实际 Notebook owner、产品 cache hook 与官方 finish 元数据检查完整笔记捕获、会话路由键及提供方响应标识；冷重启保留两个独立 sidecar 原字节。当前 root 和 wire 输入保留在 `.build/dispatch/evidence/relay-24/full-profile/`；原 Relay23 证据不改动。没有 Agent、工程动作或计费提供方。这些 Node-mode Host 证据不认证 renderer、准确模型版本、因素矩阵、T11 任务关联或安装。

```sh
node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/experiments-task-profile.built.e2e.ts --retry=0
```

<a id="verification-open"></a>

## 待验证事项

以下事项不是通过证据，review 时必须保持可见：

- Electron `capturePage()` 捕获单个窗口。Windows 交互观测包含合成弹窗和原生菜单选择，但跨平台 Figma／布局验收与完整录制仍未验证。自动化工作区运行器直接调用菜单处理器。
- 开发启动器在此 Windows 工作区遇到指向缺失目标的可选 Linux ARM64 依赖 junction；验收运行器直接链接已有依赖图，不验证该启动器的依赖投影。
- fixture（测试前置数据）不执行安装器，不覆盖已安装应用，也不证明新版本成功启动。发布前仍需签名 Windows 和 macOS 的已安装版本验收。
- 两个隔离 Windows 测试安装包通过签名包检查，包括内嵌清单配置。安装后启动、失败重试、自动重启和数据保留仍待操作者验证；文件检查不认证发布。
- 真实策略源站、网关行为、限流、批准的页面源站和已部署策略配置仍待后端联调。本地响应不能证明线上服务可用。
- 策略、updater 清单与下载停滞均达到真实截止时间并可恢复。下载写入的 `ENOSPC` 故障注入已覆盖；真实卷耗尽与已安装版本升级的磁盘压力仍未验证。差分下载和发布者拒绝已通过真实 Electron 下载验证，但尚未在新打包应用的已安装版本升级路径中验证。
- Windows 原生剪贴板写入通过。已尝试启动默认浏览器，但因自动化工具无法可靠识别当前 URL，目标地址验证停止。macOS 浏览器和剪贴板集成仍未验证。
- 强更与常规失败使用本地化摘要和折叠诊断；复制失败展示可选择的地址。常规错误悬停提示显示摘要，不展示原始诊断。Windows／macOS 安装包的图标提醒、通知权限与专注模式行为仍未验证。
- 完整 `doc-sync`（文档同步门禁）在文档站测试中遇到 Windows 文件符号链接 `EPERM`。这不是 updater 失败，也不代表完整文档门禁通过。
