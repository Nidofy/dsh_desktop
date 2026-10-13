# Agent Note: Engineering resource checkpoints

Status: implemented

English | [中文](2026-10-11-engineering-resource-checkpoints.zh.md)

## Problem

Incoming project-copy limits and native managed-journal quota exclude later project outputs and official Session storage. Treating either limit as a complete action or memory ceiling permits misleading capacity and efficiency claims. Retained copies also survive successful, refused and interrupted runs, including runs in another Host.

## Decision

The [engineering resource owner](../../../../apps/desktop-host/src/experiments/engineering-resources.ts) consumes explicit local-user checkpoint limits independently of request/output limits. Admission retains each allocation's complete per-copy charge, rather than refunding unused space, so another Host's partial or in-flight copy cannot appear free. An independently published physical allocation identity distinguishes a known empty allocation from an unaccounted historical path. Old journals remain readable without supplying retrospective ownership; new admission refuses unknown owners.

The owner observes whole copied trees between operations and after drainage. Official durable observations supply logical prefixes; official `stat` supplies physical file lengths under generation protection. The owner preserves missing observations and leaves disk/memory peaks null because these checkpoints occur after allocation and between writes. An action's post-execution refusal stops subsequent work while preserving its actual tool result and causal T11 receipt. Separate sidecars preserve old engineering/Session formats and do not alter native managed categories.

## Alternatives considered

**Reuse incoming closure or managed-journal limits.** Those owners do not observe later copied output or official Session files. Reusing their counters cannot enforce or certify those resources.

**Charge current retained lengths only.** An unfinished allocation in another Host can grow after that scan. Retaining its complete explicit ceiling makes cooperative admission conservative without inferring drainage from a missing terminal or elapsed time.

**Throw after an executed action exceeds its resource limit.** The tool pipeline then replaces the real result with an error, losing the original causal receipt link. Revoking later work preserves both facts: the action executed and resource admission no longer permits continuation.

## Consequences

Capacity can refuse before the twenty-journal retention limit, even when current files are small; retained allocations are not automatically pruned or adopted. Action-time disk growth, Shell spill outside the copy, allocation overhead and decoded/Host memory remain outside this checkpoint guarantee. Full peak enforcement needs the actual writer or execution provider to own that limit; a scanner cannot supply it.

The supported-profile tests retain synthetic over-limit outputs, verify zero dispatch after Session-budget denial and preserve actual T11 receipts after output refusal. Cold reads, historical sidecar absence, forged peaks and allocation-free aggregate refusal are independently checked. Renderer qualification uses the existing physical Electron runtime, production Main/preload and isolated synthetic profile; it supplies no installer, real-model quality, provider-cache or billing qualification. User-facing limits and failure behavior belong to the [owner reference](../../../../apps/desktop-host/src/experiments/README.md#isolated-engineering-task).
