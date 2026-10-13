/** Complete stream accounting preserves original results and refuses only subsequent work. */
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, writeFile, readFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ShellExecution, ShellRunResult } from '@deepseek-ai/dsh-shell'
import { EngineeringShellRun, engineeringShellCharge, parseEngineeringShellBudget, parseEngineeringShellResult } from '../src/experiments/engineering-shell.ts'
const retained: string[] = []
afterEach(() => { retained.length = 0 })
const budget = { outputBytes: 100, retainedSpillBytes: 1000 }
const result: ShellRunResult = { exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 1000,
  stdout: { text: '尾', truncated: false }, stderr: { text: '', truncated: false } }
function handle(bytes: number, path?: string): ShellExecution {
  return { status: 'completed', exitCode: 0, signal: null, done: Promise.resolve(), kill: () => false,
    readOutput: () => { throw Error('Consuming cursor must stay untouched') }, result: () => Promise.resolve(result),
    observed: { stdout: { readFrom: () => ({ text: '尾', nextOffset: bytes, lossy: !!path, ...path ? { spillPath: path } : {} }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } } }
}
it('requires explicit independent safe integer allowances', () => {
  expect(parseEngineeringShellBudget(budget)).toEqual(budget)
  for (const input of [{}, { ...budget, extra: 1 }, { ...budget, outputBytes: -1 }, { ...budget, retainedSpillBytes: 99 }]) {
    expect(() => parseEngineeringShellBudget(input)).toThrow('EXPERIMENT_RESOURCE_SHELL_BUDGET_INVALID')
  }
})
it('counts the original whole stream rather than the multibyte tail and preserves the result at exact exhaustion', async () => {
  const owner = new EngineeringShellRun('original', budget), original = structuredClone(result)
  await owner.settled(handle(100), result)
  expect(result).toEqual(original)
  expect(owner.result().runs[0]?.stdout).toEqual({ bytes: 100, spill: null })
  expect(() => { owner.check() }).toThrow('EXPERIMENT_RESOURCE_SHELL_LIMIT')
  expect(parseEngineeringShellResult(owner.result(), 'original')).toEqual(owner.result())
})
it('includes both streams and every action in the complete allowance', async () => {
  const owner = new EngineeringShellRun('original', budget), second = handle(40)
  second.observed.stderr.readFrom = () => ({ text: 'e', nextOffset: 20, lossy: false })
  await owner.settled(handle(40), result); owner.check(); await owner.settled(second, result)
  expect(() => { owner.check() }).toThrow('EXPERIMENT_RESOURCE_SHELL_LIMIT')
})
it('retains actual full spill identities and charges over-limit retained lengths without deleting the original', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-shell-resource-')), path = join(root, 'stdout.log')
  retained.push(root); await writeFile(path, Buffer.alloc(120, 7))
  const owner = new EngineeringShellRun('original', budget)
  await owner.settled(handle(120, path), result)
  const info = await lstat(path, { bigint: true })
  expect(owner.result().runs[0]?.stdout.spill).toEqual({ path, bytes: 120, identity: `${info.dev}:${info.ino}` })
  expect(await engineeringShellCharge(budget, owner.result())).toBe(120)
  expect(await readFile(path)).toEqual(Buffer.alloc(120, 7))
  await writeFile(path, Buffer.alloc(121)); await expect(engineeringShellCharge(budget, owner.result())).rejects.toThrow()
})
it('preserves unknown streams and refuses missing observers or inaccessible spill capacity', async () => {
  const owner = new EngineeringShellRun('original', budget), current = handle(1)
  current.observed.stdout.readFrom = () => { throw Error('Unavailable') }
  await owner.settled(current, result)
  expect(owner.result().runs[0]?.stdout.bytes).toBeNull()
  expect(() => { owner.check() }).toThrow('EXPERIMENT_RESOURCE_SHELL_UNKNOWN')
  await expect(engineeringShellCharge(budget, owner.result())).rejects.toThrow('EXPERIMENT_RESOURCE_SHELL_UNKNOWN')
  await expect(engineeringShellCharge(budget, null)).rejects.toThrow('EXPERIMENT_RESOURCE_SHELL_UNKNOWN')
})
it('retains full reservations even for a confirmed zero-output run and rejects forged counts', async () => {
  const owner = new EngineeringShellRun('original', budget)
  await owner.settled(handle(0), result)
  expect(await engineeringShellCharge(budget, owner.result())).toBe(100)
  expect(() => parseEngineeringShellResult({ ...owner.result(), runs: [{ stdout: { bytes: -1, spill: null }, stderr: { bytes: 0, spill: null } }] }, 'original')).toThrow()
})
it('keeps known complete output bytes but refuses unknown retention after truncation without an advertised spill', async () => {
  const owner = new EngineeringShellRun('original', budget), original = { ...result, stdout: { text: '尾', truncated: true } }
  await owner.settled(handle(50), original)
  expect(owner.result().runs[0]?.stdout).toEqual({ bytes: 50, spill: null })
  expect(() => { owner.check() }).toThrow('EXPERIMENT_RESOURCE_SHELL_UNKNOWN')
  await expect(engineeringShellCharge(budget, owner.result())).rejects.toThrow('EXPERIMENT_RESOURCE_SHELL_UNKNOWN')
  expect(original.stdout).toEqual({ text: '尾', truncated: true })
})
it('preserves complete coordinates when a published spill cannot be measured', async () => {
  const owner = new EngineeringShellRun('original', budget)
  await owner.settled(handle(50, join(tmpdir(), 'absent-' + randomUUID())), result)
  expect(owner.result().runs[0]?.stdout).toEqual({ bytes: 50, spill: null })
  expect(() => { owner.check() }).toThrow('EXPERIMENT_RESOURCE_SHELL_UNKNOWN')
})
