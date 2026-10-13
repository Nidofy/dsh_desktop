/** Independent task captures retain complete committed Notebook input; text and settings never imply engineering acceptance. */
import type { NotebookInputCapture } from '@nidofy/dsh-desktop-extras/context'
import type { SessionPersistenceGeneration } from '@deepseek-ai/dsh-session-persistence'
import { brandString } from '@deepseek-ai/dsh-brand'
import { object } from '../connections/store.ts'

/** Read the independently versioned private Notebook capture; future/damaged fields refuse without a live Notebook fallback.
 * @param input - Complete capture from a private journal or the current Notebook input owner.
 * @returns Bounded original rendering and exact physical source/settings, without synchronization or source rewriting.
 */
export function parseTaskNotebookInput(input: unknown): NotebookInputCapture {
  const row = object(input), scope = object(row.scope), policy = object(row.policy)
  const fields = (value: Record<string, unknown>, names: readonly string[]): void => {
    if (Object.keys(value).length !== names.length || Object.keys(value).some(key => !names.includes(key))) {
      throw Error('EXPERIMENT_NOTEBOOK_INPUT_INVALID')
    }
  }
  fields(row, ['scope', 'revision', 'text', 'maxActiveEntries', 'maxActiveBytes', 'policy'])
  fields(scope, ['sessionId', 'generation']); fields(policy, ['autoOrganize', 'revision'])
  const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed()
    && !value.includes('\0') && Buffer.byteLength(value) <= max
  if (!text(scope.sessionId, 128) || !scope.sessionId || !text(scope.generation, 512) || !scope.generation
    || !integer(row.revision) || !integer(row.maxActiveEntries) || row.maxActiveEntries < 1 || row.maxActiveEntries > 256
    || !integer(row.maxActiveBytes) || row.maxActiveBytes < 1024 || row.maxActiveBytes > 65536
    || !text(row.text, row.maxActiveBytes) || !integer(policy.revision) || typeof policy.autoOrganize !== 'boolean') {
    throw Error('EXPERIMENT_NOTEBOOK_INPUT_INVALID')
  }
  return { scope: { sessionId: scope.sessionId, generation: brandString<SessionPersistenceGeneration>(scope.generation) },
    revision: row.revision, text: row.text, maxActiveEntries: row.maxActiveEntries, maxActiveBytes: row.maxActiveBytes,
    policy: { autoOrganize: policy.autoOrganize, revision: policy.revision } }
}
