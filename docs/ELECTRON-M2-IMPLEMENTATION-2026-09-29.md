# M2 连接与数据迁移实施记录

日期：2026-09-29。M2 已完成 Windows x64 个人版的实现与本地验收，交付未签名连接试用候选包。官方主引擎仍固定在 `dsh-v0.2.0-rc.1`；完整来源见[基线锁](../electron/migration/m0/source-lock.json)。工程位于独立 `electron` checkout，本轮没有提交、推送或发布 GitHub release。

## 已交付

应用菜单新增 **连接与数据迁移**，提供中英文连接编辑、副本导入和文件保护设置。继续使用官方单一 Host、Agent loop、Session writer、模型选择器及认证通道。

| 范围 | 实现与保证 |
|---|---|
| 多连接 | OpenAI Chat Completions、Anthropic Messages；同名模型可绑定不同端点和 Key，路由显示为 `nidofy-<connection>` |
| 热切换 | 不可变配置修订和凭据租约；活动请求及同一逻辑请求的重试保持 A，新步骤使用 B，不重启 Host |
| 配置事务 | 单所有者串行 CAS；prepare/commit/reconcile 日志；ACK 包含操作、Host 代次、期望/生效修订和不含凭据的摘要；响应丢失可查询实际状态 |
| 凭据生命周期 | 官方凭据服务保存；界面不读回已存 Key；撤销阻止后续发送；仅在无引用、无租约且回退窗口结束后退休 |
| 旧补丁 | 窄范围移植目录继承 `catalogProvider` 与请求局部 `preparePayload`；通过公开组合辅助函数复用官方 pi-ai 适配器 |
| 副本导入 | 识别旧设置、连接目录和 `dsh-desktop` profile；复制 Session、附件、工作区及已启用保护范围；官方迁移链生成后继格式；源目录不写，重复及中断可恢复 |
| 导入准入 | 校验 schema、未知 writer、链接及观察到的写锁；内联秘密拒绝，旧凭据不复制，配置中的凭据引用重新绑定；旧自动化不激活 |
| 保护切片 | 随包 Rust helper 保留原 Win32 文件身份、重解析点、硬链接和 VCS 校验；模型前采集确认、工具前身份复核、任务后封存，未知或失败阻断执行 |

原生 helper 的提取来源及摘要见[来源记录](../electron/native/nidofy-protection/origin.json)。它通过受限输入和私有管道工作，不启动额外 HTTP 服务或 Agent。M2 串行处理受保护任务并拒绝父子重叠；完整并发协调、工程动作覆盖和恢复界面归 M3。

## 验收结果

可复核结果、包哈希、截图及日志索引见 [M2 证据](../electron/migration/m2/evidence/summary.json)。

| 检查 | 结果 |
|---|---|
| 连接、导入、保护、pi-ai 和 Desktop 打包回归 | 24 个文件、444 项通过 |
| 文档事件图生成器 | 4 项测试通过；修复对官方 `Context.bail` 分派的识别，生成结果校验通过 |
| 类型与静态检查 | Host/桌面 TypeScript 构建和 M2 定向 lint 通过 |
| 强制终止恢复 | 在 prepared、credential-staged、committed、applied 四个位置终止独立测试进程；重开后回滚/提交及孤立凭据回收符合预期 |
| 真实打包 Electron | CAS/ACK、保存 B 期间 A 重试、新回合 B、同名模型独立 Key、Host 不重启、连接及历史重启持久化通过 |
| 原生保护 | 打包 helper 采集/确认/封存通过；制造硬链接导致保护拒绝时，没有模型请求或工具执行 |
| 旧数据 | writer 3、4 和额外历史代次 0 的迁移测试通过；未来代次 999 拒绝；压缩 Session 保留；导入副本可独立启动并读取旧消息 |
| 官方打包运行时 | Node、koffi、sharp、HTML、PTY、pnpm、grep、glob 通过；DOCX/XLSX/PPTX 转 PDF 和技能 CLI 发现通过 |

模型集成验收使用本机流式服务和合成凭据，没有使用真实 API Key。初始个人联网阶段的公网可达性证据保留在[历史记录](ELECTRON-PERSONAL-IMPLEMENTATION-2026-09-29.md)；本轮不把本机模拟结果表述为真实模型、MCP 或网页搜索服务验收。

本次最终打包在依赖准备阶段遇到一次 Windows 子进程退出错误。保留失败记录，使用同一已构建包集重新执行 runtime 准备、官方 builder 和全部打包运行时检查，最终成功。构建 Node 放在不会被 runtime 重建清理的独立工具目录。没有以跳过检查或单独替换应用内模块的方式放行。

全仓文档同步初次为 39 项通过、3 项失败；本轮事件图失败已修复并单独复验通过。其余两项是已有 M0 缺中文对应文档、M0/M1 来源证据中的提交哈希触发官方引用规则。本轮文档对单独校验通过；保留原始来源证据，不将全仓文档门禁报告为全绿。

## 使用与回退

启动[当前桌面程序](../electron/apps/desktop/.desktop-build/targets/win-x64/personal-unsigned/win-unpacked/Nidofy%20DSH%20Desktop.exe)。必须保留整个 `win-unpacked` 目录，这是未签名目录包，不是安装器或正式发布。

1. 在应用菜单打开 **连接与数据迁移**，填写连接 ID、协议、端点、模型和 Key；保存后在官方模型选择器选择对应 `nidofy-` 路由。
2. 同一网络配置下可以热改连接。OpenAI base 通常以 `/v1` 结尾；Anthropic base 不重复附加 `/v1`。代理或 CA 变化需要完整重启。
3. 导入前退出旧应用。导入只生成独立副本，回执给出 `dataRoot`；将 `NIDOFY_DESKTOP_DATA_ROOT` 设为该绝对路径后重新启动完整桌面包。旧目录继续作为回退来源。
4. 在导入副本的编辑器中选择旧连接建议并填写新 Key。旧网络、缓存和模型能力覆盖项保留在回执待审阅，不会自动启用。官方可选列表索引关闭时，冷启动导入行可能先显示 Untitled；正文通过官方 Session 历史读取。

尚未操作用户真实旧数据。进程故障恢复验收不等于断电持久性保证；已发出的 HTTP 请求不能被凭据撤销追回；文件快照不会约束外部进程。

## 后续开发与官方更新

下一阶段按 M3 推进 Git/Hg、审阅草稿、构建、产物、任务恢复和完整保护闭环。企业网关/断网干净机、真实服务端点、签名安装器及跨官方版本升级演练继续保留为各自交付门禁，不阻塞当前个人版开发。

跟随官方升级时，先在隔离分支固定新 tag、源码和锁文件，再检查 LlmAdapter、Agent 请求/工具事件、Session 迁移链、Host 认证及 Desktop 打包接缝。重放窄范围补丁与插件组合，重建完整包集，重复本记录的连接、数据、保护和打包验收。测试副本先行；替换完整应用目录，保留旧包与旧数据，不让两个版本共写活动 home。M2 没有引入第二套 Agent loop 或 Session 状态源。
