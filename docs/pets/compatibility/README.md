# 支持的宠物资源子集

核对日期：2026-09-22。

- 上游标准包说明：https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/references/codex-pet-contract.md
- 上游行和时长说明：https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/references/animation-rows.md
- 当前开源 TUI 读取与动画实现：https://github.com/openai/codex/blob/main/codex-rs/tui/src/pets/model.rs
- 本机提供的 v2 契约已保存为 local-v2-contract.md；本项目 xiaojing 已验证包作为 v2 样例。

DSH 接收固定 192×208 格、8 列的 9 行标准包，以及版本明确为 2 的 11 行观察包。版本与实际解码几何必须同时匹配。缺少自定义时长时采用上述上游 skills 行时长预设；本包 asset-manifest.json 的逐帧时长优先。

上游当前 TUI 还包含 frame/animations 自定义布局及更慢 idle 的实现，与本机 Desktop v2 契约不同。DSH 不据此推断所有 Codex 格式互通，不接收任意 frame 几何或未知扩展版本；不复刻 TUI 所有状态播放策略。生产状态仍由 DSH 原生任务语义决定。

## 已保存的兼容样例

- `tests/fixtures/pets/standard-8x9/pet.json` 与 `spritesheet.png`：将已授权本包基础图集裁出前九行，并清空 v2 中性观察格，用于检验标准格式。不是下载的第三方作品，不代表所有历史 Codex 包。测试会对保存的实际文件进行完整解码、导入和导出回读。
- v2：`assets/pets/xiaojing/package` 的原始校验文件与图集。
- DSH 扩展：`assets/pets/xiaojing/extensions/interactions.json`，包含明确的逐帧时长、动作和触发器。无扩展包降级为基础挥手/跳跃/移动；没有观察行时保持普通待机。

仅接受包根目录含 pet.json 的目录或 ZIP。归一化导出仅含宠物描述、图像、逐帧清单及 DSH 声明式互动，不带实例配置、会话或连接。脚本、预览 HTML 和其他不需要的文件不会进入已安装包。
