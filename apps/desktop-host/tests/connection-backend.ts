/** Shared synthetic credential backend and service boot for connection owner specs. */
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'

/** Credential values shared across Host epochs, like one OS credential store behind two processes. */
export interface CredentialMemory {
  values: Map<string, string>
  failUnset: boolean
  failGet: boolean
  /** Async gate consulted before every reference read; used to delay publications deterministically. */
  beforeGet?: ((ref: string) => Promise<void>) | undefined
  /** Hook after every successful store; used to arm delayed-publication windows. */
  onSet?: (() => void) | undefined
}

export const credentialMemory = (): CredentialMemory => ({ values: new Map(), failUnset: false, failGet: false })

/** In-memory reference-half credential backend with injectable faults; the record half stays inert. */
export class OwnerCredentials extends CredentialProvider {
  constructor(ctx: Context, private readonly memory: CredentialMemory) { super(ctx) }
  private async read(ref: CredentialRef): Promise<string | undefined> {
    await this.memory.beforeGet?.(ref)
    if (this.memory.failGet) throw new Error('SYNTHETIC_BACKEND_DOWN')
    return this.memory.values.get(ref)
  }
  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return this.read(ref).then(value => value === undefined ? undefined : { value, source: 'memory' })
  }
  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: this.memory.values.has(ref), writable: true })
  }
  override async set(ref: CredentialRef, value: string): Promise<void> {
    if (this.memory.failUnset) throw new Error('SYNTHETIC_UNSET_DOWN')
    this.memory.values.set(ref, value)
    this.memory.onSet?.()
  }
  override async unset(ref: CredentialRef): Promise<void> {
    if (this.memory.failUnset) throw new Error('SYNTHETIC_UNSET_DOWN')
    this.memory.values.delete(ref)
  }
  override readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> { return Promise.resolve(undefined) }
  override describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.resolve({ configured: false, writable: true })
  }
  override listRecords(): Promise<readonly CredentialRecordEntry[]> { return Promise.resolve([]) }
  override async modifyRecord(_key: CredentialKey,
    _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>): Promise<CredentialRecord | undefined> {
    return undefined
  }
  override async deleteRecord(_key: CredentialKey): Promise<void> {}
}

/** Boot one Host epoch carrying the real LLM runtime and the synthetic credential service. */
export async function bootServices(ctx: Context, memory: CredentialMemory): Promise<void> {
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(OwnerCredentials, memory)
}
