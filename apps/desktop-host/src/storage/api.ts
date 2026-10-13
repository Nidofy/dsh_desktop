/** Authenticated quota management consumes the product owner; it grants no writer capabilities. */
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { StorageOperationId } from '@nidofy/dsh-desktop-extras/storage'
import { object } from '../connections/store.ts'

/** Dispatch local-user management actions without replaying uncertain operations.
 * @param ctx - Product Host context with the existing quota owner.
 * @param input - Validated transport action and local-user values.
 * @returns Observed capacity, configured capacity, explicit recovery or operation inspection.
 */
export async function quotaRequest(ctx: Context, input: unknown) {
  const data = object(input), owner = ctx.get('nidofyStorage')
  if (!owner) throw Error('STORAGE_OWNER_UNAVAILABLE')
  const fields: Record<string, readonly string[]> = { status: ['action'], recover: ['action'],
    configure: ['action', 'limitBytes'], inspect: ['action', 'operationId'] }
  const allowed = typeof data.action === 'string' ? fields[data.action] : undefined
  if (!allowed || Object.keys(data).some(key => !allowed.includes(key))) throw Error('STORAGE_ACTION_UNSUPPORTED')
  switch (data.action) {
    case 'status': return owner.status()
    case 'recover': return owner.recover()
    case 'configure': {
      if (typeof data.limitBytes !== 'number' || !Number.isSafeInteger(data.limitBytes) || data.limitBytes < 1) {
        throw Error('STORAGE_LIMIT_INVALID')
      }
      return owner.configure(data.limitBytes)
    }
    case 'inspect': {
      if (typeof data.operationId !== 'string' || !/^[a-zA-Z0-9-]{16,128}$/.test(data.operationId)) throw Error('STORAGE_ID_INVALID')
      return owner.inspect(brandString<StorageOperationId>(data.operationId))
    }
    default: throw Error('STORAGE_ACTION_UNSUPPORTED')
  }
}
