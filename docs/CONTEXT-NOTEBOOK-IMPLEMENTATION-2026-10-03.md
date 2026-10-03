# 工作笔记与历史检索：首版本地交付

状态：M5 本地基线收尾完成；附件核心方案 N0–N2 已在独立 Windows 候选包中实现并验收，N3 完成首轮确定性检索评估。真实模型的长期任务质量、延迟和费用对比尚未完成，不宣称消除遗忘、提高缓存命中或节省 token。基于本地已固定的 dsh 0.2.0-rc.2，不代表重新核实了官网最新版本。

## 试用

运行 [Notebook 试用启动脚本](../electron/migration/n-context/launch-trial.ps1)。它使用独立的 `n-context-trial-data`，不会替换此前 M4 试用数据，需要在该试用实例中配置自己的连接或官方登录。此次自动验收只使用隔离夹具和本机模拟服务，未使用真实模型凭据。

打开会话，在右侧「环境信息」展开「工作笔记与历史」。可以搜索当前会话或完全相同工作目录下的历史，点击命中查看原文；笔记支持分类、原文引文、人工固定、更正和停用。固定条目不能由模型修改，写入冲突会报错并刷新版本。右栏继续按可用宽度自动隐藏，不覆盖对话。

官方标准模式仍然存在。需要压缩时同步更新笔记，选择 `Notebook · standard`、`Notebook · ptc` 或 `Notebook · cordis`；普通模式也能使用历史工具和笔记工具，但仍使用官方 basic 压缩。官方 `@` 会话引用保持可用。

新包位于 `electron/apps/desktop/.desktop-build/targets/win-x64/candidates/n-context/personal-unsigned/win-unpacked/`，为未签名的本地试用目录，尚未安装或发布。M5 安装包是附件开发前的稳定基线，见 [M5 收尾记录](M5-LOCAL-CLOSEOUT-2026-10-03.md)。不要混淆这两个产物。

## 已实现

| 阶段 | 实际实现 | 本地验证 |
|---|---|---|
| N0 历史检索 | 官方 SQLite 持久索引、五个官方历史工具、现有显式会话引用、环境栏检索与原文预览 | 实包工具目录、中文完整短语、跨重启恢复、官方引用、同 cwd 隔离、英文／路径／报错夹具 |
| N1 工作笔记 | 八类条目，版本化 KEEP/ADD/UPDATE/REMOVE，准确引文校验、人工固定、不可变修订文件、下一回合的官方 runtime-context 快照 | 版本冲突、预算、取消、重放、来源定位、插件卸载、实包编辑及重启 |
| N2 压缩适配 | 继承官方 summarize 扩展接口，生成增量候选；成功压缩并 flush 后发布；非法候选或摘要失败沿官方路径回退 | 真实 Agent Loop、连续三次压缩、失败／取消／落盘失败不发布、实包手动压缩、三个 preset 启动 |
| N3 首轮评估 | 持久检索与来源锚点的确定性夹具 | 已确认中文连续文本需要完整 token，任意子串不可用；未增加向量索引或重复的统一召回工具 |

笔记增量由正常回合中的 `notebook_read` / `notebook_update` 工具维护，Notebook 模式另外支持压缩时更新。本版没有独立的回合结束后台模型抽取，也没有 Markdown 导出或修订历史浏览界面。REMOVE 保留停用条目；预算计算包含这些条目。错误事实仍可能由模型产生，准确引文校验不能代替语义核实。

## 官方升级适配

功能主要位于私有 `desktop-extras` 与 `desktop-bundle`。本次没有改 Agent Loop 或 Session 格式；官方压缩包只增加一行公共类型导出，运行时事务、溢出恢复和 token 政策仍由官方实现负责。

三个 Notebook preset 从固定版本的官方组合生成，不手工维护另一份引擎。候选包构建先执行 `generate-context-presets.mjs --check`；官方组合变化时必须重新审阅、生成和验收。每次升级至少重复普通模式、Notebook 模式、插件停用、老日志重放、索引恢复和取消／失败路径检查。索引可以重建，用户笔记不能通过删除来处理兼容问题。

模型看到的是官方日志中记录的笔记快照；每回合冻结一次，人工修改在下一回合生效。检索本地保存不代表内容永不离机：选入模型请求的笔记和历史片段会发送到配置的模型服务。自动历史工具继续使用官方 exact cwd 约束，没有新增跨工作区自动授权。

## 验收与限制

- 官方完整构建通过；未签名 Windows 目录包生成成功，原生依赖及 Office 文档往返检查通过。
- 全仓 `doc-sync` 43 项通过，定向 lint 通过。
- 两组相关测试分别通过 127 项和 184 项，存在重叠，不相加作为独立测试总数。第二组包含新增的三次连续压缩场景及官方 compaction、引用界面回归。
- 打包后 Notebook 核心检查 8 项、环境与布局回归 15 项通过。包含主题、侧栏伸缩、窄窗隐藏、原文预览、Git 操作预览与确认、重启恢复。
- M5 原基线 `app.asar` 的 SHA-256 未变。新包 `app.asar` SHA-256：`103bbabe9377c196a7f63efd925c81a8c65bb43d6b02538b96b722206eff76c5`。

Windows 构建在重定向输出时两次出现 pnpm 退出句柄错误；使用终端承载同一构建脚本后通过，未忽略退出码或跳过运行时检查。执行完整候选包构建时应保留终端输出。

N3 下一步应以真实长任务比较 basic、仅检索、Notebook+检索三种组合，记录约束保持、错误召回、原文定位、延迟及总费用，再决定是否增加统一召回入口或中文索引适配。当前确定性测试不能替代这项效果评估。干净 Windows 安装／卸载、真实系统睡眠、签名发布和企业出口仍按 M5 记录保留待验收。

[机器可读摘要](../electron/migration/n-context/evidence/summary.json) · [Notebook 实包结果](../electron/migration/n-context/evidence/desktop.json) · [布局回归结果](../electron/migration/n-context/evidence/layout.json) · [Notebook 界面截图](../electron/migration/n-context/evidence/notebook-wide.png)
