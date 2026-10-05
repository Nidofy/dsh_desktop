---
description: "Optional local diagnostics, cache experiments, vision and pets for the derived Desktop."
kind: "package-reference"
---

# @nidofy/dsh-desktop-extras

English | [中文](README.zh.md)

## Summary

The derived Desktop's Personal extensions window controls local diagnostics, synthetic cache experiments, an independent image connection and up to three desktop pets. These four capabilities start disabled; working notes and history are enabled by the bundle. Official services retain model execution, credentials, files, Sessions, theme settings and scheduling. The companion bundle installs this plugin through the official profile Loader.

## Table of Contents

- [Use this package](#use-this-package)
- [Ownership and persistence](#ownership-and-persistence)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The Environment card and companion occupy a 300px rail beside the conversation through the additive shell.accessory slot. The rail appears when the center has at least 1040px after official sidebars take their space. Folding Environment expands the companion. Hidden or folded cards stop repository polling; the Application menu retains access to workbench tools at narrow widths. The wallpaper and Windows icons reuse the Tauri assets, with the wallpaper at 14% opacity. The nidofy.companion child slot supplies active and sessionId to an optional replacement renderer; Live2D adapters must pause when inactive and dispose animation, listeners and graphics resources on unmount. The built-in renderer uses a static local portrait; no Live2D runtime or model is bundled. Show pet enables both the service and the selected instance; adding an instance also enables the service. Hide all pets stops the service.

The Environment card expands changes, text diffs, local repository information and branch actions inline. Its action menu offers commit, push, create branch and switch branch; mutations require a preview followed by explicit confirmation and inherit deployment protection. Commit includes staged files only. Details expose a separate full-workbench link. Connection settings open through an explicit editor link. Changing conversations resets details and pending previews.

Open Application → Personal extensions in the Nidofy desktop distribution. Enable the capabilities you need and save. The plugin manager can disable the entire plugin; connections, protection and the engineering workbench have separate owners. Native recovery removes its bundle and subsequent launches preserve that choice.

Cache experiments require a selected connection with retries disabled, a known context limit, a budget of 512, 2048 or 8192 estimated input tokens and four or six requests. Confirmation sends synthetic text only. Character count divided by four is an estimate; bytes and reported token counters remain separate. Missing cache counters or shorter latency do not prove a cache hit. Legacy byte budgets require a new explicit choice and never run automatically.

Vision requires an image-capable model on a selected managed or official connection. The local action confirms one image and question; the optional `analyze_image` tool lets an Agent request the same operation. Provider requests use the official prepared-call path. Image attachments use official storage. Disabling vision cancels and drains its requests and removes the tool.

Pet resources support local preview, digest-checked import, explicit replacement, ZIP export and deletion. Built-in resources are read-only. Each instance has independent size, pin, position, interactions, gaze, quiet mode, local mood and bubble settings. Corrupt resource catalogs preserve the file and retain the built-in fallback.

The pet menu opens beside the sprite and closes on Escape or loss of focus. Auto-focus tasks immediately releases a pinned Session and prioritizes waiting tasks, blocked tasks, running tasks, then recent completion notices. With no active task the pet idles. The menu shows the selection mode and a short Session identifier; double-clicking the pet opens that Session.

Enable Automation tasks in the official plugin manager to use the bundled schedule service without downloading packages. Import a reviewed `schemaVersion: 1` JSON manifest with an `items` array of title, prompt and optional timing metadata. Imported rows remain paused. Restore each to an existing root Session with a new future rule. An interrupted restore stays unknown and cannot be retried automatically.

Working notes and history are available inside the Environment card. Literal full-text search is local and scoped to the current Session or exact working directory; contiguous Chinese words require matching complete tokens. Results retain Session/event anchors. The existing `@` picker continues to capture explicit read-only Session references. Search failures remain errors, distinct from no matches.

Working notes are activated separately by the [working-notebook plugin](../working-notebook/README.md), which owns note tools, prompt snapshots and the optional compaction enhancement. Shared library exports here do not activate those features.

<a id="ownership-and-persistence"></a>
## Ownership and persistence

Preferences, probe receipts, report archives, pet resources and quarantined schedules live under `$DSH_HOME/nidofy-extras`. Preferences use revision checks and atomic replacement. Unreadable preferences disable optional capabilities and preserve the source. Diagnostic archives omit prompts, answers, credentials and file contents; user-controlled provider and model labels become process-local HMAC identifiers. Archives are bounded to 100 files and 50 MiB. Observer failures cannot replace model chunks or committed Session events.

Working notes carry a versioned store in this package. The v1 store keeps retired entries inside one bounded snapshot; the v2 `NotebookV2Store` separates the active set from an append-only history journal with its own disk budget, records dual evidence and commit cursors per Session generation, and never reuses a retired id. A publish appends journal records, publishes one content-derived immutable revision file through a completed temporary so a failed write never leaves a partial final file, then atomically replaces `current.json`; the committed journal length recorded in that pointer fences crash residue, and the next publish re-observes the real journal, truncates an uncommitted tail before appending, and reuses an identical revision file. A pre-existing file holding different bytes at the same content-derived name is refused untouched with a named diagnostic, because whether it was ever committed cannot be determined from the file, its name or its revision number. The v2 conversion copies a v1 notebook into a separate namespace and leaves the original bytes untouched, retries a failed commit pointer without rewriting identical journal bytes or duplicating the revision file, and refuses unknown legacy formats with a repairable diagnostic instead of overwriting them. A publish signal also aborts its lazy conversion before the first disk write; plain reads that trigger the conversion run it to completion. Writes above any budget fail with a named error rather than dropping pinned or retired evidence silently.

The native adapter owns only transparent windows and sender-checked IPC. Pet navigation uses the official workspace service. Theme and font settings use the official client. Schedule storage and delivery use the official schedule service. This package creates no Agent Loop or Session writer. No invariant companion is published: preferences have one serialized owner, while status and pet views are disposable projections verified at their consumers.

<a id="model-experience"></a>
## Model Experience

### Optional image tool and explicit requests

#### What the model sees

Vision adds `analyze_image` only while enabled. Its selected provider sees the image and question, without the conversation history. Diagnostics and pets add no model-visible content. Cache experiments make separate user-confirmed synthetic requests. Restored schedules follow the official schedule bundle's tool and message contracts.

#### Token effect

The image tool adds its schema while enabled and returns analysis text to the calling Agent. Explicit probes request at most 64 output tokens per request. Diagnostics, pets and appearance settings consume no model tokens.

#### KV Cache effect

Enabling vision changes the tool-schema prefix. Native cache mode leaves provider payloads unchanged; off mode removes the routing key; session mode supplies an HMAC scoped to the prepared provider, model, endpoint, home and Session for allowlisted OpenAI-compatible models. Payloads are copied. The HMAC secret changes on plugin reload, so keys and diagnostic fingerprints do not persist across reloads.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Synthetic provider qualification proves protocol and routing behavior, not a vendor's billed cache benefit or image quality. User credentials and enterprise gateway acceptance need their own environment.
- Schedule manifests are explicit imports, not an automatic reinterpretation of old scheduler databases. Unknown restore outcomes require inspection in the official task catalog.
- The native pet adapter targets Windows Desktop. This plugin is private and shipped with the derived distribution; it is not published to npm. Future extraction must qualify package compatibility and native adapters on each platform.
- Independent CLI profiles use the official CLI's execution behavior. Desktop connection/protection adapters are installed by Desktop Host and are not promised for arbitrary CLI profiles.
- The working-notebook plugin still reads and writes the v1 single-snapshot store, so live note budgets still count retired entries. The v2 active/history store ships as shared library exports until its consumers adopt it; one storage-admission object owns its local disk accounting, ready for the future quota owner to replace.

<a id="dev-note"></a>
### Dev Note

The [M4 qualification runner](../../../migration/m4/smoke-desktop.mjs) boots the packaged application with private test data and synthetic providers. Keep `src/legacy` ports isolated from upstream files; adapt the service consumers when the official contracts change. The [bundle](../desktop-bundle/README.md) owns activation, and the [client subsystem](../../../docs/subsystems/web-client.md) owns authenticated Host communication and client lifecycle.
