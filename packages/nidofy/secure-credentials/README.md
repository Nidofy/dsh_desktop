---
description: "Store managed credential references and authorization records with Windows DPAPI and recover explicit copy migrations."
kind: "package-reference"
---
# Secure credentials

English | [中文](README.zh.md)

## Summary

You can store API keys, provider environment records, and opaque JSON grants without writing their values to plaintext storage. Windows DPAPI protects the complete managed document for the current Windows user. Backend refusal leaves the provider loadable and rejects secret operations, allowing the Host to expose its repair services. Migration copies an explicitly selected document, preserves its source, and returns a receipt without secrets.

## Table of Contents

- [Use this provider](#use-this-provider)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-provider"></a>
## Use this provider

Mount `@nidofy/dsh-secure-credentials` in a Host composition. The desktop bundle exports an explicit [Windows overlay](../desktop-bundle/secure-credentials.patch.yml) with all deployment fields; it is excluded from the default bundle patches. The official provider remains the default. [Windows composition tests](tests/windows.spec.ts) exercise backend refusal and T01 repair behavior with isolated data.

All deployment fields are explicit:

| Field | Requirement | Meaning |
|---|---|---|
| applicationId / profileId | Lowercase letters, digits, dots or hyphens; start with a letter or digit | Separate storage identities |
| dshHome | Absolute path | Home identity is canonicalized; path aliases share one namespace |
| maxPlaintextBytes | Integer, 256 through 16 MiB | Complete UTF-8 document admission, including metadata |
| backendTimeoutMs / lockWaitMs | Positive integer through 2147483647 | Helper lifetime / writer acquisition wait in milliseconds |
| refreshIntervalMs | Integer, 0 through 2147483647 | External notification polling; zero disables polling |

References resolve in this order: inherited process environment, managed encrypted storage, project `.env`, user `.env`. A nonempty inherited value is read-only. Empty environment values do not configure a secret. A refused or invalid managed store rejects before dotenv fallback; it never silently substitutes a plaintext value. Records have no environment layer, including empty `api-key` records representing owner-confirmed ambient authentication.

The [migration methods](src/index.ts) accept a selected version-1 official credentials copy and a [branded operation UUID](src/ids.ts). Migration requires an empty destination. Retain the UUID before starting; after an unknown result, inspect it and explicitly recover the same operation. A prepared journal blocks ordinary writes until recovery. An undefined inspection result is not an instruction to replay. Source files are never rewritten or deleted. Metadata descriptions, record enumeration and receipts omit values; this provider exposes no ordinary secret export.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Storage and lifecycle</summary>

The encrypted document lives under `dshHome/secure-credentials/<namespace>/current.json`. Application, profile and canonical home determine both the namespace and DPAPI additional entropy. CurrentUser protection separates OS accounts; namespace entropy prevents accidental cross-application/profile/home reads but is not an authorization barrier against code already running as the same Windows user. [Microsoft's DPAPI reference](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata) defines the platform protection; the deployment document limit is not a claimed Windows maximum.

Every operation re-reads selected encrypted bytes. A per-provider queue and the official cross-process file lock serialize read-decide-write, including the whole asynchronous refresh callback. Writes validate and verify encrypted readback before atomic file replacement; notifications follow selection. External changes publish on the next read or enabled poll. Unload rejects new work, stops polling, waits for admitted work, and suppresses late notifications. The helper has fixed argv, a scrubbed environment, bounded private pipes, discarded stderr, and a timeout that kills and waits for close. No plaintext adapter is selected in production.

Migration encrypts a candidate, verifies its readback, records a secret-free journal, atomically replaces the selected document, verifies selection, and writes a receipt. Recovery reads the candidate or already selected migration; it does not reread the source or automatically replay an external authorization exchange. An unjournaled candidate remains unselected. The original official document format and Session generations remain unchanged.

No invariant companion is published: each operation admits the authoritative document directly, and retained notification state is never a credential read source. Journal/selected-operation consistency is checked in the recovery operation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Official credential service](../../credentials/credentials/README.md): the complete interface.
- [Official local provider](../../credentials/credentials-local/README.md): managed document parsing.
- [Desktop bundle](../desktop-bundle/README.md): explicit provider overlay and activation ownership.

-----

<a id="model-experience"></a>
## Model Experience

None, as credential values remain in Host authentication and are not added to model context.

#### KV Cache effect

The provider adds no prompt tokens and does not modify a model-visible prefix. Account/model routing remains owned by consumers.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The following limits affect deployment and recovery:

- Default-provider activation requires targeted security and recovery acceptance. General backup/export must exclude the private store and selected migration source copies. Workspace build and Loader evidence do not qualify an installer.
- Real Windows evidence uses synthetic scope identities and the current OS user. A separate SID, account-profile loss, enterprise policy denial, real authenticated UI and installer behavior require independent acceptance.
- Atomic replacement uses the official utility, which does not fsync files/directories. Fault-injection recovery tests do not promise power-loss durability. A reused live PID conservatively blocks stale-lock takeover; operator inspection is required.
- DPAPI access invokes a hidden PowerShell process per encryption/decryption. The whole document is bounded; no platform-scale performance or maximum-size claim is made. Same-user malware, Host memory, crash dumps and authorized authentication requests remain outside this storage protection.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Delivery context</summary>

The default-provider decision and packaged data/permission qualification remain pending; the explicit overlay does not activate itself.

</details>
