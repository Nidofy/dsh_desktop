# 0.2.4-rc.2 锁屏与代理中断验证

日期：2026-09-23。结论：本机实际锁屏没有中断任务，常见代理故障能够结束任务并形成失败记录。本次未复现内网“持续深度求索中、没有新增、按钮已变发送”的现象，不能据此认定内网代理或 DSH 任一方已经排除。

## 1. 验证对象与范围

使用现有交付 `dist/DSHDesktop-0.2.4-rc.2-win-x64`，构建 ID `911532d0-60f1-4ef7-ab8b-7f1e52738b8c`；DSH 0.1.5-rc.2、Node 24.16.0、WebView2 153.0.4234.48。没有修改生产源码、模型请求逻辑、用户连接或电源设置，也没有重打包。本次新增内容仅为调查脚本和证据；原构建回执复核仍通过。

自动检查直接启动交付目录的 Node/DSH/宿主扩展，使用全新 DSH_HOME、固定合成凭据和仅回环通信测试拦截器。原生锁屏检查直接启动交付 EXE，独立 LOCALAPPDATA、独立工作区、本地合成 API；不向真实模型服务发送请求。原生 WebView 的全部外联未作防火墙审计。

## 2. 已执行结果

| 检查 | 结果 |
|---|---|
| OpenAI / Anthropic：持续输出，期间没有浏览器订阅或前端轮询 | 各运行 12 秒后正常完成，重新读取状态为 COMPLETED |
| 两协议：接收请求后不返回响应头 | 约 2.7 秒后 TIMEOUT / FAILED |
| 两协议：返回响应头后静默 | 约 2.7 秒后 TIMEOUT / FAILED |
| 两协议：只有 SSE 注释心跳，没有模型内容 | 约 2.7 秒后 TIMEOUT / FAILED；代理保活不会在这些样例中掩盖空闲超时 |
| 两协议：部分内容后断开 TCP | 约 0.5 秒后 TRANSPORT / FAILED |
| 两协议：部分内容后静默 | 约 2.7 秒后 TIMEOUT / FAILED |
| 两协议：持续输出超过请求配置的 6 秒，再显式取消 | 取消形成 aborted / CANCELLED，运行数归零；取消确认当下仍可能 running=1，不能当作已结束 |
| OpenAI：使用实际默认 300000 ms 超时，响应头后静默 | **300.419 秒后 TIMEOUT / FAILED**，运行数归零，后端仍存活 |
| 最终 EXE：三分钟输出期间由用户手动锁屏并解锁 | 持久化 turn/end 为 completed，输出完整，无页面刷新 |
| 最终 EXE：合成代理关闭后再发送一轮 | 持久化 TRANSPORT 错误；原生界面显示“本轮运行失败 / Connection error. / TRANSPORT”，没有残留“深度求索中” |

前 14 项为两个协议各 7 个样例，缩短空闲超时为 2500 ms、请求超时为 6000 ms；并额外验证了一项真实 5 分钟默认超时。全部通过。证据：`transport-short.json`、`transport-default.json`。没有将缩短超时样例说成真实 5 分钟验收。

### 实际锁屏记录

- 北京时间 14:00:15 开始；本地服务 14:03:15 结束，发送 178 个计数增量。
- 用户在任务期间执行锁屏并回复“已解锁”。系统审计查询没有返回锁定/解锁事件，所以准确锁定区间仅有用户确认，未独立测量。
- 后端原生记录：`turn/start` 1790143215367 → `turn/end(completed)` 1790143395576，总计约 180.209 秒。
- 测试服务一秒心跳的最大间隔为 1017 ms，没有观察到长暂停；本机支持 S0 Modern Standby，但本次不构成睡眠/休眠恢复验收。
- 解锁后激活 DSH 原窗口，未刷新页面、未切换会话：完整计数与 `LOCK_TEST_COMPLETED` 可见，“深度求索中”消失，输入为空时恢复灰色发送按钮。
- 证据：`native-summary.json`、`native-requests.json`、`native-heartbeat.json`、`native-before-lock.png`、`native-completed.png`、`native-completed-ui.txt`。
- 原生错误呈现：`native-proxy-offline.png`、`native-proxy-offline-ui.txt`。
- 测试实例通过菜单正常退出，相关进程退出及唯一合成凭据清理见 `cleanup.json`。

## 3. 源码确认与解释

桌面引擎通过独立 Node 子进程执行任务；主窗口失焦、隐藏及锁屏没有对应的主动取消分支。主窗口关闭默认隐藏到托盘，完整退出才停止后端。后端的持续状态不能仅由当前页面动画判断。

桌面连接默认 `timeoutMs` 和 `streamIdleTimeoutMs` 均为 300000。固定 pi-ai 适配器使用 `idleWatchdog` 监视下一个模型输出块；纯注释心跳被适配器过滤。本轮实验确认：持续有效输出可以超过配置的请求超时时长。**五分钟不是整个多步骤任务的总时限**，而且等待工具、等待审批、系统睡眠等与模型流空闲是不同状态。

上游 `dsh-client-ui-chat/lib/client.js` 的 `TurnStatus` 由会话 `running` 状态控制；不是模型真的在“深度思考”的证明。输入组件也读取 `running`，但只有 `running && subagent === null && (empty || blocked)` 才将主按钮显示为停止。**有草稿或查看子任务时，仍在运行也可能显示发送**；因此“按钮变回发送”本身不是后端已结束的充分证据。

如果内网现场输入框为空、查看主会话，且已确认后台终态而界面仍为“深度求索中”，优先调查终态同步/重连后的界面残留；如果后台仍 RUNNING，则继续区分模型流、工具等待、审批和后端暂停。当前客户端有连接丢失后的重连和 online/offline 监听，但本次没有证明所有睡眠恢复或半开连接路径均可自愈。

锁屏与睡眠必须分开：Windows 进入 Modern Standby 的休眠阶段后会限制或暂停普通桌面应用。参见 [Microsoft：应用与 Modern Standby](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/integrating-apps-with-modern-standby) 和 [显示与睡眠计时器](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/display--sleep--and-hibernate-idle-timers)。本机交流电空闲睡眠设置为 0，不能代表内网机器的策略。

## 4. 内网再次出现时怎样区分

先保存现场，再刷新，避免丢掉状态不同步的证据：

1. 记录大致锁屏、解锁、最后新增内容的时间，桌面版本、输入框是否为空，以及主会话/子任务。无需提供提示词、代码或密钥。
2. 从会话诊断的“任务状态与恢复”记录本轮状态和最近模型/工具状态；导出前核对包含的信息，优先只提供相关终态、错误类别与时间。
3. 对比三种结果：`FAILED + TIMEOUT/TRANSPORT` 表示模型调用失败；`COMPLETED/CANCELLED/FAILED` 但界面仍显示运行表示界面不一致；`RUNNING` 且没有进度则需核对工具/审批以及引擎响应。引擎健康正常不代表远端 API 正常。
4. 可在内网运行随本报告提供的 `Collect-PowerTimeline.ps1 -Hours 4 -OutputDirectory <本地证据目录>`。它只采集睡眠能力、当前睡眠/显示超时和限定事件号的时间，不修改电源设置、不采集连接密钥或任务内容。事件未开启审计或权限不足时会标记未知，不能凭空判定没有锁屏/睡眠。
5. 保存后切换回此会话或刷新页面：若立即出现已结束结果，支持界面状态残留判断；若持久化记录仍无终态，则不能靠刷新宣称任务恢复。

需额外验证的场景：真实睡眠/休眠恢复、企业 VPN 或认证代理掉线、半开 TCP/代理异常 SSE、多小时多工具任务、特定内网版本。此次没有复现确定的生产缺陷，因此未加入猜测性的自动重启、强制取消或重复执行逻辑。

建议后续改善：显示“最后收到模型内容时间 / 当前阶段”，解锁或页面恢复可见后执行只读状态核对，对确认终态清除运行提示；发生状态差异时提供“重新同步状态”。这些是改善诊断的方向，不是本轮已实现功能。
