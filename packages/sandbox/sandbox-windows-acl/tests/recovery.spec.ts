/** Durable recovery through real Windows file security and process-held locks. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { win32Sync } from '../src/ffi.ts'
import { recoverAbandonedGrants, WorkspaceGrantLease } from '../src/recovery.ts'
import { createdObjectSecurityState, grantedSecurityState, readSecurityState, writeSecurityState, withSecurityObject } from '../src/security-state.ts'
import { workspaceWriteSid } from '../src/workspace-sid.ts'

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'dsh-acl-recovery-test-'))
  const root = join(base, 'workspace')
  const storage = join(base, 'storage')
  mkdirSync(root)
  mkdirSync(storage)
  const api = { ...win32Sync(), shGetFolderPathW: (_window: null, _folder: number, _token: null, _flags: number, buffer: Buffer) => {
    buffer.write(storage, 'utf16le')
    return 0
  } }
  return { base, root, storage, api, sid: workspaceWriteSid(root) }
}

describe.skipIf(process.platform !== 'win32')('Windows workspace grant recovery', () => {
  it('shares a live grant without rewriting files and restores existing and new objects after the last release', () => {
    const { base, root, api, sid } = fixture()
    const child = join(root, 'existing')
    mkdirSync(child)
    const file = join(child, 'file.txt')
    writeFileSync(file, 'unchanged')
    const paths = [root, child, file]
    const original = paths.map(path => readSecurityState(api, path))
    let first: WorkspaceGrantLease | undefined
    let second: WorkspaceGrantLease | undefined
    try {
      const setter = vi.spyOn(api, 'ntSetSecurityObject')
      first = WorkspaceGrantLease.acquire(api, root, sid)
      expect(setter).toHaveBeenCalledTimes(3)
      second = WorkspaceGrantLease.acquire(api, root, sid, first.authorization)
      expect(setter).toHaveBeenCalledTimes(3)
      const created = join(child, 'created.txt')
      writeFileSync(created, 'new contents')
      first.dispose()
      expect(setter).toHaveBeenCalledTimes(3)
      expect(() => WorkspaceGrantLease.acquire(api, root, sid, first!.authorization)).toThrow(/released/)
      second.dispose()
      second.dispose()
      expect(paths.map(path => readSecurityState(api, path))).toEqual(original)
      expect(readSecurityState(api, created).label).toBe(null)
      expect(readFileSync(created, 'utf8')).toBe('new contents')
      expect(recoverAbandonedGrants(api)).toEqual([])
      expect(readdirSync(join(base, 'storage', 'DeepSeek', 'Harness', 'acl-recovery-v1'), { recursive: true })).not.toContain('active.jsonl')
    } finally {
      first?.dispose()
      second?.dispose()
      paths.forEach((path, index) =>{  writeSecurityState(api, path, original[index]!) })
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('writes the opened object rather than a replacement even under Windows POSIX rename semantics', () => {
    const { base, root, api } = fixture()
    const original = readSecurityState(api, root)
    try {
      withSecurityObject(api, root, (object) => {
        renameSync(root, `${root}-moved`)
        mkdirSync(root)
        const replacement = readSecurityState(api, root)
        writeSecurityState(api, root, { ...original, control: original.control | 0x1000 }, object)
        expect(readSecurityState(api, root)).toEqual(replacement)
        expect(readSecurityState(api, `${root}-moved`).control & 0x1000).toBe(0x1000)
        writeSecurityState(api, root, original, object)
      })
    } finally { rmSync(base, { recursive: true, force: true }) }
  })

  it('recovers a killed owner on startup, including a kill immediately after the first native write', async () => {
    for (const crash of ['ready', 'first-write']) {
      const { base, root, api, storage, sid } = fixture()
      const file = join(root, 'existing.txt')
      writeFileSync(file, 'kept')
      const original = [readSecurityState(api, root), readSecurityState(api, file)]
      const child = spawn(process.execPath, ['--import', 'tsx/esm', fileURLToPath(new URL('./fixtures/recovery-child.ts', import.meta.url)), root, storage, crash], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      child.stderr.on('data', (bytes) => { stderr += String(bytes) })
      try {
        const exited = once(child, 'exit')
        if (crash === 'ready') {
          const bytes = await new Promise<Buffer>((resolve) => { child.stdout.once('data', resolve) })
          expect(String(bytes), stderr).toContain('ready')
          expect(recoverAbandonedGrants(api)).toEqual([])
          child.kill()
        }
        await exited
        expect(recoverAbandonedGrants(api), stderr).toEqual([])
        expect([readSecurityState(api, root), readSecurityState(api, file)]).toEqual(original)
        const repeated = WorkspaceGrantLease.acquire(api, root, sid)
        repeated.dispose()
        expect(readSecurityState(api, root)).toEqual(original[0])
      } finally {
        child.kill()
        writeSecurityState(api, root, original[0]!)
        writeSecurityState(api, file, original[1]!)
        rmSync(base, { recursive: true, force: true })
      }
    }
  }, 20_000)

  it('resolves a child against its fixed parent even when an ancestor is replaced with an outside junction', () => {
    const { base, root, api } = fixture()
    const parent = join(root, 'ancestor')
    const moved = join(root, 'moved')
    const outside = join(base, 'outside')
    mkdirSync(parent)
    mkdirSync(outside)
    const target = join(parent, 'file')
    const sentinel = join(outside, 'file')
    writeFileSync(target, 'inside')
    writeFileSync(sentinel, 'outside')
    const original = readSecurityState(api, target)
    const outsideOriginal = readSecurityState(api, sentinel)
    const open = api.ntOpenFile.bind(api)
    let count = 0
    const last = target.slice(parse(target).root.length).split(sep).length
    api.ntOpenFile = (...args) => {
      if (++count === last) {
        renameSync(parent, moved)
        symlinkSync(outside, parent, 'junction')
      }
      return open(...args)
    }
    try {
      withSecurityObject(api, target, (object) => {
        writeSecurityState(api, target, { ...original, control: original.control | 0x1000 }, object)
        expect(readSecurityState(api, sentinel)).toEqual(outsideOriginal)
        expect(readSecurityState(api, join(moved, 'file')).control & 0x1000).toBe(0x1000)
        writeSecurityState(api, target, original, object)
      })
      expect(() => readSecurityState(api, target)).toThrow(/reparse/)
    } finally {
      api.ntOpenFile = open
      rmSync(parent, { force: true })
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('refuses an unbacked legacy grant without changing its ACL or Low label', () => {
    const { base, root, api, sid } = fixture()
    const original = readSecurityState(api, root)
    const legacy = grantedSecurityState(original, sid, true)
    try {
      writeSecurityState(api, root, legacy)
      expect(() => WorkspaceGrantLease.acquire(api, root, sid)).toThrow(/backup|legacy/i)
      expect(readSecurityState(api, root)).toEqual(legacy)
    } finally {
      writeSecurityState(api, root, original)
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('restores an explicit inheritable Medium label and protected DACL controls', () => {
    const { base, root, api, sid } = fixture()
    const original = readSecurityState(api, root)
    const medium = Buffer.from(grantedSecurityState(original, sid, true).label!, 'base64')
    medium.writeUInt32LE(8192, 24)
    try {
      writeSecurityState(api, root, { ...original, label: medium.toString('base64'), control: original.control | 0x1000 })
      const before = readSecurityState(api, root)
      expect(before.control & 0x1000).toBe(0x1000)
      expect(Buffer.from(before.label!, 'base64').readUInt32LE(24)).toBe(8192)
      const file = join(root, 'inherited.txt')
      writeFileSync(file, 'preserve inherited label')
      const childBefore = readSecurityState(api, file)
      const lease = WorkspaceGrantLease.acquire(api, root, sid)
      expect(readSecurityState(api, root).label).not.toEqual(before.label)
      lease.dispose()
      expect(readSecurityState(api, root)).toEqual(before)
      expect(readSecurityState(api, file)).toEqual(childBefore)
    } finally {
      writeSecurityState(api, root, original)
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('keeps a pre-existing parent delete-child deny on a directory created during the lease', () => {
    const { base, root, api, sid } = fixture()
    const original = readSecurityState(api, root)
    // The explicit deny predates this lease. New-child cleanup must preserve its inheritance.
    const priorDeny = createdObjectSecurityState(grantedSecurityState(original, sid, true), sid, original, true)
    try {
      writeSecurityState(api, root, priorDeny)
      const lease = WorkspaceGrantLease.acquire(api, root, sid)
      const child = join(root, 'created')
      mkdirSync(child)
      const expected = createdObjectSecurityState(readSecurityState(api, child), sid, priorDeny, true)
      lease.dispose()
      expect(readSecurityState(api, root)).toEqual(priorDeny)
      expect(readSecurityState(api, child)).toEqual(expected)
      // An inherited deny ACE (type 1, flags include INHERITED) remains in the child's ACL.
      const acl = Buffer.from(expected.dacl!, 'base64')
      expect(acl[8]).toBe(1)
      expect(acl[9]! & 0x10).toBe(0x10)
    } finally {
      writeSecurityState(api, root, original)
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('keeps conflicting permissions and their recovery record, without blocking an unrelated workspace', () => {
    const { base, root, api, sid } = fixture()
    const original = readSecurityState(api, root)
    try {
      const lease = WorkspaceGrantLease.acquire(api, root, sid)
      const changed = { ...readSecurityState(api, root), label: null }
      writeSecurityState(api, root, changed)
      expect(() =>{  lease.dispose() }).toThrow(/recovery incomplete/)
      expect(readSecurityState(api, root)).toEqual(changed)
      expect(recoverAbandonedGrants(api)).toHaveLength(1)
      const other = join(base, 'other')
      mkdirSync(other)
      const unrelated = WorkspaceGrantLease.acquire(api, other, workspaceWriteSid(other))
      unrelated.dispose()
      writeSecurityState(api, root, original)
      expect(recoverAbandonedGrants(api)).toEqual([])
    } finally {
      writeSecurityState(api, root, original)
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('cleans its inherited grant from an atomic-save replacement without applying the old file descriptor', () => {
    const { base, root, api, sid } = fixture()
    const file = join(root, 'file')
    writeFileSync(file, 'old')
    const original = readSecurityState(api, root)
    try {
      const lease = WorkspaceGrantLease.acquire(api, root, sid)
      rmSync(file)
      writeFileSync(file, 'replacement')
      const replacement = readSecurityState(api, file)
      const expected = createdObjectSecurityState(replacement, sid, original, false)
      lease.dispose()
      expect(readSecurityState(api, file)).toEqual(expected)
      expect(readFileSync(file, 'utf8')).toBe('replacement')
      expect(existsSync(root)).toBe(true)
    } finally {
      writeSecurityState(api, root, original)
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('restores a renamed existing directory and its child using their original file identities', () => {
    const { base, root, api, sid } = fixture()
    const originalPath = join(root, 'original')
    const moved = join(root, 'moved')
    mkdirSync(originalPath)
    writeFileSync(join(originalPath, 'file'), 'same object')
    const before = [readSecurityState(api, originalPath), readSecurityState(api, join(originalPath, 'file'))]
    const rootBefore = readSecurityState(api, root)
    try {
      const lease = WorkspaceGrantLease.acquire(api, root, sid)
      renameSync(originalPath, moved)
      lease.dispose()
      expect([readSecurityState(api, moved), readSecurityState(api, join(moved, 'file'))]).toEqual(before)
    } finally {
      writeSecurityState(api, root, rootBefore)
      rmSync(base, { recursive: true, force: true })
    }
  })
})
