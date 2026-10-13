---
description: "通过官方 profile Loader 选择可选 Nidofy 桌面能力。"
kind: "package-bundle"
---

# @nidofy/dsh-desktop-bundle

[English](README.md) | 中文

## 概述

本配置 bundle 安装桌面扩展、持久化字面历史检索、五个官方历史工具，以及从固定官方组合生成的可选 Notebook 预设。派生桌面版在受管理 profile 中首次登记；后续移除及原生恢复的选择持续保留。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

插件管理器在 `dsh.profile.bundles` 中选择本 bundle。其补丁启用历史和独立的[工作笔记插件](../working-notebook/README.zh.md)。诊断、识图、缓存实验与桌宠仍需按需启用。官方预设保持不变。自动整理笔记初始关闭，通过笔记开关启用；旧 Notebook 预设保留以兼容已保存的 Session，并遵循同一开关。更新上游后运行 `node packages/nidofy/desktop-bundle/generate-context-presets.mjs --check`。按[插件指南](../desktop-extras/README.zh.md)逐项启用。

导出的 [secure-credentials overlay](secure-credentials.patch.yml)仅在显式选择时替换凭据行。它使用 [Windows provider](../secure-credentials/README.zh.md)，并要求显式 `DSH_HOME`。Bundle 的默认 patch 列表保留现有 provider。隔离 Loader 检查不授权自动迁移或默认启用。

Bundle 要求 `DSH_DESKTOP_PROTECTION_HELPER` 指向应用拥有的 Windows helper，并安装共享[受管配额 owner](../../../native/nidofy-protection/README.zh.md)。工作笔记和扩展在启用前注入此 owner。搜索使用官方 provider 的 `:memory:` 索引；旧磁盘索引继续计量并保留。冷搜索重建会占用内存。旧导入采用显式有界准入及独立原位接纳，不改变当前运行 home；参见[升级指南](../../../docs/upgrade-guide/v0.2.0-rc.2/nidofy-quota/guide.zh.md)。

<a id="model-experience"></a>
## 模型体验

### 启用

#### 模型可见内容

启用五个官方历史工具，以及 `notebook_read` 和 `notebook_update`。笔记以回合边界日志快照进入上下文，历史工具返回有界且带来源的内容。

#### Token 影响

启用时不发送模型请求，不消耗 token。

#### KV Cache 影响

工具定义会改变请求前缀，新增笔记快照和召回证据会消耗模型输入 token。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- 本私有 bundle 随派生 Windows 桌面版分发，尚未独立发布 npm。

<a id="dev-note"></a>
### 开发备注

Bundle 与插件采用不同包标识，配合官方 profile 解析对 bundle 依赖的遍历。不发布 invariant companion，因为本包没有可变运行状态。
