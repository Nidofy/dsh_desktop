---
description: "配置 Desktop HTTP 目标并检查被拒绝的请求。"
---

# Desktop HTTP 目标

[English](README.md) | 中文

## 概述

Desktop 模型请求、模型发现及 MCP HTTP 在准备和发送前使用应用策略。随包发行上限、可编辑 profile 限制及准确 Workspace 限制取交集。策略变化使已准备请求失效；拒绝请求不会改选其他端点或凭据。

## 目录

- [配置目标](#configure-destinations)
- [作用域与修订](#scope-and-revisions)
- [消费者与凭据](#consumers-and-credentials)
- [恢复](#recovery)
- [已知限制](#known-limitations)

<a id="configure-destinations"></a>
## 配置目标

随包 `resources/personal.egress.json` 和 `resources/intranet.egress.json` 包含 `schemaVersion: 1`、发行 `revision` 字符串及 `origins`。个人版默认为 `null`；内网版默认为空列表。部署可在其内网载体中发布准确的已批准 HTTP(S) origin。origin 含协议和端口，不含凭据、路径、查询或片段；不支持通配主机和路径前缀。用户设置不能扩大发行上限。Main 既有的内网 Chromium 与外链限制仍独立生效。

认证后的 `/api/nidofy/egress` 接受 `action: 'status'` 或 `action: 'save'`。保存提供 `expectedRevision` 及完整 `policy`，包含 `schemaVersion: 1`、当前整数 `revision`、`profile` 和 `workspaces`。Workspace 行包含真实 Workspace `id`、准确规范 `path` 及 `origins`；保存要求该注册项和目录存在。`null` 不追加 origin 限制，`[]` 拒绝所有 origin。结果未知时读取 status 核对，不自动重试保存。

<a id="scope-and-revisions"></a>
## 作用域与修订

[策略 owner](egress.ts) 在鉴权前捕获完整策略文档和发行修订。带作用域的发送使用既有 Workspace registry 中真实 Session 归属，不从 cwd 前缀、仓库名或模型陈述推断权限。已配置的 Workspace 规则要求其准确存储路径。文档、registry provider 或相关 Session attachment 变化会使捕获的授权失效。没有 Workspace 规则时，新 Session attachment 不改变 profile 授权。

无作用域操作、合成 probe Session 标签和 MCP 连接流量应用所有更窄的 Workspace 规则。`analyze_image` 工具调用携带实际 Agent Session；独立确认的图像 UI 仍是无作用域操作。已准备请求不能通过省略或替换 Session 扩大权限。检查在 payload／凭据处理和每次实际 fetch 前执行；端点 origin 变化及所有 HTTP 重定向都拒绝，即使另一个 origin 也在允许列表内。

<a id="consumers-and-credentials"></a>
## 消费者与凭据

托管连接保存先验证已解析模型端点，再暂存秘密，并在发布前复验。`checkConfiguration()` 为共享定义检查发行／profile 限制，不授予请求权限；实际发送仍应用所属 Workspace 限制。既有 [profile 编辑器](../../../../packages/boot/config-editor/README.zh.md) 也在替换 patch 前为变更的 PiAi 路由、DeepSeek 配置及 MCP HTTP 配置准备并复验授权。未变更的 catalog 诊断仍可编辑。官方 profile 启动器在 Loader 条目连接前提供可选的 [HTTP 能力类型](../../../../packages/util/http-proxy/src/egress.ts)；未安装 provider 的普通上游启动保持原行为。

PiAi 在 prepared call 中捕获授权，将 fetch 注入两种已验证 HTTP API：`openai-completions` 和 `anthropic-messages`，使用显式凭据和 SSE。安装本 provider 时，其他原生鉴权、其他 API 及 WebSocket 传输拒绝。模型发现、DeepSeek Messages／Files，以及 MCP 启动、重连、POST、GET 和 DELETE 均使用绑定 origin 的 fetch。fetch 仅为原 origin 保留原始 headers，不跟随重定向。响应体读取期间保持 caller 取消关联，包括响应头返回和垃圾回收之后；原 Response 元数据保持。baseURL 仍是 provider 端点，不是通用 HTTP proxy。Probe 请求及图像调用到达相同适配器。

<a id="recovery"></a>
## 恢复

可编辑策略位于 `nidofy-connections/egress.json`，完整大小不超过 64 KiB，经既有原生 quota 写入，计入临时替换字节。读取拒绝符号链接、链接形式的策略目录、损坏文档和未来版本，不覆盖原文。CAS 冲突要求重新读取。连接 journal 保持既有暂存秘密清理语义；策略失败不会把未提交候选变成 current。卸载拒绝新工作，取消所属传输并排空读写。

<a id="known-limitations"></a>
## 已知限制

本策略覆盖列出的应用 HTTP 消费者，不限制 Shell、Git、MCP stdio 子进程、worker thread、任意 Node socket、其他插件 HTTP client、web-search／fetch provider、账号登录或包管理器流量。Proxy 路由、执行权限和企业网络管控保持分离。源码／本地 provider 及 Node-mode 完整 profile 证据不等价于安装包、企业网关、Electron renderer 行为或全局零外联资格。[覆盖记录](../../../../migration/roadmap/probes/T23-egress-coverage.md) 列出实际路径与剩余观察。

## 路由归属与选择

只有成功注册的托管路由进入连接请求 hook。保存会在凭据写入前及状态提交前检查冲突；最终适配器注册仍为原子操作，不构成跨异步检查的全局预留。请求 header 保留真实 revision，并可记录供选择回放使用的稳定 providerIdentity。已开始步骤的重试保留原 revision 租约。替换凭据会轮换不透明缓存分区，保留凭据则保留分区。profile 与重试元数据按不可变 revision 缓存，每次请求适配器仍捕获当前租约检查。
