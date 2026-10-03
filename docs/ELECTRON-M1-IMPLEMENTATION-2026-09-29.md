# M1 内网发行底座实施记录

日期：2026-09-29。状态：**本地实施与目录包验证完成，现场网络和断网干净机验收待执行；不标记 M1 全部门禁通过。**

后续调整：用户已明确暂缓内网现场验收，优先开发外网环境功能。该验收不再阻塞个人版迁移，当前配置和产物见[个人联网阶段实施记录](ELECTRON-PERSONAL-IMPLEMENTATION-2026-09-29.md)；下文保留 M1 当时的构建与证据状态。

M0 的官方构建、Host、无 Key 工作区与基础接口验证可以支撑 M1。M0 中遗留保护 wire 测试和跨阶段最小切片仍按原记录保留，不因本次发行底座通过而改成成功。本轮在独立 `electron` checkout 的 `codex/electron-intranet` 分支实施，未提交、推送或发布。

## 基线与实现

仍固定官方 `dsh-v0.2.0-rc.1`、`4878cdabd87d4041bdaff61d04c966883b9fd07a`。没有升级 Agent Loop、Session writer 或另建 Host supervisor。旧 fork 补丁继续仅封存和重建验证，M2 的连接/凭据适配未提前冒充完成。

| 项目 | 本轮实现 |
|---|---|
| 构建模式 | `.env.windows` 明确选择 `DSH_DESKTOP_DISTRIBUTION=intranet`；省略时保留上游行为。内网模式拒绝混入在线更新源，不再使用 M0 的假更新地址 |
| 发行身份 | `Nidofy DSH Intranet`、App ID `io.github.nidofy.dsh.intranet`、外部协议 `nidofy-dsh-intranet`、独立产物文件名；运行时版本仍与 DSH 同为 `0.2.0-rc.1`，发行修订为 1 |
| 数据隔离 | 默认 `%APPDATA%/Nidofy DSH Intranet/electron` 与 `harness`；包括 Chromium sessionData、凭据、profile 和锁。忽略外部 `DSH_HOME`，测试/部署可通过绝对路径 `NIDOFY_DESKTOP_DATA_ROOT` 指定独立父目录 |
| 本地入口 | 无账号、无 Key 直接进入可用工作区；Main 只读取本地语言设置，不启动账号订阅；账号入口关闭后不再因过期/退出驱动欢迎页 |
| 最终配置层 | 将内网 patch 放入 ASAR 并通过官方 profile runner 的末尾 `patchFiles` 加载，覆盖 profile/home 中同 ID 的冲突设置；监听固定 loopback，端口由系统分配 |
| 数据外发 | 同时关闭产品分析生产者/exporter、session telemetry、feedback、独立的 DeepSeek API Session 日志附带；保留本地 Session 持久化与导出 |
| 依赖 | 保留官方构建期组装的 Node、Python、Office、pnpm 和 DSH 包集；关闭在线插件管理及 registry probe，首启不运行包管理安装 |
| 更新 | 不启动自动更新检查，不实例化强制更新策略；更新操作说明采用完整离线包替换。保留官方组合、文件摘要、原生包、Office 与签名校验，未实现独立的离线更新器 |
| 浏览器出口 | Chromium 默认 session 仅访问当前已认证 Host 或本地资源；sidebar guest 不访问网络；壳的外部链接不打开系统浏览器 |
| 工具出口 | Node、模型、MCP、Git、shell/build 等由企业网关约束，Electron 拦截不宣称覆盖这些进程 |

构建入口和维护说明见 [M1 README](../electron/migration/m1/README.md)，策略见 [intranet.patch.yml](../electron/apps/desktop/resources/intranet.patch.yml)，调用方/目的地见[网络清单](../electron/migration/m1/network-inventory.json)。可选插件的交互式离线启用和模型连接产品化继续属于后续阶段；本轮不开放在线安装。

## 验证结果

| 验证 | 结果与边界 |
|---|---|
| 定向测试 | 6 个文件共 84 个不同测试通过，覆盖发行策略、构建身份、上游环境/更新策略、Host 进程、语言和 installed-update builder |
| 编译/静态检查 | 最终 Host TypeScript 编译通过；M1 定向 oxlint 通过；中英文 README 配对记录更新并校验；930 个客户端 UI 文件的本地化检查通过；`git diff --check` 通过 |
| 官方运行时检查 | 依赖准备、包集和 runtime 描述完整性、原生依赖、DOCX/XLSX/PPTX→PDF、Office skill CLI discovery 通过；保留原检查逻辑 |
| 真实 EXE 首启 | 私有空目录、无凭据、不可用 HTTP(S) 代理环境下，直接进入有 composer 的工作区。此测试不等于本机物理断网 |
| 冲突配置重启 | 保存启用分析/exporter/账号/Session-log、绑定 `0.0.0.0:19387` 的冲突 profile 后，内网包仍进入工作区，最终发行策略生效 |
| 认证 RPC | 正向控制 `settings/describe` 成功；实际 `account/getState`、产品分析、插件管理和 registry probe 服务不可用 |
| 并存 | M0 官方基线包先在私有目录占用 19387 并进入工作区，再启动内网包；两边 composer 同时可用，旧目录哨兵保持不变。未操作用户真实官方数据 |
| 观测 | 主进程 Chromium 对测试接收端的请求被拒绝，遥测接收端收到 0 次请求。不是 Node/子进程出口证明 |
| 现场出口 | **未执行**。用户提供网关 `http://172.16.10.6:18080`，现场阻断所有公网，本机不可达 |
| 断网干净机 | **未执行**。当前证据来自构建机上的独立空应用目录，不能替代新机器、空全局缓存和真实断网验收 |

证据：[汇总与产物 SHA-256](../electron/migration/m1/evidence/summary.json)、[真实桌面结果](../electron/migration/m1/evidence/desktop-ui.json)、[内网工作区截图](../electron/migration/m1/evidence/coexistence.png)、[同时运行的 M0 工作区](../electron/migration/m1/evidence/official-workspace.png)。原始运行目录为 `electron/apps/desktop/.desktop-build/qualification/m1-ui-yLc9s7`；可携带证据不包含 `.credentials.yaml` 或完整 profile，日志中的临时认证 URL token 已脱敏。

## 构建故障与恢复

首次编译暴露新增 `.mjs` 缺少声明，已补齐；最终类型检查也修正了上游策略测试对可选返回值的类型收窄。第二次完整构建在 Electron 内 pnpm 已打印安装完成后出现 Windows `PostQueuedCompletionStatus` 异常，以退出码 `2147483651` 停止；保留失败证据，重新运行依赖准备成功，随后执行官方 builder 和 packaged-runtime 检查。最终又针对私有目录创建与 sessionData 明确隔离重建壳、封包并验证。没有将失败退出码改成成功，也没有跳过完整性检查。

真实 builder 配置测试有一次模块初始化超过原 5 秒测试时限，调整为有界 15 秒后通过。证据保留失败与最终成功日志，不能将早期失败日志当作最终产物状态。

## 可运行产物与后续动作

Windows x64 目录包入口：[Nidofy DSH Intranet.exe](../electron/apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/win-unpacked/Nidofy%20DSH%20Intranet.exe)。这是 `NotSigned` 开发验证目录包，携带整个 `win-unpacked` 目录使用；签名安装包和正式分发归 M5。旧 M0 目录包保留在 `.desktop-build/qualification/m0-official-win-unpacked`。

在现场用包内工具 Node 运行 [probe-site-network.mjs](../electron/migration/m1/probe-site-network.mjs)，传入内网 base URL、应阻断公网地址及新结果文件路径。脚本不接收 API Key，只观测 Node/PowerShell 子进程的 TCP 可达性；还必须附网关规则与审计证据，并做真实断网干净机首启。该脚本本轮只作语法检查，未在不可达的现场代为执行。

M2 可以基于该目录包开发统一内网代理的连接、凭据和路由 ACK，具体沿用 `base URL + API Key`；不能将 API 网关误配置为 `HTTP_PROXY`。M1 的源码实施已落地，现场验收缺口仍保留，待现场结果补齐后才将 M1 标记为全部通过。
