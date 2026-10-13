/** Complete official CredentialProvider implementation with Windows-protected managed storage. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CredentialProvider, credentialRef, parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialKey, CredentialRecord, CredentialRecordEntry, CredentialRecordInfo,
  CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { WindowsDpapiProtector } from './dpapi.ts'
import { SecureCredentialError } from './errors.ts'
import { SecureStore } from './store.ts'
import type { SecureDocument } from './document.ts'
import type { Config, MigrationOperationId, MigrationReceipt, SecretProtector } from './types.ts'

export type { Config, MigrationOperationId, MigrationReceipt, SecretProtector } from './types.ts'
export { migrationOperationId } from './ids.ts'
export { SecureCredentialError } from './errors.ts'

/** Windows-only provider. Backend access is lazy so a denied store leaves Host repair services bootable. */
export class SecureCredentialProvider extends CredentialProvider {
  static Config: z<Config> = z.object({
    applicationId: z.string(), profileId: z.string(), dshHome: z.string(),
    maxPlaintextBytes: z.number(), backendTimeoutMs: z.number(), lockWaitMs: z.number(), refreshIntervalMs: z.number(),
  })
  private readonly store: SecureStore
  private tail: Promise<void> = Promise.resolve()
  private closed = false
  private snapshot: SecureDocument | undefined

  constructor(ctx: Context, private readonly config: Config, protector?: SecretProtector) {
    super(ctx)
    this.store = new SecureStore(config, protector ?? new WindowsDpapiProtector(config.backendTimeoutMs,
      (config.maxPlaintextBytes + 65_536) * 2))
  }

  *[Service.init](): Generator<() => Promise<void>, void, void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = (): void => {
      timer = setTimeout(() => {
        void this.enqueue(async () =>{  this.publish(await this.store.read()) }).catch((error: unknown) => {
          // No stale secret is served; consumers observe refusal on their next operation.
          if (!this.closed) this.ctx.logger.warn(error instanceof SecureCredentialError ? error.code : 'SECURE_STORAGE_UNAVAILABLE')
        }).finally(() => { if (!this.closed) poll() })
      }, this.config.refreshIntervalMs)
      timer.unref()
    }
    if (this.config.refreshIntervalMs > 0) poll()
    yield async () => {
      this.closed = true
      clearTimeout(timer)
      await this.tail
      this.snapshot = undefined
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new SecureCredentialError('SECURE_DISPOSED'))
    const task = this.tail.then(() => {
      if (this.closed) throw new SecureCredentialError('SECURE_DISPOSED')
      return operation()
    })
    this.tail = task.then(() => undefined, () => undefined)
    return task
  }

  private publish(next: SecureDocument): void {
    if (this.closed) return
    const previous = this.snapshot
    this.snapshot = next
    if (!previous) return
    for (const ref of new Set([...Object.keys(previous.refs), ...Object.keys(next.refs)])) {
      if (previous.refs[ref] !== next.refs[ref]) this.notifyUpdated(credentialRef(ref))
    }
    for (const key of new Set([...Object.keys(previous.records), ...Object.keys(next.records)])) {
      if (JSON.stringify(previous.records[key]) !== JSON.stringify(next.records[key])) this.notifyRecordUpdated(parseCredentialKey(key))
    }
  }

  private read(): Promise<SecureDocument> {
    return this.enqueue(async () => {
      const next = await this.store.read()
      this.publish(next)
      return structuredClone(next)
    })
  }

  private inherited(ref: CredentialRef): string | undefined {
    return launchEnvironmentOf(this.ctx).getFrom(ref, ['process'])?.value || undefined
  }

  override async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    if (this.closed) throw new SecureCredentialError('SECURE_DISPOSED')
    const inherited = this.inherited(ref)
    if (inherited) return { value: inherited, source: 'env' }
    const refs = (await this.read()).refs
    const stored = Object.hasOwn(refs, ref) ? refs[ref] : undefined
    if (stored) return { value: stored, source: 'windows-dpapi' }
    const fallback = launchEnvironmentOf(this.ctx).getFrom(ref, ['project-env', 'user-env'])
    return fallback?.value ? { value: fallback.value, source: fallback.source } : undefined
  }

  override async describe(ref: CredentialRef): Promise<CredentialInfo> {
    const value = await this.resolve(ref)
    return value ? { configured: true, source: value.source, writable: value.source !== 'env' }
      : { configured: false, writable: true }
  }

  private editRef(ref: CredentialRef, value: string | undefined): Promise<void> {
    return this.enqueue(async () => {
      if (this.inherited(ref)) throw new SecureCredentialError('SECURE_ENV_SHADOWED')
      const next = await this.store.modify((current) => {
        this.publish(structuredClone(current))
        if (value === undefined && !Object.hasOwn(current.refs, ref)) return Promise.resolve(undefined)
        current.refs = value === undefined
          ? Object.fromEntries(Object.entries(current.refs).filter(([name]) => name !== ref))
          : { ...current.refs, [ref]: value }
        return Promise.resolve(current)
      })
      const unchanged = this.snapshot?.refs[ref] === next.refs[ref]
      this.publish(next)
      if (value !== undefined && unchanged && !this.closed) this.notifyUpdated(ref)
    })
  }

  override async set(ref: CredentialRef, value: string): Promise<void> {
    if (value.length === 0) throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
    await this.editRef(ref, value)
  }

  override async unset(ref: CredentialRef): Promise<void> { await this.editRef(ref, undefined) }

  override async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> { return (await this.read()).records[key] }

  override async describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const record = await this.readRecord(key)
    return record ? { configured: true, kind: record.kind, writable: true } : { configured: false, writable: true }
  }

  override async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Object.entries((await this.read()).records).map(([key, record]) => ({ key: parseCredentialKey(key), kind: record.kind }))
  }

  override modifyRecord(key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    return this.enqueue(async () => {
      const written = { value: false }
      const next = await this.store.modify(async (current) => {
        this.publish(structuredClone(current))
        const replacement = await mutate(structuredClone(current.records[key]))
        if (replacement === undefined) return undefined
        current.records[key] = replacement
        written.value = true
        return current
      })
      const unchanged = JSON.stringify(this.snapshot?.records[key]) === JSON.stringify(next.records[key])
      this.publish(next)
      if (written.value && unchanged && !this.closed) this.notifyRecordUpdated(key)
      return structuredClone(next.records[key])
    })
  }

  override async deleteRecord(key: CredentialKey): Promise<void> {
    await this.enqueue(async () => {
      const next = await this.store.modify((current) => {
        this.publish(structuredClone(current))
        if (!Object.hasOwn(current.records, key)) return Promise.resolve(undefined)
        current.records = Object.fromEntries(Object.entries(current.records).filter(([name]) => name !== key))
        return Promise.resolve(current)
      })
      this.publish(next)
    })
  }

  /** Explicit Host-only migration; it does not create a connection/key mapping or delete the source copy.
   * @param selectedCopy - absolute path of the selected version-1 source copy.
   * @param operationId - retained UUID used to inspect or recover an unknown result.
   * @returns a receipt containing counts and identity only.
   */
  migrateCopy(selectedCopy: string, operationId: MigrationOperationId): Promise<MigrationReceipt> {
    return this.enqueue(async () => {
      this.publish(await this.store.read())
      const receipt = await this.store.migrateCopy(selectedCopy, operationId)
      this.publish(await this.store.read())
      return receipt
    })
  }

  /** Inspect the original migration without replaying it.
   * @param operationId - original UUID.
   * @returns a receipt only for a proven selected migration.
   */
  inspectMigration(operationId: MigrationOperationId): Promise<MigrationReceipt | undefined> {
    return this.enqueue(() => this.store.inspectMigration(operationId))
  }

  /** Finish an explicitly selected interrupted migration using its encrypted candidate.
   * @param operationId - original UUID.
   * @returns verified secret-free receipt.
   */
  recoverMigration(operationId: MigrationOperationId): Promise<MigrationReceipt> {
    return this.enqueue(async () => {
      const receipt = await this.store.recoverMigration(operationId)
      this.publish(await this.store.read())
      return receipt
    })
  }
}

export default SecureCredentialProvider
