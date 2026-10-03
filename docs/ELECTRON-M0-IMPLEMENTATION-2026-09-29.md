# M0 实施记录：来源、官方构建与关键接口验证

日期：2026-09-29。对应[迁移计划](ELECTRON-MIGRATION-PLAN-0.2.0-rc.1.md)。**M0 已实际实施，源码与构建底座可用；完整迁移资格尚未全部通过。** 本文区分本次成功、修复和待闭合项目，不把分散测试等同于全部功能已迁移。

## 1. 已建立的实施仓库

| 项目 | 实际状态 |
|---|---|
| 独立 checkout | 当前工作区下 `electron/`，独立 Git 仓库；父仓库仅增加该目录的忽略规则 |
| 分支 | `codex/electron-intranet` |
| origin | `https://github.com/Nidofy/deepseek-harness.git` |
| upstream | `https://github.com/deepseek-ai/deepseek-harness.git` |
| 固定基线 | `dsh-v0.2.0-rc.1` / `4878cdabd87d4041bdaff61d04c966883b9fd07a` |
| fork 刷新 | 用户更新后重新 fetch，`origin/master` 与固定基线一致 |
| 工作状态 | 本地未提交变更；没有 push、PR、安装器发布或修改远端 master |

构建依赖采用 pnpm `11.7.0` 的 `--frozen-lockfile` 安装，官方 lockfile 未修改。Git 所有权检查通过只作用于构建进程的精确 `safe.directory` 解决，没有扩大全局信任或修改 ACL。

后续开发应在这个独立仓库继续；旧 Tauri 代码和用户活动数据没有迁入该 checkout。新仓库下的[源码锁](../electron/migration/m0/source-lock.json)、[验证脚本](../electron/migration/m0/verify-source.mjs)、[耦合台账](../electron/migration/m0/couplings.json)随本地变更保留。

## 2. 两项旧 fork 补丁已形成可复原材料

归档了 `dad014b7…` 的请求局部 payload hook、`5e2879f…` 的 catalogProvider 补丁，记录字节 SHA-256。以官方 `dsh-v0.1.7-alpha.2 / 00102833…` 为底，在临时 Git index 中依次应用，重建完整源码树为 `a69cd11266a43b29e57eeea664855fa7b6f684ed`，与旧本地 fork 完全一致。

这证明旧定制来源可从官方基线和归档补丁恢复，不再只能依赖相邻 checkout。它不代表补丁已发布到 GitHub，也不代表已移植到 rc.1。

对 rc.1 的旧补丁直接应用检查失败：翻译记录、生成目录、catalog 生成脚本及事件声明上下文存在差异。下一阶段应逐项移植行为并重新生成相应记录，不能整体 cherry-pick 后忽略冲突。验证器仅操作临时 index，没有把旧补丁写进当前产品源码。

## 3. 官方 Windows 目录包构建成功

执行：`npm exec --yes --package=pnpm@11.7.0 -- pnpm --dir apps/desktop run package:win:x64:dir --unsigned`。

输出位于[未签名目录包](../electron/apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/win-unpacked)。该目录是 M0 验证产物，配置为独立测试 App ID 和 loopback 策略地址，不是可交付内网版。没有签名凭据或上传凭据，没有安装到系统。请勿把裸 EXE 单独复制分发；运行依赖在同目录中。

| 记录 | 本次结果 |
|---|---|
| 官方完整构建 | PASS，包含 native、Host、client、Web |
| 官方 runtime preparation | PASS，固定包集与原生依赖准备完成 |
| Office 运行时 | PASS，版本与文档往返检查 |
| 最终 ASAR/原生依赖/Host smoke | PASS，包含 DOCX/XLSX/PPTX 转 PDF 与 CLI 发现 |
| 完整目录规模 | 9763 文件，1,057,490,240 字节，约 1.06 GB |
| DSH 描述清单 | 12448 个条目；与外层文件数不同，因为 ASAR 打包 |
| 签名 | `NotSigned`，明确的本地验证模式 |
| 构建耗时 | 官方流水线约 610 秒，不包含最初依赖安装 |

可核对[产物摘要](evidence/m0/artifact.json)及[官方打包结果](../electron/migration/m0/evidence/packaging-result.json)。构建标记 dirty，因为 checkout 包含 M0 材料；本轮产品运行源码仍为固定官方基线。新增测试与修正测试不进入成品运行代码。

### 运行时必须分开记录

| 用途 | 版本 | 观察 |
|---|---|---|
| 最初构建机 Node | 24.16.0 | 完成构建；SDK missing-assets 退出场景两次触发 libuv assertion |
| Electron | 44.0.0，内置 Node 24.18.1 | 最终 Host smoke 通过；该 SDK 失败场景单独通过 |
| 包内工具 Node | 24.21.0 | 完整 18 项 SDK/headless smoke 通过 |
| pnpm / Python | 11.7.0 / 3.12.14 | 来自实际运行时描述 |

后续 M0/M1 的 SDK 资格测试使用已验证的 Node 24.21.0。没有更换系统 Node，也不把一次通过泛化成上游 engines 范围内所有版本均合格。24.16.0 的失败日志保留。

## 4. 实际桌面首启与关键接口结果

[桌面 smoke 脚本](../electron/migration/m0/smoke-desktop.mjs)启动实际未签名包，使用全新 Harness home、Electron userData 和动态 loopback 端口，清除继承的模型凭据变量。测试 overlay 在首次启动前禁用产品分析与 exporter，会话遥测为 DISABLED。

已验证欢迎页返回 `analyticsEnabled=false`，不提供账号或 Key，调用官方欢迎页 `skip` IPC 后进入 `dsh-app://app/`，等待真正的 composer 挂载，保存截图并关闭自己启动的应用。没有发送模型请求。[首启结果](../electron/migration/m0/evidence/desktop-ui.json)、[工作区截图](../electron/migration/m0/evidence/workspace.png)。

这证明现有本地入口可用；**不是首次默认跳过账号已实现，也不是 OS 级断网/出口约束认证**。测试采用关闭分析的私有 overlay 和不可达本地代理，不能据此声称所有子进程网络均被强制隔离。M1 仍需固化发行策略并做真实网络观测。

首启调试还核实两点：profile 的 entry config 是替换，不是自动补齐；只覆盖 webserver 的 port 而遗漏 host 会启动失败。Electron 首个窗口可能是后台工作区，应按欢迎页 URL 定位；工作区就绪必须等编辑器，不能用加载页有文本作为通过条件。最终脚本已修正，早期失败记录保留。

### 本轮测试汇总

| 验证组 | 最终结果 | 解释 |
|---|---|---|
| 定向官方/新增接口测试 | 81 PASS | Host、认证转发、配置继承、动态配置、Loader、Session repair，以及新增 2 项真实 HTTP 凭据修订测试 |
| SDK/headless 实际入口 | 18 PASS | Node 24.21.0；本地模型替身，包含真实工具与持久化 |
| Session 格式迁移/拒绝 | 4 PASS | 修正 Windows 测试预期后；源文件保持、未来格式及未知事件拒绝 |
| 旧版 Rust 文件保护 | 30 PASS，1 默认忽略 | 路径/句柄/恢复/配额等；不是新 Electron helper 已完成 |
| 旧协议 fixture 生成 | 1 PASS | 生成本地 OpenAI/Anthropic 合成配置 |
| 旧版保护完整 wire 集成 | FAIL | 补齐 fixture 后，OpenAI 分支在后续 self-test 终态检查超时，仍为 RUNNING；Anthropic 分支未到达 |
| 实际 Electron 首启 | PASS | 私有空目录，无账号/Key，编辑器就绪，正常关闭 |

修正的唯一已有官方代码文件是测试：[Session 格式用例](../electron/apps/cli/tests/profiles/headless/tests/session-format-guard.expected.e2e.ts)。官方 Windows lease 使用命名信号量，没有 `session.lock` 文件；测试现在保留 POSIX 锁文件要求，同时使用正确的 Windows 预期。没有改变持久化或锁实现。

新增[连接修订测试](../electron/apps/desktop/tests/migration-m0-connection.spec.ts)得到明确结果：同一 prepared call 在重复发送时会再次解析可变凭据引用；使用不可变修订引用后，保留调用继续走旧地址/Key，新调用走新修订。这验证 M2 的技术路径，但不代表 Agent 自动重试、CAS、回执丢失恢复、取消和退休回收已实现。

## 5. M0 的剩余项与后续实施约束

| 项目 | 状态与处理 |
|---|---|
| 来源、官方构建、基本接口可用性 | 已有可复核实测，可继续 M1 底座开发 |
| 旧保护 wire 集成失败 | 保留 FAIL；失败位于 `tests/task-snapshot-wire.mjs:99` 的 self-test 终态等待。需隔离自检生命周期与快照行为，不能放宽断言后宣称通过 |
| 新版完整垂直切片 | 尚未把保护 helper、长请求热切换、工具执行和重开历史整合在同一新 Desktop 流程中；按原计划跨 M0–M2 继续，当前不能宣布全量 M0 资格通过 |
| 两项 fork 行为移植 | 已完成来源恢复与差异核实，尚未改造 rc.1 生产实现 |
| 内网发行 | 测试 overlay 已验证基本可用；账号监听、更新模式、网络强制策略、反馈/分析生命周期仍属 M1 |
| 数据迁移 | 只用合成 fixture；真实旧版数据副本及事务 journal 尚未接入 |
| 远端交付 | 新代码与证据仍在本地分支，未提交/推送 |

下一批按以下顺序推进：将 M0 的私有测试策略收敛为 M1 发行配置；建立 Main 本地入口与账号/更新策略；拆分旧保护 wire 用例中的自检终态问题；再把不可变连接修订和窄保护 helper 接到同一真实 Host，补齐完整切片。此后才把旧版工程与诊断功能成批迁入。

本次发现没有理由改回 Tauri 或放弃官方主线，但需要把 runtime matrix、配置替换语义和实际 wire 结果纳入持续升级检查。当前没有自动更新、真实模型计费、用户凭据访问、活动数据迁移、系统安装或远端发布。
