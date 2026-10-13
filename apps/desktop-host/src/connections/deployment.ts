/** Home proxy edits take effect only through the next official profile launch. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-app-boot'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { object } from './store.ts'

const names = { httpProxy: 'HTTP_PROXY', httpsProxy: 'HTTPS_PROXY', allProxy: 'ALL_PROXY', noProxy: 'NO_PROXY' } as const
type Field = keyof typeof names
const begin = '# BEGIN DSH DESKTOP PROXY SETTINGS'
const end = '# END DSH DESKTOP PROXY SETTINGS'
type DeploymentRevision = Branded<'DesktopDeploymentRevision'>
const revision = (text: string): DeploymentRevision => brandString<DeploymentRevision>(createHash('sha256').update(text).digest('hex'))

function valueFor(values: Record<string, string | undefined>, name: string): string {
  return values[name.toLowerCase()] ?? values[name] ?? ''
}

function display(value: string, field: Field): { value: string; credentialed: boolean } {
  if (field === 'noProxy' || value === '') return { value, credentialed: false }
  const url = URL.parse(value)
  if (url === null) return { value: '', credentialed: true }
  const credentialed = url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== ''
  url.username = ''; url.password = ''; url.search = ''; url.hash = ''
  return { value: url.href, credentialed }
}

function validated(value: unknown, field: Field): string {
  if (typeof value !== 'string' || /[\r\n\0]/u.test(value)) throw Error('DEPLOYMENT_VALUE_INVALID')
  const text = value.trim()
  if (text === '') return text
  if (field === 'noProxy') {
    if (!/^[a-zA-Z0-9.*,:\[\]_\-\s]+$/u.test(text)) throw Error('DEPLOYMENT_BYPASS_INVALID')
    return text
  }
  const url = URL.parse(text)
  if (url === null || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || url.pathname !== '/') throw Error('DEPLOYMENT_PROXY_INVALID')
  return url.href
}

/** Serializes the editor's block without changing bytes outside it. */
function update(text: string, changes: Record<string, unknown>): string {
  const first = text.indexOf(begin), last = text.indexOf(end)
  const markerLine = (index: number, marker: string): boolean => (index === 0 || text[index - 1] === '\n')
    && (index + marker.length === text.length || /^\r?\n/u.test(text.slice(index + marker.length)))
  if ((first === -1) !== (last === -1) || first >= 0 && (last < first
    || !markerLine(first, begin) || !markerLine(last, end)
    || text.indexOf(begin, first + begin.length) !== -1 || text.indexOf(end, last + end.length) !== -1)) {
    throw Error('DEPLOYMENT_FILE_INVALID')
  }
  const current = parseEnv(text)
  const values = Object.fromEntries(Object.entries(names).map(([field, name]) => [field, valueFor(current, name)]))
  for (const [field, value] of Object.entries(changes)) {
    if (!Object.hasOwn(names, field)) throw Error('DEPLOYMENT_FIELD_UNSUPPORTED')
    values[field] = validated(value, field as Field)
  }
  // Existing multiline/protected proxy values require manual repair; never serialize them into a changed value.
  if (Object.values(values).some(value => /[\r\n\0"\\]/u.test(value))) throw Error('DEPLOYMENT_FILE_INVALID')
  const block = [begin, ...Object.entries(names).flatMap(([field, name]) =>
    [name, name.toLowerCase()].map(alias => `${alias}="${values[field] ?? ''}"`)), end].join('\n')
  const next = first < 0 ? text + (text === '' || text.endsWith('\n') ? '' : '\n') + block + '\n'
    : text.slice(0, first) + block + text.slice(last + end.length)
  const parsed = parseEnv(next), proxyNames = new Set(Object.values(names).flatMap(name => [name, name.toLowerCase()]))
  if (Object.keys({ ...current, ...parsed }).some(name => !proxyNames.has(name) && current[name] !== parsed[name])) {
    throw Error('DEPLOYMENT_FILE_INVALID')
  }
  return next
}

/** Edit only the Harness-home proxy layer; retain the launch snapshot and active requests.
 * CA trust is inherited at Node startup and is not writable through a discovered environment file.
 */
export class DeploymentSettings {
  private readonly path: string
  private readonly environment: Context['launchEnvironment']
  constructor(ctx: Context, home: string) { this.path = join(home, '.env'); this.environment = ctx.get('launchEnvironment') }

  private async read(): Promise<string> {
    try {
      const entry = await lstat(this.path)
      if (!entry.isFile() || entry.isSymbolicLink()) throw Error('DEPLOYMENT_FILE_INVALID')
      return await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    }
  }

  private snapshot(text: string) {
    const saved = parseEnv(text)
    const fieldState = (field: Field) => {
      const name = names[field]
      const lower = this.environment?.get(name.toLowerCase()), upper = this.environment?.get(name)
      const applied = lower?.value.trim() ? lower : upper
      const next = valueFor(saved, name)
      return { saved: display(next, field), applied: display(applied?.value ?? '', field),
        source: applied?.source ?? 'none', overridden: [lower, upper].some(entry => entry?.source === 'process'),
        pending: next !== (applied?.value ?? '') && ![lower, upper].some(entry => entry?.source === 'process') }
    }
    const fields = { httpProxy: fieldState('httpProxy'), httpsProxy: fieldState('httpsProxy'),
      allProxy: fieldState('allProxy'), noProxy: fieldState('noProxy') }
    return { revision: revision(text), fields, ca: { configured: !!this.environment?.get('NODE_EXTRA_CA_CERTS')?.value,
      source: 'launch-environment', restart: 'desktop' }, restart: 'host', loopbackBypass: true }
  }

  /** Read redacted saved values, launch values and inherited precedence.
   * @returns Deployment state without proxy credentials or CA file contents.
   */
  async status() { return this.snapshot(await this.read()) }

  /** Atomically save the edited proxy fields after comparing the current complete environment document.
   * @param input - JSON action, expected revision and edited fields; no runtime hot switching.
   * @returns Redacted next-launch state; a lost response is reconciled by reading status.
   * @throws For stale edits, unsupported fields, malformed URLs or unsafe file entries.
   */
  async request(input: unknown) {
    const data = object(input)
    if (data.action === 'status') return this.status()
    if (data.action !== 'save') throw Error('DEPLOYMENT_ACTION_UNSUPPORTED')
    const fields = object(data.fields)
    return withFileLock(this.path, async () => {
      const text = await this.read()
      if (data.expectedRevision !== revision(text)) throw Error('DEPLOYMENT_REVISION_CONFLICT')
      const next = update(text, fields)
      await writeFileAtomic(this.path, next, { mode: 0o600, dirMode: 0o700 })
      return this.snapshot(next)
    })
  }
}
