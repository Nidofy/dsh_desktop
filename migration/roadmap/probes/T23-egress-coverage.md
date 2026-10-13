# T23 实际出口覆盖记录

2026-10-09 Relay 16，按当前源码记录。下面的“接线目标”尚不代表验证通过；行为证据另存 `.build/dispatch/evidence/relay-16/`。

| 实际入口 | 当前传输/授权 | 当前重定向 | 接线目标 |
|---|---|---|---|
| `connections/store.ts` save | 校验 PiAi profile，journal 后写秘密 | 无发送 | 所有解析模型目标在秘密/journal 前检查，发布前复验 |
| `connections/runtime.ts` ManagedAdapter | immutable ConnectionStore lease → PiAi；只支持 completions/messages，显式 Key | 由 SDK 决定 | 准备时捕获策略；实际 SDK fetch 前检查同一 origin、scope、revision |
| 官方 PiAi prepare/stream | SDK request `fetch` 可注入；OAuth/native auth 可另行联网；WebSocket 不经过 fetch | 由 SDK 决定 | 受策略时仅支持两种已核对 HTTP API、显式 credential；其他传输拒绝 |
| PiAi model discovery | `/models` fetch，bearer 或 x-api-key + deployment headers | 待发送代码核对 | 同一策略 lease fetch，拒绝重定向 |
| 官方 DeepSeek prepare/messages | frozen connection → resolveAuth → fetch；原始 headers | `redirect: error` | 准备时捕获策略；messages 与 Files 共享受控 fetch |
| DeepSeek Files upload/inspect/delete | FileStore → FilesApi 的可注入 fetch，原始 auth headers | `redirect: error` | 每次 fetch 检查；缓存/清理生命周期另核对，不宣称自动覆盖 |
| desktop-extras analyze_image | 真实 tool/UI → llm.prepareCall → attachment → call.stream | 委托模型 adapter | tool 传真实 Session scope；显式 UI scope 需验证，不能按 cwd 前缀猜测 |
| desktop-extras cache/start | 固定 route、单用 prepared-call 数组，无 provider retry；合成 SessionId 仅作请求标记 | 委托模型 adapter | probe 是 profile 操作；禁止把合成 ID 当真实 Workspace 权限 |
| MCP streamable-http | SDK fetch 可注入；config headers；当前无 OAuth provider | SDK 默认 | startup/reconnect/POST/GET/DELETE 全部使用 lease fetch；origin 固定；Session scoped tool 调用需核对 |
| MCP stdio | SDK 直接 spawn，scrubbed env | 子进程自行决定 | 明确不属于 HTTP 保证，现场网络管控；不伪造 socket confinement |
| Electron intranet | defaultSession onBeforeRequest；Main 外链/guest 限制 | Chromium 检查每次请求 | 保持原限制，不作为 Node policy 实现 |
| Shell/Git/任意 socket/worker/任意插件 | 各自进程与执行权限 | 各自决定 | 不在本次应用 HTTP 保证中；企业网关验证 UNKNOWN |

baseURL 仅是 provider endpoint；不会成为通用 HTTP proxy。所有受控 fetch 固定原 endpoint origin，拒绝重定向，包括另一个被允许的 origin，从而不转发任何 bearer、x-api-key、Cookie 或自定义授权头。普通官方 profile 在没有安装策略 provider 时保持当前行为。

## Relay 16 发布与验证

实际接口已发布：`packages/util/http-proxy/src/egress.ts` 的 type-only `HttpEgressPolicy/HttpEgressLease`，以及 `connections/egress.ts` provider。发行/profile/准确 Workspace 交集、完整策略修订、保存前及发布前检查、实际 fetch 前检查均接入；发行 maxima 由 Main 的随包资源提供，Root 在 Loader 前提供能力。配置定义保存使用 `checkConfiguration()`，不授予发送权限；无 scope 实际发送仍应用所有更窄 Workspace 规则。工具 vision 传真实 Agent Session，独立 UI/probe 与 MCP 连接明确为无 scope。

最终来源验证 `egress-final-source-isolated-root` 同次 15 文件/418 项，含修正后的真实 native quota，不能再叠加先前独立 native 次数。当前最终 bundle 的 `egress-publish-host` 完整 Node-mode Host/profile 验证通过，证据在 `.build/dispatch/evidence/relay-16/published-host/`：配置拒绝保留真实 patch，实际 Agent 以 `EGRESS_TARGET_REFUSED` 结束且额外 provider 请求为零。真实 Electron renderer、安装包与现场网关未测；具体完整入口/排除范围见 [owner 参考](../../../apps/desktop-host/src/connections/README.md)。

保留失败链：类型 readonly/optional、fixture credential/配额、pre-abort 回归、错误路径期望、bundler filter、首次 Session 自动 attachment 过度拒绝、fixture profile 路径和 inject、实际模块副本下错误码 UNKNOWN、lint/unknown 断言。首次 quota fixture 将临时目录本身用作 home，触及共享 TEMP 父目录测试账本，已撤销其隔离资格；当前采用独立 root/home。共享 TEMP 残留不删除、不猜测回写，后续不得把旧“单独 1 项通过”作为新资格。
