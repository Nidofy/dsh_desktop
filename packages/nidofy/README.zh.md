---
description: "基于官方 Harness 服务的 Nidofy 发行扩展。"
kind: "package-group"
---

# nidofy/

[English](README.md) | 中文

## 概述

私有发行包将可选个人功能隔离在官方主引擎之外。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

- [桌面 bundle](desktop-bundle/README.zh.md)通过 profile bundle 选择可选插件。
- [工作笔记](working-notebook/README.zh.md)负责跨官方模式的可选笔记与压缩整理。
- [桌面扩展](desktop-extras/README.zh.md)负责诊断、合成实验、识图、桌宠及暂停计划导入。
- [安全凭据](secure-credentials/README.zh.md)在显式 overlay 下以 Windows DPAPI 保护受管引用与 record。

[启动子系统](../../docs/subsystems/boot.zh.md)负责 profile 解析；[网页客户端子系统](../../docs/subsystems/web-client.zh.md)负责客户端生命周期和认证通信。

<a id="dev-note"></a>
## 开发备注

这些包不实现 Agent Loop 或 Session writer。原生发行适配仍位于 Desktop Main 与 Host。

[Workspace 约束检查](../../scripts/check-workspace-constraints.ts)要求本组包名为 `@nidofy/dsh-<directory>`，设置 `private: true` 且不含 `publishConfig`。官方 npm 发行要求保持独立。
