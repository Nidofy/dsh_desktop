---
kind: upgrade-guide
description: Windows 工作区授权现在要求可恢复租约，并拒绝没有原始备份的旧版权限。
---

# Windows 工作区权限恢复

[English](guide.md) | 中文

## 变更

Windows ACL 工作区授权不再永久保留能力 ACE 和 Low 完整性标签。首个活跃 owner 在授权前保存每个对象的 DACL、mandatory label 及相关继承控制，最后一个 owner 释放后恢复这些字段。模式变更释放会话准入；已准入的运行器持有租约直到其子进程 job 关闭。启动时恢复异常退出遗留的租约。owner、group 和 audit ACE 不会写入。

旧版本授权没有原始快照，会被拒绝并保留原状；新版本无法推断原始权限。恢复冲突保留日志，不允许覆盖外部 ACL 改动。

直接调用自管理 `AclSandbox` 的 workspace-write 现在要求 `writableDirs` 恰有一个条目，并使用 `workspaceWriteSid(realpathSync(root))`。seam 管理的运行器调用除两个 SID 标志外，还必须传入 `--workspace-lease`。`AclWriteGrant.add(path, true)` 现在获取可恢复租约。

## 迁移

1. 升级前结束正在运行的受限命令。使用 `icacls "C:\path\to\workspace"` 只读检查受影响根目录；没有备份的 `S-1-4-*` 能力项需要迁移。恢复经核验的原始安全备份，或只把文件内容复制到全新目录，不复制安全元数据，再重新打开。内容和权限检查完成前保留旧目录。没有备份时，操作者必须明确确定预期权限；新版本和 ACL 诊断脚本均不能补造丢失的历史 mandatory label。内置诊断脚本会执行修复，不是只读检查命令。
2. 直接调用方改用一个规范工作区及其派生 SID，等全部子进程退出后再调用 `dispose()`。自定义运行器适配层必须把 `AclWriteGrant.authorization(root)` 返回的存活 owner 作为 `--workspace-lease` 传入；已释放的 owner 不可重用。
3. 保留 Windows Local AppData 下 `DeepSeek/Harness/acl-recovery-v1` 中的活跃恢复记录。同一 Windows 用户的安装共享该目录。不要跨用户复制日志或手工删除失败记录。恢复成功后删除完整日志，仅保留小型摘要。
4. 在干净测试工作区执行一次受限写入，释放最后一个租约后检查原始 DACL 与 mandatory label 已恢复。首次授权和最终恢复随目录树大小增长，活跃重入不重新标记整树。身份、冲突、旧版及平台限制见[包契约](../../../../packages/sandbox/sandbox-windows-acl/README.zh.md)。
