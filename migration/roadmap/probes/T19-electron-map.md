# T19：旧 25 项到 Electron 的测量映射

旧定义直接来自 `../runtime-src/self-test.mjs` 的 `contracts` 与 `../docs/SELF_TEST_CENTER.md`，本表不把旧 Tauri/WebView2 实现复制成 Electron 资格。正式[本机／确认连接 runner/report/UI](../../../apps/desktop-host/src/selftest/README.md)已发布，旧六行 service-presence 入口改为拒绝。此表是等效测量目标，不代表全部目标已执行或取得资格；实际逐项结果由报告保留，前缀仅取得 owner 参考中的本机分类资格。[开发载体](../../../apps/desktop/tests/README.md#verification-selftest)另取得真实 Main／preload／本地协议及本机／合成连接 UI 交互证据，报告行不消费这些外部结果，renderer／资源行仍 UNKNOWN。真实模型缓存命中／Agent-loop 准入／回合渲染、安装及现场仍未认证。连接证据只使用本地合成提供方，不证明真实付费模型行为。

| 旧 ID / 组 | Electron 等效测量 | 现有实际 owner / 不能冒称的范围 |
|---|---|---|
| node / local | 实际 Electron Node-mode Host 的 executable/version 与当前载体声明 | Main/Host 启动；开发 Node 不等于签名安装运行时完整性，不用 Git SHA |
| dsh / local | 当前随包 DSH 生产依赖及资源集合，缺失/额外/未知清单分开 | package preparation；未取得实际安装载体清单保持 UNKNOWN |
| modules / local | 实际已载入 Host/Client bundle 与发行资源范围 | bundle 构建；仅源码存在或编译成功不是载体完整性 PASS |
| webview / local | Electron/Chromium 版本、预加载与本地协议资源，替代 Fixed WebView2 | Main；独立开发载体已测真实窗口／隔离 preload／认证自检交互，报告仍缺逐运行载体证据，不能据此认证安装或现场 |
| storage / local | 随机隔离目录原子写/替换/完整 UTF-8 冷读，真实 quota 拒绝 | T06 + atomic-write；包括临时峰值与终态空间 |
| shell / local | 在隔离 cwd 执行固定已审定原生命令并读回合成文件 | 官方 Shell/provider/sandbox；不能绕过执行权限，不加载用户规则或 Agent |
| skills / local | 只发现/加载显式隔离目录里的合成 Skill | 官方 Skill/fs provider；不得调用全局 list 读用户 Skills 后称隔离 |
| action-trust / local | 未信任合成 action 必须被真正执行入口拒绝 | ProjectActions；不污染用户工程信任配置 |
| action-run / local | 信任固定合成 action，实际执行并独立冷读意图/结果 | ProjectActions/T11；exit 0 不生成任意测试 PASSED |
| action-change / local | 修改合成 action 配置，旧信任立即失效 | 现有配置指纹/信任 owner |
| cancel / local | 取消已启动隔离长命令，等待真实进程/输出排空 | Shell/ProjectActions；取消和 exitCode/timedOut 独立记录 |
| git / local | 隔离新仓库状态/基线/修改比较；固定命令、不联网 | 现有 changes owner/Git；缺命令 SKIPPED，不读取用户 Git 配置或仓库 |
| hg / local | 同上，使用实际 Mercurial；缺依赖 SKIPPED | 现有 changes owner/Hg；不得下载替代资格 |
| artifact / local | 合成产物更新后，旧引用在真实读取/下载入口失效 | DesktopArtifacts/fs；不写用户产物目录 |
| prefix / local | 官方原文追加／消息投影替换、Notebook 已提交更正／过期 CAS、另一物理 root 恢复拒绝与准备路由／缓存键分类 | [精确范围](../../../apps/desktop-host/src/selftest/README.md#prefix-classifications)；零发送，稳定键不证明前缀相同／提供方命中，不认证 loop 准入或回合渲染；不重开 W04 |
| recovery / local | 自检先持久意图；只读冷恢复缺终态为 INTERRUPTED/UNKNOWN | 新 T19 report owner；不杀用户 Host，不自动重放请求/命令 |
| notification / local | 隔离 feed/notice 身份及隐私投影，避免系统弹出 | T12 identity/claim/handled 各自独立；未知 OS ACK 不补发 |
| probe-failure / local | 本地合成 provider 注入失败后，后续请求计数保持不增 | 已有 prepared-call/Probe；必须是本地 provider，不能用真实付费 Key |
| connection / provider | 用户确认固定模型、实际连接及独立 T23 修订、单用票据和预算后最多五次合成请求 | ConnectionStore lease + T23；官方完整输入 JSONL flush／冷读重建，每次发送前检查，拒绝 retry/failover |
| streaming / provider | 实际 chunk/finish、耗时和取消观察 | 官方 LlmRuntime；finish failure/aborted 不等于成功 |
| tool-call / provider | 固定 echo tool 名称与参数；绝不执行模型生成的命令 | 官方模型协议；64-token 输出用尽保留 UNKNOWN |
| cache-counter / provider | 仅记录真实 adapter usage 覆盖，未报告保留 UNKNOWN | 官方 usage/diagnostics；补零不是服务原始计数覆盖证明 |
| cache-repeat / provider | 两组各重复两次 2 KiB 合成文本；只有真实正 cacheRead 才 PASS | 官方 prepared-call；共五次总预算，失败停止后续，未知不补发 |
| native-acceptance / field | 实际窗口/通知/跨显示器/休眠/异常恢复现场证据 | 实际目标设备；无现场始终 UNKNOWN |
| egress / field | 企业网关观察 Shell/Git/任意 socket/worker 等真实出口 | 不由 T23 应用 HTTP 允许列表推断系统全局零外联；无现场始终 UNKNOWN |

正式 runner 必须先持久化意图再创建/执行检查，逐项完整提交结果；持久化失败停止后续副作用。取消/Host 退出留下 INTERRUPTED/UNKNOWN，冷读不重放。所有目录和 Key 使用隔离合成数据，不创建聊天、代理、定时器或调用模型来执行本机检查。完整报告和导出有界，导出按字段白名单重建，不含地址、路径、模型/账户名、凭据、正文或任意原始异常。COMPLETED 仅是流程结束，不能把 UNKNOWN/SKIPPED 变成 PASS。

T23 现有可消费接口是 `HttpEgressPolicy.prepare(url)` → 带 distribution/profile revision 的 `HttpEgressLease`，配置保存使用 `checkConfiguration()`，实际请求只能使用 `check(actualSessionId?)` 与 `fetchFor(actualSessionId?)`。应用的 Root provider 已在 Loader 前提供；未装 provider 的普通官方发行保留原语义。正式 T19 不从台账 NOT_STARTED 或未发布 owner 推断停工，也不按未来草案调用 API。
