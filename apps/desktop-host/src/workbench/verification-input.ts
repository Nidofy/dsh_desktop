/** Bounded byte observations of explicitly reviewed verification inputs, including dirty and untracked files. */
import { createHash } from 'node:crypto'
import { lstat, open, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Action, VerificationSpec, ExecutionObservation } from './legacy/project-actions.mjs'

/** Fingerprints describe actual file bytes; unavailable or unstable inputs remain unknown. */
export interface InputObservation {
  sourceFingerprint: string | null
  inputFingerprint: string | null
  runtimeFingerprint: string | null
  coverage: 'complete' | 'unknown'
  diagnostic: string | null
}

/** Hash bytes without retaining file content.
 * @param path - Explicitly selected ordinary file, with no linked ancestors.
 * @param maxBytes - Complete file-byte observation ceiling.
 * @returns Stable content digest and actual size; changes during reading refuse.
 */
export async function fileDigest(path: string, maxBytes: number): Promise<{ digest: string; bytes: number }> {
  const info = await lstat(path, { bigint: true })
  if (!info.isFile() || info.isSymbolicLink() || info.size > BigInt(maxBytes)) throw Error('VERIFICATION_INPUT_REFUSED')
  const file = await open(path, 'r')
  try {
    const before = await file.stat({ bigint: true }), hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024)
    if (before.dev !== info.dev || before.ino !== info.ino) throw Error('VERIFICATION_INPUT_CHANGED')
    let bytes = 0
    for (;;) {
      const read = await file.read(buffer, 0, buffer.length, null)
      if (!read.bytesRead) break
      bytes += read.bytesRead
      if (bytes > maxBytes) throw Error('VERIFICATION_INPUT_REFUSED')
      hash.update(buffer.subarray(0, read.bytesRead))
    }
    const after = await file.stat({ bigint: true }), selected = await lstat(path, { bigint: true })
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || BigInt(bytes) !== after.size
      || selected.dev !== after.dev || selected.ino !== after.ino || selected.mtimeNs !== after.mtimeNs
      || selected.ctimeNs !== after.ctimeNs) throw Error('VERIFICATION_INPUT_CHANGED')
    return { digest: hash.digest('hex'), bytes }
  } finally { await file.close() }
}

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)
}
async function noLinks(path: string): Promise<void> {
  const parent = resolve(path, '..')
  try { if ((await lstat(path)).isSymbolicLink()) throw Error('VERIFICATION_INPUT_REFUSED') }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  if (parent !== path) await noLinks(parent)
}
async function treeDigest(workspace: string, paths: readonly string[], external: boolean):
Promise<{ fingerprint: string; complete: boolean }> {
  const rows: [string, string][] = []
  let bytes = 0, count = 0, complete = true
  const visit = async (path: string, key: string): Promise<void> => {
    if (++count > 4096) throw Error('VERIFICATION_INPUT_REFUSED')
    let before
    try { before = await lstat(path, { bigint: true }) }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      rows.push([key, 'missing']); complete = false; return
    }
    if (before.isSymbolicLink()) throw Error('VERIFICATION_INPUT_REFUSED')
    if (before.isFile()) {
      const result = await fileDigest(path, 128 * 1024 * 1024)
      bytes += result.bytes
      if (bytes > 512 * 1024 * 1024) throw Error('VERIFICATION_INPUT_REFUSED')
      rows.push([key, result.digest])
    } else if (before.isDirectory()) {
      const names = (await readdir(path)).sort()
      rows.push([key + '/', digest(names)])
      for (const name of names) await visit(join(path, name), key + '/' + name)
      const after = await lstat(path, { bigint: true })
      if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeNs !== after.mtimeNs
        || before.ctimeNs !== after.ctimeNs) throw Error('VERIFICATION_INPUT_CHANGED')
    } else { throw Error('VERIFICATION_INPUT_REFUSED') }
  }
  for (const path of [...paths].sort()) {
    const selected = isAbsolute(path) ? path : resolve(workspace, path)
    if (!external && !inside(workspace, selected)) throw Error('VERIFICATION_INPUT_REFUSED')
    await noLinks(selected)
    await visit(selected, path)
  }
  return { fingerprint: digest(rows), complete }
}

/** Observe the declared input closure, actual configuration, tool binaries and execution environment.
 * @param workspace - Canonical workspace of the real run.
 * @param spec - Locally trusted scope; directories include every regular entry without Git filtering.
 * @param configFingerprint - ProjectActions' actual configuration and workspace identity digest.
 * @param runtimeFingerprint - Actual resolved Shell settings, or null when unavailable.
 * @returns Complete only for an explicitly reviewed closure and fully observed execution settings.
 */
export async function observeInputs(workspace: string, spec: VerificationSpec | undefined,
  configFingerprint: string, runtimeFingerprint: string | null): Promise<InputObservation> {
  if (!spec) return { sourceFingerprint: null, inputFingerprint: null, runtimeFingerprint,
    coverage: 'unknown', diagnostic: 'VERIFICATION_SCOPE_UNDECLARED' }
  let sourceFingerprint: string | null = null, inputFingerprint: string | null = null, diagnostic: string | null = null, complete = true
  try {
    const source = await treeDigest(workspace, spec.sources, false)
    sourceFingerprint = source.fingerprint; complete &&= source.complete
  }
  catch (error) { diagnostic = inputCode(error) }
  try {
    const files = await treeDigest(workspace, spec.inputs, false)
    const tools = await treeDigest(workspace, [...new Set([process.execPath, ...spec.toolchain])], true)
    complete &&= files.complete && tools.complete
    inputFingerprint = digest({ files: files.fingerprint, tools: tools.fingerprint,
      configFingerprint, runtimeFingerprint, parameters: spec.parameters, node: process.version,
      platform: process.platform, arch: process.arch })
  } catch (error) { diagnostic = inputCode(error) }
  return { sourceFingerprint, inputFingerprint, runtimeFingerprint,
    diagnostic: diagnostic ?? (!complete ? 'VERIFICATION_INPUT_MISSING' : null),
    coverage: complete && sourceFingerprint !== null && inputFingerprint !== null && runtimeFingerprint !== null
      && spec.coverage === 'complete' && spec.sources.length > 0 && spec.toolchain.length > 0 ? 'complete' : 'unknown' }
}
function inputCode(error: unknown): string {
  return error instanceof Error && /^VERIFICATION_[A-Z_]+$/.test(error.message) ? error.message : 'VERIFICATION_INPUT_UNAVAILABLE'
}

/** Hash resolved execution settings without publishing command text or environment values.
 * @param action - Actual trusted action.
 * @param settings - Resolver-owned settings with cancellation signals omitted.
 * @returns Digest for the actual configuration and ambient environment observed before execution.
 */
export function executionFingerprint(action: Action, settings: object): string {
  return digest({ action, settings, environment: Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b)) })
}

/** Observe executable bytes and settings reported by the actual Shell provider.
 * @param action - The locally trusted action.
 * @param observation - Actual resolved settings and the provider's declared execution inputs.
 * @returns Runtime digest, or null when provider enumeration or executable reading is unavailable.
 */
export async function runtimeFingerprint(action: Action, observation: ExecutionObservation): Promise<string | null> {
  if (!observation.provider || observation.provider.executablePaths.length === 0) return null
  try {
    const executables = await treeDigest(process.cwd(), observation.provider.executablePaths, true)
    if (!executables.complete) return null
    return executionFingerprint(action, { settings: observation.settings, provider: observation.provider.configuration,
      executables: executables.fingerprint })
  } catch (error) { /* Unavailable provider inputs cannot qualify coverage. */ void error; return null }
}
