# 环境信息交互修复与验收

完成日期：2026-10-03。候选包：`m4-environment-details`，基于当前 dsh 0.2.0-rc.2 派生版，Windows x64 未签名测试包。

## 使用

退出旧版后运行 [新版启动脚本](../electron/migration/m4-environment-details/launch-trial.ps1)。脚本继续使用此前的 M4 试用数据目录；本次验收另用独立数据和临时 Git 仓库。未替换旧候选包，未自动启动用户的试用数据实例。

环境信息现在先在卡片内展开。点击「变更」查看文件列表，再点文件查看差异；「本地」显示路径、仓库根目录、分支、当前提交、上游和远程名称；「分支」提供选择和创建操作。变更行右侧的省略号展开提交、推送、创建分支和切换分支。

Git 写操作先预览，再由用户确认。提交仅包含 Git 已暂存的文件，不会自动暂存整个工作区。切换或创建分支时仍沿用现有的干净工作区要求，写操作仍经过部署保护。仓库状态变化或预览过期会拒绝执行，需刷新并重新预览。当前 Host 会把部分业务错误统一为 `OPERATION_NOT_CONFIRMED`，尚未提供细分的界面错误文案。

只有详情中的「打开工程工作台」才进入完整工作台；连接先显示说明，再通过「打开连接编辑器」进入设置。切换会话会清除旧详情和待确认预览，非 Git 工作区禁用 Git 操作。

详情在正常布局中展开，不覆盖聊天。内容较长时右栏滚动；收起详情或环境卡片后角色区恢复可用空间。保留原来的宽度响应规则、官方侧栏联动、Tauri 素材和可替换的 Live2D 渲染接口。

## 验收证据

- 官方构建、修改文件 lint、客户端文案检查、本次 README 双语配对通过。
- 相关单元测试：47 项通过。
- 打包后窗口测试：15 项通过，使用真实 Loader、临时数据目录和临时 Git 仓库。
- 已实际确认执行提交、创建并切换分支；验证未确认不执行、工作区不干净拒绝切换、预览后状态变化拒绝执行。
- 推送验证到远程选择和预览取消，未进行公网推送；未使用真实模型凭据，也未把本次检查描述为内网验收。
- 前四批候选包的 19 项发行产物哈希保持一致；3 项原 Tauri 图像/图标素材与新包逐字节一致。

[机器可读验收摘要](../electron/migration/m4-environment-details/evidence/summary.json) · [完整窗口结果](../electron/migration/m4-environment-details/evidence/desktop.json) · [中文详情截图](../electron/migration/m4-environment-details/evidence/environment-zh-local.png) · [变更预览截图](../electron/migration/m4-environment-details/evidence/environment-changes.png)

全仓文档检查仍有此前迁移的未清理项：`migration/m0/README.md` 缺少双语配对；`ui-layout` README 两处硬换行；`nidofy.companion` 插槽缺少生成目录要求的声明注释；历史迁移记录含仓库规则拒绝的提交哈希。`test:docs` 为 18 通过/3 失败，`doc-sync` 为 39 通过/4 失败。因此本次仅声明构建、定向检查和产品验收通过，不声明全仓文档检查通过。

## 附件分析

[工作笔记与历史检索实施方案](CONTEXT-NOTEBOOK-FEASIBILITY-2026-10-03.md)对附件逐条核实，并给出 N0–N3 分阶段计划。本次没有启用新的全文检索配置、Notebook、自动召回或压缩 provider，也没有改动 Agent Loop。
