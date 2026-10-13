---
kind: upgrade-guide
description: 工作笔记使用独立预算，并在 v2 API 中采用 Session 物理代次身份。
---

# 工作笔记 v2

[English](guide.md) | 中文

## 变更

私有 Nidofy 工作笔记插件使用 v2 活动笔记、历史和两个证据游标。Config 将 `maxEntries`、`maxBytes` 替换为 `maxActiveEntries`、`maxActiveBytes`、`maxDeltaBytes`、`maxEvidenceBytes`、`maxHistoryBytes`。更新 API 要求传回读取 API 提供的 scope，使用 `cursors.evidenceThrough`；读取 API 返回 `active`，不再返回 `entries`。

Notebook scope 携带官方持久化 provider 的不透明物理代次。既有 v2 文件中的数字代次无法证明此身份，因此原文件保持不变并返回 `NOTEBOOK_GENERATION_REBIND_REQUIRED`。物理代次改变时返回 `NOTEBOOK_SCOPE_CONFLICT`。这两种拒绝都不会重置已提交游标或删除历史。

## 迁移

1. 将工作笔记 Config 的自定义覆盖更新为五项新字段，分别限制活动条目数、完整活动注入字节、delta 字节、证据附录字节和历史磁盘字节。没有覆盖的 profile 使用已校验默认值。
2. 自定义 API 客户端须保存完整 scope 和 revision，每次编辑一同提交；冲突后重新读取。随附 Panel 和工具已采用该协议。
3. 既有 v1 文件通过复制转换到 v2 命名空间，源文件保留。既有数字代次 v2 状态，或被替换、恢复的 Session 对应状态，必须先显式核对证据才能重新绑定；当前不提供自动重绑。保留文件，解决诊断后再使用该 Session 的笔记。
4. 验证新 Session 可以保存编辑、重开后读取，并在下一回合注入。相同文件系统上的追加和冷启动保留物理代次身份；复制 Session 文件会产生新的物理实例。
