---
kind: upgrade-guide
description: "Nidofy writer 要求共享原生账本；导入接纳会追加旧 helper 拒读的 v2 记录。"
---

# Nidofy 受管存储准入

[English](guide.md) | 中文

## 变更

Nidofy Desktop bundle 用物理发行根下的共享 Windows 账本替换进程内准入。其存储插件要求 DSH_DESKTOP_PROTECTION_HELPER。没有 Host 能力的原始 native 修改拒绝。已有 Notebook 代次保留；适配器可返回结算租约。

Helper 读取已有 v1 日志前缀并追加 v2 记录，保留历史字节。旧 helper 拒读 v2。导入与授予共用操作身份，要求显式累计字节上限和独立确认的原位接纳。已接纳 home 使用原账本，绝不开嵌套账本。接纳不为当前 Host 选中该 home。

产品使用内存搜索索引并保留旧磁盘索引。原生 importArchive 要求 verifyArchive 返回的 expectedRevision；导入快照不恢复工程文件。宠物 ZIP 导出必须选择发行根之外的目标。

## 迁移

1. 随当前 Host/profile 提供重新构建的 protection helper。保留 storage 行及所需注入。为新账本设置 limitBytes 和 safetyBytes；现有额度经显式配置修改，不撤销终态授予。
2. 保留物理根与 .nidofy-storage-v1/ledger.jsonl，不重置或重绑。降级需使用升级前保留的发行数据副本，不能让旧 helper 写入 v2。
3. 在「连接与数据迁移」选择声明的来源版本 0.2.0 或 0.2.5-rc.1，预览类别与配置命名空间。预览验证清单/设置；执行另由官方读取器验证会话内容和复制摘要。未知版本/格式及歧义设置命名空间拒绝，原目录保留。保留操作 ID，填写累计写入上限并确认复制。上限包括副本、编码后继及临时元数据；sourceBytes 不是该上限。响应未知时查询；仅在旧 owner 退出后显式恢复。中断的复制不能续写。既有 standalone imports 不能通过伪造记录取得权限。
4. 读取已提交报告，再独立确认接纳。勾选明确的下次启动选择，准备返回的 home、数据根和 --nidofy-desktop-data-root 参数，退出后传给已有 Desktop 启动器；普通 CLI 使用 DSH_HOME。这里不启动进程或切换当前 Host。Home 层 cordis.patch.yml 提供副本 Session root/编码。在所选 home 启动后，通过独立 owner 审阅实际工作区命令及保护路径；导入的 review 副本保持未激活。计划只从明确 JSON 清单导入为暂停，逐项选择主会话、新未来规则及独立确认。重新绑定 Key。固定导入保留费用继续存在；兄弟 electron 运行目录沿用普通排除规则。不自动激活计划、重绑 Notebook 或删除保留费用。
5. 通过「存储与配额」显式核算。Inventory 实时文件长度与账本保留费用不同。归档先校验，再传 expectedRevision；恢复工程文件另行确认。身份、阶段与恢复见[原生协议](../../../../native/nidofy-protection/README.zh.md)。账本同步确认不为普通导入元数据或 rename 添加断电保证。
