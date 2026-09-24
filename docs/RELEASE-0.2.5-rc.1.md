# 0.2.5-rc.1 源码引擎隔离候选

此候选继续使用 Tauri 2、固定 Node 和固定 WebView2。Harness 是唯一 Agent Loop。功能和资格结果见 [实施记录](IMPLEMENTATION-0.2.5.md)。这是独立本地候选，未推送或在线发布。

## 固定组合

Desktop 0.2.5-rc.1 / Harness 0.1.7-alpha.2；fork `5e2879f0478ba9336128312e715dee7a9f56c3db`；Node 24.16.0 / WebView2 153.0.4234.48 / Tauri 2.11.5。fork 接口和桌面里程碑均为本地提交，未推送。

## 功能范围

- 双击默认进入版本独立候选，自有 dsh-desktop profile 与候选内默认工作区；正式版数据和旧发布目录保留。
- 旧设置、工作区和会话副本迁移保留原文件；受支持旧代升级，新未知格式拒绝。不可通过替换 EXE 将候选数据降级给旧版。
- 多连接独立路由保留内置模型的推理、模态与兼容字段；同一进程网络配置下，密钥、端点、模型与缓存策略在下一请求生效，旧请求保持快照。代理/CA 改变仍重载。
- 保留工程操作、产物、变更查看、快照、恢复、主题、通知、桌宠和按需环境浮窗。
- 源码产物、桌面模块、固定运行时、完整构建与交付目录各有校验记录；启动不下载依赖，不回退系统 Node。

## 验证状态

- 完整构建：PASS，回执 `faaf05d4-9328-43ff-88ef-e0c20e3ea121`；[日志与回执](evidence/0.2.5/build-receipt.json)。Rust 93 项、单独的双协议原生快照集成、38 项前缀及完整协议/迁移/恢复检查均通过。
- 原生 Windows：PASS，实际回执 EXE 完成合成工具任务、浮窗、快照入口、桌宠拖动/关闭、受控重启、历史打开及正常退出；[证据与具体边界](evidence/0.2.5/native-final-verification.json)。连接首次保存/热应用在同源码与资源的预验收 EXE 验证，完整 Gate 另覆盖最终双协议热更新。
- EXE SHA256：`cbaec9533f4f9700ceaeca56fe4a288be93480b5cd5cbd35413f0e3e9f377d95`。
- 交付形式：独立 `DSHDesktop-0.2.5-rc.1-win-x64` 目录。只有目录完整性、许可证和受限 PATH 离线 smoke 成功后，打包脚本才登记 `.build/latest-staged-package.json`。交付目录包含 `BUILD_RECEIPT.json` 与 `Verify-DSHDesktop.ps1`，可自行复查。
- 真实内网及企业现场：未完成验收，具体范围见下文；不以本机 PASS 代替现场结论。

## 明确限制

真实内网网关、缓存命中收益、睡眠、混合 DPI、触控/笔、长期负载和干净企业镜像未在本候选完成现场验收。本机 loopback mock 与受限 PATH 检查不等于全系统防火墙或 WebView egress 验证。主连接凭据在 Windows Credential Manager；识图凭据仍由 Harness 本地 YAML 服务管理，工程原始日志的隐私范围不同于元数据诊断。

额外 Harness SDK `text-turn` 回放的 feedback 断言失败已独立记录，原因尚未定位，不能计为 SDK 通过；见 [fork 检查记录](evidence/0.2.5/catalog-provider-fork.json)。本候选的实际桌面 Gate 及原生结果分别记录。可选 Office 依赖包、嵌入浏览器、语音及官方 Electron 的其他扩展功能不属于本轮 M1 的 T1–T6。
