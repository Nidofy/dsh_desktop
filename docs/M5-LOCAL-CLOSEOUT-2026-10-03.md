# M5 本地基线收尾

状态：本地源码、未签名安装包和升级回退证据已封存；不是签名发行或企业内网验收完成。

## 已验证

- 文档门禁 `doc-sync`：43 项通过。历史迁移 JSON 保留原字节，通过路径白名单和 SHA-256 校验后免于当前提交引用规则；组织地址检查仍生效。规则测试 11 项通过、1 项 Windows 符号链接测试跳过。
- 实际 rc.1 → rc.2 独立数据副本升级：历史会话、模拟连接凭据、保护配置和快照可继续使用；rc.2 重启后继续任务。
- 主窗口首次关闭确认后隐藏、重新显示和继续任务；模拟 suspend/resume 后继续任务。
- 旧 rc.1 配合升级前数据副本成功恢复；升级前备份摘要保持不变。未对真实用户数据做回退或覆盖。
- NSIS 未签名安装包构建成功。构建使用隔离预打包副本，未安装、未发布。

证据：[升级结果](../electron/migration/m5/evidence/upgrade.json)、[源码快照](../electron/migration/m5/evidence/source-baseline.json)。源码归档包含逐文件 SHA-256 清单，可恢复附件开发前状态。

基线 rc.2 app.asar SHA-256：`873ae1b64eeb7306503959d7d96e11a31b4a50f0beaaee3695ceeeb4a85bd16a`。安装包 SHA-256：`854a9c63d8110e27630caab7666a8c75d1a6a21cd17ae976d703b757d5df6c67`。

安装包位置：`electron/apps/desktop/.desktop-build/targets/win-x64/candidates/m5-local/installer/nidofy-dsh-personal-0.2.0-rc.2-win-x64-unsigned.exe`。本机编译工具缓存下载曾超时；重试并明确关闭未签名构建的签名调用后成功。

## 保留的发行验收项

真实干净 Windows 安装/卸载、真实系统睡眠唤醒、签名及发布、真实企业网关出口均未验收。事件模拟不能替代真实睡眠；构建成功不能替代安装验证。上述项目不阻断在隔离候选包中实施附件功能。

## 后续开发

按 N0 历史检索 → N1 工作笔记 → N2 压缩适配 → N3 召回评估推进。继续使用官方 Session 日志、精确 cwd 权限、预设配置和压缩事务。新的模型输入必须日志化；不以可编辑外部文件替代历史重放依据。
