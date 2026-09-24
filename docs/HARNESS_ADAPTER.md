# Harness adapter v1 与 M1 兼容清单

核查基线为桌面 `36d84ebe49243ba03a658fb4e844cec4fb5d9399` 的实际工作树，Harness `00102833dfaee1da9f48a3a8eae9d34005a75218`。该清单描述固定组合，不承诺兼容其他 alpha 或 master。实施状态见 [M1 记录](IMPLEMENTATION-M1.md)。

## 最小版本化入口

本文下表记录固定源码组合的耦合；当前实施结果见 [0.2.5 实施记录](IMPLEMENTATION-0.2.5.md)。当前 pin 为 `5e2879f0478ba9336128312e715dee7a9f56c3db`，包含明确授权的 payload hook 与 catalogProvider 接口。隔离候选完整构建 Gate 已通过，正式数据仍不自动挂载。公开服务耦合包括 LocalCredentialProvider 的 resolve/describe/set/unset 扩展、SettingsForms.replace 和自有 profile 的 package.json 原生写入锁。主 Key 经监督管道进入内存，其他凭据继续委托原生服务。没有更改官方会话 writer 或 Agent Loop。

`runtime-src/harness-adapter.mjs` 的 `harnessAdapterVersion=1` 记录两个已核查的引擎布局：

| adapter | 引擎 | Node | Session writer | 配置 | 桌面运行准入 |
|---|---|---|---|---|---|
| registry-015rc2-v1 | 0.1.5-rc.2 | 24.16.0 | 3 | settings.yaml | 保留已有组合 |
| source-017a2-v1 | 0.1.7-alpha.2 | 24.16.0 | 4 | profiles/dsh-desktop/cordis.patch.yml | 仅匹配固定来源的隔离候选；允许完整构建 Gate |

`requireDesktopAdapter()` 在 preload 的启动管道放行后、迁移和 Harness 设置写入前检查包身份与固定 Node，未知版本和未接好的源码组合产生固定错误 `BOOT_ADAPTER_UNSUPPORTED`。它不替代整树完整性、Rust 健康检查或构建准入；不通过改动一个布尔值解锁新产品。

`sourceProbeArguments()` 为隔离候选验证自有 profile `dsh-desktop`，首次初始化由 `prepareSourceProfile()` 调用公开 `initProfile` 并暂存后 rename。已有正确 manifest 不重复初始化。固定 base/web-app 两个基础 bundle 后可保留原生管理器新增的合法包名；基础顺序变化、重复/路径 specifier、不完整目录、符号链接/目录联接和非隔离路径拒绝，保留现场，不自动删除锁或数据。Rust 候选启动已经接入该分支。

首次工作区使用公开 `workspace-controller.documentsDirectory` 固定在候选目录；已登记项目不会改写。缓存 hook 保持绑定已审阅的源码提交与模块 hash。授权后的 `catalogProvider` 接口让独立连接继承固定内置模型的完整元数据，保留各自 endpoint、凭据和请求 scope；见 [具体证据与方案](proposals/M1-CATALOG-ROUTE.md)及 [实施结果](IMPLEMENTATION-0.2.5.md)。

## 实际依赖与耦合

“仍存在”只表示在固定源码中找到了声明，不能推导为行为回归通过。

| 桌面消费者 | 依赖与私有耦合 | 新源码事实／必须完成的工作 |
|---|---|---|
| engine.rs / host.mjs | 官方 CLI `lib/bin.js`、stdout 就绪文本、stdin 监督协议、环境变量 | Rust 使用自有 profile 与版本隔离候选；开发 EXE 启停、重启和历史打开已验证，最终交付另验 |
| engine_http.rs / desktop-health.mjs | 私有 `/desktop-diagnostics/api/health` 与固定组合 | 按版本 adapter 校验来源、健康和启动错误，保持显式内部协议耦合 |
| settings-sync / transaction / owner | settings.yaml 内容、文件锁、DPAPI 事务、桌面配置责任 | source-profile 通过公开 SettingsForms 写 profile patch，DPAPI 事务覆盖中断恢复、冲突及旧设置迁移 |
| desktop-vision / desktop-environment | SettingsForms 注册、客户端 describe/update revision | 使用版本化注册适配；源码识图双协议与浮窗开发窗口验证通过 |
| profiles.rs / config.rs | 连接目录、Windows Credential Manager、私有监督管道、overlay | 连接共享环境历史。主 Key 通过私有管道传送不可变修订，公开 LocalCredentialProvider 扩展按引用解析，YAML 仅存引用 |
| workspace-migration | 旧 workspace v2 文件布局、迁移标记和重复目录修复 | 实际旧 writer 的 v3 副本升级 v4、原文件不变、中断恢复与未知 v99 拒绝已验证 |
| task-recovery / notifications / pet / snapshots | session/event、turn/end、reason.kind、header.origin、投影顺序和 asOfSeq | source wire 冷恢复不重放及 Rust 私有快照生命周期通过；开发原生窗口完成状态和宠物重启通过 |
| desktop-control | agents.status、inbox.nextTurn/nextStep、cancel | 队列字段仍有声明；这是内部运行视图耦合，不等于全局准入冻结接口 |
| project-actions | shell、sandboxPolicy、shellEnv、tools 注册及执行约定 | 双协议 wire 验证权限、取消、日志、产物；离线 smoke 验证真实 read/edit/pwsh，工程日志仍含原始 stdout/stderr |
| desktop-prompt-stability | `app:web-surface` 名称、英文提示前缀、system-prompt/assemble | 保留精确上游文案耦合；源码双协议 38 项最终请求前缀回归已通过 |
| desktop-cache-key-bridge | 旧 adapter 精确 SHA256、源码锚点、内存 load hook | 原 hash 和旧回归保留。源码使用已授权公开 payload hook，按新提交及实际模块 hash 校验，热更新绑定不可变配置修订 |
| desktop-client / environment client | `window.__ModuleLoader__`、ctx.sessions/uiWorkspace/conversation、slots、上游 DOM | 显式保留这些内部耦合；开发原生浮窗、快照导航与主题入口已验证，最终交付另验 |
| theme 与构建同步 | 打包 client.js 内 CSS 变量和构建字符串锚点 | 完整源码产品构建通过；缺少包内 LICENSE 时仅接受同版本、同为 MIT 的 CLI 仓库许可证；保留 CSS 锚点校验 |

主连接 Key 保留 Windows 凭据管理器责任；识图 Key 当前由 Harness credentials-local 保存在本地 YAML。元数据诊断的隐私约束不覆盖工程原始日志。代理、企业 CA 和进程网络参数继续要求重载；源码本地代理、CA、loopback 与不受信证书拒绝测试已通过。

## 放行要求

每项必须有对应层面的证据：来源固定 → profile/设置/凭据 → 数据副本迁移与降级边界 → 原功能回归 → 双协议请求与缓存前缀 → 完整原生 EXE 构建及启停 → 离线目录核验。Web Host 探针、直接适配器请求和 Loader 组合测试分别只证明各自层面。

源码生产构建要求干净的固定提交。当前 payload/catalog 接口固定为 `5e2879f0478ba9336128312e715dee7a9f56c3db`，资格目录及源码产物各保留校验记录。未来 fork 增量必须重新提交、构建及完成门禁，不能复用旧封存产物或降低 clean/pin/hash 检查。
