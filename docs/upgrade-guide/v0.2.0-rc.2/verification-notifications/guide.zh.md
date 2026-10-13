---
kind: upgrade-guide
description: "持久回执通知替代工作台瞬态轮询和原始 renderer 通知 IPC。"
---

# 工作台持久验证与通知

[English](guide.md) | 中文

## 变更

认证后的 `workbench/notifications` 响应改为分页通知对象，不再是瞬态 turn-end 数组。通知偏好在 home 内共享、带修订并持久保存；旧进程内复选框与原始 `nidofy:notify` renderer IPC 不再生产通知。工作台关闭时，Main 仍消费已提交回执通知和原始持久 Session 终态通知。会话轮次完成不表示项目验证通过。

旧动作记录／日志仍可作为执行事实读取。它们没有运行前意图，不能补造通过回执。新验证记录与保留日志独立存放在 `desktop-actions` 下，不随 100 条动作历史裁剪删除。

新通知文件使用 schemaVersion 2，增加后台 job 身份以及 blocked、limit、interrupted、unknown 原因。当前读取方保留并读取 v1 记录。首次使用前保留升级前 home 备份：只接受 v1 的旧构建不能打开新 v2 记录。保留旧便携程序不表示支持在同一 home 上降级。

## 迁移

1. 重新打开工作台，如需通知则显式启用。偏好默认为禁用。编辑冲突时先刷新；`notifications/configure` 要求已观察到的 `expectedRevision`。
2. 自定义消费方改为读取分页通知响应，并区分来源 ID／类型、系统交付、角色可见和已处理状态。移除 `nidofy:notify` 调用；由 Main 使用 Host 的 claim／settle／cursor API。启动／重连时建立新基线，不弹出历史。不要重试结果未知的 OS 尝试。
3. 使用回执时，为动作添加显式审阅的 `verification` 范围。受支持解析器、输入／工具链覆盖与独立验收见[owner 参考](../../../../apps/desktop-host/src/workbench/README.zh.md)。即使命令零退出或解析测试通过，不受支持的提供方枚举仍保持 UNKNOWN。
4. 确认新的实际运行具有已提交回执和保留日志，再修改选定输入并观察 STALE。验收／拒绝另行记录。保留原数据与回执；不会自动删除、重放执行或迁移来源日志。
