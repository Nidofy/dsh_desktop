/** Host-only parameters and encryption adapter for the secure credential provider. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identity of one explicitly selected copy migration, independent of connection save operations. */
export type MigrationOperationId = Branded<'SecureCredentialMigration'>

/** Explicit deployment choices; no ambient application or home identity is inferred. */
export interface Config {
  /** Application identifier, separate from official distributions. */
  applicationId: string
  /** Profile identifier within the application. */
  profileId: string
  /** Absolute, existing or creatable Harness home. */
  dshHome: string
  /** Maximum UTF-8 bytes of the complete decrypted document, including records and metadata. */
  maxPlaintextBytes: number
  /** Maximum lifetime of one Windows encryption helper, in milliseconds. */
  backendTimeoutMs: number
  /** Maximum cross-process writer lock acquisition wait, in milliseconds. */
  lockWaitMs: number
  /** External change observation interval in milliseconds; zero disables polling. */
  refreshIntervalMs: number
}

/** Encryption boundary; production uses Windows DPAPI CurrentUser, never a plaintext adapter. */
export interface SecretProtector {
  /** Encrypt bytes using the supplied namespace entropy.
   * @param data - plaintext kept in Host memory and the private helper pipe.
   * @param entropy - application/profile/canonical-home identity.
   * @returns authenticated ciphertext.
   */
  protect(data: Buffer, entropy: Buffer): Promise<Buffer>
  /** Decrypt bytes with the same namespace entropy.
   * @param data - stored ciphertext.
   * @param entropy - application/profile/canonical-home identity.
   * @returns plaintext; rejects if the backend or identity refuses access.
   */
  unprotect(data: Buffer, entropy: Buffer): Promise<Buffer>
}

/** Secret-free receipt for one explicitly selected copy migration. */
export interface MigrationReceipt {
  /** Format of the receipt, independent of Session formats. */
  version: 1
  /** Caller-supplied UUID, used to inspect an interrupted or lost acknowledgement. */
  operationId: MigrationOperationId
  /** Number of copied managed references; environment fallback values are excluded. */
  references: number
  /** Number of copied records. */
  records: number
}
