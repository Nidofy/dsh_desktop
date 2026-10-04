# 人工执行手册

## Summary

本手册说明如何在用户指定 Electron 目录内部创建隔离工作副本、启动一个开发任务，并把交付送入统一集成。T00 已在主 checkout 建立集成分支并交付设计资料，实际结果见 [T00 交接](../handoffs/T00.md)。以下任务 worktree 示例尚未执行；后续以实际代码、依赖能力和测试状态为准，无需校验 Git SHA。

## Table of Contents

- [目录安排](#目录安排)
- [首次启动](#首次启动)
- [分派任务](#分派任务)
- [审查和集成](#审查和集成)
- [暂停与换模型](#暂停与换模型)
- [Dev Note](#dev-note)

## 目录安排

所有项目工作位于以下根目录。worktree 保留各自源码副本，但全部在该目录内部；它们共享 Git 对象库，不共享正在改动的文件。

```text
D:\Documents\FeiyangChen\devApps\dshWinUi\electron\
  migration\roadmap\dispatch\     本次计划和逐任务 prompt
  migration\roadmap\handoffs\     作者交付；在各自 worktree 内产生后合入
  migration\roadmap\reviews\      独立审查和里程碑结论
  .build\dispatch\worktrees\T01\  GLM 的 T01 独立源码
  .build\dispatch\worktrees\T03\  GLM 的 T03 独立源码
  .build\dispatch\worktrees\T25\  独立验收源码
```

每个任务的 `.build/dispatch/evidence/<ID>/`、测试 home、临时工作区、node_modules 和编译输出属于自己的 worktree。尽量把测试 TEMP/TMP 与 Cargo 输出定向到任务内部；操作系统安全凭据、系统缓存等平台操作仍有系统位置，使用测试命名空间且记录，不伪装成绝对没有系统副作用。

构建器默认输出一般在当前 worktree 内，但启动前必须查实际脚本；机器级共享缓存只按工具支持方式使用，不把主 checkout 的 node_modules、lib、target 或用户 home 链接到任务目录。源 worktree 已可用并不等于其依赖和本机工具已经准备好。

若必须让所有模型使用完全同一个 checkout，只能轮流写入：前一模型完成提交并停止后再交给后一模型。不要在同一个目录并行开多个编写者。

## 首次启动

1. 在 Codex 选择 Astra，工作目录为 Electron 主目录，发送 [T00](prompts/T00-baseline-contracts.txt)。
2. T00 核对现有修改，只提交本派工包和它自己的基线文件，创建/继续 `codex/roadmap-integration`；若同名分支或其他工作存在，应保留并准确报告。
3. T00 交付并经复核后，确认集成目录中的实际实现、接口与依赖能力；后续直接以任务目录当前代码为准，无需人工填写或匹配提交号。
4. 由调度者/集成人员按锁定 Node/pnpm 准备任务 worktree 的依赖和合成数据，验证可运行最小测试。不要假设新 worktree 继承主目录 node_modules。
5. 初批分派 T01、T03、T25；测试相关 feature API 尚不存在时，T25 先做现状复现与验收设计。

## 分派任务

下面是待执行的 PowerShell 示例，仅在 T00 已完成、分支和目标路径未占用时使用。首次创建和后续接续不同，不得在报错后加 force 覆盖。

```powershell
$dispatchRoot = 'D:\Documents\FeiyangChen\devApps\dshWinUi\electron'
$dispatchTaskId = 'T01'
$dispatchBranch = 'codex/roadmap-t01-connection-recovery'
$dispatchSourceBranch = 'codex/roadmap-integration'
$dispatchParent = Join-Path $dispatchRoot '.build\dispatch\worktrees'
$dispatchPath = Join-Path $dispatchParent $dispatchTaskId
$dispatchResolved = [System.IO.Path]::GetFullPath($dispatchPath)
$dispatchRootFull = [System.IO.Path]::GetFullPath($dispatchRoot).TrimEnd('\') + '\'
if (-not $dispatchResolved.StartsWith($dispatchRootFull, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Worktree is outside the requested directory' }
if (Test-Path -LiteralPath $dispatchPath) { throw 'Inspect the existing worktree before reuse' }
New-Item -ItemType Directory -Path $dispatchParent -Force | Out-Null
git -C $dispatchRoot worktree add -b $dispatchBranch $dispatchPath $dispatchSourceBranch
if ($LASTEXITCODE -ne 0) { throw 'Worktree creation failed; do not overwrite existing state' }
```

创建后，在对应客户端打开 `$dispatchPath`，选择任务推荐模型，发送完整 prompt，无需填写提交号。新 worktree 不会自动带入集成目录的未提交文件；由集成人员先保存所需改动到来源分支或受控同步必要文件，再检查实际能力就绪，不能因分支相同就假定代码齐全。运行前检查 `git rev-parse --show-toplevel` 与任务目录一致；不能只在提示词里说目录正确而客户端仍绑定主 checkout。

T02 等有前置依赖的任务，从已经具备依赖实现的集成分支创建并核实实际文件；不要从 T01 未审查分支直接开始，也不要把原始 feature 提交和 cherry-pick 后提交重复合入。任务较长时，在稳定交付点由集成人员安排更新基线，避免作者擅自 rebase 并改变审查范围。

## 审查和集成

1. 作者提交局部实现、测试和 handoff，保留工作树；你把实际任务目录、变更文件范围、handoff 路径发给独立审查者。
2. 审查者使用 [REVIEW](prompts/REVIEW.txt)，优先看实际 diff 和执行证据。复核模型可在作者已停止的任务 worktree 只读审查；需故障测试则用单独审查 worktree，测试数据仍在内部目录。
3. 原作者修复审查问题，避免 reviewer 和作者同时写同一目录。审查清单逐项关闭。
4. Sol 在独占集成 checkout 使用 [INTEGRATE](prompts/INTEGRATE.txt)。按依赖顺序合入明确的提交；集中处理 bundle/lock/根配置，并执行合并后检查。
5. 记录实际集成改动、依赖能力和后继可用目录；提交映射可选。后继任务以其目录实际实现为准。
6. 每阶段执行 G-A 至 G-E。最终 G-F 需要实际包与测试一致，不能只审所有作者的总结。

每个任务都应局部验收；每阶段再测跨模块不变量。小补丁相关测试已通过后，不为凑报告重复跑全部测试；包、原生和 UI 资格在对应阶段做。T25 提供独立补充，不免除作者写有意义测试的责任。

## 暂停与换模型

任务限额耗尽时，先保存可恢复提交、handoff 与失败命令，结束旧会话。新模型读取短交接和实际文件继续，不把整个聊天历史复制一遍。由你更新模型登记即可，不改任务接口和验收标准。

同一根因连续两次修复失败，先用 Sol/Astra 诊断最小复现，再决定原模型继续还是接管。没有依据时不能用第三次“大重构”代替定位。

不要自动清理任何 worktree。T24/G-F 完成、交付与日志已保存后，再由你决定归档；本手册不提供递归删除命令。

## Dev Note

全部命令采用用户提供的本机根路径；若你移动仓库，先更新派工记录和所有客户端工作目录。不要仅改一条 prompt 而让其他任务继续读旧 checkout。
