---
description: "使用 Windows DPAPI 保存受管凭据引用和授权 record，并恢复显式副本迁移。"
kind: "package-reference"
---
# 安全凭据

[English](README.md) | 中文

## 概述

你可以保存 API Key、provider 环境 record 和不透明 JSON 授权数据，而不把值写入明文存储。Windows DPAPI 为当前 Windows 用户保护完整受管文档。后端拒绝时 provider 仍可加载，但秘密操作会拒绝，使 Host 能展示修复服务。迁移复制显式选定的文档，保留来源并返回不含秘密的回执。

## 目录

- [使用此 provider](#use-this-provider)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-provider"></a>
## 使用此 provider

在 Host 组合中挂载 `@nidofy/dsh-secure-credentials`。桌面 bundle 导出显式的 [Windows overlay](../desktop-bundle/secure-credentials.patch.yml)，提供全部部署字段；默认 bundle patches 不包含它。官方 provider 仍为默认值。[Windows 组合测试](tests/windows.spec.ts)使用隔离数据验证后端拒绝及 T01 修复行为。

所有部署字段都须显式提供：

| 字段 | 要求 | 含义 |
|---|---|---|
| applicationId / profileId | 小写字母、数字、点或连字符；以字母或数字开头 | 分离存储身份 |
| dshHome | 绝对路径 | home 身份使用规范路径；路径别名共享命名空间 |
| maxPlaintextBytes | 整数，256 至 16 MiB | 完整 UTF-8 文档准入，包含元数据 |
| backendTimeoutMs / lockWaitMs | 正整数，最大 2147483647 | helper 存活时间 / writer 获取等待时间，单位毫秒 |
| refreshIntervalMs | 整数，0 至 2147483647 | 外部通知轮询；0 禁用轮询 |

引用按以下顺序解析：继承的进程环境、受管加密存储、工程 `.env`、用户 `.env`。非空继承值为只读。空环境值不表示已配置秘密。受管存储拒绝或损坏时，在 dotenv 回落前拒绝；不会静默替换为明文值。Record 不叠加环境层，空 `api-key` record 也可表示 owner 已确认环境认证。

[迁移方法](src/index.ts) 接收选定的官方版本 1 凭据副本及[品牌化操作 UUID](src/ids.ts)。目标必须为空。开始前保留 UUID；结果未知时先查询，再显式恢复同一操作。prepared journal 存在时阻止普通写入，直到恢复。查询返回 undefined 不代表应重放。来源文件不会被改写或删除。描述元数据、record 枚举和回执不含值；provider 不提供普通秘密导出。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>存储与生命周期</summary>

加密文档位于 `dshHome/secure-credentials/<namespace>/current.json`。应用、profile 和规范 home 同时决定命名空间及 DPAPI 附加熵。CurrentUser 保护分离 OS 账号；命名空间熵防止应用/profile/home 意外互读，但不能对已经作为同一 Windows 用户运行的代码构成授权屏障。[微软 DPAPI 参考](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata) 定义平台保护；部署文档上限不表示 Windows 最大值。

每次操作重新读取选定密文字节。单 provider 队列和官方跨进程文件锁串行执行读改写，包括完整异步刷新回调。写入在原子替换文件前验证文档并校验加密回读；选定后才发通知。外部变化在下次读取或启用的轮询中发布。卸载拒绝新工作，停止轮询，等待已准入工作，并抑制晚到通知。Helper 使用固定 argv、清理后的环境、有界私有管道、丢弃的 stderr，以及终止后等待 close 的超时。不在生产选择明文适配器。

迁移加密候选、校验回读、记录不含秘密的 journal、原子替换选定文档、验证选定并写回执。恢复读取候选或已选定迁移；不重读来源，也不自动重放外部授权交换。未记录 journal 的候选保持未选定。官方原文档格式及 Session 代次不变。

不发布独立 invariant companion：每次操作直接校验权威文档，保留的通知状态从不作为凭据读取来源。恢复操作检查 journal 与已选定操作的一致性。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [官方凭据服务](../../credentials/credentials/README.zh.md)：完整接口。
- [官方本地 provider](../../credentials/credentials-local/README.zh.md)：受管文档解析。
- [桌面 bundle](../desktop-bundle/README.zh.md)：显式 provider overlay 及激活归属。

-----

<a id="model-experience"></a>
## 模型体验

无，因为凭据值只用于 Host 认证，不加入模型上下文。

#### KV 缓存影响

Provider 不添加提示 token，也不改变模型可见前缀。账号/模型路由仍由消费者负责。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

以下限制影响部署与恢复：

- 默认 provider 激活需要定向安全与恢复验收。普通备份/导出必须排除私有存储及选定的迁移来源副本。Workspace 构建和 Loader 证据不授予安装包资格。
- 真实 Windows 证据使用合成作用域身份和当前 OS 用户。独立 SID、账号 profile 丢失、企业策略拒绝、真实认证 UI 和安装器行为需要独立验收。
- 原子替换使用官方工具，未对文件/目录执行 fsync。故障注入恢复测试不承诺断电持久性。被活进程复用的 PID 会保守阻止旧锁接管，需要人工检查。
- DPAPI 每次加密/解密调用隐藏 PowerShell 进程。完整文档有界；不声明平台规模性能或最大容量。同用户恶意程序、Host 内存、崩溃转储和已授权认证请求不属于此存储保护。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>交付上下文</summary>

默认 provider 决定及安装包的数据/权限资格仍待完成；显式 overlay 不会自行激活。

</details>
