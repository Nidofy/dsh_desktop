---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-13-provider-selection-identity

[English](2026-10-13-provider-selection-identity.md) | 中文

## 概述

为记录的 LlmCallConfig 增加可选 providerIdentity。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-13-provider-selection-identity
baseline: false
changes:
  - root: "event:request/header"
    previous: "2026-09-16-session-format-v4"
    after: "2f09e4b30487c64bcaf3edce3ba0c987fb7823f16cf37e4ceceb36228262ed2b"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

旧 header 保持有效；缺少身份时选择回放沿用原 provider。调度与已开始步骤重试继续使用记录的 provider revision。该可选字段不增加 Session writer 版本。

<a id="verification"></a>
## 验证

provider-identity-replay.host.spec.ts：两个真实 JSONL 存储与冷投影用例通过，保留真实 revision 和旧 header 行为；连接 owner 与缓存分区定向测试通过。

<a id="dev-note"></a>
## 开发备注

无。
