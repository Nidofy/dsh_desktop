# Harness 引擎升级与 Tauri 适配

当前组合为 Desktop `0.2.5-rc.1` / DSH `0.1.7-alpha.2`，固定 fork 提交 `5e2879f0478ba9336128312e715dee7a9f56c3db`。包版本相同不代表代码相同，必须同时核对 commit、锁文件、源码产物清单和桌面构建回执。旧交付目录的引擎不随新候选改变。

升级由开发端完成，用户端安装整套经过验收的桌面候选。当前 adapter 只识别明确列出的版本，不是通用的版本无关接口；不能只改 `versions.json`、替换 node_modules 或把准入开关设为 true。

## 1. 固定候选并审查上游变化

先保存两个仓库的当前修改、保留旧交付和迁移前完整数据副本。读取 Harness 及相关子目录的 AGENTS.md，执行桌面仓库的 `scripts/check-harness-upstream.ps1 -Fetch`，选择具体发布标签或提交。该脚本只检查 refs，不会合并或升级产品。

从当前集成提交创建新的 `codex/*` 升级分支，再合并所选上游提交。共享分支不强推，不用 reset/clean 丢弃修改。先比较 profile/bundle、设置与凭据、workspace/session 格式、任务事件、模型协议、客户端 slots/DOM、沙箱和主题打包结构；完整耦合清单见 [HARNESS_ADAPTER.md](HARNESS_ADAPTER.md)。

当前 fork 只承载两项已授权的运行时扩展：

- payload preparation hook：必须保留每次请求的配置快照与 scope，并覆盖双协议最终 payload 和缓存策略。
- `catalogProvider`：连接路由与内置目录来源分离，继承完整模型元数据，同时保留独立 endpoint、凭据和 scope。

如果上游已提供等价能力，验证行为后移除重复补丁；否则在新分支保留最小差异并重跑定向测试。需要新增 hook 时先给出具体失败证据、最小补丁和验证方案，取得相应授权。Harness 继续是唯一 Agent Loop。

## 2. 更新桌面适配和来源记录

先将新组合的 `desktopAdapterApproved` 设为 false，并在隔离候选中验证。主要审查位置如下，不能用全仓库字符串替换代替适配：

| 范围 | 位置与处理 |
|---|---|
| 来源与版本 | `build-deps/harness-source.json` 的 commit/version/packageManager/Node/两个锁哈希；`versions.json` 和桌面 Cargo/Tauri 版本保持一致 |
| adapter 与启动 | `runtime-src/harness-adapter.mjs`、`src-tauri/src/engine.rs`、`environments.rs`：增加或修订已审查版本的契约；保留旧版迁移路径 |
| 模型与 hook | `src-tauri/src/source_providers.rs`、`config.rs`、缓存扩展：复核 hook 语义，再使用实际新构建模块的 SHA256 和来源回执更新 pin；未知来源仍拒绝 |
| 设置与数据 | source profile、settings transaction/owner、workspace migration、session reader/writer；明确新旧格式和降级边界 |
| 原生能力 | task recovery、notifications、pet、snapshots、project actions、vision、environment slots/DOM；事件名称相同也需要行为回归 |
| 构建与测试分派 | `scripts/build-windows.ps1`、`prepare-dsh.ps1`、`sync-desktop-theme.mjs`、`tests/runtime-fixture.mjs` 等当前含精确版本判断的文件；新版本不得意外落回 registry 或跳过源码 Gate |

使用 `rg` 搜索旧版本号、旧提交和模块 hash，逐项判断是当前 pin、兼容分支还是历史证据。历史测试结果不回写成新版本结果。hash 变化只有在来源和行为审查后才能更新，不能为了让失败消失而放宽校验。

## 3. 构建源码并验证隔离候选

先提交并保持 Harness 源码树干净，使用 `build-harness-source.ps1` 从固定提交构建、部署生产依赖并生成来源清单。按 [源码工作流](HARNESS_SOURCE.md) 导入独立候选，先跑 CLI/Web Host，再验证自有 `dsh-desktop` profile 和真实 Tauri 启停。

迁移测试使用合成数据或完整副本，覆盖设置、凭据、工作区、会话、附件、规则、skills、未知格式拒绝、中断恢复及旧副本回退。默认工作区必须仍在候选目录内；不要让新引擎直接读写正式资料。降级使用迁移前完整副本，不能仅换回旧 EXE。

## 4. 完整 Gate 与交付

来源、契约和候选行为得到证据后才开启构建组合准入。使用新源码 artifact 执行完整 `build-windows.ps1`；当前迁移 Gate 仍需要完整旧 `0.1.5-rc.2` runtime。未来增加支持版本时保留所需的旧 writer/桥回归，不能把旧资源路径换成新引擎冒充迁移测试。

必须覆盖：完整 Rust/桌面测试、双协议最终请求与工具循环、内置目录/别名一致性、热切换和旧请求快照、缓存前缀、旧数据副本迁移、崩溃与 staging 恢复、取消与不自动重放。随后用回执对应的最终 EXE 验证原生窗口，再生成独立离线目录并核对 EXE/资源/目录清单。编译后指纹变化时，原生验收必须对应实际交付 EXE。

每轮升级建立新的实施记录、构建回执、测试日志和现场限制；真实内网、缓存收益、睡眠、DPI 等只有实际完成才能记为 PASS。当前 D 盘 ACL Win32 5 和额外 SDK feedback 回放失败也应在升级时复查，不能静默视作已修复。

## 5. 提交、推送与回退

当前用户仅授权推送桌面 main，Harness fork 适配提交保持本地。以下双仓库推送顺序是将来获得相应授权后的完整源码交付流程；当前远端桌面 pin 的源码可获取性尚未闭合，其他机器需另行取得固定 Harness 提交。离线运行包无需这些源码。

先提交并推送 Harness fork 集成分支，再推送引用其固定 commit 的桌面仓库，其他构建机才能取得完整来源。不要向官方 upstream 直接推送，也不要把 `runtime/`、`.build/`、`dist/` 加入源码 Git 历史。发布 ZIP 或 GitHub Release 是独立动作。

新旧交付目录并存，数据迁移前保留完整副本。记录每个里程碑的两仓库提交、源码 artifact、最终 EXE 和构建回执；只有整套固定组合通过后才用于用户升级。纯文档变更不要求重编译引擎，但重新交付的文档应有对应记录。
