# Relay 31 — Sol：侧边分析、有限设置与完整便携包

本棒按用户功能优先授权连续完成 T21、T22、T16 包内互动、T17 草稿引用修补、可实施 T15 与便携交付。当前完整交付是 .build/p31g（Start DSH.exe）与 .build/p31g.zip。停止原因是本轮约定阶段已完成，没有用正式发行条件停止，也无新 Astra 冲突。

功能、真实包命令、最终通过/未认证范围和保留失败详见 [NEXT_HANDOFF](../dispatch/NEXT_HANDOFF.md)。历史 [Relay29](relay-29-astra.md) 与 [Relay30](relay-30-sol.md) 原样保留。证据根 .build/dispatch/evidence/relay-31；实际目录候选 relay-31-usable，GUI 结果 packaged-hCnijj/result.json，runtime 结果 usable-runtime-smoke.log，GPU 生命周期结果 live2d-webgl-allocations/result.json，启动器结果 launcher-4bab4fa7/result.json，ZIP 结果 zip-completeness.json。最终 GUI 共三次本地合成请求，外部计费为零。没有接管真实用户数据、关闭沙箱或修改正式注册。

本棒同时修复标签随正文变化、侧栏裁切、画布比例和历史引用整段替换。pnpm run build:official、受影响类型/lint/行为与 owner-local 快照通过；doc-sync 35/43 通过，8 个既有问题详列于交接和原日志。短路径部署解决当前便携包 Python DLL 路径限制；长路径失败输入及所有旧产物保留。GPU 显存峰值、美术接缝和公开发行资格不冒称通过。

## 下一棒 prompt（本棒副本）

```text
请使用 Sol 承接 Relay 31，继续 DSH Electron 本地便携功能完善。工作目录：D:/Documents/FeiyangChen/devApps/dshWinUi/electron。
先读 AGENTS.md、适用下级规则、migration/roadmap/dispatch/CONTINUOUS.md、NEXT_HANDOFF.md 和 migration/roadmap/handoffs/relay-31-sol.md。当前完整便携包为 .build/p31g（Start DSH.exe）及 .build/p31g.zip；SDK 路径为 D:/Software/live2d/CubismSdkForWeb-5-r.5。
第一项实现 T21 侧边分析历史浏览与显式保留预算管理：先定向读取 analysis.ts、task-requests.ts 和 task-inputs.ts，复用现有独立官方记录、权限、取消及 quota；用户预览确认后归档，保留精确请求及原结果，拒绝过期/重复操作，不自动删除日志、追加草稿或调用模型。完成源码及实际便携包必要验证后继续独立功能。
保留当前未提交修改、全部历史证据和资产，不盘点全仓、不校验 SHA、不重开已解决 Astra 判断；不创建聊天/代理/定时器、不计费、不迁移真实数据、不 push/合并/发布。继续使用完整便携目录、现有 portable 模式和专用稳定绝对数据根，保留沙箱；不制作安装器、不注册协议。正式发行条件延期，不是停工理由。仅新的具体架构/数据/权限冲突交 Astra。结束更新 NEXT_HANDOFF.md、NEXT_PROMPT.txt 和下一未使用 relay 记录，并贴出同一启动 prompt。
```
