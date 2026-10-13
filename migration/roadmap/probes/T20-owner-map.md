# T20：现行 owner 与下一实现入口

T20 任务依据为 [任务 prompt](../dispatch/prompts/T20-ab-experiments.txt)。已发布[实际回执比较／有界记录与模型选择 step](../../../apps/desktop-host/src/experiments/README.md)、独立工程动作 turn runner、隔离副本、官方全输入截点及实际 Agent→保护 Shell→T11 关联。显式 Notebook／当前缓存因素、有预算顺序矩阵、每轮归档／报告验证，以及独立工程 turn 计量／原来源／验收比较由认证 API 和双语页面消费。一般任务计费、真实模型质量／缓存效果、完整存储峰值及 renderer／安装资格仍未完成。T11／T19 的实际能力不能被旧阶段门槛替代。

| 现行 owner | 可直接消费 | 不能推断 |
|---|---|---|
| [VerificationOwner](../../../apps/desktop-host/src/workbench/verification.ts) 与 [执行输入](../../../apps/desktop-host/src/workbench/verification-input.ts) | 真实 run／receipt 身份、源码／输入观察、coverage、日志完整性与解析、freshness、独立 acceptance | 退出码或测试通过不提供任务质量；unknown／null 不按零或完整算；不能重放旧运行 |
| [SelfTestConnectionOwner](../../../apps/desktop-host/src/selftest/provider.ts)、[输入 owner](../../../apps/desktop-host/src/selftest/inputs.ts)及 [runner](../../../apps/desktop-host/src/selftest/runner.ts) | 准备／确认／逐请求预算与权限、完整官方输入 flush／冷读／generation 保护、原配额及取消排空 | 自检五次合成任务不是用户任务 A/B；不能扩大预算、模型权限或复用私有票据 |
| [诊断 store](../../../packages/nidofy/desktop-extras/src/legacy/diagnostic-store.mjs) 与 [比较](../../../packages/nidofy/desktop-extras/src/legacy/diagnostic-comparison.mjs) | 原归档与当前旧诊断语义的实现参考 | 旧归档不是 experiment/case/run／receipt 绑定；不能改写旧 schema 或把旧展示当质量结论 |
| [旧 Probe](../../../packages/nidofy/desktop-extras/src/probe.ts) | 读取既有实现的有限路由／usage 参考 | prepared-call 和合成 Session 标签没有完整官方输入日志；不能用它发 T20 请求，不执行旧 cache/start 验证 |
| [T20 reader](../../../apps/desktop-host/src/experiments/owner.ts) 与 [record](../../../apps/desktop-host/src/experiments/records.ts) | 显式 experiment／case／A/B run 选择、实际 receipt/current acceptance、已知差异、缺失计数、有界独立v1记录和本机逐项导入重验 | 标签不证明因素已改变；回执匹配不证明完整任务可比，两个手动验收不证明质量相同；记录或导入不发请求／执行任务 |
| [模型选择 step](../../../apps/desktop-host/src/experiments/model-lineage.ts) | 原 T11 source 限制 Session，唯一官方 run_project_action 结果／callId／准确 receipt 关联 turn/step；官方冷读与 generation 保护下完整结算前日志输入及逐尝试 usage／缺失值 | 无实际发送截点，不认证 dispatchInput；settledAttempts 不是网络调用数，不是完整任务计数；模型 alias、当前偏好、笔记正文不授予准确版本／历史因素真实性；PTC／继承／歧义／桌面来源保持UNKNOWN |

[单次任务 owner](../../../apps/desktop-host/src/experiments/task-requests.ts)与[独立输入日志](../../../apps/desktop-host/src/experiments/task-inputs.ts)已提供自己的显式 prepare／confirm、一次无工具分析请求预算、T23／连接修订重验、官方 append／flush／冷读与同代次 prepared-call、原生普通／终态额度、取消排空和只读中断恢复。发送截点是 prepared-call 入口的 Harness 输入；不证明 wire 字节、网络调用数或 T11 工程任务关联。准确版本和实际缓存因素保持 UNKNOWN，Notebook assembly 未调用；原比较表和独立选择记录语义不变。

实际 Notebook 输入 owner 提供不 flush／同步／写源的完整活动文本、物理 scope、笔记／设置修订和限额捕获；分析与工程任务分别以显式源预览、确认及发送前复验消费。工程任务另捕获实际只读缓存 owner 的偏好修订／挂载状态／策略，独立 sidecar 与实际已应用观察逐请求核对，不改全局偏好。官方 finish responseModel 按 route／model 匹配并冷验；选择 T11 step 也读取逐尝试报告标识。独立工程 runner 已接完整官方输入、预算／权限、隔离副本和实际 Agent→保护 Shell→T11 因果链。有界矩阵顺序执行两到四行，每轮排空归档，失败／未知停止后续；冷读、报告来源／版本／大小验证不补发。实现与限额见[工程／矩阵契约](../../../apps/desktop-host/src/experiments/README.zh.md#isolated-engineering-task)。本机合成提供方证明接线，不能认证真实模型质量、提供方缓存命中或效率；准确不可变版本仍 null，历史观察不补造。原比较表和 records-v1 语义不变。独立工程比较已呈现完整输入闭包／真实执行差异、逐轮独立验收和缺失计量；后续优先核查完整资源／保留副本预算及真实 owner 边界，再补可独立 renderer／后继功能。一般任务计费／真实模型效果／完整存储峰值及安装资格不升级。只有具体公共持久语义／权限冲突才交 Astra，普通缺 owner 由当前 Sol 完成。

独立[资源 owner](../../../apps/desktop-host/src/experiments/engineering-resources.ts)已接显式六项检查点限额、完整保留副本费用、实际物理分配身份及官方 stat／逻辑前缀，缺历史 owner 只读未知且拒绝新准入；动作后拒绝保留真实工具结果／T11。Relay26 完整支持 Host 与真实 Electron Main／preload 工程／矩阵页面、取消／未知已提交启动与坏报告文件拒绝已验证，原字节、旧格式及总资格保留。当前计数分别见 `.build/dispatch/evidence/relay-26/summary.json`，不叠加重叠调用。动作期间磁盘峰值、Shell spill／完整 Host 内存、恶意替换及安装仍未资格化；后续优先可在现有 owner 契约内实现的资源消费缺口和后继功能。

Relay27 补齐传入目录、工程／矩阵日志目录的有界枚举，Session 真实物理元数据解码前检查及修订复验；每次工程冷读用一次完整官方观察和同代次保护验证全部截点、结算与资源，无截点 sidecar 也重验。大物理文件零解码拒绝，压缩逻辑超额在一次官方解码后拒绝；后者不认证解码内存峰值。真实空 Session 的原排空水位在官方追加后拒绝，原 sidecar 保留。当前独立命令与 profile summary 见 `.build/dispatch/evidence/relay-27/`，失败／重叠调用分别保留且不相加；原 Relay26 renderer 与 Relay25 时钟未重跑、未升级。后继优先接实际 Shell 输出／spill 的独立只读观察与明确费用 owner；现有 Workbench stdout 上限及 provider 默认 spill 配置不能充当完整保留容量或执行期间峰值。
