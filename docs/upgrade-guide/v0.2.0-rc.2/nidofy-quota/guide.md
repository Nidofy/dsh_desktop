---
kind: upgrade-guide
description: "Nidofy writers require the shared native ledger; import adoption appends v2 records that old helpers refuse."
---

# Nidofy managed storage admission

English | [中文](guide.zh.md)

## Change

The Nidofy Desktop bundle replaces process-local admission with a shared Windows ledger under the physical distribution root. Its storage plugin requires DSH_DESKTOP_PROTECTION_HELPER. Raw native mutations without a Host capability refuse. Existing Notebook generations stay in place; adapters may return a settlement lease.

The helper reads existing v1 journal prefixes and appends v2 records, preserving prior bytes. Old helpers refuse v2. Import uses the same operation identity as its grant, an explicit cumulative byte ceiling and an independently confirmed in-place adoption. An adopted home uses the original ledger, never a nested one. Adoption does not select the home for the running Host.

The product uses an in-memory search index and retains old disk indexes. Native importArchive requires expectedRevision from verifyArchive; importing a snapshot does not restore project files. Pet ZIP exports must target outside the distribution root.

## Migration

1. Ship the rebuilt protection helper with the current Host/profile. Keep the storage row and required injections together. Set limitBytes and safetyBytes for new ledgers; existing limits change through explicit configuration without revoking terminal grants.
2. Preserve the physical root and .nidofy-storage-v1/ledger.jsonl. Do not reset or rebind it. Downgrade requires a preserved pre-upgrade distribution copy, not an older helper writing into v2.
3. In Connections and migration, choose the declared source version 0.2.0 or 0.2.5-rc.1 and preview its categories and configuration namespaces. Preview validates inventory/settings; execution also validates Session contents with official readers and copy digests. Unknown versions/formats and ambiguous setting namespaces refuse while preserving the source. Retain the operation ID, enter a cumulative write ceiling and confirm copying. The ceiling includes copies, encoded successors and temporary metadata; sourceBytes is not that ceiling. Inspect unknown responses; recover only explicitly after the old owner exits. Interrupted copying cannot resume. Existing standalone imports cannot acquire authority from invented records.
4. Read the committed report, then confirm adoption separately. Check the explicit next-launch choice to prepare the returned home, data root and --nidofy-desktop-data-root argument for the existing Desktop launcher after exit; ordinary CLI uses DSH_HOME. This does not start a process or switch this Host. The home-level cordis.patch.yml supplies the copied Session root/encoding. On the selected home, review actual workspace commands and protection paths through their separate owners; imported review copies stay inactive. Import plans only through an explicit JSON manifest as paused, then select a main Session, new future rule and separate confirmation per plan. Rebind keys. Fixed retained import charges remain; sibling electron runtime state follows the ordinary exclusion. No schedule activation, Notebook rebinding or retained-charge deletion is automatic.
5. Use Storage and quota for explicit reconciliation. Inventory live lengths differ from retained ledger charges. Verify archives before passing expectedRevision, and confirm restoration separately. See the [native protocol](../../../../native/nidofy-protection/README.md) for identities, phases and recovery. Ledger sync acknowledgement adds no power-loss guarantee to ordinary import metadata or rename.
