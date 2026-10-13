# Relay 32 — Sol：侧栏排布修复

2026-10-12。在 Relay31 已完成功能阶段后，用户要求 Environment 移到顶部、Live2D 移到底部，并修复设置文字排布。本棒直接完成源码、ClientLoader 快照、实际便携窗口验证和新完整包；没有继续扩大为 T21 历史管理，也没有重开 Astra、正式发行或全仓盘点。

变更：desktop-extras 的 Environment.tsx、NaturalSettings.tsx、appearance.ts、所属双语 README 及 3 个 HTML 快照。共用宽窄布局，统一折叠行与两列按钮，展开设置独立排版，桌宠标签关联输入。操作回调、权限、取消、日志和 launcher 根规则沿用。

验证：3 个相关 client 文件共 16 项通过；type-aware lint、957 文件 locale 检查、README 配对及局部 diff whitespace 检查通过。build:official 与完整 materialization/builder 通过。最终 .build/p32 实际 Electron 的 7 个布局截图、设置预览/确认和 Live2D 启用通过，零模型/计费、无 pageerror、沙箱保留、注册表未变。短路径 runtime/native、Office 三种格式转 PDF、CLI 和 Host 通过。证据位于 .build/dispatch/evidence/relay-32；详细路径见本棒 NEXT_HANDOFF。

交付：.build/p32/Start DSH.exe 与整套目录、.build/p32.zip（414055438 字节）；9997 个文件及长度与目录一致，未校验 SHA。用户默认稳定数据根保持 %LOCALAPPDATA%\NidofyDSHPortable\data-v1。旧包、失败和所有历史事实保留；Relay31 文档门禁既有 8 个失败未重新审计。此次 UI 要求完成，下一功能为 T21 历史浏览与显式保留预算管理，由 Sol 承接。

## 发出的下一棒 prompt

```text
请使用 Sol 承接 Relay 32，继续 DSH Electron 本地便携功能完善。工作目录：D:/Documents/FeiyangChen/devApps/dshWinUi/electron。
先读 AGENTS.md、适用下级规则、migration/roadmap/dispatch/CONTINUOUS.md、NEXT_HANDOFF.md 和 migration/roadmap/handoffs/relay-32-sol.md。当前完整便携包为 .build/p32（Start DSH.exe）及 .build/p32.zip；Environment 已移到顶部，Live2D 位于底部，设置排布已修复。SDK 路径为 D:/Software/live2d/CubismSdkForWeb-5-r.5。
第一项实现 T21 侧边分析历史浏览与显式保留预算管理：先定向读取 analysis.ts、task-requests.ts 和 task-inputs.ts，复用现有独立官方记录、权限、取消及 quota；用户预览确认后归档，保留精确请求及原结果，拒绝过期/重复操作，不自动删除日志、追加草稿或调用模型。完成源码及实际便携包必要验证后继续独立功能。
保留当前未提交修改、全部历史证据和资产，不盘点全仓、不校验 SHA、不重开已解决 Astra 判断；不创建聊天/代理/定时器、不计费、不迁移真实数据、不 push/合并/发布。继续使用完整便携目录、现有 portable 模式和专用稳定绝对数据根，保留沙箱；不制作安装器、不注册协议。正式发行条件延期，不是停工理由。仅新的具体架构/数据/权限冲突交 Astra。结束更新 NEXT_HANDOFF.md、NEXT_PROMPT.txt 和下一未使用 relay 记录，并贴出同一启动 prompt。
```
