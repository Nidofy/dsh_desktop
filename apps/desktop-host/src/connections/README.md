---
description: "Configure Desktop HTTP destinations and inspect refused requests."
---

# Desktop HTTP destinations

English | [中文](README.zh.md)

## Summary

Desktop model requests, model discovery and MCP HTTP use an application policy before preparing and sending requests. Packaged distribution limits, editable profile limits and exact Workspace limits intersect. A changed policy invalidates prepared requests; refusing a request never selects another endpoint or credential.

## Table of Contents

- [Configure destinations](#configure-destinations)
- [Scope and revisions](#scope-and-revisions)
- [Consumers and credentials](#consumers-and-credentials)
- [Recovery](#recovery)
- [Known limitations](#known-limitations)

<a id="configure-destinations"></a>
## Configure destinations

The packaged `resources/personal.egress.json` and `resources/intranet.egress.json` contain `schemaVersion: 1`, a distribution `revision` string and `origins`. Personal defaults to `null`; intranet defaults to an empty list. A deployment can publish exact approved HTTP(S) origins in its intranet artifact. An origin includes scheme and port, without credentials, path, query or fragment; wildcard hosts and path prefixes are unsupported. User settings cannot expand this packaged maximum. Main’s existing intranet Chromium and external-link restrictions still apply independently.

The authenticated `/api/nidofy/egress` endpoint accepts `action: 'status'` or `action: 'save'`. A save supplies `expectedRevision` and a complete `policy` containing `schemaVersion: 1`, the current integer `revision`, `profile` and `workspaces`. A Workspace row contains the real Workspace `id`, its exact canonical `path` and `origins`; saving requires that registry entry and directory to exist. `null` imposes no additional origin restriction, and `[]` denies every origin. An uncertain save is reconciled by status, without automatic retry.

<a id="scope-and-revisions"></a>
## Scope and revisions

The [policy owner](egress.ts) captures the complete policy document and distribution revision before authentication. Scoped sends use real Session membership from the existing Workspace registry, without inferring permission from cwd prefixes, repository names or model statements. A configured Workspace rule requires its exact stored path. Changes to the document, registry provider or relevant Session attachment invalidate the captured authorization. With no Workspace rules, a new Session attachment does not change profile authorization.

Unscoped operations, synthetic probe Session labels and MCP connection traffic apply all narrower Workspace rules. An `analyze_image` tool call carries its actual Agent Session; the standalone confirmed image UI remains an unscoped operation. A prepared request never gains broader permission by omitting or replacing its Session. Checks precede payload/credential work and every actual fetch; endpoint-origin changes and all HTTP redirects refuse, even when another origin is also allowed.

<a id="consumers-and-credentials"></a>
## Consumers and credentials

Managed connection saves validate resolved model endpoints before staging secrets and again before publication. `checkConfiguration()` checks distribution/profile limits for a shared definition and grants no request permission; actual sends still apply their Workspace restrictions. The existing [profile editor](../../../../packages/boot/config-editor/README.md) also prepares and rechecks authorization for changed PiAi routes, DeepSeek configurations and MCP HTTP configurations before replacing the patch. Unchanged catalog diagnostics remain editable. The official profile launcher provides the optional [HTTP capability types](../../../../packages/util/http-proxy/src/egress.ts) before Loader entries can connect; ordinary upstream launches without a provider retain their existing behavior.

PiAi captures authorization with prepared calls and injects its fetch into the two qualified HTTP APIs: `openai-completions` and `anthropic-messages`, using an explicit credential and SSE. Alternate native authentication, other APIs and WebSocket transports refuse while this provider is installed. Discovery, DeepSeek Messages/Files and MCP startup, reconnect, POST, GET and DELETE all use an origin-bound fetch. The fetch preserves the original headers only for that original origin and follows no redirects. Caller cancellation remains connected while the response body is read, including after headers and garbage collection; the original Response metadata remains intact. baseURL remains a provider endpoint, not a general HTTP proxy. Probe requests and image calls reach these same adapters.

<a id="recovery"></a>
## Recovery

Editable policy lives at `nidofy-connections/egress.json`, bounded to 64 KiB and written through the existing native quota with temporary replacement bytes included. Reads refuse symbolic links, linked policy directories, malformed documents and future versions without overwriting them. CAS conflicts require a new read. Connection journals retain their existing staged-secret cleanup semantics; policy failure never makes an uncommitted candidate current. Disposal rejects new work, aborts owned transports and drains reads and writes.

<a id="known-limitations"></a>
## Known limitations

This policy covers the listed application HTTP consumers. It does not confine Shell, Git, MCP stdio children, worker threads, arbitrary Node sockets, other plugins’ HTTP clients, web-search/fetch providers, account-login flows or package-manager traffic. Proxy routing, execution permissions and enterprise network controls remain separate. Source/local-provider and Node-mode full-profile evidence does not qualify an installer, corporate gateway, Electron renderer behavior or global zero-egress. The [coverage record](../../../../migration/roadmap/probes/T23-egress-coverage.md) names the actual paths and remaining observations.

## Route ownership and selection

Only successfully registered managed routes enter the connection request hooks. Saving checks conflicts before credential storage and before state commit; final adapter registration remains atomic, without a global reservation across asynchronous checks. Request headers preserve the actual revision and an optional stable providerIdentity for selection replay. Retrying an open step keeps its revision lease. A replacement credential rotates an opaque cache partition; keeping a credential retains it. Profile and retry metadata are cached by immutable revision, while each request adapter captures its current lease checks.
