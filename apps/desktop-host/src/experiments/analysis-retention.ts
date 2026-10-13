/** Explicit side-analysis retention metadata never moves, replaces or deletes official journals. */
import { join } from 'node:path'
import { lstat, readdir } from 'node:fs/promises'
import { readRecord } from '../workbench/verification-storage.ts'
import { unlinked } from '../selftest/store.ts'
import { object } from '../connections/store.ts'

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u
function exact(row: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(row).sort().join() !== [...keys].sort().join()) throw Error('ANALYSIS_RETENTION_INVALID')
}
/** Independent active/archive ceilings; existing journals retain the original twenty-active default. */
export type AnalysisBudget = { revision: number; activeLimit: number; archiveLimit: number }
/** @param active - User-selected active ceiling. @param archive - User-selected archive ceiling. @returns Validated finite ceilings. */
export function analysisLimits(active: unknown, archive: unknown): { activeLimit: number; archiveLimit: number } {
  if (typeof active !== 'number' || !Number.isSafeInteger(active) || active < 1 || active > 20
    || typeof archive !== 'number' || !Number.isSafeInteger(archive) || archive < 0 || archive > 80) throw Error('ANALYSIS_BUDGET_INVALID')
  return { activeLimit: active, archiveLimit: archive }
}
/** @param base - Owned side-analysis collection. @returns Cold immutable budget revision; damaged/residue records refuse. */
export async function readAnalysisBudget(base: string): Promise<AnalysisBudget> {
  const path = join(base, 'retention-v1'); await unlinked(path)
  let names: string[]
  try { names = await readdir(path) }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { revision: 0, activeLimit: 20, archiveLimit: 80 }; throw error }
  if (names.length > 256) throw Error('ANALYSIS_BUDGET_HISTORY_LIMIT')
  names.sort()
  let budget: AnalysisBudget = { revision: 0, activeLimit: 20, archiveLimit: 80 }
  for (const [index, name] of names.entries()) {
    if (name !== `budget-${String(index + 1).padStart(6, '0')}.json`) throw Error('ANALYSIS_RETENTION_INVALID')
    const info = await lstat(join(path, name)), bytes = await readRecord(join(path, name))
    if (info.nlink !== 1 || info.size > 4096 || !bytes) throw Error('ANALYSIS_RETENTION_INVALID')
    const row = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
    exact(row, ['schemaVersion', 'kind', 'revision', 'activeLimit', 'archiveLimit', 'operationId', 'committedAt'])
    if (row.schemaVersion !== 1 || row.kind !== 'side-analysis-budget' || row.revision !== index + 1
      || typeof row.operationId !== 'string' || !UUID.test(row.operationId) || !Number.isSafeInteger(row.committedAt)
      || Number(row.committedAt) < 0) throw Error('ANALYSIS_RETENTION_INVALID')
    budget = { revision: index + 1, ...analysisLimits(row.activeLimit, row.archiveLimit) }
  }
  return budget
}
/** @param root - Original run directory. @param id - Exact run identity. @returns Archive receipt or null; no journal relocation. */
export async function readAnalysisArchive(root: string, id: string): Promise<{ operationId: string; archivedAt: number } | null> {
  const path = join(root, 'archive.json'), bytes = await readRecord(path)
  if (!bytes) return null
  const info = await lstat(path)
  if (info.nlink !== 1 || info.size > 4096) throw Error('ANALYSIS_RETENTION_INVALID')
  const row = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  exact(row, ['schemaVersion', 'kind', 'id', 'operationId', 'archivedAt'])
  if (row.schemaVersion !== 1 || row.kind !== 'side-analysis-archive' || row.id !== id
    || typeof row.operationId !== 'string' || !UUID.test(row.operationId) || typeof row.archivedAt !== 'number'
    || !Number.isSafeInteger(row.archivedAt) || row.archivedAt < 0) throw Error('ANALYSIS_RETENTION_INVALID')
  return { operationId: row.operationId, archivedAt: row.archivedAt }
}
