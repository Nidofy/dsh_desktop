# 当前启动入口

## Summary

2026-10-07 起，以 [CONTINUOUS](CONTINUOUS.md) 替代旧的独立 T02/T04 人工派工门槛。两项均已有源码交付，具体状态见 [盘点](STATUS-2026-10-07.md)，不再按“尚未启动”重新实施。

## Table of Contents

- [下一棒](#下一棒)
- [现存来源](#现存来源)
- [Dev Note](#dev-note)

## 下一棒

在 Electron 主目录使用 [SOL_CONTINUE](prompts/SOL_CONTINUE.txt)。Sol 直接承担原 R 的普通接收与共享接线，必要时交 Astra 实施关键语义修复。每棒读 [NEXT_HANDOFF](NEXT_HANDOFF.md)。

## 现存来源

T02 源码来源为主目录内 `.build/dispatch/worktrees/T02`；T04 来源为 `.build/dispatch/worktrees/T04`。冻结依赖已存在，不无故重装。来源 handoff 和证据保留；只接收必要变更，不覆盖主目录当前台账。旧工作树并非新代码默认执行目录。

## Dev Note

旧的环境准备证据在各工作树 preparation 与历史 R handoff 中；历史就绪状态不替代现在的实际代码和测试。
