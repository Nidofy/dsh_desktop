---
kind: upgrade-guide
description: "Desktop 服务存在检查入口改为拒绝，正式本机自检使用持久运行身份。"
---

# Desktop 自检使用持久运行身份

[English](guide.md) | 中文

## 变更

`POST /api/nidofy-extras/selftest` 不再返回六行标为 PASS 的服务存在检查，改以 `SELFTEST_USE_FORMAL_RUNNER` 拒绝。正式本机 runner 提供 25 项独立范围结果、持久意图／检查点、只读中断恢复及零模型预算。报告使用独立 `nidofy-extras/selftests` 存储，不迁移已有用户数据。

已确认的受管连接检查发布 schemaVersion 2 报告，预算为一至五次请求，每次最多输出 64 token。本机 schemaVersion 1 报告保持只读兼容，不改写；旧程序拒绝版本 2。完整合成请求输入保留在独立私有官方 JSONL 日志中，始终不进入导出。不改变 Session 格式。

## 迁移

1. 打开「个人扩展 → 本地自检」。直接消费者使用 `/api/nidofy/workbench/selftest/start`，提供 `mode: 'local'` 与新的 UUID `operationId`，发送前保留该身份。
2. 响应未知后，使用 `id` 调用 `read`，不再 `start`。`list`、`cancel` 与 `export` 使用同一认证命名空间。连接检查先调用 `connection-options`，再调用 `connection-prepare`，确认返回的模型、连接及 HTTP 修订和预算，以 `mode: 'provider'`、`ticket` 和 `accepted: true` 启动。票据两分钟后过期且不能复用，须显式禁用路由重试。
3. 确认 `kind: 'electron-self-test'`、全部 25 行及两项 UNKNOWN 现场行。本机模式为 `budget.modelRequests: 0`，连接模式为 `modelRequests: 1..5` 和 `maxOutputTokens: 64`。COMPLETED 不表示全部 PASS。见 [owner 参考](../../../../apps/desktop-host/src/selftest/README.zh.md)。
4. 版本 2 读取方保留缺计数及失败／未知请求，不重试或重放，导出省略私有输入。回退使用旧程序与原数据副本，不能原位读取新报告。
