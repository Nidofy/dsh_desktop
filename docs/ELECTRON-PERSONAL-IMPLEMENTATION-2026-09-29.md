# 个人联网迁移阶段实施记录

日期：2026-09-29。状态：**此文保留初始个人联网候选的历史验收结果；M2 已后续完成，当前包及范围见 [M2 实施记录](ELECTRON-M2-IMPLEMENTATION-2026-09-29.md)。内网现场验收仍暂缓。**

当前沿用官方 `dsh-v0.2.0-rc.1`、`4878cdabd87d4041bdaff61d04c966883b9fd07a`，不改变已固定的主引擎版本。实现位于独立 `electron` checkout，未提交、推送或发布。旧 Tauri 工程和用户数据未导入或替换。

## 本次交付

同一套 Main、Host 和打包脚本支持 `upstream`、`intranet`、`personal`。新增个人发行身份 `Nidofy DSH Desktop`，使用独立 App ID、URL 协议、数据和产物目录。个人模式保留浏览器网络访问、官方模型配置界面、公网工具及在线插件接口；不再套用内网 Chromium 请求白名单。继续关闭官方账号入口、分析、反馈上传和官方自动更新，完整包更新方式保持不变。

本地 `.env.windows` 已选用 `personal` 示例配置。默认数据目录为 `%APPDATA%/Nidofy DSH Desktop/{electron,harness}`；运行示例测试时使用独立临时根目录，没有读取真实 API Key。

可运行产物：[Nidofy DSH Desktop.exe](../electron/apps/desktop/.desktop-build/targets/win-x64/personal-unsigned/win-unpacked/Nidofy%20DSH%20Desktop.exe)。必须保留整个 `win-unpacked` 目录，不能单独复制 exe。该产物是未签名开发候选包，不是安装器或正式发布。使用与验证契约见[个人版验证参考](../electron/migration/personal/README.zh.md)。

## 实测结果

| 范围 | 结果与边界 |
|---|---|
| 发行及构建回归 | 4 个测试文件、58 项通过；覆盖身份隔离、个人/内网产物隔离、环境及更新策略 |
| 类型与静态检查 | Desktop TypeScript 构建、定向 oxlint 通过；类型标注修正后 Main bundle 字节未变化 |
| 官方运行时检查 | 内置 Node、koffi、sharp、HTML、PTY、pnpm、grep、glob 通过；DOCX、XLSX、PPTX 转 PDF 和技能 CLI 发现通过 |
| 真实桌面与公网 | 无账号直接进入工作区，官方输入框可用；Chromium 实际请求 `https://example.com/` 返回 HTTP 200 |
| 模型与凭据 | 经官方设置/凭据 RPC 配置两个同名模型，OpenAI 和 Anthropic 分别使用独立 Key、严格协议路径，完整流式回合持久化通过；没有真实付费模型调用 |
| 配置冲突与换 Key | 旧设置 revision 写入被拒绝；下一轮使用新 Key；不等于在途重试固定 credential lease 已完成 |
| 重启恢复 | 配置、凭据和历史保留，重启后继续请求成功；官方 Models 页面显示两种连接 |
| 在线插件 | `pluginManager/listBundles` 可用；没有把接口可用解释为第三方插件安装成功 |

证据集中在[摘要](../electron/migration/personal/evidence/summary.json)、[集成结果](../electron/migration/personal/evidence/integration.json)、[模型页面](../electron/migration/personal/evidence/models.png)、[运行时日志](../electron/migration/personal/evidence/runtime.log)和[测试日志](../electron/migration/personal/evidence/tests.log)。只归档脱敏结果与截图，不归档测试 home 内的凭据文件或原始 Host 认证地址。

文档门禁：本轮 Desktop README 和个人版 README 两组中英文配对检查通过。全仓 `test:docs` 为 18 项通过、2 项失败；剩余失败仅涉及此前 M0 README 缺中文配对，以及 M0/M1 不可变来源及证据中的 commit hash 与仓库引用规则冲突。本轮新增证据引用已有来源锁，未新增该类冲突，也未放宽全仓规则。详见[文档检查日志](../electron/migration/personal/evidence/docs.log)。

本轮复用同一固定基线、M1 已验证的 Host/runtime 准备产物，重新打包个人 shell 和最终 overlay，并重新执行整个目录包的官方运行时检查。没有宣称重新构建所有第三方依赖。实际会话验收使用官方 projection 游标及 history page；默认未打开全文索引，因此未将 session search 当作历史持久化依据。

## 构建事件与修复

最初尝试移动旧 M1 包时，该包有用户进程正在运行，Windows 锁定部分文件。PowerShell 的非终止错误没有阻止随后的构建器，构建器清理了部分未锁定文件后失败。没有终止用户进程。

已从保留的同版本 M0 包恢复 9756 个缺失运行时文件，未覆盖旧 M1 的 `app.asar` 和 exe，两者哈希均与原 M1 证据一致。恢复后的 M1 官方运行时、Office 和技能检查通过。后续构建改用个人独立输出目录；涉及目录操作的命令启用终止式错误处理，并在移动前核实完整路径。个人输出曾因路径过长导致 Python `lxml` DLL 加载失败，缩短至 `personal-unsigned` 后复验通过。

## 下一步顺序

1. 继续 M2 的连接不可变 revision、credential lease、在途及重试归属、撤销/退休语义，沿官方 provider/prepare-call 接缝实现，避免复制 Agent loop。
2. 补齐跨凭据/设置的 journal、CAS、ACK 与崩溃恢复，以及旧 catalogProvider/preparePayload 的兼容切片。现有单 namespace CAS 不能冒充跨文档原子事务。
3. 实现旧 Tauri 数据只复制导入：预检版本、拒绝未来格式、可重复执行、保持源数据及历史自动化暂停。当前未自动读取旧 Key、会话或计划。
4. 使用明确配置的外网模型、MCP、搜索及插件服务做真实 endpoint 测试；随后推进工程、Git、构建与保护等迁移功能。没有服务凭据时以模拟协议测试与真实公网可达性分别记录。
5. 恢复企业交付时重新启用 M1 现场网关和干净断网机验收；个人版通过不替代企业出口规则验证。

后续跟随官方升级仍保留固定 tag/SHA、完整 Host/runtime 一起升级、发行策略条目核对和打包后回归。当前改动集中在发行元数据、Main 网络策略、打包路径和最终 composition；官方连接 UI 与核心模型引擎继续直接复用。
