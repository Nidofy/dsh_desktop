---
kind: upgrade-guide
description: "新工程预览要求显式副本及 Session 资源检查点限额。"
---

# 显式工程资源限额

[English](guide.md) | 中文

## 变更

`engineering-prepare` 和每个 `matrix-prepare` 行现在要求独立于原请求／输出预算的 `resourceBudget`。旧请求格式会拒绝，不分配副本或发送。既存工程、矩阵、T11 和官方 Session 记录格式保持。旧工程日志缺资源分配 sidecar 仍可读取，资源为未知；新准入拒绝这些未计量分配，不接纳或删除它们。

新预览还要求 `shellBudget`，用于完整 Shell 输出及保留 spill 费用。缺原始 Shell 计量时拒绝新准入；旧记录仍可读取，Shell 观测保持未知。输出耗尽后保留已完成动作结果和 T11 回执，只拒绝后续工作。

工程 Session 读取现在要求完整解码前取得真实物理长度，并拒绝元数据修订变化。冷读保留 2 MiB／4,096 事件扫描上限；物理较小的压缩文件仍在官方解码后检查完整逻辑大小。没有请求截点的资源观察也会重验，不直接返回未经检查的值。

## 迁移

1. 为每个工程预览请求补齐六项 `resourceBudget` 限额及两项 `shellBudget` 限额，矩阵行也相同。当前本机页面提供可编辑的值。例如：

```json
{"resourceBudget":{"workspaceBytes":33554432,"workspaceEntries":1024,"retainedWorkspaceBytes":536870912,"sessionBytes":2097152,"sessionDiskBytes":2097152,"sessionEvents":4096},"shellBudget":{"outputBytes":8388608,"retainedSpillBytes":134217728}}
```

2. 预览并显式确认完整输入、已审阅命令及全部显式预算。运行结束后，保留工作区和 Shell 额度仍计入费用。此前分配缺资源 owner 或超额时，保留原文件并检查拒绝；没有自动修复、删除或重试。
3. 读取原工程日志及资源检查点。排空副本长度、Session 物理长度和逻辑快照字节分别观察。运行期间磁盘和 Host 内存峰值仍为 null。完整行为及限制归[工程 owner](../../../../apps/desktop-host/src/experiments/README.zh.md#isolated-engineering-task)所有。
4. 读取因缺失或超额物理元数据而拒绝时，保留原 Session 和日志，检查官方持久化 owner。读取、提高确认检查点预算或没有请求截点均不授予自动修复、裁剪或重放权限。
