# Desktop logical fingerprint schema v1

0.1.7 adds a schema-v2 report envelope; the existing v1 digest representation is unchanged. New `skillCatalog` and `projectInstructions` digest domains project matching message `content` and `source` without message IDs. They share the existing bounded hashing budget. Old v1 exports without these fields remain unknown for these comparisons. The dependency-manifest SHA-256 is explicitly not a full runtime tree fingerprint. See [0.1.7](EXPERIMENTS-0.1.7.md) for persistence, task completeness and environment coverage.

Scope: the options seen at DSH `llm/stream`, **not** adapter-private state or final HTTP bytes. Production never intercepts HTTPS. Synthetic integration tests separately compare final HTTP bodies.

Each digest is HMAC-SHA256 with the prefix `DSHDesktop:fingerprint:v1\0`. The 32-byte key is generated with Windows BCrypt, stored as a separate current-user Credential Manager record, and delivered in the supervisor's inherited stdin pipe. It is independent of the API key, ZIP location, model and provider. No key is written to environment variables, overlays, diagnostic records or exports. Failed credential access uses an explicitly labelled ephemeral process key. Reset from desktop settings takes effect on the next engine restart.

`fingerprintSchemaVersion: 1` and `keyScopeId` accompany every export. Compare hashes only when both match. `keyScopeId` and pseudonymous session/connection IDs are HMAC-derived short identifiers, not secrets. Equal digests reveal equality within a scope; metadata exports are not anonymous.

## Representation

- Strings use JSON escaping without changing whitespace, Unicode normalization, newlines or contents.
- Message arrays, content-block arrays, tool arrays and every nested array retain their exact order. Tools are **never sorted**.
- Plain-object keys sort by JavaScript code-unit order. Undefined object properties are omitted, matching JSON. Unsupported prototypes, undefined array members, cycles/deep values and non-finite numbers produce `complete:false`; no partial hash is presented as a complete comparison.
- `toolsSerializationOrder` separately retains object property enumeration order. It can detect logical tool serialization-order changes that the canonical tool digest omits. It is still not a wire hash.
- `system`: `{system: options.system ?? null, messages: all system-role messages in their original order}`.
- `tools`: the full ordered schemas or `[]`.
- `messages`: one digest for each complete logical message object, including its source/replay metadata when present. Such metadata can change independently of provider-visible text.
- `model`: `{provider, model}`.
- `config`: desktop/DSH version, API format, effective startup spill budget, HMAC connection profile ID, reasoning effort, temperature, max output tokens and stop strings. Credentials are excluded. This is a declared subset, not a digest of every possible third-party plugin setting.
- Session and connection identifiers use HMAC-SHA256 over their respective source strings, truncated to 24 hex characters. No raw session IDs, endpoint paths, API keys, prompts, replies or tool arguments are retained.

## Bounds and comparisons

One analysis has a shared 4 MiB serialized-work budget, a 16 ms cooperative deadline, at most 2,048 messages, 100,000 nodes and depth 64. `analyzedBytes` counts **hashing work across domains**, including repeated system/tool representations; it is not request size or token count. The time limit is checked during traversal and is not a hard real-time deadline.

The live store retains at most 500 completed records and 10 MiB of serialized completed metadata; oldest records are evicted. At most 64 additional in-flight records and 500 session boundary/statistic entries are retained. JavaScript heap usage can exceed serialized size. Restart clears live records; exported scopes remain comparable across restart. In 0.1.7, explicit measurement archives (or opt-in automatic turn archives) persist as bounded JSON files, at most 100 files / 50 MiB. Tool metadata has a separate 2,000-row bound and drop count.

Comparison uses the previous retained, completed logical request in the same pseudonymous session and purpose. It reports the longest unchanged message-hash prefix and a zero-based first changed position. First/unknown-session/incomplete requests are `NOT_COMPARABLE`; model/config changes are explicit facts. These facts are not provider cache diagnoses. Concurrent completion order is not a causal ordering guarantee.

`COMPACTION` comes from explicit purpose or a native `compaction/end` boundary. `RETRY` comes from native `llm/retry-started`. No retry is inferred from repeated text. Native event turn/step numbers are copied when known. Native `sessionStats` is observed through the projection change feed without rebuilding its timing logic. It has whole-session scope, distinct from the retained-request window; summed parallel tool intervals are not wall time.

Usage source is `dsh-adapter`. `inputTokens` is uncached input. Cache read/write are distinct; absent fields stay null, including an adapter that omits zero counters. Aggregate input is derived only from valid `totalTokens - outputTokens`. Reasoning is displayed separately and never added again to output. Missing fields cannot distinguish provider omission from adapter loss at this boundary. Timing starts before local capture, first output includes reasoning/tool arguments, and first visible text is separate.
