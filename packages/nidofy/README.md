---
description: "Nidofy distribution extensions over official Harness services."
kind: "package-group"
---

# nidofy/

English | [中文](README.zh.md)

## Summary

Private distribution packages keep optional personal features outside the official engine.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

- [Desktop bundle](desktop-bundle/README.md) selects the optional plugin through a profile bundle.
- [Working notebook](working-notebook/README.md) owns optional notes and compaction organization across official modes.
- [Desktop extras](desktop-extras/README.md) owns diagnostics, synthetic probes, vision, pets and paused schedule import.
- [Secure credentials](secure-credentials/README.md) protects managed references and records with Windows DPAPI under an explicit overlay.

The [boot subsystem](../../docs/subsystems/boot.md) owns profile resolution; the [web client subsystem](../../docs/subsystems/web-client.md) owns client lifecycle and authenticated communication.

<a id="dev-note"></a>
## Dev Note

These packages do not implement an Agent Loop or a Session writer. Native distribution adapters remain in Desktop Main and Host.

The [workspace constraint check](../../scripts/check-workspace-constraints.ts) requires this group's package names to match `@nidofy/dsh-<directory>`, with `private: true` and no `publishConfig`. Official npm release requirements remain separate.
