---
description: "Select optional Nidofy Desktop capabilities through the official profile Loader."
kind: "package-bundle"
---

# @nidofy/dsh-desktop-bundle

English | [中文](README.zh.md)

## Summary

This configuration-only bundle installs desktop extras, persistent literal history search, the five official history tools, and opt-in Notebook presets derived from the pinned official compositions. The derived Desktop enrolls it once in the managed profile; later removal and native recovery remain persistent.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The plugin manager selects this bundle in `dsh.profile.bundles`. Its patch enables history and the independent [working-notebook plugin](../working-notebook/README.md). Diagnostics, vision, cache experiments and pets remain opt-in. Official presets remain unchanged. Automatic note organization is initially off and enabled through the notebook switch; legacy Notebook presets remain for saved Sessions and use the same switch. Run `node packages/nidofy/desktop-bundle/generate-context-presets.mjs --check` after an upstream update. Follow the [plugin guide](../desktop-extras/README.md) to enable individual capabilities.

The exported [secure-credentials overlay](secure-credentials.patch.yml) replaces the credential row only when explicitly selected. It uses the [Windows provider](../secure-credentials/README.md) and requires an explicit `DSH_HOME`. The bundle's default patch list keeps the existing provider. Isolated Loader checks do not authorize automatic migration or default enablement.

The bundle requires `DSH_DESKTOP_PROTECTION_HELPER` to name the application-owned Windows helper and installs the shared [managed quota owner](../../../native/nidofy-protection/README.md). Working notes and extras inject that owner before activation. Search uses the official provider's `:memory:` index; retained disk indexes remain counted and untouched. Cold search rebuilds consume memory. Legacy import uses explicit bounded admission and separate in-place adoption without changing the running home; see the [upgrade guide](../../../docs/upgrade-guide/v0.2.0-rc.2/nidofy-quota/guide.md).

<a id="model-experience"></a>
## Model Experience

### Activation

#### What the model sees

The five official history tools plus `notebook_read` and `notebook_update` become available. Notes enter a logged turn-boundary snapshot; history tools return bounded, source-attributed content.

#### Token effect

No model request or token cost occurs on activation.

#### KV Cache effect

Tool schemas change the request prefix; added note snapshots and recalled evidence consume model input tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This private bundle ships with the derived Windows Desktop. It is not an independently published npm distribution.

<a id="dev-note"></a>
### Dev Note

The bundle and plugin have separate package identities because official profile resolution traverses bundle dependencies. No invariant companion is published: this package has no mutable runtime state.
