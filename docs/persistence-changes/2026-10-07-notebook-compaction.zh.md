---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-07-notebook-compaction

[English](2026-10-07-notebook-compaction.md) | 中文

## 概述

登记 required 的 nidofy/notebook-compaction 事件，保存准确的辅助请求与压缩决策。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-07-notebook-compaction
baseline: false
changes:
  - root: "event:nidofy/notebook-compaction"
    previous: null
    after: "1c3218e0484d634fadfddd61203ed85c5ba34b42c16fcbe384aa927be38fb66d"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有事件及 header 均不变，旧日志继续有效。新请求事件保留笔记候选验证与恢复所用的准确模型输入。不认识此 required 事件的旧构建拒绝读取日志；不添加 ignorable 标记或降级支持。新增 root 不要求提高 Session 结构格式版本。

<a id="verification"></a>
## 验证

整合后的定向 Vitest：18 文件、182 项通过。压缩协议 fixture 不再添加 ignorable:true，使用 required 请求事件并通过真实 JSONL provider 冷读取。生产代次接线及 v2 激活仍待完成。

<a id="dev-note"></a>
## 开发备注

无。
