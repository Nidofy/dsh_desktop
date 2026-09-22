# DSHDesktop 0.1.7：实验与比较

本轮已实现比较、测量归档、实验设置、矩阵 runner 和只读 Git 摘要原型。DSH 仍固定 0.1.5-rc.2，未修改上游源文件。按本轮要求，**只构建桌面程序，不制作离线包**。已有 0.1.6 ZIP 不包含这些功能。

## 采纳附件的内容

| 建议 | 本轮落地 |
|---|---|
| 可重复性指纹 | Desktop / DSH / Node、依赖清单、overlay、provider 配置、system / tool schema / Skill catalog / 项目指令、Git revision / dirty contents / staged diff；未知条件保留 UNKNOWN |
| Cache Continuity | 使用“本地请求连续性”语义；记录首次会话、进程启动、模型/provider/effort 改变、超过 5 分钟空闲、插入其他逻辑请求、显式 compaction；不声称知道服务端 cache key |
| Request / Tool waterfall | A/B 分栏、请求首输出等待与工具区间、并集耗时；不把首输出后的剩余时间叫纯解码，也不相加并行区间 |
| Matrix sweep | 默认单因素，显式 `--full-matrix` 才做组合；重复轮次轮换顺序；并发 1 / 2 / 4 |
| repo_summary | 默认关闭、重启生效、当前工作区 Git 只读摘要；无完整 patch；hg 暂用原生 shell |
| Raw usage evidence | 调查后暂缓。当前 pi-ai adapter 的 `mapUsage` 仅在 cacheRead/cacheWrite > 0 时转发字段，逻辑观察点无法区分零与缺失。没有绕过适配器或拦截生产 fetch |
| 有条件的效率差值 | 保留数值差值、覆盖率和质量标签；只有同一外部验收 PASS/PASS、完整测量与覆盖、无已知条件冲突才显示满足效率比较条件；仍不作因果结论 |

## 页面使用

进入 `Help → 会话诊断 / Session Diagnostics`，点击 **A/B 实验比较**。

1. A/B 分别选择当前记录、已归档测量或本地 JSON（支持 schema v1/v2，单文件上限 12 MiB）。导入只读取元数据字段；未知版本拒绝。
2. 可筛选会话、turn、用途、时间范围。缩小原测量范围后，原完整任务墙钟失效，显示未知，不拿整任务时长充当筛选区间时长。
3. 查看数值差异、覆盖率、工具统计、环境检查及时间线。导出比较 JSON / Markdown。

开始一个跨多轮任务前，选定已有会话并点击 **开始测量所选会话**；完成后选择人工 UNKNOWN/PASS/FAIL，点击 **结束并归档**。已有会话可先运行一条准备消息。开始时已有请求在运行、采集中断、记录淘汰、结束时仍在运行等情况会令测量不完整。不要把人工 PASS 当成 runner 的外部验收。

**归档当前保留范围** 可保存已完成历史，但不会追认完整任务边界。**自动归档每轮** 默认关闭，启用后只归档启用期间观察到的轮次，不从原生日志回填。实时数据重启清空，归档在 `DSH_HOME/desktop-measurements` 保留，最多 100 份 / 50 MiB，超限淘汰最旧数据；每份独立原子写入。未提供归档删除 UI，可在关闭引擎后管理该目录。

## 实验设置

| 设置 | 选项 | 生效时间 |
|---|---|---|
| 工具结果内联预算 | 50,000 / 24,000 bytes | 重启引擎 |
| Skill catalog 描述长度 | 500 / 250 字符 | 重启引擎 |
| repo_summary | 关闭 / 开启 | 重启引擎 |
| 元数据采集 / 自动归档 | 关闭 / 开启 | 立即 |

首次改变某项实验前，保存原生设置中该字段的值或“字段不存在”。“恢复首次实验前配置”与“原生 50,000 / 500”是不同选项，前者保留原有自定义值。原配置保存在 `desktop-experiment-baseline.json`；恢复模式会在后续启动继续应用该基线。主界面展示当前已生效预算，选项表示下次启动的配置。

工具记录最多 2,000 条，独立区分顶层 tool/call→result 与 PTC dispatch。这些是可观察的调用区间，可能包括权限/队列等待，并非纯 CPU 执行时间。失败、未完成、Skill 加载、重复 read 目标分别统计；路径与 Skill 名只保留 HMAC。普通请求的 toolCallCount 仍是模型发出的调用块数量，不与实际结果数混用。

## Runner

在仓库根目录执行，使用已准备好的 runtime：

```powershell
# 仅显示计划，不执行命令、不调用模型
.\runtime\runtime\node.exe scripts/experiment-runner.mjs experiments/synthetic.json

# 真实 DSH 引擎 + 本地合成 provider，6 个隔离任务，独立文件验收
.\runtime\runtime\node.exe scripts/experiment-runner.mjs experiments/synthetic.json --execute

# 请求型并发：24 次本地流式 HTTP 请求
.\runtime\runtime\node.exe scripts/experiment-runner.mjs experiments/concurrency.json --execute

# 任务型并发：12 个隔离工作目录，共享同一配置的 DSH 引擎
.\runtime\runtime\node.exe scripts/experiment-runner.mjs experiments/task-concurrency.json --execute

# 只有明确需要组合时才加 --full-matrix
.\runtime\runtime\node.exe scripts/experiment-runner.mjs experiments/synthetic.json --full-matrix
```

配置维度允许工具预算、Skill 描述、maxConcurrency 和 repoSummary。两个二选一维度默认生成 baseline + 两个单因素变体，共 3 组；repeat=2 运行 6 组，而不是遗漏第二个维度。结果在 `.build/experiments/<timestamp-id>`，包含每任务 measurement、比较 JSON/MD、批次吞吐量、P50/P95、队列时间和失败数。

request 模式直连 OpenAI-compatible HTTP，测首字节、完成时间、响应字节与状态，不测 DSH 调度、模型 TTFT 或任务质量。task 模式使用原生 session API，记录逻辑请求/工具/验收。并发限制作用于工作负载，不是修改 DSH 内部调度器。

真实任务参考 `experiments/live-template.example.json`，复制后填写 endpoint、model、模板目录、prompt 和独立验收命令，再显式添加 **`--live --execute`**。密钥通过指定环境变量读取，不写入报告。当前 runner 的真实传输只支持 OpenAI-compatible；桌面正常使用仍支持两种协议。输出上限、请求数上限、任务超时和最多 120 个工作负载构成首版预算，尚无金额预算估算。

runner 为每任务复制新工作目录，跳过 `.git/.hg/node_modules/.build/dist`，拒绝符号链接；不 reset/clean 用户仓库。副本不保留 VCS revision，因此 runner 明确将 workspace 可比性标为未知。需要 Git 语义的 repo_summary 真实 A/B 应在正常 Git 工作区用手动测量完成，不能把此副本策略视为 Git worktree 实验。未来可以补 worktree backend。

外部 acceptance 用 command + args（无 shell 拼接），可以串行安排构建和测试；记录退出码、耗时、状态、日志文件位置。真实任务应配置 `protectedAcceptancePaths` 指定验收定义文件/目录，runner 将任务前后的内容指纹纳入验收身份；定义被修改会 FAIL。没有保护定义时，即便命令返回 PASS，也只标记为人工等级，不进入同一外部验收的效率判断。每份日志最多 1 MiB，截断明确标记。独立模块 `scripts/experiment-process.mjs` 的 `runCommand` 还返回 4,000 字符尾部摘要。Windows 超时先结束进程树，权限限制时退回结束直接子进程。日志可能含项目输出，与无正文的诊断 JSON 分开分享。runner 结果目录不自动淘汰，请按需清理。

## 判断边界

- MATCHED 表示**所检查的条件**相同，不保证所有环境一致。runtimeManifestHash 是依赖 lock 清单，不是全 runtime 文件树。Git dirty 指纹有 4 MiB 文件预算和 200 条状态上限，超限标不完整；观察路径/权限失败标未知。
- 当前会话导出的 workspace 是首次采集轮次附近观察到的状态；手动测量开始会重新读取。读取期间用户或工具修改文件仍可能产生非原子快照。runner 工作目录不同会改变真实 system prompt，这种差异如实报告，不能归因于预算设置。
- 原始请求指纹继续使用 v1 算法；schema v2 是报告信封。新增 Skill/instructions 域只比较同 key scope、同 fingerprint version 且完整的数据。旧报告没有字段时按未知处理。
- cache 比例只使用同时有 cache read 与有效总输入的记录加权；没有字段不当作零。比较报告提供每项 delta 的覆盖完整标志。
- 通过同一验收只代表该验收覆盖范围内通过。模型自己写的测试数量不是独立质量证明。
- 合成实验用于验证采集/runner/归档链路。本轮未调用内网真实模型，**没有宣称真实编码效率收益**，默认仍保持原生预算。

本轮 6 次单因素合成任务全部验收通过，各为 4 个逻辑请求（包含标题）、2 次工具调用、43,416 的合成输入计数，24 KB / 250 字符变体均未降低这些指标。这里的 token 值由 mock 按字节数近似产生，不代表真实 tokenizer 或计费。这是“夹具中未观察到收益”的结果，不能据此判定真实编码任务中有效或无效。另有 12 次任务型并发与 24 次请求型并发完成验证。完整摘要见 `docs/evidence/experiments-0.1.7.json`。

runner 的 HMAC key 每次调用独立生成，同一轮矩阵中的所有任务共享该 key；跨 runner 调用的指纹不可直接比较。桌面采集仍使用 Windows 用户级持久密钥。

## 验证和构建

`tests/experiments.mjs` 覆盖旧/新导入、加权覆盖率、质量条件、重叠区间、隐私、连续性、原生/PTC 工具、归档淘汰、矩阵顺序、进程退出/超时、自定义设置恢复、Git 摘要。`tests/observability-wire.mjs` 在两种协议下验证原请求字节不变、原生读工具、关闭/取消/错误、鉴权、导出、归档跨重启、自动归档、实验设置与可选工具注册。

开发机完整构建且不打包：`scripts/build-windows.ps1 -ReusePreparedRuntime -SkipPackage`。本轮分别执行了对应检查与 release 编译；生成程序位于 `src-tauri/target/x86_64-pc-windows-msvc/release/DSHDesktop.exe`，它不是独立可分发文件，仍需 runtime / WebView2。
