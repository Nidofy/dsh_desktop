---
kind: upgrade-guide
description: "历史 JSONL 写 open 现在响应提交前取消，并在迟到取消后返回已提交句柄。"
---

# JSONL 迁移取消

[English](guide.md) | 中文

## 变更

历史 JSONL 写 open 以前会在暂存阶段取消后继续完成后继发布，再拒绝 open。现在会在编码、校验和最终源检查阶段响应取消，等待暂存句柄关闭与校验 worker 排空后拒绝，并保留源。独占发布开始后，即使随后发生取消，成功 open 也会返回句柄。发布后的 I/O 失败仍可能在后继已存在时拒绝；单凭拒绝不能证明后继不存在。

## 迁移

1. 更新 `SessionPersistence.open(id, 'write', { signal })` 调用者：即使 `signal.aborted` 为 true，也关闭每个已返回句柄。返回句柄表示 open 已完成。
2. 失败后，在任何显式恢复前检查已选代次。保留历史源和已有当前代次。取消或 I/O 错误不能授权重放其他副作用。
3. 确认提交前取消不留下新当前代次或活动校验 worker，而成功发布后的取消保留当前代次。可选可信 JSONL 迁移 writer 测量并约束后继字节；它不授予产品导入根或接纳权限。
