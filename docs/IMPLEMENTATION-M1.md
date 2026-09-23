# M1：源码 Harness 的 Tauri 接入实施记录

本轮尚未交付 M1。正式版本仍为 Desktop 0.2.4-rc.2 / Harness 0.1.5-rc.2，源码准入仍为 false。没有提交、推送、发布、覆盖旧发布目录或迁移正式用户数据。

## 基线复核

开始时桌面为 `main / 36d84ebe49243ba03a658fb4e844cec4fb5d9399`，6 modified / 10 untracked 与交接逐项一致。Harness fork 为 `codex/tauri-integration / 00102833dfaee1da9f48a3a8eae9d34005a75218`，origin/upstream 与 pin 一致，开始时工作树干净。固定版本 Node 24.16.0、WebView2 153.0.4234.48、Tauri 2.11.5、Rust 1.97.1 均无交接差异；实际 Node 二进制 hash 与 versions.json 一致。Cargo 不在当前 shell PATH，定向编译使用现有 `C:/Users/enxi1/.cargo/bin`，没有下载或替换工具链。

原 16 个未提交文件已完整复制并逐一核对 SHA256，保存在 `.build/m1-baseline-20260923-232256/files`，清单为同目录 `baseline.json`。该本机备份位于忽略目录，Git clone 不会带来它。保留的原始内容与本轮后续修改可分别追溯；未用提交全部工作树的方式保存。

历史 RC2 回执 ID 仍为 `911532d0-60f1-4ef7-ab8b-7f1e52738b8c`，历史 build.log 包含 Rust 90 项和双协议前缀记录。它们是历史证据，没有当成本轮重测结果。当前工作树执行 receipt 校验已明确拒绝旧回执。现存 runtime 整树复核通过：25,786 文件，1,025,709,046 字节。

## 顺序与状态

| 阶段 | 当前结果 | 下一项 |
|---|---|---|
| T1 | 文件备份、[兼容耦合清单](HARNESS_ADAPTER.md)、版本化启动入口和失败保护已加入 | 随后续实现扩充契约；当前入口不表示新版产品适配完成 |
| T2 | 自有 profile 首次/再次 Web Host 启动通过；不完整 profile 拒绝通过 | Rust 启动分支、profile 设置写入、主连接凭据和回退未完成 |
| T3 | 保留现有迁移保护，尚未新增 v3→v4 数据副本验收 | workspace/session/config 复制迁移、中断恢复、未知格式及降级副本 |
| T4 | 静态耦合已列出，未宣称功能接回 | 恢复、通知、桌宠、工程操作、快照、主题、浮窗逐项回归 |
| T5 | 经用户明确授权，fork 已增加最小 payload hook 及定向/Loader/协议测试 | 新来源固定、桌面缓存消费者接回、提供方热应用与完整前缀回归 |
| T6 | 等待 hook 授权期间独立修复 staging 的先验证后整树替换与失败回滚 | 完整构建、原生 Windows、离线目录和目标内网验收未执行 |

## 实际验证

| 检查 | 本轮结果 |
|---|---|
| 桌面 adapter | 5/5，包含真实 preload 拒绝未适配引擎，CLI sentinel 未执行且合成 settings 字节未变 |
| 既有源码契约 | 8/8 |
| 原启动错误、runtime-module-sync、release-receipt 测试 | PASS |
| 新版 Web Host 首次与重启 | 两次 PASS；固定 dsh-desktop profile，认证 HTTP、4 个 JS/CSS 资源、受限 PATH、零模型调用、已启动子进程停止；产物未变 |
| source staging | 7 个场景 PASS：整树保留、替换后异常回滚、未知锁、越界、链接、缺失目录、恢复冲突；失败候选不丢失 |
| Rust release 定向编译与测试 | `engine::tests::startup_failures_accept_only_fixed_codes` 1 项 PASS；未重跑完整 90 项 |
| Harness hook 与已有 adapter/动态配置/Loader | 四个文件 71 项 PASS；随后新增 Anthropic 对照，hook 文件 6/6 PASS |
| Harness 定向 TypeScript build | PASS |
| Harness 导出 JSDoc 与中英文配对检查 | PASS |
| Harness 定向 lint 与模块图生成检查 | PASS |
| 公开 API 目录与消费者 | 补齐类型/事件归属并重新生成 3 个产物；映射、生成记录、既有 Cordis 工具共 23 项 PASS，中英文两组配对 PASS |

Web Host 证据：`.build/harness-web-smoke-FIBBbP/report.json` 和 `host-1.log` / `host-2.log`。staging 证据：`.build/staging-test-726f84b4b62f4d989d0b839d70081eb3`。机器记录见 `docs/evidence/m1-20260923.json`。测试使用合成资料、本地 HTTP 服务，没有调用真实 Provider。

首次新增 Loader 测试因默认 1 秒等待短于现有 HMR 行为而失败；改为同文件既有测试采用的 5 秒等待后通过。产品超时、断言和门禁未因此放宽。

## staging 恢复范围

源码导入、桌面扩展同步与完整 runtime manifest 校验均在 `source-prepared-*` 中完成；通过后将整个旧 runtime 移至 `source-previous-*`，再安装新树。同步/校验失败不动旧 runtime；替换后的普通异常会回滚完整旧树，失败新树保留在 prepared。目录移动使用拒绝目标已存在的原生 Directory.Move，避免 Move-Item 意外嵌套目录。

每次替换记录 `source-transaction-*.json`，独占 `source-staging.lock`。未知锁不按年龄清理，回滚发生冲突时保留锁与两套资料。硬终止/断电时仍可能停在两个 rename 之间；必须根据本次 journal、目录存在性和完整性核验恢复，尚未实现或验收无人值守的崩溃恢复。此修补不代表完整 T6。

## 明确未通过的交付 Gate

- 功能完成：M1 未完成，尤其新版配置写入、数据副本迁移和全部桌面扩展。
- 自动测试：只有上表范围通过；完整双协议 Agent Loop、前缀、缓存、原功能整体验证未运行。
- 原生窗口：新版 Harness 的 Tauri EXE 启停与原生功能验收未运行。
- 真实内网：未运行；历史“持续深度求索中”报告仍未复现，根因未知。
- 独立可运行交付：没有生成新的合格目录或离线包，不能把旧源码 artifact / Web Host home 当作 M1 产品交付。
- 来源固定：旧 pin 不含本轮 hook。fork 保留未提交实现；需审阅后建立新的固定提交，才能在不降低 clean/pin 检查的前提下继续源码产物构建。用户的“不自动提交”约束仍有效。

睡眠、混合 DPI、真实触控/笔、长期性能及干净企业镜像仍属于未测项。
