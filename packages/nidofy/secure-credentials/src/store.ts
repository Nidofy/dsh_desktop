/** Atomic encrypted state and explicit copy migration under one cross-process writer lock. */
import { createHash } from 'node:crypto'
import { mkdir, open, realpath, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { parseCredentialsDocument } from '@deepseek-ai/dsh-credentials-local'
import { assertJson, object, parseDocument, parseReceipt } from './document.ts'
import type { SecureDocument } from './document.ts'
import { SecureCredentialError } from './errors.ts'
import type { Config, MigrationOperationId, MigrationReceipt, SecretProtector } from './types.ts'

/** Whether a failed filesystem lookup reported absence. */
function absent(error: unknown): boolean { return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT' }

/** Canonical identity and storage directory, computed once after the first storage request. */
interface Location { namespace: string; directory: string; current: string; entropy: Buffer }

/** Host-only storage; construction and provider activation never access the backend. */
export class SecureStore {
  private location: Location | undefined
  private readonly maxEncodedBytes: number

  constructor(private readonly config: Config, private readonly protector: SecretProtector) {
    if (!isAbsolute(config.dshHome) || !/^[a-z0-9][a-z0-9.-]*$/.test(config.applicationId)
      || !/^[a-z0-9][a-z0-9.-]*$/.test(config.profileId)
      || !Number.isSafeInteger(config.maxPlaintextBytes) || config.maxPlaintextBytes < 256
      || config.maxPlaintextBytes > 16 * 1024 * 1024
      || !Number.isSafeInteger(config.backendTimeoutMs) || config.backendTimeoutMs <= 0
      || config.backendTimeoutMs > 0x7fffffff
      || !Number.isSafeInteger(config.lockWaitMs) || config.lockWaitMs <= 0
      || config.lockWaitMs > 0x7fffffff
      || !Number.isSafeInteger(config.refreshIntervalMs) || config.refreshIntervalMs < 0
      || config.refreshIntervalMs > 0x7fffffff) {
      throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
    }
    // DPAPI adds authenticated metadata; both the encoded file and pipe remain bounded.
    this.maxEncodedBytes = (config.maxPlaintextBytes + 65_536) * 2
  }

  private async locate(): Promise<Location> {
    if (this.location) return this.location
    try {
      await mkdir(this.config.dshHome, { recursive: true, mode: 0o700 })
      const canonical = await realpath(this.config.dshHome)
      const homeIdentity = process.platform === 'win32' ? canonical.toLowerCase() : canonical
      const identity = JSON.stringify(['nidofy-secure-credentials-v1', this.config.applicationId,
        this.config.profileId, homeIdentity])
      const namespace = createHash('sha256').update(identity).digest('hex')
      const directory = join(canonical, 'secure-credentials', namespace)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      // Refuse an existing junction that redirects encrypted state outside this home.
      const resolvedDirectory = await realpath(directory)
      if (process.platform === 'win32' ? resolvedDirectory.toLowerCase() !== directory.toLowerCase() : resolvedDirectory !== directory) {
        throw new SecureCredentialError('SECURE_STORAGE_UNAVAILABLE')
      }
      this.location = { namespace, directory, current: join(directory, 'current.json'), entropy: Buffer.from(identity) }
      return this.location
    } catch (error) {
      void error
      throw new SecureCredentialError('SECURE_STORAGE_UNAVAILABLE')
    }
  }

  private async readText(filename: string, limit = this.maxEncodedBytes): Promise<string | undefined> {
    try {
      const file = await open(filename, 'r')
      try {
        if ((await file.stat()).size > limit) throw new SecureCredentialError('SECURE_SIZE_LIMIT')
        const text = await file.readFile('utf8')
        if (Buffer.byteLength(text) > limit) throw new SecureCredentialError('SECURE_SIZE_LIMIT')
        return text
      } finally { await file.close() }
    } catch (error) {
      if (absent(error)) return undefined
      if (error instanceof SecureCredentialError) throw error
      throw new SecureCredentialError('SECURE_STORAGE_UNAVAILABLE')
    }
  }

  private async crypt(op: 'protect' | 'unprotect', data: Buffer, location: Location): Promise<Buffer> {
    try { return await this.protector[op](data, location.entropy) }
    catch (error) {
      void error
      throw new SecureCredentialError('SECURE_BACKEND_UNAVAILABLE')
    }
  }

  private async decode(text: string, location: Location): Promise<SecureDocument> {
    let cipher: Buffer
    try {
      const v = object(JSON.parse(text))
      if (Object.keys(v).sort().join(',') !== 'ciphertext,namespace,version' || v.version !== 1
        || v.namespace !== location.namespace || typeof v.ciphertext !== 'string' || v.ciphertext.length === 0
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.ciphertext)) {
        throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
      }
      cipher = Buffer.from(v.ciphertext, 'base64')
    } catch (error) {
      void error
      throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
    }
    const plain = await this.crypt('unprotect', cipher, location)
    try {
      if (plain.length > this.config.maxPlaintextBytes) throw new SecureCredentialError('SECURE_SIZE_LIMIT')
      return parseDocument(plain.toString('utf8'), location.namespace)
    } finally { plain.fill(0) }
  }

  private async encode(document: SecureDocument, location: Location): Promise<string> {
    assertJson(document)
    const text = JSON.stringify(document)
    if (Buffer.byteLength(text) > this.config.maxPlaintextBytes) throw new SecureCredentialError('SECURE_SIZE_LIMIT')
    parseDocument(text, location.namespace)
    const plain = Buffer.from(text)
    let cipher: Buffer
    try { cipher = await this.crypt('protect', plain, location) }
    finally { plain.fill(0) }
    const encoded = JSON.stringify({ version: 1, namespace: location.namespace, ciphertext: cipher.toString('base64') })
    if (Buffer.byteLength(encoded) > this.maxEncodedBytes) throw new SecureCredentialError('SECURE_SIZE_LIMIT')
    return encoded
  }

  private async load(location: Location): Promise<SecureDocument> {
    const text = await this.readText(location.current)
    if (text !== undefined) return this.decode(text, location)
    // Absence does not hide an unavailable backend, even for a fresh home.
    await this.crypt('protect', Buffer.from('availability'), location)
    return { version: 1, namespace: location.namespace, revision: 0, refs: {}, records: {}, migration: null }
  }

  private async write(filename: string, text: string): Promise<void> {
    try { await writeFileAtomic(filename, text, { mode: 0o600, dirMode: 0o700 }) }
    catch (error) {
      void error
      throw new SecureCredentialError('SECURE_STORAGE_UNAVAILABLE')
    }
  }

  private async exclusive<T>(operation: (location: Location) => Promise<T>): Promise<T> {
    const location = await this.locate()
    const state = { entered: false }
    try {
      return await withFileLock(location.current, () => {
        state.entered = true
        return operation(location)
      }, { waitMs: this.config.lockWaitMs })
    } catch (error) {
      if (state.entered) throw error
      throw new SecureCredentialError('SECURE_STORAGE_UNAVAILABLE')
    }
  }

  /** Read the currently selected complete state, never the migration candidate.
   * @returns fresh decrypted state; backend refusal never returns cached values.
   */
  async read(): Promise<SecureDocument> { return this.load(await this.locate()) }

  /** Serialize a read-decide-write cycle across processes; a declined edit performs no commit.
   * @param mutate - decision against fresh state while holding the writer lock.
   * @returns committed state or the unchanged current state.
   */
  async modify(mutate: (current: SecureDocument) => Promise<SecureDocument | undefined>): Promise<SecureDocument> {
    return this.exclusive(async (location) => {
      if (await this.readText(join(location.directory, 'migration-journal.json')) !== undefined) {
        throw new SecureCredentialError('SECURE_MIGRATION_PENDING')
      }
      const current = await this.load(location)
      const next = await mutate(current)
      if (next === undefined) return current
      next.revision = current.revision + 1
      const encoded = await this.encode(next, location)
      const verified = await this.decode(encoded, location)
      await this.write(location.current, encoded)
      return verified
    })
  }

  /** Copy an explicitly selected official version-1 credentials document into an empty destination.
   * @param selectedCopy - absolute path of a synthetic or explicitly chosen data copy; never removed or rewritten.
   * @param operationId - UUID retained by the caller for recovery and lost acknowledgement inspection.
   * @returns secret-free receipt after encryption, readback verification, and atomic selection.
   */
  async migrateCopy(selectedCopy: string, operationId: MigrationOperationId): Promise<MigrationReceipt> {
    if (!isAbsolute(selectedCopy)) throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
    return this.exclusive(async (location) => {
      const previous = await this.inspectAt(location, operationId)
      const journal = join(location.directory, 'migration-journal.json')
      if (previous) {
        return await this.readText(journal) === undefined ? previous : this.recoverAt(location, operationId)
      }
      if (await this.readText(journal) !== undefined) throw new SecureCredentialError('SECURE_MIGRATION_PENDING')
      const current = await this.load(location)
      if (current.revision !== 0 || Object.keys(current.refs).length || Object.keys(current.records).length) {
        throw new SecureCredentialError('SECURE_MIGRATION_CONFLICT')
      }
      const text = await this.readText(selectedCopy, this.config.maxPlaintextBytes)
      if (text === undefined) throw new SecureCredentialError('SECURE_STORAGE_UNAVAILABLE')
      let parsed: ReturnType<typeof parseCredentialsDocument>
      try { parsed = parseCredentialsDocument(text, '<selected-copy>') }
      catch (error) {
        void error
        throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
      }
      const receipt = parseReceipt({ version: 1, operationId, references: parsed.refs.size, records: parsed.records.size })
      const next: SecureDocument = { ...current, revision: 1, refs: Object.fromEntries(parsed.refs),
        records: Object.fromEntries(parsed.records), migration: receipt }
      const candidate = join(location.directory, 'migration-candidate.json')
      await this.write(candidate, await this.encode(next, location))
      const staged = await this.readText(candidate)
      if (staged === undefined || JSON.stringify(await this.decode(staged, location)) !== JSON.stringify(next)) {
        throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
      }
      await this.write(journal, JSON.stringify(receipt))
      return this.recoverAt(location, operationId)
    })
  }

  private async inspectAt(location: Location, operationId: MigrationOperationId): Promise<MigrationReceipt | undefined> {
    // UUID admission prevents unsafe ids from entering a receipt or diagnostic.
    parseReceipt({ version: 1, operationId, references: 0, records: 0 })
    const selected = await this.load(location)
    return selected.migration?.operationId === operationId ? { ...selected.migration } : undefined
  }

  private async recoverAt(location: Location, operationId: MigrationOperationId): Promise<MigrationReceipt> {
    const journal = join(location.directory, 'migration-journal.json')
    const journalText = await this.readText(journal)
    if (journalText === undefined) {
      const selected = await this.inspectAt(location, operationId)
      if (selected) return selected
      throw new SecureCredentialError('SECURE_MIGRATION_CONFLICT')
    }
    let receipt: MigrationReceipt
    try { receipt = parseReceipt(JSON.parse(journalText)) }
    catch (error) {
      void error
      throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
    }
    if (receipt.operationId !== operationId) throw new SecureCredentialError('SECURE_MIGRATION_CONFLICT')
    const current = await this.load(location)
    if (current.migration?.operationId !== operationId) {
      if (current.revision !== 0) throw new SecureCredentialError('SECURE_MIGRATION_CONFLICT')
      const staged = await this.readText(join(location.directory, 'migration-candidate.json'))
      if (staged === undefined) throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
      const candidate = await this.decode(staged, location)
      if (JSON.stringify(candidate.migration) !== JSON.stringify(receipt) || candidate.revision !== 1) {
        throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
      }
      await this.write(location.current, staged)
    }
    const selected = await this.inspectAt(location, operationId)
    if (!selected || JSON.stringify(selected) !== JSON.stringify(receipt)) {
      throw new SecureCredentialError('SECURE_INVALID_DOCUMENT')
    }
    await this.write(join(location.directory, 'migration-receipt.json'), JSON.stringify(receipt))
    try { await unlink(journal) }
    catch (error) {
      void error
      throw new SecureCredentialError('SECURE_STORAGE_UNAVAILABLE')
    }
    // The encrypted candidate stays available for inspection; no source file is deleted.
    return receipt
  }

  /** Complete an interrupted migration only at the caller's explicit request; never automatically at boot.
   * @param operationId - original migration UUID, not a new request.
   * @returns verified receipt; pending state remains on failure.
   */
  async recoverMigration(operationId: MigrationOperationId): Promise<MigrationReceipt> {
    return this.exclusive(location => this.recoverAt(location, operationId))
  }

  /** Inspect whether selection committed, including a commit whose receipt acknowledgement was lost.
   * @param operationId - original migration UUID.
   * @returns receipt when selected; undefined means no proven commit, not permission to replay.
   */
  async inspectMigration(operationId: MigrationOperationId): Promise<MigrationReceipt | undefined> {
    return this.inspectAt(await this.locate(), operationId)
  }
}
