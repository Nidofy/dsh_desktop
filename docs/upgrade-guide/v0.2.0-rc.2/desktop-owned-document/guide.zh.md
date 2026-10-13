---
kind: upgrade-guide
description: "Desktop 启动拒绝不归属 Main 的完整应用窗口和过期文档。"
---

# Desktop 启动要求归属的应用文档

[English](guide.md) | 中文

## 变更

Desktop 启动 IPC 原先接受其他 `dsh-app://app` 页面，但其语言信息与 Host 流仍被拒绝。启动和语言 IPC 现在要求 Main 主窗口中位于 `/` 或 `/index.html` 的当前顶层文档。重载或销毁使未完成的读取失效。应用页面向不可用或已替换 Host 地址发出的 WebSocket 请求会被取消，包括携带旧 cookie 的请求。仅供主窗口使用的产品 IPC 保持原有所有权。

## 迁移

1. 使用既有 Main 创建的 Conversation 窗口。不要创建第二个完整 root 来取得启动注入或连接 Host 流。工作台及其他辅助页面保留既有 HTTP 和作用域导航路径。
2. 重载主窗口后，使用新文档的启动信息与 Companion scope，不复用旧文档的 scope 或 Host 地址。
3. 确认主 Conversation 能重连并打开工作台。独立创建的完整 root 必须以 `DESKTOP_APPLICATION_DOCUMENT_REFUSED` 拒绝启动和语言读取，并且不能建立 Host 流。无需转换持久数据。
