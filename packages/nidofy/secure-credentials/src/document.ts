/** Encrypted document admission, sharing the official managed reference and record parser. */
import { parseCredentialsDocument } from '@deepseek-ai/dsh-credentials-local'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { SecureCredentialError } from './errors.ts'
import { migrationOperationId } from './ids.ts'
import type { MigrationReceipt } from './types.ts'

/** Decrypted state; only encrypted bytes may be persisted. */
export interface SecureDocument {
  version: 1
  namespace: string
  revision: number
  refs: Record<string, string>
  records: Record<string, CredentialRecord>
  migration: MigrationReceipt | null
}

/** Validate an opaque grant before JSON serialization can silently drop or coerce values.
 * @param value - complete caller-owned value.
 * @param seen - ancestors used to reject cycles.
 */
export function assertJson(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || seen.has(value)) {
    throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
  }
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
    throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
  }
  seen.add(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) assertJson(value[index], seen)
  } else {
    for (const nested of Object.values(value)) assertJson(nested, seen)
  }
  seen.delete(value)
}

/** Admit secret-free migration metadata without accepting arbitrary fields.
 * @param value - parsed receipt.
 * @returns validated receipt.
 */
export function parseReceipt(value: unknown): MigrationReceipt {
  const v = object(value)
  if (Object.keys(v).sort().join(',') !== 'operationId,records,references,version'
    || v.version !== 1 || typeof v.operationId !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.operationId)
    || !Number.isSafeInteger(v.references) || typeof v.references !== 'number' || v.references < 0
    || !Number.isSafeInteger(v.records) || typeof v.records !== 'number' || v.records < 0) {
    throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
  }
  return { version: 1, operationId: migrationOperationId(v.operationId), references: v.references, records: v.records }
}

/** Require a JSON object at a durable parsing boundary.
 * @param value - parsed value.
 * @returns its fields.
 */
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
  }
  return value as Record<string, unknown>
}

/** Admit the whole decrypted document and clone records through the official parser.
 * @param text - decrypted JSON, never included in diagnostics.
 * @param namespace - expected canonical identity.
 * @returns validated state.
 */
export function parseDocument(text: string, namespace: string): SecureDocument {
  try {
    const v = object(JSON.parse(text))
    if (Object.keys(v).sort().join(',') !== 'migration,namespace,records,refs,revision,version'
      || v.version !== 1 || v.namespace !== namespace
      || typeof v.revision !== 'number' || !Number.isSafeInteger(v.revision) || v.revision < 0) {
      throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
    }
    object(v.refs)
    object(v.records)
    const parsed = parseCredentialsDocument(JSON.stringify({ version: 1, refs: v.refs, records: v.records }), '<encrypted>')
    return { version: 1, namespace, revision: v.revision, refs: Object.fromEntries(parsed.refs),
      records: Object.fromEntries(parsed.records), migration: v.migration === null ? null : parseReceipt(v.migration) }
  } catch (error) {
    // Even invalid tags/version fields may contain secret bytes; discard the parser error.
    void error
    throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
  }
}
