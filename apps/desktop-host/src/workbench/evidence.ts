/** Read-only execution evidence from the retained ProjectActions owner; no verification receipt is minted. */
import { createHash } from 'node:crypto'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import type { ProjectActions, Run } from './legacy/project-actions.mjs'

/** Independent command observations; success does not establish tests or input coverage. */
export interface CommandFacts {
  exitCode: number | null
  cancelled: boolean
  timedOut: boolean
  interrupted: boolean
  outcome: 'SUCCEEDED' | 'FAILED' | 'NOT_RUN' | 'UNKNOWN'
}
/** Counts parsed from one complete Node TAP v13 log, without a source-freshness conclusion. */
export interface TestLogSummary {
  tests: number
  passed: number
  failed: number
  cancelled: number
  skipped: number
  todo: number
}
/** Disposable evidence projection. The retained log is not an authenticated verification receipt. */
export interface ActionEvidence {
  runId: string
  command: CommandFacts
  log: { digest: string | null; complete: boolean; parserVersion: 'node-tap-13/1' | null; tests: TestLogSummary | null }
  coverage: 'unknown'
  freshness: 'UNKNOWN'
  acceptance: 'PENDING'
  receipt: null
}

/** Project normalized execution facts from an actual retained run.
 * @param run - ProjectActions-owned command observation, never a model verification claim.
 * @returns Independent outcome and flags, with incomplete execution marked unknown.
 */
export function commandFacts(run: Run): CommandFacts {
  const exitCode = typeof run.exitCode === 'number' && Number.isSafeInteger(run.exitCode) ? run.exitCode : null
  const cancelled = run.aborted === true || run.status === 'CANCELLED'
  const timedOut = run.timedOut === true || run.status === 'TIMEOUT'
  const interrupted = ['INTERRUPTED', 'UNKNOWN', 'RUNNER_FAILED'].includes(run.status) || run.persistenceFailed === true
  const started = typeof run.startedAt === 'string'
  const outcome = !started && ['NOT_STARTED', 'CANCELLED'].includes(run.status) ? 'NOT_RUN'
    : !started || interrupted || cancelled || timedOut || !['PASS', 'FAIL'].includes(run.status) || exitCode === null ? 'UNKNOWN'
      : exitCode === 0 ? 'SUCCEEDED' : 'FAILED'
  return { exitCode, cancelled, timedOut, interrupted, outcome }
}

/** Parse only the supported complete Node TAP v13 framing, never model-authored status claims.
 * @param log - Actual retained stdout/stderr framing supplied by the execution owner.
 * @returns Validated counts, or null when framing, plan or counts are inconsistent.
 */
export function tapSummary(log: string): TestLogSummary | null {
  const normalized = log.replaceAll('\r\n', '\n'), split = normalized.lastIndexOf('\nSTDERR\n')
  if (!normalized.startsWith('STDOUT\n') || split < 0) return null
  const stdout = normalized.slice(7, split).trimEnd()
  if (!stdout.startsWith('TAP version 13\n') || /^Bail out!/m.test(stdout)
    || (stdout.match(/^TAP version /gm) ?? []).length !== 1 || (stdout.match(/^1\.\./gm) ?? []).length !== 1) return null
  const summary = stdout.match(new RegExp('\\n1\\.\\.(\\d+)\\n# tests (\\d+)\\n# suites (\\d+)'
    + '\\n# pass (\\d+)\\n# fail (\\d+)\\n# cancelled (\\d+)\\n# skipped (\\d+)\\n# todo (\\d+)\\n# duration_ms [\\d.]+$'))
  if (!summary) return null
  const numbers = summary.slice(1).map(Number)
  if (numbers.some(n => !Number.isSafeInteger(n) || n < 0)) return null
  const [plan = -1, tests = -1, , passed = -1, failed = -1, cancelled = -1, skipped = -1, todo = -1] = numbers
  const roots = [...stdout.matchAll(/^(?:not )?ok (\d+) - /gm)].map(row => Number(row[1]))
  if (roots.length !== plan || roots.some((n, i) => n !== i + 1)
    || tests !== passed + failed + cancelled + skipped + todo) return null
  return { tests, passed, failed, cancelled, skipped, todo }
}

async function readLog(actions: ProjectActions, workspace: string, id: string): Promise<Buffer> {
  const reference = await actions.logReference(workspace, id), path = join(reference.root, reference.path)
  const info = await lstat(path), root = await realpath(reference.root), selected = await realpath(path)
  const rel = relative(root, selected)
  if (!info.isFile() || info.isSymbolicLink() || isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\'))
    throw Error('ACTION_EVIDENCE_PATH_REFUSED')
  const file = await open(path, 'r')
  try {
    const before = await file.stat({ bigint: true }), maximum = 1024 * 1024
    if (before.size > BigInt(maximum)) throw Error('ACTION_EVIDENCE_LOG_TOO_LARGE')
    const bytes = Buffer.alloc(maximum + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    const after = await file.stat({ bigint: true })
    if (offset > maximum || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || BigInt(offset) !== after.size) throw Error('ACTION_EVIDENCE_LOG_CHANGED')
    return bytes.subarray(0, offset)
  } finally { await file.close() }
}

/** Read one existing run and optionally parse its complete retained Node TAP log.
 * @param actions - The actual ProjectActions owner; callers cannot submit result or log bytes.
 * @param workspace - Existing workspace scope checked by that owner.
 * @param id - Existing run identity within the workspace.
 * @param parser - Explicit supported parser or null; unsupported parsers refuse.
 * @returns Current retained-log facts; coverage/freshness/acceptance stay unassessed and no receipt persists.
 */
export async function actionEvidence(actions: ProjectActions, workspace: string, id: string,
  parser: unknown = null): Promise<ActionEvidence> {
  if (parser !== null && parser !== 'node-tap-13/1') throw Error('ACTION_EVIDENCE_PARSER_UNSUPPORTED')
  const view = await actions.inspect(workspace), run = view.runs.find(row => row.id === id)
  if (!run) throw Error('ACTION_EVIDENCE_RUN_UNKNOWN')
  const command = commandFacts(run)
  const log: ActionEvidence['log'] = { digest: null, complete: false, parserVersion: parser, tests: null }
  if (run.logAvailable === true) {
    const bytes = await readLog(actions, workspace, id)
    log.digest = createHash('sha256').update(bytes).digest('hex')
    log.complete = typeof run.startedAt === 'string' && typeof run.finishedAt === 'string' && run.logTruncated === false
      && !command.cancelled && !command.timedOut && !command.interrupted && ['PASS', 'FAIL'].includes(run.status)
    if (parser && log.complete) log.tests = tapSummary(bytes.toString('utf8'))
  }
  return { runId: id, command, log, coverage: 'unknown', freshness: 'UNKNOWN', acceptance: 'PENDING', receipt: null }
}
