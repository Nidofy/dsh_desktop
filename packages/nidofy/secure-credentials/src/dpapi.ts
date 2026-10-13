/** Windows DPAPI CurrentUser through a bounded, hidden PowerShell helper with private pipes. */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { SecureCredentialError } from './errors.ts'
import type { SecretProtector } from './types.ts'

// The encoded command is constant: neither plaintext nor namespace enters argv.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  Add-Type -AssemblyName System.Security
  $r = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $data = [Convert]::FromBase64String($r.data)
  $entropy = [Convert]::FromBase64String($r.entropy)
  $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($r.op -eq 'protect') {
    $out = [System.Security.Cryptography.ProtectedData]::Protect($data, $entropy, $scope)
  } elseif ($r.op -eq 'unprotect') {
    $out = [System.Security.Cryptography.ProtectedData]::Unprotect($data, $entropy, $scope)
  } else { exit 1 }
  [Console]::Out.Write([Convert]::ToBase64String($out))
} catch { exit 1 }
`
const ENCODED_SCRIPT = Buffer.from(SCRIPT, 'utf16le').toString('base64')

/** Production encryption adapter; data and diagnostics never enter the inherited console. */
export class WindowsDpapiProtector implements SecretProtector {
  constructor(private readonly timeoutMs: number, private readonly maxOutputBytes: number) {}

  protect(data: Buffer, entropy: Buffer): Promise<Buffer> {
    return this.run('protect', data, entropy)
  }

  unprotect(data: Buffer, entropy: Buffer): Promise<Buffer> {
    return this.run('unprotect', data, entropy)
  }

  private run(op: 'protect' | 'unprotect', data: Buffer, entropy: Buffer): Promise<Buffer> {
    if (process.platform !== 'win32' || !process.env.SystemRoot) {
      return Promise.reject(new SecureCredentialError('SECURE_BACKEND_UNAVAILABLE'))
    }
    const systemRoot = process.env.SystemRoot
    const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return new Promise((resolve, reject) => {
      const child = spawn(executable,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_SCRIPT], {
          windowsHide: true,
          env: { SystemRoot: systemRoot, windir: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP },
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      let failed = false
      let length = 0
      const chunks: Buffer[] = []
      const fail = (): void => { failed = true; child.kill() }
      const timer = setTimeout(fail, this.timeoutMs)
      child.on('error', fail)
      child.stdin.on('error', fail)
      // Drain but discard stderr: PowerShell diagnostics can quote request contents.
      child.stderr.resume()
      child.stdout.on('data', (chunk: Buffer) => {
        length += chunk.length
        if (length > this.maxOutputBytes) fail()
        else if (!failed) chunks.push(chunk)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        const encoded = Buffer.concat(chunks).toString('ascii')
        if (failed || code !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
          reject(new SecureCredentialError('SECURE_BACKEND_UNAVAILABLE'))
          return
        }
        resolve(Buffer.from(encoded, 'base64'))
      })
      child.stdin.end(JSON.stringify({ op, data: data.toString('base64'), entropy: entropy.toString('base64') }))
    })
  }
}
