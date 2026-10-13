/** Interrupted copy migration: faults replace filesystem writes, not encryption or commit observations. */
import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { migrationOperationId } from '../src/ids.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { boot, cleanup, config, directory, storageDirectory, SubstituteProtector } from './harness.ts'

const fault = vi.hoisted(() => ({ basename: '', armed: false }))
vi.mock('@deepseek-ai/dsh-atomic-write', async (original) => {
  const module = await original<typeof import('@deepseek-ai/dsh-atomic-write')>()
  return { ...module, writeFileAtomic: async (...args: Parameters<typeof module.writeFileAtomic>) => {
    if (fault.armed && args[0].endsWith(fault.basename)) { fault.armed = false; throw new Error('synthetic-write-refusal') }
    return module.writeFileAtomic(...args)
  } }
})
afterEach(async () => { fault.armed = false; await cleanup() })
const ref = credentialRef('T02_MIGRATED_KEY')
const key = credentialKey('llm-pi-ai', 'openai-codex')
const source = 'version: 1\nrefs:\n  T02_MIGRATED_KEY: synthetic-source-ref\nrecords:\n  llm-pi-ai/openai-codex:\n    kind: grant\n    payload:\n      refresh: synthetic-source-refresh\n'

it('encrypts a selected copy, verifies it, atomically selects it and returns a secret-free receipt', async () => {
  const home = await directory(), backend = new SubstituteProtector()
  const copy = join(home, 'selected-copy.yaml')
  await writeFile(copy, source)
  const { provider } = await boot(config(home), backend)
  const operationId = migrationOperationId(randomUUID())
  expect(await provider.migrateCopy(copy, operationId)).toEqual({ version: 1, operationId, references: 1, records: 1 })
  expect(await readFile(copy, 'utf8')).toBe(source)
  expect((await provider.resolve(ref))?.value).toBe('synthetic-source-ref')
  expect(await provider.readRecord(key)).toEqual({ kind: 'grant', payload: { refresh: 'synthetic-source-refresh' } })
  const storage = await storageDirectory(home)
  for (const name of ['current.json', 'migration-candidate.json', 'migration-receipt.json']) {
    expect(await readFile(join(storage, name), 'utf8')).not.toContain('synthetic-source')
  }
  expect(await provider.migrateCopy(copy, operationId)).toMatchObject({ operationId })
  await expect(provider.migrateCopy(copy, migrationOperationId(randomUUID()))).rejects.toThrow('SECURE_MIGRATION_CONFLICT')
})

it.each(['migration-candidate.json', 'migration-journal.json', 'current.json', 'migration-receipt.json'])(
  'recovers a failure writing %s without replaying the source or losing the committed selection', async (basename) => {
    const home = await directory(), backend = new SubstituteProtector(), operationId = migrationOperationId(randomUUID())
    const copy = join(home, 'selected-copy.yaml'); await writeFile(copy, source)
    const first = await boot(config(home), backend)
    fault.basename = basename; fault.armed = true
    await expect(first.provider.migrateCopy(copy, operationId)).rejects.toThrow('SECURE_STORAGE_UNAVAILABLE')
    expect(await readFile(copy, 'utf8')).toBe(source)
    await first.ctx.fiber.dispose()
    const second = await boot(config(home), backend)
    if (basename === 'migration-candidate.json' || basename === 'migration-journal.json') {
      expect(await second.provider.inspectMigration(operationId)).toBeUndefined()
      expect(await second.provider.resolve(ref)).toBeUndefined()
      // Staging has not yet recorded an operation. An explicit retry may reselect the unchanged copy.
      expect(await second.provider.migrateCopy(copy, operationId)).toMatchObject({ operationId })
    } else {
      expect(await second.provider.inspectMigration(operationId)).toEqual(
        basename === 'current.json' ? undefined : expect.objectContaining({ operationId }))
      await expect(second.provider.set(ref, 'synthetic-forbidden')).rejects.toThrow('SECURE_MIGRATION_PENDING')
      await writeFile(copy, 'source changed after interruption')
      expect(await second.provider.recoverMigration(operationId)).toMatchObject({ operationId, references: 1, records: 1 })
      expect((await second.provider.resolve(ref))?.value).toBe('synthetic-source-ref')
      expect(await readFile(copy, 'utf8')).toBe('source changed after interruption')
    }
    await second.provider.set(ref, 'synthetic-after-recovery')
  })

it('preserves selected bytes on backend refusal and invalid source versions without logging source data', async () => {
  const home = await directory(), backend = new SubstituteProtector()
  const copy = join(home, 'copy.yaml'); await writeFile(copy, 'version: synthetic-sensitive-version\n')
  const { provider } = await boot(config(home), backend)
  await expect(provider.migrateCopy(copy, migrationOperationId(randomUUID()))).rejects.toMatchObject({ message: 'SECURE_INVALID_DOCUMENT' })
  backend.refused = true
  await writeFile(copy, source)
  await expect(provider.migrateCopy(copy, migrationOperationId(randomUUID())))
    .rejects.toMatchObject({ message: 'SECURE_BACKEND_UNAVAILABLE' })
  expect(await readFile(copy, 'utf8')).toBe(source)
  backend.refused = false
  expect(await provider.resolve(ref)).toBeUndefined()
})
