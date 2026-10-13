---
description: "Optional working notes and compaction organization for official agent modes."
kind: "package-reference"
---

# @nidofy/dsh-working-notebook

English | [中文](README.zh.md)

## Summary

This independent plugin supplies note tools, original-history browsing, versioned user corrections and turn-boundary note snapshots. Standard and Creator retain their official preset definitions. Disable the plugin through Plugin Manager to remove its tools, prompt contribution, endpoints and UI without deleting notes or affecting desktop appearance and pets.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The private desktop bundle mounts this package separately from desktop extras. Its Desktop Client panel and Settings consume the public CompanionScope owner, including exact Session selection and cancellation. The rail opens notes explicitly. Without that Desktop owner the client contribution remains unavailable; the independently mounted Host note tools and store keep their own lifetime. New scopes do not rebind or delete old physical Notebook generations. Existing notes remain under `$DSH_HOME/nidofy-extras/notebooks`; no Session migration is needed. The five official history tools and persistent search index remain separately owned by the bundle.

“Organize notes during compaction” is a profile-wide, persisted switch, initially off. It applies from the next basic-compaction summary, including manual `/compact`, across Standard, Creator and other presets using the official basic provider. Switching it off keeps manual edits, model note tools and existing note snapshots available. A choice changed during a summary discards that operation's note candidate. Saved choices override the `autoOrganize` initial Config value.

The product reads and edits v2 state. Five Config fields independently bound active entries (`maxActiveEntries`), complete active injection bytes (`maxActiveBytes`), delta bytes (`maxDeltaBytes`), evidence appendix bytes (`maxEvidenceBytes`) and history disk bytes (`maxHistoryBytes`). The Panel reads active notes and paged retired history; restore remains an explicit user operation. Every accepted setting revision aborts the previous revision lifetime, including candidates waiting for storage admission. Scope conflicts and numeric legacy generations preserve committed data and require explicit reconciliation; the conversation continues without injecting those notes. See the [upgrade guide](../../../docs/upgrade-guide/v0.2.0-rc.2/notebook-v2-generation/guide.md).

Startup and successful compaction explicitly synchronize durable note candidates. Turn snapshots, note reads and status read only committed v2 state; reading does not run recovery or create a converted notebook. The Panel explicitly synchronizes on refresh and shows pending, ready or failed organization while retaining committed notes. Original-event lookup and search go directly to the Session query service; recent sources are bounded by `recentScanEvents` (default 256) and `recentEventLimit` (default 40). `maxCachedSessions` (default 32) bounds idle metadata entries; active jobs remain pinned until settled. The cache stores physical scope and synchronization progress, not event arrays.

History retains official unicode61 phrase recall for words, filenames and error codes. Literal queries of at least three Unicode codepoints also use SQLite [trigrams](https://sqlite.org/fts5.html#the_trigram_tokenizer) over bounded checkpoints; no dictionary segmentation or cloud embedding is required. Single-character and two-character queries retain the `recentScanEvents` original-event window. `maxCachedSessions` caps substring source Sessions, `recentEventLimit` caps returned sources, and `maxEvidenceBytes` bounds original text plus locators in UTF-8. Source, index, window, byte or result limits report incomplete coverage. Matching adds no model calls.

Search defaults to the current Session, with exact cwd available explicitly. “Choose project workspaces” saves a complete selection of registered Workspace IDs and exact paths, granting local history reads among those members. Names and path prefixes confer no permission; a Workspace in another project cannot be silently merged. Candidate loading, return, preview and explicit citation recheck the association revision, current registration, Session attachment, raw source cwd and physical generation. Editing or removing a project invalidates its old results. Missing directories and corrupt association records refuse project reads and preserve the records.

Under the existing Notebook home, `history-projects-v1` selects complete immutable revisions by CAS; `history-substrings-v1` holds disposable checksummed checkpoints. Each namespace independently uses `maxHistoryBytes`, including publication temporaries and crash/corruption residue; complete association metadata responses use `maxEvidenceBytes`. Association records are retained. Derived checkpoints can be deleted and rebuilt; corruption is backed up before reconstruction, while unknown newer versions refuse overwrite. Same-generation appends extract events after the checkpoint cut; generation, prefix or anchor changes rebuild it. Each operation reconstructs its SQLite table from one bounded checkpoint. Original decoding and table construction retain full-source costs and do not establish peak-memory qualification.

Changing the search text or range cancels pending search, preview and draft-reference reads and clears the previous selection. Choosing another result supersedes the previous preview. Late responses cannot republish a cancelled selection or insert its reference, even if the transport completes after cancellation. Closing the panel cancels its reads; HTTP disconnect also cancels the Host operation. Index loops yield between configured batches and check cancellation before publication. Later cancellation does not roll back a completed checkpoint, and no cancelled reference is replayed.

Explicit history insertion uses the official revision-guarded composer append. Existing text, reference chips, attachments and selection survive, the insertion creates one undo step, and no message is submitted. Busy, disposed or stale inputs refuse without replacing the draft.

The shared `nidofyNotebookV2` service provides `read`, explicit `synchronize`, immediate `synchronization` and [complete input capture](../../../docs/subsystems/compaction.md#notebook-input-capture) for other consumers. Companion uses only read; its full UI scope is distinct from the physical Notebook generation. The private 1k/10k/100k synthetic harness (`desktop-extras/tests/notebook-performance.ts`) records elapsed time, ending heap/RSS deltas and event-loop delay under `.build/dispatch/evidence/relay-03`; these are not peak-memory or installed-product measurements.

Desktop Panel and Settings registrations withdraw and reread Companion facts when a note update or explicit synchronization settles, including an uncertain response. This read-only callback uses the complete existing scope; it does not claim whether a failed request committed, replay a write, or change notification handling. Current committed corrections replace older Hint sources without requiring a conversation switch. Standalone Panel hosts without a Companion do not acquire one.

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin uses the `compaction/basic-summary` waterfall, adding a bounded appendix to the official trailing summary directive. It leaves replayed messages, tool schemas, routing, pressure thresholds, pruning, commit and cancellation with the official engine. Successful durable compaction publishes validated note deltas; malformed candidates fall back to ordinary summarization. The shared implementation remains in desktop-extras library exports, which do not activate that package's desktop plugin. The [compaction subsystem](../../../docs/subsystems/compaction.md) owns summary transactions.

Plugin disposal removes its event handlers and waits for pending work. Notes are non-authoritative reference material with exact source-event citations. Model writes cannot change user-pinned notes. No invariant companion is published because publication is owned by the versioned store and official compaction transaction rather than independently maintained runtime observations.

<a id="model-experience"></a>
## Independent client and drafts

The Notebook Settings entry does not require the optional Companion client. Advanced settings and context details are collapsible. Drafts remain local to the current Host generation and Session; a completed save clears only the unchanged submitted draft. Disabling Desktop Extras still disables routes owned by that plugin, including its management pages.


## Model Experience

### Working notes

#### What the model sees

`notebook_read` and `notebook_update` are available while this plugin is enabled. Updates use revision checks, evidence quotes and entry limits. Disabling automatic organization does not remove these tools.

#### Token effect

Committed notes enter the next turn through logged runtime context. Enhanced summaries request an incremental note delta alongside the ordinary checkpoint. Only original cited events support new entries.

#### KV Cache effect

With organization off, the plugin does not alter the official summary request. When on, one bounded trailing appendix preserves the original request prefix; notes and generated deltas add tokens. Invalid enhanced output may cause another ordinary summarization request. Disabling the plugin removes future note injection but does not erase already logged history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Custom compaction providers that bypass the basic-summary hook are not enhanced. Compatibility Notebook presets remain available for saved conversations; new conversations can use the official modes. The switch is profile-wide, not per conversation. Substring recall remains bounded by sources and checkpoint capacity; short queries remain window-bound. Projects require actual Workspace registrations and attached Sessions. Association history at its disk limit refuses further writes; corrupt authority never resets to empty. Full-log costs remain, and regressions do not establish long-task accuracy, cost or cold-read peaks.
- Startup synchronization, durable observation and cold JSONL/query preparation remain proportional to full history. Candidate reconstruction starts after the actual commit cursor, but fetching the raw durable prefix is still a full observation. Warm committed and status reads avoid that scan. History validation is explicit; lightweight reads validate the selected pointer.

<a id="dev-note"></a>
### Dev Note

This private package ships with the Nidofy desktop bundle. When updating upstream, verify the basic-summary hook and independent plugin disposal before rebuilding the desktop candidate.
