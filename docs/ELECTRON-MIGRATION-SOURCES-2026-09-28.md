# 迁移分析证据索引

> 新基线证据：2026-09-29 已补充[官方 0.2.0-rc.1 迁移计划](ELECTRON-MIGRATION-PLAN-0.2.0-rc.1.md)与[机器可读来源](evidence/migration-2026-09-29/baseline.json)。本索引保留此前固定样本，不将旧 SHA 改写成新版本事实。

对应 [详细分析与实施方案](ELECTRON-MIGRATION-ANALYSIS-2026-09-28.md)。此索引记录实际读取的关键入口，不表示文件内每个分支均已审计或运行验证。源码镜像位于本项目被 Git 忽略的 `.investigation/audit-20260928-*`，不是产品依赖，不随发行包分发。

后续新增的 [持续升级与开发分析](ELECTRON-UPSTREAM-EVOLUTION-2026-09-28.md) 继续使用同一源码基线，并补读了下列发行/兼容资料。补充分析没有升级产品运行时。

## 本地事实

以下相对路径从本文件位置解析。完整源码基线与关键文件 SHA-256 见 [baseline.json](evidence/migration-2026-09-28/baseline.json)。

| 结论 | 证据入口 |
|---|---|
| 当前桌面/运行时版本 | [versions.json](../versions.json)、[源码 pin](../build-deps/harness-source.json) |
| 日用基准与候选语义 | [README](../README.md)、[交付记录](RELEASE-0.2.5-rc.1.md) |
| fork 本地来源与尚未推送的限制 | [HARNESS_SOURCE](HARNESS_SOURCE.md)、相邻 `deepseek-harness` checkout 的 HEAD/提交历史 |
| 已有离线验证与未完成的现场验证 | [distribution-verification.json](evidence/0.2.5/distribution-verification.json) |
| 连接两次设置替换、日志外的回执不足、Map 无退役回收 | [source-provider-control.mjs](../runtime-src/source-provider-control.mjs) |
| 主凭据扩展，其他引用委托原生服务 | [source-credentials.mjs](../runtime-src/source-credentials.mjs) |
| 代理/CA 不同必须重载、固定 fork 接口准入 | [source_providers.rs](../src-tauri/src/source_providers.rs) |
| 已启用文件快照未确认则 reject，子任务被跳过 | [task-snapshot-integration.mjs](../runtime-src/task-snapshot-integration.mjs) |
| 差异基线失败继续任务 | [change-review-integration.mjs](../runtime-src/change-review-integration.mjs) |
| Win32 句柄、路径和重解析点保护不能直接删除 | [task_snapshots.rs](../src-tauri/src/task_snapshots.rs)、[artifacts.rs](../src-tauri/src/artifacts.rs) |
| 诊断插件还装载必需桥接/保护与工程能力 | [desktop-observability.mjs](../runtime-src/desktop-observability.mjs) |
| bytes 预算和诊断字段 | [source-profile.mjs](../runtime-src/source-profile.mjs) |
| 旧同源校验与原生执行路径 | [project-actions-integration.mjs](../runtime-src/project-actions-integration.mjs) |
| DPAPI 与事务实现 | [settings-protection.mjs](../runtime-src/settings-protection.mjs)、[settings-transaction.mjs](../runtime-src/settings-transaction.mjs) |
| 已有不可变凭据、旧代消息拒绝与设置失败回滚测试 | [source-provider-control 测试](../tests/source-provider-control.mjs) |

## 官方 DSH：固定 tag 477b4f4

| 事实 | 源码 |
|---|---|
| 最新公开核实的候选发布、日期及 pre-release 属性 | [Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2) |
| 打包依赖、平台、UI/Host 安全边界 | [Desktop README](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/README.md) |
| skip 本地入口及 needsWelcome | [welcome-api.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/src/welcome-api.ts) |
| 遍历 provider 凭据，仍查询 account | [welcome-backend.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/src/welcome-backend.ts) |
| skip: enterWorkspace、账号 watch、强制更新实例化、外链 | [main.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/src/main.ts) |
| 网络失败保留当前阻断状态 | [mandatory-update-policy.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/src/mandatory-update-policy.ts) |
| unsigned 之前验证 policy | [desktop-package-environment.mjs](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/scripts/desktop-package-environment.mjs) |
| 转发移除 Origin/原 Cookie，再附 Host cookie | [web-document.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/src/web-document.ts) |
| profile 置于共享 Harness home | [paths.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/src/paths.ts) |
| Node IPC、profile 启动、19387 默认端口；profile 覆盖见 Desktop README | [desktop-host/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop-host/src/index.ts) |
| Host 协议版本 4 | [host-protocol.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/src/host-protocol.ts) |
| 请求 snapshot、每次 stream 解析 credential | [adapter.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/llm/llm-pi-ai/src/adapter.ts) |
| 原子注册与捕获配置冲突后记日志 | [index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/llm/llm-pi-ai/src/index.ts) |
| token 内联预算 | [spill-policy](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/spill/spill-policy/src/index.ts) |

## 持续升级补充证据

| 事实或现状 | 源码/文档 |
|---|---|
| 旧 Tauri 升级流程、精确 pin、双仓库源码取得边界 | [HARNESS_UPGRADE.md](HARNESS_UPGRADE.md) |
| 已记录的公开/内部服务及 DOM/prompt 耦合 | [HARNESS_ADAPTER.md](HARNESS_ADAPTER.md) |
| 当前检查脚本只提供 refs/diff 等信息，不判断兼容性 | [check-harness-upstream.ps1](../scripts/check-harness-upstream.ps1) |
| Shell/runtime 版本及 Host 协议、Node/pnpm 组合 | [release.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/src/release.ts) |
| DSH/Host 包版本与预期发行版本一致性校验 | [core-package-set.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/src/core-package-set.ts) |
| 目标平台、完整文件清单、运行时元数据 | [runtime-tree.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/src/runtime-tree.ts) |
| 插件 peer 检查及精确版本豁免 | [Plugin Manager README](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/plugin-manager/README.md) |
| 格式 writer、发布记录与新鲜度的不同责任 | [session-format-status.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/session-format-status.md)、[types.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/session/src/types.ts) |

上述文件经固定本地 checkout 读取；格式状态 GitHub 网页读取曾返回错误，分析依据本地同 SHA 文件与 writer 常量，并未仅凭搜索摘要推断。

## Codex：固定源码 1cc7e23

| 事实 | 源码/文档 |
|---|---|
| thread/turn/item、审批、取消与执行接口语义 | [官方 App Server 文档](https://learn.chatgpt.com/docs/app-server) |
| 类型化请求/响应与 server approval request | [protocol/common.rs](https://github.com/openai/codex/blob/1cc7e2361237ce7244430ee1d581c77f95c57ac8/codex-rs/app-server-protocol/src/protocol/common.rs) |
| thread model_provider 等创建参数 | [v2/thread.rs](https://github.com/openai/codex/blob/1cc7e2361237ce7244430ee1d581c77f95c57ac8/codex-rs/app-server-protocol/src/protocol/v2/thread.rs) |
| 策略 owner/read side、request permit、撤销与错误分类 | [network_policy.rs](https://github.com/openai/codex/blob/1cc7e2361237ce7244430ee1d581c77f95c57ac8/codex-rs/http-client/src/network_policy.rs) |
| 本次源码中的网络策略/模型目录限制补充 | [App Server README](https://github.com/openai/codex/blob/1cc7e2361237ce7244430ee1d581c77f95c57ac8/codex-rs/app-server/README.md) |

## ZCode：固定源码 29628c9

| 事实 | 源码 |
|---|---|
| 内置/个人/account 配置组合，异步修订发布 | [registry-service.ts](https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/packages/provider/src/registry-service.ts) |
| 缺省继承、递归覆盖语义 | [config-overlay.ts](https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/packages/provider/src/config-overlay.ts) |
| 普通连接与账号类型的有效选择 | [effective-model-selection.ts](https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/packages/provider/src/effective-model-selection.ts) |
| 远端同步与 lease/endpoint 绑定 | [remote-synchronizer.ts](https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/packages/provider-node/src/zcode-builtin-remote-synchronizer.ts) |
| connection-scoped topic ownership 与可信字段 | [zcodeAgentConnectionScope.ts](https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/packages/services/src/zcode-agent/zcodeAgentConnectionScope.ts) |
| pending request、timeout 与操作/观察区分 | [zcodeProtocolClient.ts](https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/packages/services/src/zcode-agent/zcodeProtocolClient.ts) |
| 外联、日志和凭据实现的产品边界声明 | [NOTICE.md](https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/NOTICE.md) |

## OpenCode：固定 v1.18.32 / 545f51d

| 事实 | 源码 |
|---|---|
| 配置更新后标记实例处置 | [config handler](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts) |
| provider/model、SDK 缓存与 Npm.add 动态安装 | [provider.ts](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/provider/provider.ts) |
| 模型目录远端来源、关闭开关与周期刷新 | [models-dev.ts](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/core/src/models-dev.ts) |
| 有序权限匹配、等待批准、释放拒绝 pending | [permission/index.ts](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/permission/index.ts) |
| 独立 Git 快照目录与 diff/revert | [snapshot/index.ts](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/snapshot/index.ts) |

## Google：动态在线文档，2026-09-28 核实

- [Antigravity 附加条款](https://antigravity.google/terms)：消费服务第三方访问限制；页面开头也声明部分企业接入适用其他条款。
- [Headless CLI](https://antigravity.google/docs/cli/headless/)：NDJSON、已有登录依赖、恢复、不支持控制请求/响应事件。
- [计划权益](https://antigravity.google/docs/plans)：不能替代实际账号资格/余额验证。
- [Gemini API 计费](https://ai.google.dev/gemini-api/docs/billing)：API 项目接入与计费机制。

网页内容可能变动；进入 Google 自动化集成阶段应重新核实。没有访问用户 Google 账号，没有验证余额，也没有通过第三方 OAuth 路径发送请求。
