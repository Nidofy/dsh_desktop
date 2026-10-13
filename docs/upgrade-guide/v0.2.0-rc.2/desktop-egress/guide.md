---
kind: upgrade-guide
description: "Derived Desktop HTTP routes require the packaged and profile destination policy."
---

# Desktop HTTP requests require explicit destination authorization

English | [中文](guide.zh.md)

## Change

Derived Desktop launches provide HTTP authorization before model/discovery and MCP entries connect. Intranet artifacts default to no allowed destinations; previously their Chromium restriction did not restrict these Node HTTP consumers. Distribution, profile and exact Workspace limits now intersect, and policy changes invalidate prepared requests. PiAi routes under this provider require explicit credentials and qualified SSE APIs (`openai-completions` or `anthropic-messages`); native authentication, other APIs and WebSocket transports refuse. Ordinary upstream launches without this provider retain their behavior. This does not confine other Node, Shell, Git or arbitrary socket traffic.

## Migration

1. For an intranet artifact, set exact approved origins and a distinct revision in `apps/desktop/resources/intranet.egress.json` before packaging. Keep the existing Chromium/external-link restrictions and enterprise gateway controls. The `origins` list must contain canonical HTTP(S) origins without credentials, path, query or fragment; an empty list denies every destination.
2. Configure qualified PiAi HTTP routes with an explicit credential. Use the provider's canonical endpoint because redirects refuse, including redirects to another allowed origin. baseURL remains an endpoint and does not replace proxy settings.
3. Read `/api/nidofy/egress` status before an authenticated CAS save of profile/Workspace limits. A Workspace rule requires the real ID and exact path. Re-read uncertain saves; do not retry a lost response automatically. Reprepare invalidated calls explicitly, without widening a prepared call or replaying uncertain effects.
4. Confirm that an approved local test endpoint receives the expected request and that refused targets/redirect sinks receive none. No Session conversion or default credential-provider change is required. Preserve data and evidence for rollback; a previous program does not enforce the new policy, so retain external network controls and use the pre-upgrade copy. See the [policy reference](../../../../apps/desktop-host/src/connections/README.md) for covered consumers and limits.
