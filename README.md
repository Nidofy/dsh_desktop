# DSHDesktop

Windows x64 的 Tauri 2 桌面程序，直接运行官方 DeepSeek Harness 和原生 Web UI。**0.2.0 为日常使用基准版本**，携带固定 Node 和 WebView2，首次启动无需下载运行环境。

本版沿用已验证的功能基线，后续根据实际内外网和工程使用反馈修复。完整本机构建与回归结果见 [0.2.0 发布记录](docs/RELEASE-0.2.0.md)；现场观察单独记录，不表示所有目标环境均已测试。

当前开发候选为 **0.2.4-rc.2「可靠切换与恢复」**，包含配置事务、任务切换确认、独立候选环境及宠物拖动修复；详见 [实施记录](docs/IMPLEMENTATION-0.2.4.md)。它没有更换 DSH 引擎，也不自动覆盖旧交付目录。

## 开始使用

1. 使用完整程序目录，保留 `DSHDesktop.exe` 同级的 `resources`，放在当前用户拥有的本机路径中。已有程序先从托盘选择「退出」，再启动新目录中的 EXE。
2. 在「连接与模型」顶部选择 **DeepSeek 官方连接 / 添加提供方 / 添加自定义提供方**。已知提供方预填地址、协议和模型；自定义提供方填写 Base URL、API Key 和模型 ID。
3. 点击「保存连接」，待任务结束后点击提供方旁的「应用」。当前已生效且配置未变时显示不可点击的「已应用」。切换不同连接会重载后端；重复应用相同配置不会重载。
4. 打开工作区开始任务，在对话输入框的模型选择器切换当前连接内的模型。Thinking effort 使用原生 DSH 选择器。
5. 工作区右上角的「环境信息」图标打开浮动卡片，查看变更、分支、本地环境和来源。加号菜单可打开构建、文件产物、诊断、缓存、自检等工具。窗口缩小时自动收起，不使用右侧栏。
6. 托盘「设置 / 诊断」打开桌面设置；页面按连接、快照、存储、备份与凭据、运行状态分类。辅助页面跟随 DSH 的明暗/系统主题及字号。

连接共享工作区、会话、附件和外观设置。地址、协议、模型与网络参数可编辑；连接可删除，删除连接不删除会话或工程。API Key 按连接保存到 Windows 凭据管理器，编辑时留空保留密钥。切换连接本身不发送历史，继续任务时使用当前服务。

OpenAI 使用 Chat Completions，Anthropic 使用 Messages。填写服务基础地址，不要填写完整 `/chat/completions` 或 `/messages` 请求路径。每个模型可分别设置上下文容量和最大输出；GLM 模型 ID 使用服务提供的原名，不添加 `[1m]` 容量后缀。代理、企业 CA 和超时在连接的高级设置中配置。

默认正式环境使用 `%LOCALAPPDATA%\DSHDesktop` 数据目录。0.2.4 的「候选环境」使用该目录下独立的 `candidates/<环境编号>`，不与正式环境共享会话或凭据。历史连接与已支持格式的工作区按迁移标记处理；未知格式停止写入并保留原数据。详情见 [连接与迁移](docs/CONNECTION_PROFILES.md)。

## 日常功能

- [工作区环境浮窗](docs/ENVIRONMENT_PLUGIN.md)：按需打开，可在 DSH 设置 → 插件 → 工作区环境启停；Git 分支搜索/切换/创建、比较、提交暂存区及确认后推送，Hg 状态与变更查看。
- [项目操作](docs/PROJECT_ACTIONS.md)：构建与测试命令、配置绑定信任、取消、日志和产物，复用 DSH 权限与执行后端。
- [变更查看](docs/CHANGE_REVIEW.md)：Git/Hg 差异、任务前后基线、选中片段追加现有草稿。
- [文件与产物](docs/ARTIFACTS.md)、[快照与恢复](docs/TASK_SNAPSHOTS.md)、[任务状态](docs/TASK_RECOVERY.md)、[后台提醒](docs/NOTIFICATIONS.md)。
- [诊断与归档](docs/OBSERVABILITY-0.1.6.md)、[A/B 比较](docs/EXPERIMENTS-0.1.7.md)、[缓存配置与探针](docs/CACHE_CENTER.md)、[环境自检](docs/SELF_TEST_CENTER.md)。
- [识图插件](docs/VISION_PLUGIN.md)：独立 Base URL、模型和凭据，支持 OpenAI/Anthropic 格式，在 DSH 设置 → 插件 → 识图中配置。

关闭窗口会隐藏到托盘，后台任务继续运行。托盘「打开 DSH Desktop」恢复窗口，「退出」结束程序及引擎；第二次启动不会创建另一套引擎。重启或退出前先结束任务。

## 运行范围与已知限制

面向 Windows 10/11 x64 普通用户账户。程序自带 Node 24.16.0、DSH 0.1.5-rc.2 和 WebView2 Fixed Version 153.0.4234.48；工程所需 Git/Hg、编译器和测试工具由工程环境提供。无自动更新、首次运行下载或系统 Node 回退。

- 当前本机验证环境为 Windows 11；干净 Windows 10/11、企业策略、休眠/注销及真实内外网网关持续验证中。
- 实际缓存命中取决于服务及任务；计数缺失显示未知。客户端缓存键、标记和前缀稳定性已有本机双协议回归。
- Hg 写操作和在线 Pull Request 尚未接入。浮窗来源展示桌面连接与工作区根目录 AGENTS.md/CLAUDE.md。
- 通知点击、系统另存对话框及大型真实工程仍持续收集反馈。程序未签名，企业应用策略可能限制运行。
- 随包插件可离线使用；新增依赖需由构建者准备完整运行时。网络插件和 MCP 仍需要相应服务可达。

0.2.4-rc.2 已提供完整离线 ZIP 和未压缩目录，交付校验见 [发布记录](docs/RELEASE-0.2.4-rc.2.md)。旧验证目录保留；它们共用用户数据，不能据目录名称视为独立配置环境。

## 开发构建

构建机需要 Node/npm、Rust 和 MSVC；最终用户不需要这些开发工具。版本和依赖锁定在 `versions.json`、`build-deps/package-lock.json` 与 `src-tauri/Cargo.lock`。

```powershell
# 已准备运行时：完成全部检查和 EXE 构建，不生成 ZIP
.\scripts\build-windows.ps1 -ReusePreparedRuntime -SkipPackage
# 完整目录：包含许可证清单和离线启动验证，不生成 ZIP
.\scripts\package-portable.ps1 -SkipArchive
```

首次构建去掉 `-ReusePreparedRuntime`。默认打包命令仍可生成 ZIP。源码仓库为 `https://github.com/Nidofy/dsh_desktop`；`runtime/`、`dist/` 和 `.build/` 为本机构建数据。

- [构建](docs/BUILD.md) / [运行前提](docs/RUNTIME_REQUIREMENTS.md) / [离线部署](docs/OFFLINE_DEPLOYMENT.md)
- [0.2.0 发布记录](docs/RELEASE-0.2.0.md) / [后续现场检查](docs/ACCEPTANCE-0.2.0.md)
- [第三方许可](docs/THIRD_PARTY_LICENSES.md) / [完整性校验](docs/RUNTIME_INTEGRITY.md)

## 桌宠候选版本

在 0.2.0 正式版基线上连续开发 0.2.1/0.2.2/0.2.3，首只内置宠物为「吃白饭的大肥鱼」（资源 ID：xiaojing）。默认关闭，可在桌面设置的「桌面宠物」页启用。0.2.3 支持最多三个实例、资源导入与导出、独立外观和固定目标。宠物仅显示任务状态，不参与模型请求。

阶段交付与实际检查见 [桌宠里程碑](docs/PETS-MILESTONES.md)，资源子集与边界见 [兼容说明](docs/pets/compatibility/README.md)。候选版本不覆盖 0.2.0 正式版目录；现场视觉和硬件检查的完成情况单独列明。
