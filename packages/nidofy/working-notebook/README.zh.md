---
description: "供官方模式使用的可选工作笔记与压缩整理插件。"
kind: "package-reference"
---

# @nidofy/dsh-working-notebook

[English](README.md) | 中文

## 概述

本独立插件提供笔记工具、原始历史浏览、带版本的人工修正，以及回合边界的笔记快照。标准模式和创造模式保留官方预设定义。在插件管理器中停用本插件，会移除其工具、提示词贡献、接口及界面，但不会删除笔记或影响桌面外观与桌宠。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

私有桌面 bundle 将本包与桌面扩展分别挂载。Desktop Client 面板和设置消费公开 CompanionScope owner，包括准确会话选择与取消；侧栏显式打开笔记。缺少此 Desktop owner 时 Client 展示贡献不可用，独立挂载的 Host 笔记工具和 store 保持各自生命周期。新 scope 不重绑或删除旧物理 Notebook 代次。已有笔记继续位于 `$DSH_HOME/nidofy-extras/notebooks`，无需迁移 Session。五个官方历史工具与持久化检索索引仍由 bundle 分别管理。

“压缩时自动整理”是保存在当前配置目录中的全局开关，初始关闭。它从下一次基础压缩摘要开始生效，包括手动 `/compact`，适用于标准、创造及其他使用官方基础压缩器的预设。关闭后仍可人工编辑、调用模型笔记工具及使用已有笔记快照。摘要进行期间若修改开关，将丢弃本次笔记候选。已保存的选择优先于 Config 中的 `autoOrganize` 初始值。

产品读取和编辑 v2 状态。五项 Config 分别限制活动条目数（`maxActiveEntries`）、完整活动注入字节（`maxActiveBytes`）、delta 字节（`maxDeltaBytes`）、证据附录字节（`maxEvidenceBytes`）和历史磁盘字节（`maxHistoryBytes`）。Panel 读取活动笔记与分页停用历史，恢复是用户显式操作。成功保存设置会终止上一个 revision 的生命周期，包括等待 storage admission 的候选。scope 冲突和旧数字代次保留已提交数据，要求显式核对；会话继续执行但不注入这些笔记。参见[升级指南](../../../docs/upgrade-guide/v0.2.0-rc.2/notebook-v2-generation/guide.zh.md)。

启动和成功压缩会显式补齐耐久笔记候选。回合快照、笔记读取和状态只读 committed v2 状态，不在读取时运行恢复或创建转换文件。Panel 刷新显式补齐，并显示整理中、就绪或失败，同时保留已提交笔记。原始事件读取和搜索直接使用 Session 查询服务；最近来源由 `recentScanEvents`（默认 256）及 `recentEventLimit`（默认 40）限制。`maxCachedSessions`（默认 32）限制空闲元数据条目，活动任务在结束前保留。缓存只保存物理 scope 与补齐进度，不保存事件数组。

历史保留官方 unicode61 对词语、文件名和错误码的短语召回。至少三个 Unicode 码点的字面查询还使用 SQLite [三元组](https://sqlite.org/fts5.html#the_trigram_tokenizer)读取有界检查点，无需词典分词或云 embedding。单字与两字查询保留 `recentScanEvents` 原事件窗口。`maxCachedSessions` 限定子串来源会话，`recentEventLimit` 限定返回来源数，`maxEvidenceBytes` 按 UTF-8 限定原文及定位字段。来源、索引、窗口、字节或结果上限均报告覆盖不完整。检索不增加模型调用。

默认检索当前会话，exact cwd 可明确选择。“选择项目工作区”保存已登记 Workspace ID 与准确路径的完整选择，授予成员间本地历史读取权限。同名和路径前缀不提供权限，已属于其他项目的 Workspace 不能静默合并。候选载入、返回、预览和显式引用都会重验关联修订、当前登记、Session 归属、原始来源 cwd 及物理代次。编辑或移除项目后，旧项目结果失效。目录缺失或关联记录损坏时拒绝项目读取，保留原记录。

在现有 Notebook 根下，`history-projects-v1` 用 CAS 选择完整不可变修订，`history-substrings-v1` 保存带校验摘要的可重建检查点。两个命名空间各自使用 `maxHistoryBytes`，计入发布临时文件及崩溃／损坏残留；完整关联元数据响应使用 `maxEvidenceBytes`。关联记录保留，派生检查点可删除后重建；损坏字节在重建前备份，未知更新版本拒绝覆盖。同代次追加只提取检查点水位后的事件；代次、前缀或锚点变化会重建。每次操作从一个有界检查点重建 SQLite 表。原文解码和表构建仍有完整来源成本，不代表内存峰值资格。

修改检索词或范围会取消未完成的搜索、预览及草稿引用读取，并清除原选择。选择其他结果会替换上一个预览操作。即使传输在取消后完成，迟到响应也不能重新显示已取消的选择或插入其引用。关闭面板会取消其读取；HTTP 断开也取消 Host 操作。索引循环在配置批次之间让出执行，并在发布前检查取消。迟到取消不回滚已完成的检查点，已取消引用不重放。

显式历史引用插入使用官方带修订检查的 composer 追加。已有文字、引用 chip、附件和选择保留，插入形成一个撤销步骤，不提交消息。繁忙、已释放或过期输入拒绝，不替换草稿。

共享 `nidofyNotebookV2` 服务提供 `read`、显式 `synchronize`、即时 `synchronization` 及[完整输入捕获](../../../docs/subsystems/compaction.zh.md#notebook-input-capture)；Companion 仅使用 read，完整 UI scope 与物理 Notebook 代次彼此独立。私有 1k/10k/100k 合成脚本（`desktop-extras/tests/notebook-performance.ts`）在 `.build/dispatch/evidence/relay-03` 记录耗时、结束时 heap/RSS 变化和事件循环延迟；这些不是内存峰值或安装后产品测量。

Desktop Panel 与设置注册在笔记更新或显式补齐结束时撤回并重读 Companion 事实，包括回应不确定的情况。此只读回调使用完整现有 scope，不判断失败请求是否提交、不重放写入，也不改变通知处理。当前已提交人工修正无需切换会话即可替换旧 Hint 来源。没有 Companion 的独立 Panel 展示方不会取得该 owner。

<a id="understand-the-implementation"></a>
## 理解实现

插件使用 `compaction/basic-summary` 瀑布事件，在官方摘要请求末尾的指令中追加有界附录。重放消息、工具 schema、路由、压力阈值、裁剪、提交与取消继续由官方引擎负责。压缩成功持久化后才发布经过校验的笔记增量；候选格式错误时回退到普通摘要。共享实现保留在 desktop-extras 的库导出中，导入这些实现不会激活该包的桌面插件。[压缩子系统](../../../docs/subsystems/compaction.zh.md)负责摘要事务。

插件卸载会移除事件处理器，并等待未完成工作结束。笔记是非权威参考材料，每条均引用准确的原始事件。模型不能改动用户固定的笔记。没有独立的 invariant 插件，因为发布由版本化存储及官方压缩事务管理，而不是由独立维护的运行时观察状态管理。

<a id="model-experience"></a>
## 独立客户端与草稿

笔记本设置入口不要求可选的 Companion 客户端。高级设置与上下文详情可折叠。草稿限定于当前 Host generation 与会话；保存完成只清除未再修改的已提交草稿。禁用 Desktop Extras 仍会关闭该插件拥有的路由，包括其管理页。


## 模型体验

### 工作笔记

#### 模型可见内容

启用本插件时提供 `notebook_read` 和 `notebook_update`。更新需要版本检查、证据引用并遵守条目限制。关闭自动整理不会移除这两个工具。

#### Token 影响

已提交笔记通过已记录的运行时上下文进入下一回合。增强摘要在普通检查点之外请求增量笔记。新增条目只能依据被引用的原始事件。

#### KV Cache 影响

关闭整理时，插件不改变官方摘要请求。开启时，在末尾追加有界附录，保留原请求前缀；笔记及生成的增量会增加 token。增强输出无效可能产生额外一次普通摘要请求。停用插件会移除后续笔记注入，但不会抹除已记录的历史。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- 绕过基础摘要钩子的自定义压缩器不会得到增强。兼容 Notebook 预设仍用于已保存会话，新会话可采用官方模式。开关作用于整个配置目录，不能逐会话设置。子串召回仍受来源及检查点容量限制，短查询仍限于窗口。项目要求真实 Workspace 登记和所属 Session。关联历史达到磁盘上限时拒绝进一步写入，损坏权限记录不会重置为空。全日志成本仍在，回归不代表长任务准确率、费用或冷读峰值资格。
- 启动补齐、耐久观察和冷 JSONL／查询准备仍随完整历史增长。候选重建从实际提交游标之后开始，但取得原始耐久前缀仍需全量观察。热态 committed 与 status 读取避免这一扫描。历史验证为显式操作；轻量读取验证选定指针。

<a id="dev-note"></a>
### 开发备注

本私有包随 Nidofy 桌面 bundle 分发。更新上游时，先验证基础摘要事件及独立插件卸载，再构建桌面候选版。
