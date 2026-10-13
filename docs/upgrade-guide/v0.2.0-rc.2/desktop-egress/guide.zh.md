---
kind: upgrade-guide
description: "派生 Desktop HTTP 路由要求随包及 profile 目标策略。"
---

# Desktop HTTP 请求要求明确的目标授权

[English](guide.md) | 中文

## 变更

派生 Desktop 在模型／发现及 MCP 条目连接前提供 HTTP 授权。内网载体默认不允许任何目标；此前 Chromium 限制不限制这些 Node HTTP 消费者。发行、profile 及准确 Workspace 限制现在取交集，策略变化使已准备请求失效。使用此 provider 的 PiAi 路由要求显式凭据及已验证 SSE API（`openai-completions` 或 `anthropic-messages`）；原生鉴权、其他 API 和 WebSocket 传输拒绝。未安装本 provider 的普通上游启动保持原行为。它不限制其他 Node、Shell、Git 或任意 socket 流量。

## 迁移

1. 为内网载体在打包前设置 `apps/desktop/resources/intranet.egress.json` 中准确的已批准 origin 及独立修订。保持既有 Chromium／外链限制及企业网关管控。`origins` 列表必须包含规范 HTTP(S) origin，不含凭据、路径、查询或片段；空列表拒绝所有目标。
2. 为已验证 PiAi HTTP 路由配置显式凭据。使用 provider 的规范端点，因为所有重定向都拒绝，包括跳到另一个允许 origin。baseURL 仍是端点，不替代 proxy 设置。
3. 在认证的 profile／Workspace 限制 CAS 保存前读取 `/api/nidofy/egress` status。Workspace 规则要求真实 ID 和准确路径。未知保存先重读，不自动重试丢失响应。显式重新准备已失效调用，不扩大已准备调用权限或重放未知副作用。
4. 确认批准的本地测试端点收到预期请求，而被拒绝的目标／重定向 sink 没有请求。不需要转换 Session 或更换默认 credential provider。保留回退所需的数据和证据；旧程序不执行新策略，因此保持外部网络管控并使用升级前副本。覆盖消费者及限制见 [策略参考](../../../../apps/desktop-host/src/connections/README.zh.md)。
