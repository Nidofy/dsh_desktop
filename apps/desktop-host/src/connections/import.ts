/** Copy-only legacy import. Official Session readers validate and upgrade only the private copy. */
import { Context } from '@deepseek-ai/cordis'
import JsonlSessionPersistence, { type Config as JsonlConfig } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, realpath, rename } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { load } from 'js-yaml'
import { object, profileFrom } from './store.ts'
import type { ImportLease, StorageService, StorageOperationId } from '@nidofy/dsh-desktop-extras/storage'
import { brandString } from '@deepseek-ai/dsh-brand'

const hash = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
type Inventory = Array<{ source: string; target: string; digest: string; bytes: number }>

/** Trusted admission for a complete file write, separate from preview and wire requests.
 * @param path - Exact destination in the private import tree.
 * @param maxWriteBytes - Additional physical file bytes, including its temporary representation.
 * @param work - Actual bounded writer and cleanup completion.
 * @returns The writer result after it drains.
 */
export type LegacyImportWriter = <T>(path: string, maxWriteBytes: number, work: () => Promise<T>) => Promise<T>

/** Standalone content callbacks retain their local coordination lock.
 * Product admission replaces it with native operation exclusion; neither path authorizes replay or adoption.
 */
export interface LegacyImportExecution {
  readonly signal?: AbortSignal
  readonly write?: LegacyImportWriter
  /** Native admission runs after source validation and before any product coordination/content write. */
  readonly admit?: (fingerprint: string) => Promise<ImportLease>
}

async function copyInventoryFile(item: Inventory[number], target: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const source = await open(item.source, 'r')
  try {
    const before = await source.stat({ bigint: true })
    if (before.size !== BigInt(item.bytes) || before.nlink !== 1n || !before.isFile()) throw Error('IMPORT_SOURCE_CHANGED')
    const output = await open(target, 'wx', 0o600)
    try {
      const digest = createHash('sha256'), buffer = Buffer.alloc(64 * 1024)
      let total = 0
      while (true) {
        signal?.throwIfAborted()
        const { bytesRead } = await source.read(buffer)
        if (bytesRead === 0) break
        if (bytesRead > item.bytes - total) throw Error('IMPORT_SOURCE_CHANGED')
        const chunk = buffer.subarray(0, bytesRead)
        await output.writeFile(chunk)
        digest.update(chunk); total += bytesRead
      }
      const after = await source.stat({ bigint: true })
      if (total !== item.bytes || digest.digest('hex') !== item.digest || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs) throw Error('IMPORT_SOURCE_CHANGED')
      signal?.throwIfAborted()
    } finally { await output.close() }
  } finally { await source.close() }
}
async function fileDigest(path: string, expected: { dev: bigint; ino: bigint; size: bigint }): Promise<string> {
  const file = await open(path, 'r')
  try {
    const before = await file.stat({ bigint: true })
    if (before.dev !== expected.dev || before.ino !== expected.ino || before.size !== expected.size || before.nlink !== 1n) {
      throw Error('IMPORT_SOURCE_CHANGED')
    }
    const digest = createHash('sha256'), buffer = Buffer.alloc(64 * 1024)
    let total = 0n
    while (true) {
      const { bytesRead } = await file.read(buffer)
      if (bytesRead === 0) break
      total += BigInt(bytesRead)
      if (total > expected.size) throw Error('IMPORT_SOURCE_CHANGED')
      digest.update(buffer.subarray(0, bytesRead))
    }
    const after = await file.stat({ bigint: true })
    if (total !== expected.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs) throw Error('IMPORT_SOURCE_CHANGED')
    return digest.digest('hex')
  } finally { await file.close() }
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
/** Reject every linked ancestor, including Windows junctions, before importing any data. */
async function plainPath(path: string): Promise<void> {
  const full = resolve(path)
  const parent = dirname(full)
  if (parent !== full) await plainPath(parent)
  const stat = await lstat(full === parse(full).root && full.startsWith('\\\\?\\') ? full.slice(4) : full)
  if (stat.isSymbolicLink()) throw new Error('IMPORT_LINK_REFUSED')
}
async function collect(source: string, target: string, inventory: Inventory): Promise<void> {
  if (!await exists(source)) return
  const stat = await lstat(source, { bigint: true })
  if (stat.isSymbolicLink()) throw new Error('IMPORT_LINK_REFUSED')
  if (stat.isDirectory()) {
    for (const name of (await readdir(source)).sort()) await collect(join(source, name), join(target, name), inventory)
  } else if (stat.isFile()) {
    if (source.endsWith('.lock')) throw new Error('IMPORT_SOURCE_BUSY')
    if (stat.nlink !== 1n || stat.size > BigInt(512 * 1024 * 1024) || inventory.length >= 100_000) throw new Error('IMPORT_FILE_REFUSED')
    inventory.push({ source, target, digest: await fileDigest(source, stat), bytes: Number(stat.size) })
  } else throw new Error('IMPORT_FILE_REFUSED')
}
function noSecrets(value: unknown): void {
  if (Array.isArray(value)) { for (const item of value) noSecrets(item); return }
  if (value === null || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (/^(apiKey|password|token|secret|authorization|headers)$/i.test(key)) throw new Error('IMPORT_INLINE_SECRET_REFUSED')
    noSecrets(item)
  }
}

async function legacyInput(input: unknown, imports: string) {
  const request = object(input)
  if (typeof request.source !== 'string' || !isAbsolute(request.source)
    || typeof request.operationId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(request.operationId)
    || typeof request.sourceVersion !== 'string' || !['0.2.0', '0.2.5-rc.1'].includes(request.sourceVersion)) throw new Error('IMPORT_REQUEST_INVALID')
  const source = await realpath(request.source)
  await plainPath(request.source)
  const root = resolve(imports)
  if (root === source || root.startsWith(source + sep) || source.startsWith(root + sep)) throw new Error('IMPORT_PATH_OVERLAP')

  return { request: { operationId: request.operationId, sourceVersion: request.sourceVersion }, source, root }
}
async function legacyPlan(spec: Awaited<ReturnType<typeof legacyInput>>,
  validateSetting: (namespace: string, config: unknown) => void) {
  const { request, source } = spec
  const home = await exists(join(source, 'dsh')) ? join(source, 'dsh') : source
  for (const lock of ['settings.yaml.lock', 'settings.yaml.imported', 'profiles/dsh-desktop/lock', 'profiles/desktop/lock']) {
    if (await exists(join(home, lock))) throw new Error('IMPORT_SOURCE_BUSY')
  }
  const inventory: Inventory = []
  for (const name of ['sessions', 'attachments']) await collect(join(home, name), join('harness', name), inventory)
  for (const item of inventory) {
    const version = /session\.v(\d+)\.jsonl(?:\.zstd)?$/.exec(item.source)?.[1]
    if (version && Number(version) > SESSION_FORMAT_VERSION) throw new Error('IMPORT_SESSION_VERSION_UNSUPPORTED')
  }
  await collect(join(home, 'storages', 'workspace.json'), join('harness', 'storages', 'workspace.json'), inventory)
  await collect(join(home, 'desktop-snapshot-scopes.json'), join('harness', 'desktop-snapshot-scopes.json'), inventory)
  const configPaths = [join(source, 'connections.json'), join(source, 'connection.json'),
    join(home, 'settings.yaml'), join(home, 'profiles', 'desktop', 'cordis.patch.yml'), join(home, 'profiles', 'dsh-desktop', 'cordis.patch.yml')]
  const documents: Record<string, unknown> = {}
  const sources: Array<{ path: string; digest: string }> = []
  for (const path of configPaths) if (await exists(path)) {
    await plainPath(path)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024) throw new Error('IMPORT_SETTINGS_REFUSED')
    const bytes = await readFile(path)
    const value: unknown = path.endsWith('.json') ? JSON.parse(bytes.toString()) as unknown : load(bytes.toString())
    noSecrets(value); documents[path] = value; sources.push({ path, digest: hash(bytes) })
  }
  const connectionSuggestions: Array<{
    connection: string
    profile: ReturnType<typeof profileFrom>
    requiresKey: true
    pendingReview: unknown
  }> = []
  const catalog = documents[join(source, 'connections.json')]
  const legacy = documents[join(source, 'connection.json')]
  let profiles: unknown[] = []
  if (catalog !== undefined) {
    const parsed = object(catalog)
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.profiles) || parsed.profiles.length > 32) throw new Error('IMPORT_CONNECTION_VERSION_UNSUPPORTED')
    profiles = parsed.profiles
  } else if (legacy !== undefined) profiles = [{ id: 'legacy', connection: legacy }]
  for (const value of profiles) {
    const profile = object(value), connection = object(profile.connection)
    if (typeof profile.id !== 'string' || !/^(legacy|p-[a-f0-9]{32})$/.test(profile.id)) throw new Error('IMPORT_CONNECTION_ID_INVALID')
    const models: unknown = connection.models ?? [connection.model]
    if (!Array.isArray(models) || models.length === 0 || models.some(id => typeof id !== 'string')) throw new Error('IMPORT_MODELS_INVALID')
    const limits = connection.modelLimits === undefined ? {} : object(connection.modelLimits)
    const declarations = (models as string[]).map(id => ({ id, ...(limits[id] === undefined ? {} : object(limits[id])) }))
    if (connection.baseUrl !== undefined && typeof connection.baseUrl !== 'string') throw new Error('IMPORT_ENDPOINT_INVALID')
    if (connection.providerName !== undefined && typeof connection.providerName !== 'string') throw new Error('IMPORT_NAME_INVALID')
    const baseURL = (connection.baseUrl ?? '').replace(/\/$/, '')
    if (!baseURL) continue
    const converted = profileFrom({ displayName: connection.providerName ?? profile.id,
      api: connection.api ?? 'openai-completions', baseURL: connection.api === 'anthropic-messages' ? baseURL.replace(/\/v1$/, '') : baseURL,
      ...connection.builtinProvider ? { catalogProvider: connection.builtinProvider } : {}, models: declarations,
      timeoutMs: connection.timeoutMs ?? 300_000, streamIdleTimeoutMs: connection.streamIdleTimeoutMs ?? 300_000 })
    connectionSuggestions.push({ connection: profile.id, profile: converted, requiresKey: true,
      pendingReview: { network: profile.network, cache: connection.cache, modelCapabilities: connection.modelCapabilities } })
  }
  const patch: Array<{ id: string; config: unknown }> = []
  const legacySettings = documents[join(home, 'settings.yaml')]
  const patches = ['desktop', 'dsh-desktop'].map(name => documents[join(home, 'profiles', name, 'cordis.patch.yml')]).filter(value => value !== undefined)
  if (patches.length > 1) throw new Error('IMPORT_SETTINGS_AMBIGUOUS')
  const savedPatch = patches[0]
  if (legacySettings !== undefined && savedPatch !== undefined) throw new Error('IMPORT_SETTINGS_AMBIGUOUS')
  const aliases: Record<string, string> = { 'ui-developer-tools': 'ui-settings', 'ui-onboarding': 'ui-settings-general', shell: 'pwsh-sandbox' }
  const rows = legacySettings === undefined ? savedPatch ?? []
    : Object.entries(object(legacySettings)).map(([id, config]) => ({ id: aliases[id] ?? id, config }))
  if (!Array.isArray(rows) || rows.length > 256) throw new Error('IMPORT_SETTINGS_INVALID')
  const namespaces = new Set<string>()
  for (const item of rows) {
    const row = object(item)
    if (typeof row.id !== 'string' || Object.keys(row).some(key => !['id', 'config'].includes(key))) throw new Error('IMPORT_PLUGIN_CODE_REFUSED')
    if (namespaces.has(row.id)) throw new Error('IMPORT_SETTINGS_AMBIGUOUS')
    namespaces.add(row.id)
    // Rebind every credential reference to an intentionally absent value in the new home.
    const rebind = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rebind)
      if (value === null || typeof value !== 'object') return value
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
        /^(apiKeyEnv|credentialRef)$/i.test(key) ? `NIDOFY_IMPORT_${randomUUID().replaceAll('-', '_')}` : rebind(item)]))
    }
    const config = rebind(row.config)
    validateSetting(row.id, config)
    patch.push({ id: row.id, config })
  }
  const workspacePath = join(home, 'storages', 'workspace.json')
  if (await exists(workspacePath)) {
    const value = object(JSON.parse(await readFile(workspacePath, 'utf8')) as unknown)
    const unit = object(value.unit), globals = object(value.global), tables = object(value.tables)
    if (unit.name !== 'workspace' || unit.version !== 2 || globals.pendingMutation || !Array.isArray(globals.workspaceIds)) throw new Error('IMPORT_WORKSPACE_VERSION_UNSUPPORTED')
    const workspaces = object(tables.workspaces)
    if (globals.workspaceIds.some(id => typeof id !== 'string' || !Object.hasOwn(workspaces, id))) throw new Error('IMPORT_WORKSPACE_INVALID')
  }
  const fingerprint = hash(JSON.stringify({ source, sourceVersion: request.sourceVersion, inventory, sources }))
  return { home, inventory, sources, patch, connectionSuggestions, fingerprint }
}

function reviewReport(spec: Awaited<ReturnType<typeof legacyInput>>, plan: Awaited<ReturnType<typeof legacyPlan>>,
  mode: 'preview' | 'validated', product: boolean) {
  const count = (prefix: string) => plan.inventory.filter(item => item.target === prefix || item.target.startsWith(prefix + sep)).length
  const review = product ? join('review', 'harness') : 'harness'
  const report = { schemaVersion: 1, sourceVersion: spec.request.sourceVersion, sourceVersionKind: 'declared-desktop',
    supportedVersions: ['0.2.0', '0.2.5-rc.1'],
    settingNamespaces: [...new Set([...plan.patch.map(row => row.id), 'session-persistence-jsonl'])],
    verification: mode === 'preview' ? 'inventory-and-settings-only' : 'official-session-readers-and-copy-digests',
    sourcePreserved: true, categories: [
      { category: 'sessions', disposition: 'migrate', count: count(join('harness', 'sessions')),
        source: 'sessions', destination: 'harness/sessions', detail: 'retain-generations' },
      { category: 'attachments', disposition: 'copy', count: count(join('harness', 'attachments')),
        source: 'attachments', destination: 'harness/attachments', detail: 'verify-digests' },
      { category: 'workspace', disposition: 'review', count: count(join('harness', 'storages', 'workspace.json')) + count(join('review', 'harness', 'storages', 'workspace.json')),
        source: 'storages/workspace.json', destination: join(review, 'storages', 'workspace.json').replaceAll('\\', '/'), detail: 'new-workspace-confirmation' },
      { category: 'protection', disposition: 'review', count: count(join('harness', 'desktop-snapshot-scopes.json')) + count(join('review', 'harness', 'desktop-snapshot-scopes.json')),
        source: 'desktop-snapshot-scopes.json', destination: join(review, 'desktop-snapshot-scopes.json').replaceAll('\\', '/'), detail: 'new-protection-confirmation' },
      { category: 'connections', disposition: 'review', count: plan.connectionSuggestions.length,
        source: 'connections.json / connection.json', destination: 'harness/nidofy-import-connections.json', detail: 'rebind-keys-and-capabilities' },
      { category: 'settings', disposition: 'copy', count: plan.patch.length + (plan.patch.some(row => row.id === 'session-persistence-jsonl') ? 0 : 1),
        source: 'settings.yaml / cordis.patch.yml', destination: 'harness/cordis.patch.yml', detail: 'validated-settings-and-new-session-root' },
      { category: 'credentials', disposition: 'excluded', count: null,
        source: 'credentials / .env', destination: null, detail: 'not-copied' },
      { category: 'plugins', disposition: 'excluded', count: null,
        source: 'executable plugins', destination: null, detail: 'not-copied' },
      { category: 'schedules', disposition: 'separate-confirmation', count: null,
        source: 'scheduler data', destination: null, detail: 'explicit-paused-manifest' },
      { category: 'indexes-and-other-data', disposition: 'source-only', count: null,
        source: 'search indexes / other files', destination: null, detail: 'source-preserved' },
    ] }
  if (Buffer.byteLength(JSON.stringify(report)) > 128 * 1024) throw Error('IMPORT_REVIEW_TOO_LARGE')
  return report
}

/** Read and validate supported legacy categories without creating a copy or granting migration.
 * @param input - Explicit source, supported version and caller operation identity.
 * @param imports - Product-owned future target parent; it is not created by preview.
 * @param validateSetting - Current official schemas used to refuse unsupported settings.
 * @returns A bounded category report and source fingerprint; execution/adoption remain unavailable.
 */
export async function previewLegacy(input: unknown, imports: string,
  validateSetting: (namespace: string, config: unknown) => void) {
  const spec = await legacyInput(input, imports), plan = await legacyPlan(spec, validateSetting)
  const report = reviewReport(spec, plan, 'preview', true)
  return { status: 'PREVIEW', fingerprint: plan.fingerprint, sourceVersion: spec.request.sourceVersion,
    files: plan.inventory.length, sourceBytes: plan.inventory.reduce((total, item) => total + item.bytes, 0),
    sessions: new Set(plan.inventory.filter(item => /session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(item.source))
      .map(item => dirname(item.source))).size,
    categories: [
      { category: 'sessions', disposition: 'bounded-migration-required' },
      { category: 'attachments', disposition: 'copy-and-verify' },
      { category: 'workspace', disposition: 'reconfirm-trust' },
      { category: 'connections', disposition: 'bind-keys-and-review', count: plan.connectionSuggestions.length },
      { category: 'settings', disposition: 'validated-for-review', count: plan.patch.length },
      { category: 'credentials-and-plugins', disposition: 'excluded' },
      { category: 'schedules', disposition: 'excluded' },
    ], execution: 'IMPORT_QUOTA_MIGRATION_UNSUPPORTED', adoption: 'not-supported',
    sourceModified: false, credentialsCopied: false, schedulesActivated: false, report }
}

/** Import into a new distribution data root; never replace or merge an active home.
 * @param input - Source directory, supported legacy desktop version and operation ID.
 * @param imports - Application-owned destination parent, separate from the source.
 * @param validateSetting - Official loaded-plugin schema validation without dropping unknown fields.
 * @param fault - Qualification interruption at copy, validation or publication stages.
 * @param execution - Trusted content writer or native product admission, plus pre-publication cancellation.
 * @returns Ready receipt after all copies pass official readers, or rejects without publishing a home.
 */
export async function importLegacy(input: unknown, imports: string,
  validateSetting: (namespace: string, config: unknown) => void,
  fault: (point: string) => Promise<void> = () => Promise.resolve(), execution: LegacyImportExecution = {}) {
  const { signal } = execution
  const readOptions = signal === undefined ? undefined : { signal }
  const write: LegacyImportWriter = execution.write ?? ((_path, _bytes, work) => work())
  signal?.throwIfAborted()
  const spec = await legacyInput(input, imports)
  const { request, root } = spec
  const operationId = request.operationId
  const perform = async () => {
    const plan = await legacyPlan(spec, validateSetting)
    const { inventory, sources, patch, connectionSuggestions, fingerprint } = plan
    signal?.throwIfAborted()
    if (execution.admit) for (const item of inventory) {
      if (item.target === join('harness', 'storages', 'workspace.json')
        || item.target === join('harness', 'desktop-snapshot-scopes.json')) item.target = join('review', item.target)
    }
    const final = join(root, operationId), staging = join(root, `${operationId}.pending`)
    const lease = await execution.admit?.(fingerprint)
    const writeContent: LegacyImportWriter = lease ? (path, bytes, work) => lease.write(path, bytes, work) : write
    const metadataContent = (path: string, value: unknown): Promise<void> => {
      signal?.throwIfAborted()
      const content = JSON.stringify(value)
      return writeContent(path, Buffer.byteLength(content), async () => {
        signal?.throwIfAborted()
        await writeFileAtomic(path, content, { mode: 0o600 })
      })
    }
    const copy = async () => {
      if (await exists(final)) {
        await plainPath(final)
        const receipt = object(JSON.parse(await readFile(join(final, 'import.json'), 'utf8')) as unknown)
        if (receipt.fingerprint !== fingerprint || receipt.status !== 'READY') throw new Error('IMPORT_CONFLICT')
        return receipt
      }
      await mkdir(staging, { recursive: true, mode: 0o700 }); await plainPath(staging)
      const journal = join(staging, 'import.json')
      if (await exists(journal)) {
        const prior = object(JSON.parse(await readFile(journal, 'utf8')) as unknown)
        if (prior.fingerprint !== fingerprint) throw new Error('IMPORT_SOURCE_CHANGED')
      }
      await metadataContent(journal, { schemaVersion: 1, fingerprint, status: 'COPYING' })
      for (const item of inventory) {
        const target = join(staging, item.target)
        if (relative(staging, target).startsWith('..')) throw new Error('IMPORT_PATH_ESCAPE')
        await mkdir(dirname(target), { recursive: true }); await plainPath(dirname(target)); await plainPath(item.source)
        if (await exists(target)) {
          await plainPath(target)
          if (hash(await readFile(target)) !== item.digest) throw new Error('IMPORT_COPY_CONFLICT')
        } else await writeContent(target, item.bytes, () => copyInventoryFile(item, target, signal))
        if (await fileDigest(item.source, await lstat(item.source, { bigint: true })) !== item.digest
        || await fileDigest(target, await lstat(target, { bigint: true })) !== item.digest) throw new Error('IMPORT_SOURCE_CHANGED')
      }
      await fault('copied')
      // The isolated context contains only a persistence reader/writer, never an Agent or a second Host.
      const reader = new Context()
      class ImportPersistence extends JsonlSessionPersistence {
        constructor(ctx: Context, config: JsonlConfig) {
          super(ctx, config, (path, bytes, publish) => writeContent(path, bytes, publish))
        }
      }
      let sessions = 0
      try {
        const sessionLogs = inventory.filter(item => item.target.startsWith(join('harness', 'sessions') + sep)
        && /session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(item.source))
        const plain = sessionLogs.some(item => item.source.endsWith('.jsonl'))
        const compressed = sessionLogs.some(item => item.source.endsWith('.jsonl.zstd'))
        if (plain && compressed) throw new Error('IMPORT_MIXED_ENCODING_REFUSED')
        const compression = plain ? 'none' : 'zstd'
        const persistence = patch.find(row => row.id === 'session-persistence-jsonl')
        const copiedRoot = join(final, 'harness', 'sessions')
        if (persistence) persistence.config = { ...object(persistence.config), root: copiedRoot, compression }
        else patch.push({ id: 'session-persistence-jsonl', config: { root: copiedRoot, compression } })
        await reader.plugin(ImportPersistence, { root: join(staging, 'harness', 'sessions'), compression })
        const list = await reader.sessionPersistence.list(readOptions)
        const expected = new Set(sessionLogs.map(item => dirname(item.source)))
        if (list.length !== expected.size) throw new Error('IMPORT_SESSION_UNREADABLE')
        for (const { header } of list) {
          const read = await reader.sessionPersistence.open(header.id, 'read', readOptions)
          try { await read.read() } finally { await read.close() }
        }
        await fault('validated')
        for (const { header } of list) {
          const write = await reader.sessionPersistence.open(header.id, 'write', readOptions)
          await write.close(); sessions++
        }
        await reader.sessionPersistence.flush()
      } finally { await reader.fiber.dispose() }
      // Source bytes are checked again after the official migration chain finishes.
      for (const item of inventory) {
        signal?.throwIfAborted()
        if (await fileDigest(item.source, await lstat(item.source, { bigint: true })) !== item.digest) throw new Error('IMPORT_SOURCE_CHANGED')
      }
      for (const item of sources) if (hash(await readFile(item.path)) !== item.digest) throw new Error('IMPORT_SOURCE_CHANGED')
      // Desktop supplies its distribution profile; the home layer applies to that profile too.
      const patchPath = join(staging, 'harness', 'cordis.patch.yml')
      await metadataContent(patchPath, patch)
      await metadataContent(join(staging, 'harness', 'nidofy-import-connections.json'), connectionSuggestions)
      const receipt = { schemaVersion: 1, operationId, fingerprint, status: 'READY', dataRoot: final,
        sourceVersion: request.sourceVersion, sessions, files: inventory.length, credentialsCopied: false,
        sourceModified: false, schedulesActivated: false, connectionSuggestions,
        exclusions: ['credentials', 'executable plugins', 'automation schedules', 'session query caches'], settings: patch.map(row => row.id),
        report: reviewReport(spec, plan, 'validated', lease !== undefined) }
      await metadataContent(journal, receipt)
      await fault('ready')
      signal?.throwIfAborted()
      if (lease) return lease.publish()
      await rename(staging, final)
      return receipt
    }
    if (!lease) return copy()
    try { return await lease.run(copy) }
    catch (error) { await lease.abort().catch(() => { /* Unknown outcome remains inspectable; no replay. */ }); throw error }
    finally { await lease.release().catch(() => { /* Successful publication remains successful; charge is retained. */ }) }
  }
  if (execution.admit) return perform()
  await mkdir(root, { recursive: true, mode: 0o700 }); await plainPath(root)
  return withFileLock(join(root, 'owner'), perform)
}

/** Authenticated product import dispatcher; preview and explicit actions retain the caller identity.
 * @param storage - Actual physical distribution owner.
 * @param input - Wire request including explicit confirmation and write ceiling for execution.
 * @param validateSetting - Official schema validation.
 * @param signal - Pre-publication cancellation, drained before settlement.
 * @returns Preview or persisted operation observation; adoption never switches the running Host.
 */
export async function productImport(storage: StorageService, input: unknown,
  validateSetting: (namespace: string, config: unknown) => void, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const data = object(input)
  if (typeof data.operationId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(data.operationId))
    throw Error('IMPORT_REQUEST_INVALID')
  const operationId = brandString<StorageOperationId>(data.operationId)
  if (data.action === 'inspect') return storage.importOperation('inspect', operationId)
  if (data.action === 'review') {
    const value = await storage.importOperation('review', operationId)
    return { ...value, runningHome: storage.home, launch: value.phase === 'adopted' && typeof value.home === 'string'
      ? { harnessHome: value.home, desktopDataRoot: dirname(value.home),
        argument: '--nidofy-desktop-data-root=' + dirname(value.home), switchesRunningHost: false } : null }
  }
  if (data.action === 'recover' || data.action === 'adopt') {
    if (data.confirm !== true) throw Error('IMPORT_CONFIRM_REQUIRED')
    return storage.importOperation(data.action, operationId)
  }
  const root = await storage.importRoot()
  if (data.action === 'preview') return { ...await previewLegacy(data, root, validateSetting), execution: 'explicit-bounded-copy', adoption: 'explicit-in-place' }
  if (data.action !== 'execute' || data.confirm !== true || typeof data.expectedFingerprint !== 'string'
    || typeof data.maxWriteBytes !== 'number' || !Number.isSafeInteger(data.maxWriteBytes)
    || data.maxWriteBytes < 1 || data.maxWriteBytes > 1024 * 1024 * 1024) throw Error('IMPORT_REQUEST_INVALID')
  const maximum = data.maxWriteBytes
  return importLegacy(data, root, validateSetting, undefined, { ...(signal === undefined ? {} : { signal }),
    admit: (fingerprint) => {
      if (fingerprint !== data.expectedFingerprint) throw Error('IMPORT_PREVIEW_CONFLICT')
      signal?.throwIfAborted()
      return storage.beginImport(operationId, fingerprint, maximum)
    },
  })
}
