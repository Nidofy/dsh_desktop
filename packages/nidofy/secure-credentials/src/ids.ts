/** Migration identity admission; ids cross Host recovery and durable receipt boundaries. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { SecureCredentialError } from './errors.ts'
import type { MigrationOperationId } from './types.ts'

/** Admit the caller-retained UUID for one migration, without exposing arbitrary input in diagnostics.
 * @param value - original operation UUID.
 * @returns the branded migration identity.
 */
export function migrationOperationId(value: string): MigrationOperationId {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) {
    throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
  }
  return brandString<MigrationOperationId>(value)
}
