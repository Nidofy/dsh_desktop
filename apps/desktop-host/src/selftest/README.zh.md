---
description: "运行隔离 Electron 本机检查并读取有界脱敏报告。"
---

# Electron 自检

[English](README.md) | 中文

## 概述

认证 Desktop 工作台运行隔离本机检查和明确确认的连接检查。本机模式创建新的合成工作区，使用现有 Shell 权限、原生配额和动作／产物 owner，不加载用户规则、用户 Skills 或模型请求。连接模式只发送固定合成输入。查看、历史、轮询和导出不会启动检查。

## 目录

- [运行与读取](#run-and-inspect)
- [持久化与取消](#persistence-and-cancellation)
- [测量限制](#measurement-limits)
- [前缀分类](#prefix-classifications)
- [已知限制](#known-limitations)

<a id="run-and-inspect"></a>
## 运行与读取

「个人扩展 → 本地自检」在原认证载体中打开 `/api/nidofy/workbench/selftest/ui`。`start` 接受 `mode: 'local'` 和调用者预先保留的新 UUID `operationId`。响应未知后，`read` 使用同一身份，不补发；null 表示 UNKNOWN，不授予重放权限。其他操作为 `list`、`cancel` 与 `export`。调用者不能指定目录、命令或任意输入正文。不注册模型可调用的自检工具。

「读取输入保留容量」使用无字段的 `connection-capacity`，只读私有保留输入，返回 root／未终结计数或已有分配拒绝，不分配目录、读取凭据、准备调用或删除字节。达到二十个 root 时报告 root 上限，未终结计数保持未测量。损坏／未来版本／链接输入仍明确拒绝读取。计数只是观察，不授予发送或修复权限；分配仍独立重验。Host 关闭取消并排空这些读取。

连接检查先用 `connection-options` 读取选项，不发送发现 HTTP，再用现有受管 `connection`、准确 `model` 与整数 `requests: 1..5` 调用 `connection-prepare`。预览显示真实连接 UUID／发布修订及独立的 T23 发行／profile 修订。两分钟有效期内，使用 `start`、`mode: 'provider'`、新 `operationId`、返回的单用 `ticket` 和 `accepted: true` 确认；页面要求显式勾选。每次请求固定 `maxTokens: 64`，受管路由须配置 `retryPolicy: { mode: 'normal', maxRetries: 0 }`。不重试、不故障转移、不执行模型生成命令。每次发送前检查模型、连接发布／撤销、策略／提供方与预算。失败、未知 finish、输出预算耗尽或未知证据即停止后续请求。产品操作可能产生提供方费用；本地验证仅使用合成 loopback 提供方与 Key。

全部 25 项身份分别包含范围、阶段、结果和固定诊断代码。本机模式将连接行保持为 SKIPPED，连接模式将本机行保持为 SKIPPED，两项现场行始终 UNKNOWN。COMPLETED 仅表示流程结束，不把缺失证据改为 PASS。

<a id="persistence-and-cancellation"></a>
## 持久化与取消

报告位于 `nidofy-extras/selftests/reports`。runner 通过原生 owner 预留普通检查点额度和独立终态额度，在构造检查 provider 前提交意图，在逐项执行前提交 RUNNING。完整检查点发布后才显示结果。失败或未知检查点停止后续副作用，不盲目重复。取消等待检查、命令／输出排空与清理后才发布终态，关闭页面不会取消。Host 卸载拒绝新启动，取消并等待排空。

冷读将未终结运行投影为 INTERRUPTED、执行中行投影为 UNKNOWN、待执行行投影为 SKIPPED，不修改原字节或重放。新的显式运行使用新身份／工作区，不接纳旧中断运行。每份完整报告／导出最多 64 KiB，保留二十份，只裁剪已知终态记录。中断、损坏／未来版本与临时字节保留或明确拒绝。历史发现超过 80 项或总计 22 × 64 KiB + 4 KiB 时拒绝，包括替换空间、锁与残留；链接路径拒绝。

JSON 导出重建允许字段并省略内部运行 ID，Markdown 使用同一报告及固定双语范围。不包含路径、地址、账户、模型名、Key、正文或原始异常。合成 root 使用随机身份和独占规范目录 marker。正常清理先排空工作、重验 marker，并拒绝链接／特殊文件，仅移除本次 root。崩溃残留保留，达到十项拒绝新分配。Skill 发现禁用默认目录，仅使用一个显式合成目录。私有回执通知 owner 不连接系统显示消费者。

连接报告使用 schemaVersion 2，本机 schemaVersion 1 仍可读取且不改写。完整合成输入检查点独立保存在 `nidofy-extras/selftests/inputs/<run>`。官方 JSONL writer 提交 turn／step 框架、准确请求 header、工具定义和原始用户消息，flush 后冷读重建实际请求，并在同一官方物理代次保护下发送。每次请求使用新的私有 Session 身份，不注册 Agent 或用户会话。输入检查点仅记录发送前置条件，不证明提供方结果或授予重放权限。逐次写入／读取重验规范 marker。输入保留上限为二十个 root，每个 root 共八十项、完整 64 KiB，包含 marker 与残留字节；发现时冷读校验原日志，损坏／未来版本／链接拒绝，十个未终结或未知 root 拒绝新分配。上限不授予删除旧输入的权限。原生配额计入这些写入和代次锁元数据，发送准入租约保持至提供方排空。输入不进入报告、导出或正常工作区清理。

<a id="measurement-limits"></a>
## 测量限制

真实检查测量 UTF-8 原子替换／冷读、原生配额拒绝、固定 Shell 文件输出、隔离官方 Skill 加载、执行时动作信任／变更拒绝、固定 TAP 执行与 journal 冷读、取消已启动命令、隔离 Git/Hg 基线比较、产物租约失效、只读检查点恢复及私有通知去重。退出、解析测试和用户输入覆盖独立，合成回执不认证用户工程。只有缺少 VCS 可执行文件为 SKIPPED，实际执行失败不会改为缺依赖。

Desktop 通过与 Office 共用的资源解析器，从既有 primary-runtime 载荷选择独立 Node，执行固定合成命令与 TAP 解析。Main 和 Host 仍由 Electron 运行。provider 在工作区分配前检查该可执行文件，资源缺失或为链接时拒绝。命令保持原 Shell 策略、原生保护及配额。普通 Node 测试／修复组合使用当前可执行文件。只有退出码、没有独立读回合成输出时，检查不能取得资格。

前缀项仅认证[本机分类](#prefix-classifications)，通过官方原始 JSONL、已提交 Notebook 和准备好的 PiAi／缓存键消费者测量，不创建 Agent 或发送请求。不认证提供方缓存命中、Agent-loop 提示词准入或回合快照渲染。provider 失败项在正文／发送前使用官方准备入口及私有失败 adapter，停止后续准备，不认证流式重试。Node 项只观察实际 Electron Node-mode 进程／可执行文件。开发 Node、安装运行时／模块清单及 renderer／预加载证据保持 UNKNOWN。不推断 SHA 或签名资格。

连接模式用一次请求观察连接、流式输出及固定 `selftest_echo` 协议，不执行该工具。缓存计数仅在 adapter 实际报告时取得资格。重复缓存行需要剩余四次请求：两组独立 2 KiB 输入各重复两次，实际正 cache read 才 PASS。缺计数保持 UNKNOWN，不补零。确认预算不足时，该测量以 UNKNOWN 结束，不发送不完整分组。

<a id="prefix-classifications"></a>
## 前缀分类

本机前缀检查在新的合成数据上测量以下情况。PASS 只适用于这些消费者判定，不代表提供方缓存行为。请求正文和路由键不进入报告，现有报告与 Notebook 代次不改写。

| 变化 | 已测量的消费者判定 |
|---|---|
| 原文追加 | 物理代次固定，原始前缀完整保留；持久修订改变，显式 Notebook 同步跟进。仅已提交读取不会同步。 |
| 消息投影替换 | 替换追加一个原始事件并改变冷读派生的模型历史，原引用仍可读取，已提交笔记／游标保持。 |
| 显式笔记更正或过期 CAS | 成功更正发布下个笔记修订，过期修订拒绝。读取仅见选定修订，不隐式推进证据或提交游标。 |
| 官方恢复到另一物理 root | 相同逻辑事件保留格式，但取得不同物理代次。旧代次保护与旧 Notebook scope 拒绝，原选定笔记仍可读取。 |
| 准备模型、token／默认值或工具变化 | 官方规范 header 区分模型、输出上限、默认值来源及工具定义，空工具列表规范为无工具。PiAi 不声明历史内 system-prompt 或工具更新能力。 |
| 地址或部署变化 | 仅地址变化可能保留相同日志 header。新准备观察新地址／容量／重试策略，旧准备事实固定；header 相同不授予路由或策略权限。 |
| 缓存路由键 | 同 provider／model／endpoint／home／Session／key 在消息追加／替换、笔记更正、工具及 token 变化后保留相同键，任一 scope 成员或私有 key 变化则分离。原生模式／其他协议保持 payload，关闭、未允许模型或缺 Session 移除键。既有捕获保留原策略，其他 payload 字段全部保持。相同键不证明前缀相同或缓存命中。 |

<a id="known-limitations"></a>
## 已知限制

受管连接模式依赖实际连接、存储及 HTTP owner，缺少它们的修复组合明确拒绝。输入保留容量没有自动裁剪或修复 UI。旧 cache Probe 不满足官方输入日志义务。[开发载体](../../../desktop/tests/README.zh.md#verification-selftest)认证真实认证页面上的本机及合成连接自检；报告行不消费这些外部证据，因此 renderer／资源清单行仍保持 UNKNOWN。安装包、跨屏／休眠／窗口恢复、真实提供方缓存行为和企业网关仍未认证。应用 HTTP 策略不认证 Shell/Git/socket/worker 或全局零外联，见 [HTTP owner](../connections/README.zh.md)。
