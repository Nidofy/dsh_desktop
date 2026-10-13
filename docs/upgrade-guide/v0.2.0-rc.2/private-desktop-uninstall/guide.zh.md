---
kind: upgrade-guide
description: 私有 Windows Desktop 卸载程序保留应用数据及缓存，不再删除它们。
---

# 私有 Windows Desktop 卸载保留数据

[English](guide.md) | 中文

## 变更

Personal 和 Intranet Windows Desktop 卸载程序现在保留产品数据目录、Electron 包数据与更新缓存。此前私有安装器继承上游清理策略，可能删除位于产品目录中的默认私有 Harness 主目录。此变更不修改上游发行版的清理策略或持久化格式。

## 迁移

1. 改动安装前，保留现有私有数据根及独立备份。默认根为 `%APPDATA%\Nidofy DSH Desktop` 和 `%APPDATA%\Nidofy DSH Intranet`；另行保留通过 `--nidofy-desktop-data-root` 或 `NIDOFY_DESKTOP_DATA_ROOT` 显式指定的目录。
2. 使用带保留策略的新构建私有安装器。不要运行旧私有卸载程序来删除数据。生产身份安装及旧安装替换仍须在干净账号或 VM 中验收；内部未签名候选不具备发行资格。
3. 卸载新安装版本后，确认应用安装已移除、私有数据根仍存在。卸载不再重置私有设置或清除会话；后续删除数据必须另行明确执行。当前行为见 [Desktop 安装约定](../../../../apps/desktop/README.zh.md)。
