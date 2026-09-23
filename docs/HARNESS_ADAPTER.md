# Harness adapter v1 与 M1 兼容清单

核查基线为桌面 `36d84ebe49243ba03a658fb4e844cec4fb5d9399` 的实际工作树，Harness `00102833dfaee1da9f48a3a8eae9d34005a75218`。该清单描述固定组合，不承诺兼容其他 alpha 或 master。实施状态见 [M1 记录](IMPLEMENTATION-M1.md)。

## 最小版本化入口

本文下表保留 T1 核查时的耦合清单；当前实施结果见 [0.2.5 实施记录](IMPLEMENTATION-0.2.5.md)。截至 S5a，固定 hook 已提交 dad014b7，隔离 Rust/source profile 已接通并完成原生启动、重启、退出开发验收，生产准入仍关闭。新增公开服务耦合为 LocalCredentialProvider 的 resolve/describe/set/unset 扩展、SettingsForms.replace 和自有 profile 的 package.json 原生写入锁。主 Key 经监督管道进入内存，其他凭据继续委托原生服务。没有更改官方会话 writer、Agent Loop 或增加新的 fork hook。

`runtime-src/harness-adapter.mjs` 的 `harnessAdapterVersion=1` 记录两个已核查的引擎布局：

| adapter | 引擎 | Node | Session writer | 配置 | 桌面运行准入 |
|---|---|---|---|---|---|
| registry-015rc2-v1 | 0.1.5-rc.2 | 24.16.0 | 3 | settings.yaml | 保留已有组合 |
| source-017a2-v1 | 0.1.7-alpha.2 | 24.16.0 | 4 | profiles/dsh-desktop/cordis.patch.yml | 拒绝，完整适配未完成 |

`requireDesktopAdapter()` 在 preload 的启动管道放行后、迁移和 Harness 设置写入前检查包身份与固定 Node，未知版本和未接好的源码组合产生固定错误 `BOOT_ADAPTER_UNSUPPORTED`。它不替代整树完整性、Rust 健康检查或构建准入；不通过改动一个布尔值解锁新产品。

`sourceProbeArguments()` 只为隔离开发探针生成 CLI 参数：固定自有 profile `dsh-desktop`，首次使用 `--from-default-profile web`，已有正确 manifest 时不重复初始化。中断留下的不完整目录、未知 bundle 组合、符号链接/目录联接和非隔离路径直接拒绝，保留现场，不自动删除锁或数据。该函数尚未接到 Rust 产品启动分支。

## 实际依赖与耦合

“仍存在”只表示在固定源码中找到了声明，不能推导为行为回归通过。

| 桌面消费者 | 依赖与私有耦合 | 新源码事实／必须完成的工作 |
|---|---|---|
| engine.rs / host.mjs | 官方 CLI `lib/bin.js`、stdout 就绪文本、stdin 监督协议、环境变量 | CLI main 仍负责启动；新 profile 初始化与重启已单独实测，Rust 分支未接入 |
| engine_http.rs / desktop-health.mjs | 私有 `/desktop-diagnostics/api/health`，双方硬编码引擎版本 | 仍绑定 0.1.5-rc.2；不可仅改版本值冒充新组合就绪 |
| settings-sync / transaction / owner | settings.yaml 内容、文件锁、DPAPI 事务、桌面配置责任 | 新版 SettingsForms 写 profile patch；旧事务文件名单不接受新路径，必须另行设计单一写入与失败恢复 |
| desktop-vision / desktop-environment | `settings.installSection`，客户端 describe/update revision | 固定新产物导出的 SettingsForms 原型没有 installSection；阻断真实桌面扩展启动 |
| profiles.rs / config.rs | 连接目录、Windows Credential Manager、KEY_ENV、overlay | 连接不是 Harness profile；继续共享一个历史 home。新原生凭据按请求解析，热切换需另外设计 Windows 凭据发布，不可把主 Key 写 YAML |
| workspace-migration | 旧 workspace v2 文件布局、迁移标记和重复目录修复 | 现有检查不是 session v3→v4 迁移验收；须在副本验证相邻格式升级、未知事件/格式拒绝及中断恢复 |
| task-recovery / notifications / pet / snapshots | session/event、turn/end、reason.kind、header.origin、投影顺序和 asOfSeq | 字段和事件仍有声明；新格式持久化、冷加载、终态乱序与跨代原生回归尚未执行 |
| desktop-control | agents.status、inbox.nextTurn/nextStep、cancel | 队列字段仍有声明；这是内部运行视图耦合，不等于全局准入冻结接口 |
| project-actions | shell、sandboxPolicy、shellEnv、tools 注册及执行约定 | 新组合下权限、取消、日志、产物和原生 shell 待实测；工程日志仍含原始 stdout/stderr |
| desktop-prompt-stability | `app:web-surface` 名称、英文提示前缀、system-prompt/assemble | 精确上游文案耦合；必须核对最终双协议请求，不能只看字符串替换成功 |
| desktop-cache-key-bridge | 旧 adapter 精确 SHA256、源码锚点、内存 load hook | 原 hash 和测试保留。经授权的源码 payload hook 已独立实现并测试，尚未接回桌面缓存策略或进入固定产物 |
| desktop-client / environment client | `window.__ModuleLoader__`、ctx.sessions/uiWorkspace/conversation、slots、上游 DOM | 部分 slot 名仍存在；参数、组件生命周期、DOM 定位和浮窗交互均待新 Tauri 实测 |
| theme 与构建同步 | 打包 client.js 内 CSS 变量和构建字符串锚点 | `sync-desktop-theme.mjs` 仍依赖旧打包结构，完整源码产品构建尚未验证 |

主连接 Key 保留 Windows 凭据管理器责任；识图 Key 当前由 Harness credentials-local 保存在本地 YAML。元数据诊断的隐私约束不覆盖工程原始日志。代理、企业 CA 和进程网络参数的重载范围尚未完成新版验证。

## 放行要求

每项必须有对应层面的证据：来源固定 → profile/设置/凭据 → 数据副本迁移与降级边界 → 原功能回归 → 双协议请求与缓存前缀 → 完整原生 EXE 构建及启停 → 离线目录核验。Web Host 探针、直接适配器请求和 Loader 组合测试分别只证明各自层面。

源码生产构建目前要求干净的固定提交。经授权的 hook 留在 fork 未提交工作树中，旧 commit 对应的已封存产物不包含该 hook。不能把它重新标成新实现的证据，也不能降低 clean/pin/hash 检查来构建。
