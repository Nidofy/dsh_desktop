/** Real Windows descriptor round-trips on isolated, disposable objects. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { win32Sync } from '../src/ffi.ts'
import { grantedSecurityState, readSecurityState, writeSecurityState, withSecurityObject } from '../src/security-state.ts'

describe.skipIf(process.platform !== 'win32')('recoverable security descriptors', () => {
  it('reads a Modify-only directory without requesting WRITE_OWNER and refuses mutation through its snapshot handle', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-security-read-'))
    const child = join(root, 'modify-only')
    mkdirSync(child)
    const api = win32Sync()
    const original = readSecurityState(api, child)
    try {
      withSecurityObject(api, child, (held) => {
        try {
          const command = '$path = $env:DSH_TEST_ACL_DIR; $acl = [System.IO.Directory]::GetAccessControl($path); '
            + '$acl.SetAccessRuleProtection($true, $false); '
            + '$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User; '
            + '$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, "Modify", "Allow"); '
            + '$acl.AddAccessRule($rule); [System.IO.Directory]::SetAccessControl($path, $acl)'
          execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
            Buffer.from(command, 'utf16le').toString('base64')], {
            windowsHide: true, env: { ...process.env, DSH_TEST_ACL_DIR: child },
          })
          expect(readSecurityState(api, child).dacl).not.toBe(original.dacl)
          expect(() => { withSecurityObject(api, child, () => {}) }).toThrow(/NtOpenFile/u)
          withSecurityObject(api, child, (snapshot) => {
            expect(() => { writeSecurityState(api, child, original, snapshot) }).toThrow(/snapshot handle cannot write/u)
          }, 'read')
        } finally { writeSecurityState(api, child, original, held) }
      })
      expect(readSecurityState(api, child)).toEqual(original)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('changes only the selected object and restores exact original DACL and label fields', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-security-state-'))
    const child = join(root, 'child')
    mkdirSync(child)
    writeFileSync(join(child, 'file'), 'preserved bytes')
    const api = win32Sync()
    const original = readSecurityState(api, root)
    const childOriginal = readSecurityState(api, child)
    try {
      const granted = grantedSecurityState(original, 'S-1-4-9100-1', true)
      writeSecurityState(api, root, granted)
      expect(readSecurityState(api, root)).toEqual(granted)
      expect(readSecurityState(api, child)).toEqual(childOriginal)
      writeSecurityState(api, root, original)
      expect(readSecurityState(api, root)).toEqual(original)
      expect(readSecurityState(api, child)).toEqual(childOriginal)
    } finally {
      writeSecurityState(api, root, original)
      rmSync(root, { recursive: true, force: true })
    }
  })
})
