# 连续开发执行手册

## Summary

只在 Electron 当前开发目录运行一个 Sol 或 Astra 代码作者。下一步由实际实现与 NEXT_HANDOFF 决定；不再为每项任务创建工作树、独立审查或单独 integration 会话。

## Table of Contents

- [启动](#启动)
- [首次接收旧成果](#首次接收旧成果)
- [切换模型](#切换模型)
- [GLM 文档](#glm-文档)
- [Dev Note](#dev-note)

## 启动

1. 在 Codex 打开 `D:/Documents/FeiyangChen/devApps/dshWinUi/electron`，选择 GPT-6.1-Sol，建议 high。
2. 发送 [SOL_CONTINUE](prompts/SOL_CONTINUE.txt)，读取 [CONTINUOUS](CONTINUOUS.md) 和 [NEXT_HANDOFF](NEXT_HANDOFF.md)。
3. 模型连续实施与验证，直到满足规则中的真实交接条件；完成一项任务或一个提交不结束整棒。

## 首次接收旧成果

T02/T04 已有源码在主目录内部 `.build/dispatch/worktrees/T02`、`T04`。当棒按实际差异接收，保留来源目录和证据。必要本地提交/合入由当棒完成；不要求额外审批或外部 R。不要覆盖旧工作树内复制的台账到主目录，不能只按分支名假定实际文件齐全。

有实际并行写入时先停止冲突；历史 assigned/租约/WAIT_AUTHOR_STOP 标签不等同于现在仍有人运行。当前主目录和来源的用户改动都应保留。无需填写或校验 Git SHA。

## 切换模型

每棒结束读取模型输出的 [NEXT_PROMPT](NEXT_PROMPT.txt)，在同一开发目录选择指定模型并发送。Astra 也要实际开发解决触发问题，再给 Sol 生成下一 prompt。只保留 NEXT_HANDOFF、NEXT_PROMPT 和一份简短历史 relay 交接；必要命令和日志就近引用。

纯上下文或额度耗尽可以交给同模型新会话继续，不能虚构 Astra 技术阻塞。模型不会因文件名称自动切换；本流程不自动开线程或定时器。

## GLM 文档

把确定行为、源码位置与已运行证据交给 GLM，范围限 README、升级指南、支持矩阵、翻译或文档草稿。它不能改源码、测试、配置或宣告验收通过。必需的代码相关说明由 Sol/Astra 当棒写好，不等待文档模型。T26 入口保留在功能清单中。

## Dev Note

每棒自行承担代码接线与最小验证；最终候选、数据恢复及权限不变量仍需真实证据。使用 [交接模板](HANDOFF_TEMPLATE.md) 即可，不新增非必须流程文档。
