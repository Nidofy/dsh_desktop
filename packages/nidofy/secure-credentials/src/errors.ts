/** Value-free diagnostics for storage and helper failures. */

/** Stable diagnostic codes; callers must never log helper output or plaintext parser errors. */
export type SecureCredentialCode =
  | 'SECURE_BACKEND_UNAVAILABLE' | 'SECURE_STORAGE_UNAVAILABLE' | 'SECURE_INVALID_DOCUMENT'
  | 'SECURE_SIZE_LIMIT' | 'SECURE_DISPOSED' | 'SECURE_ENV_SHADOWED'
  | 'SECURE_MIGRATION_PENDING' | 'SECURE_MIGRATION_CONFLICT'

/** A safe diagnostic with no original error, secret, child output, or source line attached. */
export class SecureCredentialError extends Error {
  constructor(public readonly code: SecureCredentialCode) {
    super(code)
    this.name = 'SecureCredentialError'
  }
}
