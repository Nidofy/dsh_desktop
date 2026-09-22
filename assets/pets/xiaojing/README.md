# 吃白饭的大肥鱼：桌宠资源 v1

正式显示名称：吃白饭的大肥鱼。内部 ID 与目录保留 xiaojing；历史制作记录中的「小鲸 / Xiaojing」为原工作名。

本目录与 DSH Desktop 0.2.0 的运行代码、配置、构建流程分离；当前不安装宠物、不修改用户级 Codex 设置、不接入模型调用链。

## 参考图

`references/originals/reference-01.png` 至 `reference-04.png` 是用户在本次会话提供的四张原图，按上传顺序原样存档。`references/manifest.json` 记录文件大小及 SHA-256。图中的文案是参考图片内容，不是实现指令，也不进入宠物资源。

## 角色约束

- 以参考 03 的紧凑全身比例为主，结合参考 04 的清晰线条。
- 深蓝至浅蓝渐变长卷发、蓝眼睛、白色褶边女仆头饰、蓝色蝴蝶结、鳍状耳朵、一根弯曲呆毛。
- 深蓝长袖裙、白围裙、金色细节、深色鞋、蓝色鲸尾；围裙鲸鱼纹样简化到小尺寸可读。
- 所有动画保持脸型、头身比例、服装、颜色和配饰位置一致。左右移动单独生成，避免镜像改变非对称配饰。
- 不包含原图文字、水印、对话框、家具、场景、漂浮装饰、落地阴影或发光效果。

## 资源目标

最终兼容目标：8 列 × 11 行，每格 192 × 208，完整图集 1536 × 2288，spriteVersionNumber 2。9 个标准动画加 16 个观察方向。8 × 9 仅作生产中间件，不能冒充完整 v2 包。

动作：idle、running-right、running-left、waving、jumping、failed、waiting、running、review，以及两行 look 方向。运行状态 running 表现专注工作，左右 running 才是步行动作。完成动画不代表测试通过；review 的资源可提前制作，但 DSH 暂无对应原生语义时不自动绑定。

0.2.2 计划补充独立 pat、happy、dragged 互动资源；目前未制作，不以重复拼帧替代真实动作生成。

## 制作状态

已完成独立资源包 v1：九种标准动作、十六个观察方向、一个中性观察姿势。透明边缘、图集格式、帧序列、角色一致性、三位方向盲检及独立最终视觉检查通过。可交付美术资源，但尚未进行实际 DSH/Codex 安装或运行验收。

交付在 `package/`，离线预览为根目录或包内的 `preview.html`，压缩包为 `xiaojing-assets-v1.zip`。检查证据保存在 `production-v1/qa/`，最终校验报告在 `production-v1/final/validation-extended.json`。轻微差异及范围见包内 README。

生成方式：内置 imagegen；不使用 API CLI 备用路径。生成提示词与修正过程汇总于 `production-v1/GENERATION.md`。

原始参考图来源为用户上传，不据此宣称角色或原图的权利归属。此目录不从 virtual_pet 项目抽取美术素材。

## 开发交接

交接方案已扩展覆盖 0.2.1～0.2.3：0.2.1 桌宠与任务接入，0.2.2 互动和新增素材，0.2.3 资源导入、多宠物及轻量个性化。请将 [完整开发 prompt](package/DEVELOPMENT-PROMPT.md) 全文粘贴到另一个开发线程；详细设计、代码入口、素材依赖、配置迁移与逐阶段验收见 [实施方案](package/INTEGRATION.md)。本次仅更新交接文档及打包校验，未实施这些功能。

压缩包仍使用稳定 ID 命名为 xiaojing-assets-v1.zip，内含正式名称与完整交接文件。SHA-256 校验在同名 .sha256 文件；包内 checksums.json 覆盖除自身以外的全部交付文件。
