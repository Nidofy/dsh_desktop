# M3 工程闭环迁移实施记录

日期：2026-09-29。M3 已完成 Windows x64 个人联网版的实现与本地验收：425 项测试、18 项真实桌面检查通过。继续固定官方 `dsh-v0.2.0-rc.1` 基线，保留唯一 Host、Agent Loop、Session writer 和官方客户端。源码在独立 `electron` checkout；没有提交、推送或发布 GitHub release。最终构建为 `2026-09-29T12-14-25.956Z-Sz5S4H`，桌面验收为 `m3-4v5CUk`，包摘要和详细结果见[机器证据](../electron/migration/m3/evidence/summary.json)。

## 实现范围

应用菜单新增**工程工作台**，提供中英文仓库、变更与草稿、构建与测试、文件与产物、任务状态、文件保护六个页面。连接、模型选择和历史数据继续使用 M2 已接入的官方路径。

| 迁移项 | 实现 | 验收重点 |
|---|---|---|
| ENGINEER | Git 分支搜索/创建/切换/比较、仅提交暂存区、显式非强制 push；Hg 只读 | 预览绑定仓库状态与本次权限、一次性消费、脏状态及过期预览拒绝；写操作经过官方 Shell |
| REVIEW | 仓库/暂存/未暂存/任务基线 diff、片段追加官方草稿 | patch 摘要、目标 Session/编辑器、草稿 revision 重检；保留原文、引用标签和附件；未知 ACK 不重放 |
| BUILD | 项目动作配置、平台命令、配置与工作区身份绑定的信任、同工作区队列 | 执行前重检信任、真实取消和超时、有界日志、重启中断记录不自动重跑；模型只能调用已信任 ID |
| ARTIFACT | 手动登记、官方 Session 交付声明、构建声明、构建日志 | 来源与文件身份检查、文档打开允许列表、定位、固定副本另存；声明不等于本次生成 |
| PROTECT | 原生采集/身份重检/封存/恢复，工程命令参加同一准入 | 父子任务共享采集、最后所有者封存、无关重叠拒绝、不相交根并行；恢复预览 CAS、失败关闭 |
| TASK | 官方 Session 事件投影、未确认工具提示、任务与构建通知 | 不维护第二份执行事实，不自动重放工具；Main 观察官方 turn-end 通知 |

自动变更基线在每轮第一个模型步骤之前采集，部分采集或无法采集均明确保留其边界。VCS 程序缺失、编码失败和容量限制不会阻断普通模型任务，但也不会提供不存在的比较证据；原生保护失败仍阻断执行。基线描述时间范围内的差异，不证明某项修改由模型独自造成。

## 关键适配结论

官方编辑器的插入坐标把引用标签视为一个字符，持久草稿则展开为完整引用文本。迁移桥据此换算追加位置，并使用官方 `InputActions.insertText` 和 revision 检查，没有直接覆盖 DOM 或替换整份草稿。

Windows 原生 helper 返回的规范路径可能带扩展路径前缀。Host 增加原生 `resolve` 准入查询，用同一原生规范路径比较保护根，避免 JavaScript 普通路径与 Win32 路径表示不同而漏掉保护。父子关系来自官方运行时 Agent ownership，不接受客户端自行声明父任务。

官方 Windows ACL runner 可以执行 Git 创建分支、提交和 PowerShell 构建，但本机 MSYS 在受限令牌下创建 push 所需命名管道时失败。工作台默认仍保持部署策略并拒绝失败操作；仅当用户在预览中明确勾选**仅本次 Git 操作不限制文件写入**、再确认该预览时，才使用官方 `danger-full-access` 执行该次 Git 命令。权限被绑定到一次性票据，不改变会话策略，也不自动降级。测试 push 仅指向合成的本地 bare 仓库，没有向用户 GitHub 仓库推送。

产物另存使用 Host 固定副本和 Main 独占创建目标。现有目标不覆盖，请选择新文件名；复制失败可能保留不完整目标供检查。快照只保护选定文件，不替代操作系统沙箱，也不能约束外部应用。

## 验证与证据

| 检查 | 结果与依据 |
|---|---|
| 聚焦 Vitest | 29 个文件、425 项通过，覆盖 M2 连接/导入、模型适配、Shell、草稿保留、工作台脚本和保护 |
| 原生保护 | 5 项通过，包含真实 Win32 helper、父子共享、双工作区并行、恢复和失效拒绝；已包含在上述 425 项中 |
| 迁入模块回归 | 5 个脚本通过；真实 Git/Hg 比较、预览提交/推送、动作信任/队列/取消/中断/保留、文件租约/传输、恢复事实投影 |
| 完整包 | 官方构建、依赖组装、原生 helper、目录包、运行时/PTY/搜索和 Office 转换自检；最终构建记录见机器证据 |
| 真实 Electron | 菜单、双协议连接回归、Git、diff 追加、构建、取消/超时、恢复、原生文件 IPC、模型工具、任务通知、重启与副本导入；使用合成模型服务和独立数据目录 |
| 类型与 lint | 变更相关检查通过 |
| 文档检查 | 40/42 通过；两个既有失败是 M0 README 缺中文配对、M0/M1 来源证明使用提交哈希。未删除来源证明或放宽全仓规则 |
| 旧包保护 | M2 个人版与 M1 内网版的 exe/asar 摘要与先前记录一致；正在运行的旧包未被停止或覆盖 |

完整结果、模型可见工具契约、截图、日志与源码摘要集中在 [M3 evidence](../electron/migration/m3/evidence/summary.json)。可重复脚本为 [smoke-desktop.mjs](../electron/migration/m3/smoke-desktop.mjs)、[模块回归目录](../electron/migration/m3/tests) 和 [原生保护测试](../electron/apps/desktop-host/tests/protection.spec.ts)。更详细的使用约束见[中英文工作台说明](../electron/migration/m3/README.zh.md)。

## 使用与回退

最终包位于 `electron/apps/desktop/.desktop-build/targets/win-x64/candidates/m3/personal-unsigned/win-unpacked`，需保留整个目录。M3 增加 `DSH_DESKTOP_BUILD_CANDIDATE=m3`，使运行时、依赖组装及目录包均与当前 M2/M1 目录分离。

建议先运行 [launch-trial.ps1](../electron/migration/m3/launch-trial.ps1)。它用 `m3-trial-data` 独立数据目录启动候选，不占用正在运行的 M2 数据目录，不自动导入真实历史或读取旧 Key。进入应用菜单的**工程工作台**，选择实际项目。文件保护范围仍在**连接与迁移**中配置，恢复操作在工作台完成。该脚本已提供，本次没有替用户启动长期试用实例。

这是未签名的工程试用目录包，真实模型服务/凭据、企业网关、断网干净机、安装器签名与发布验收仍按既定边界分别进行。内网现场验收继续按用户指示搁置。旧 Tauri、M2 个人包和 M1 内网包保留为回退入口。

## 后续开发与跟随官方更新

M3 适配集中在 Desktop Host 的 `workbench`、Main/preload 的少量 IPC 和菜单，以及官方 composer 的一处桥接。官方主循环未 fork。迁入模块的原始文件摘要见 [origin.json](../electron/migration/m3/origin.json)；本轮增加的依赖与锁文件只对应官方 workspace 能力和已有 `diff` 版本。

每次升级官方基线，依次核对：Host 认证路由组合；pre-step、tool pre-execute 和 turn-end 钩子；Agent ownership；Shell 权限与取消结果；Session query/恢复及 `deliverables/presented`；composer 的 phase、revision、引用坐标与附件语义；原生 helper 和 Host 的版本匹配。随后重跑 M2 连接/导入与 M3 工程切片，重建完整依赖包并验收实际 Electron。不要只替换正在运行的主引擎文件。

下一阶段可进入 M4 的诊断、自检、缓存/识图及可选能力。完整迁移仍需 M5 的签名/安装、干净机与企业现场证据，以及跨官方版本适配和回退演练；M3 完成不代替这些发行条件。
