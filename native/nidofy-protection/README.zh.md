---
description: "Windows 发行根配额日志、所有者证明、原生能力与恢复规则。"
---

# Nidofy 配额日志

[English](README.md) | 中文

## 所有权

Desktop Host 的[存储服务](../../packages/nidofy/desktop-extras/src/storage.ts)通过应用拥有的 Windows helper 授予受管容量。普通 `DSH_HOME` 的规范父目录是发行根；Windows 卷序列号与文件索引标识其物理身份。兄弟 home 登记到同一份 `.nidofy-storage-v1/ledger.jsonl` 账本。新增 home 登记需等现有授予结算。位于 `imports/<operation>/harness` 的导入 home 是唯一例外：只有显式 adopted 记录匹配两个目录身份后才解析到原根。它不能初始化嵌套账本或移动原账本。

[受管允许列表](src/quota.rs)包含连接文档、工作笔记、含宠物资源的扩展数据、操作与变更记录、产物暂存、快照范围及快照，以及保留的 SQLite 索引文件。官方会话、附件、storage、运行时、工程数据、`.env` 和凭据不计入此受管预算。未知 home/cache 条目、链接、不可访问路径及不稳定观察均拒绝核算。Inventory 端点是独立只读观察，绝不授予容量。

## 格式确认

当前原生格式使用 [schema version 2](quota.schema.json)。每行依次为小写 SHA-256 摘要、一个空格、UTF-8 JSON 记录体和 LF。Owners、leases 与 imports 按 epoch 或操作身份合并新增或更新；homes 为只增集合。标量替换之前的值。回放保留已结算授予，供丢 ACK 查询。摘要检测损坏，不是授权签名。Windows 创建时间是无符号 64 位整数，回放不能经过 JavaScript number 解析。

读取器保留并回放 v1 前缀，随后追加 v2 记录，不改写历史字节。旧 helper 拒绝 v2；降级需使用升级前保留的发行数据副本。未知 schema、phase、完整坏记录、版本倒退或物理根不匹配均拒绝访问，不重置账本。不完整末行未提交，在独占锁内截断。单条记录上限 4 MiB，日志上限 128 MiB；达到任一上限拒绝新写。不自动压缩、删除、迁移或重绑账本。Rust 序列化测试按 schema 核对真实字段与 phase。本文件不改变 Session header 或 event，不伪造 Session acknowledgement。

## 锁、提交与确认

Helper 持有既有祖先目录句柄以禁止重命名和删除，并以 Windows 禁止共享方式打开账本，拒绝重解析点和账本硬链接。独占文件句柄跨 Host 串行化读写。获取可因 busy 拒绝；经过时间绝不使 owner 过期。每次追加使用 write-through，并在回复前完成 `sync_all`。丢 ACK 后保留的完整记录会在查询回复前同步。这是账本的同步回执，不是给 Notebook 原子替换或其他消费者文件添加新的耐久保证。测试不证明物理断电、独立 SID 或安装包资格。

Reserve 计入已测字节以及所有未结算的普通与终态授予。磁盘可用空间还必须覆盖授予、配置的安全余量和每个未结算操作五条最大账本记录。每次导入日志追加都重新检查上述余量及本条完整记录字节。调用者在发送前创建操作身份。丢 ACK、helper 失败、无效输出或结算失败均保留计费；查询返回 reserved、settled 或 unknown，绝不授权重放。降低受管额度会阻止新授予，不缩减已有终态容量。

认证后的存储页面读取 `status`，不回收授予。该读取的 `QuotaStatus.measuredBytes` 为 null；`observedBytes` 是账本上次计量，普通与终态预留分别显示。打开客户端可能登记 owner，并依照既有锁协议同步或修复不完整日志尾部。显式 `recover` 可以结算已确认排空的操作并重扫；不完整扫描保留预留。页面同时显示账本占用及其固定上限。独立 inventory 描述本 home 与 imports，不是发行根的原子准入扫描。

## Owner 与原生权限

每个随机 Host epoch 绑定真实 Windows 进程句柄观察：PID、创建 FILETIME 和等待状态。权限拒绝表示未知，阻止回收。原生修改通过私有 stdin 接收操作身份和随机 token 组成的能力；持久化仅保存其摘要。UI/model 命令 JSON 不能选择包装器或授予预算。Helper 校验 home、命令范围、可用普通/终态字节和 owner 存活，再耐久记录自身创建身份，随后才开始修改。原始修改命令在打开快照存储前拒绝。

每次原生文件写入检查剩余额度；普通修改再次检查 owner 存活。已经通过检查的写入可能在 owner 退出后完成，因此回收前必须等其 worker 排空。Native end 只消费一次原 begin 授予的独立终态额度。结果未知的 end 不能重放该能力。新 helper 工作要求 Host 存活；已取得终态权限的 worker 可以在 Host 退出后完成终态记录。

## 结算与消费者限制

产品导入用同一调用者保留身份标识操作与配额授予。原生准入将新暂存目录绑定到物理根与目录身份；既有 final/pending 残留拒绝重放。显式累计字节上限涵盖每次复制、编码后继及完整临时元数据写入；每次扣减都在 writer 开始前持久记录。这是强制上限，不是源大小估计。产品协调使用账本锁，不另建 owner/takeover 锁文件。Windows Session 写锁是内核对象；verifier worker 只读。文件字节上限不包括文件系统分配开销与解码内存。

导入阶段为 copying、publishing、ready、interrupted 和 adopted。发布先同步记录 publishing 意图、目录/home 身份与 READY 回执摘要，再在同一父目录下 rename，最后记录 ready。丢 ACK 后查询，不自动重放。显式恢复在确认原 writer 退出后，才可从匹配的 pending 或 final 目录完成已记录发布。中断副本保留且不可续写。发布前取消需排空 writer 并标 interrupted；迟到取消不能撤销发布。READY 表示已验证副本，不代表产品选中状态或断电耐久。

接纳必须显式确认并保留原位；不修改 patch 的绝对 Session root，也不切换当前 Host。它要求授予排空且目录/回执身份匹配。既有 Session、附件、profile 等排除项字节成为可见的固定保留费用；后续官方排除项增长沿用普通 home 策略。扫描对已接纳 home 的托管文件只计一次，即使排除项后来消失也保留该固定费用。这项保守费用暂无释放机制。父目录 review/回执文件继续计量。工作区信任与保护范围隔离在 review 下；凭据、插件及计划不激活。只读 inventory 报告实际文件长度，不是这些账本费用。

已接纳 Desktop 数据根的兄弟 `electron` 目录沿用普通运行时排除规则。被锁定的 Chromium 状态不能阻断受管核算。扫描仍校验已登记的 import/home 身份，并计量 review、回执及 home 内受管文件；固定保留费用不变。

`import-review` 只读取 ready 或 adopted 操作，并持有已提交目录/home 身份的句柄。它先按账本摘要核对完整 READY 回执，再返回类别报告。报告使用 schema version 1，最多 16 个类别和 128 KiB；未知版本或超限报告拒绝。没有报告的旧回执返回 null。该读取不改变阶段或费用。`import-inspect` 仍是账本观察，不验证当前回执字节。

导入 home 将已验证配置保存在 Loader home 层的 `cordis.patch.yml`，使应用拥有的 Desktop profile 取得副本 Session root 和编码。返回的 home 使用启动环境消费者可用的 DOS/UNC 路径表示；原生身份检查仍使用规范路径。HTTP 导入修改在缺少 storage owner 时拒绝；只有独立库调用者可以选择局部导入行为。

Node 租约等待其登记的写任务；原生结算等待实际子进程关闭。如果仍有未完成工作的 owner 或已记录 worker 存活，核算不回收。只有所有 writer 排空后的完整扫描才能替换 measured bytes 并结算授予。扫描失败保留 finished 授予。物理文件身份在已登记 home 和 imports 间去重硬链接。配额绝不删除工程文件或重放操作。

产品接通 Notebook 发布/转换、设置、连接事务、ProjectActions、变更审阅、产物登记/暂存、偏好、探针、诊断归档、暂停计划、宠物导入/删除及所有原生修改命令。Notebook 准入拒绝先于崩溃尾部截断；之后结算失败不能推翻已选定 Notebook。准入失败时只读诊断仍可访问。没有此产品 owner 的独立库组合保留明确的局部行为，不属于跨 Host 配额参与者。

产品对官方 SQLite provider 使用 `path: ':memory:'`，临时表也在内存中。旧磁盘索引继续计量并保留。冷搜索重建与内存使用不受磁盘配额约束。产品导入要求显式预览指纹、操作身份、写入上限与确认。既有 standalone 副本没有产品权限，不能伪造操作记录来接纳。宠物 ZIP 导出必须选择发行根之外的目标。协作 writer 必须经过产品 owner；任意外部文件系统写入者及并发恶意路径替换不在此协议的容量保证内。

快照管理复用同一原生授予和既有逐文件恢复检查。归档校验返回绑定已持有句柄的物理目录及有效 manifest 的修订。导入必须将该修订作为 `expectedRevision`，并在创建任何快照字节前复核；预览改变时以 `PROTECTION_ARCHIVE_PREVIEW_CONFLICT` 拒绝。导入只保存快照，不恢复工程文件。恢复需要独立的当前预览、明确文件选择及确认。清理返回有界只读缓存／暂存候选清单；其变更标识不授予删除权限，目前没有清理执行器。这些管理 API 不改变快照与账本格式。
