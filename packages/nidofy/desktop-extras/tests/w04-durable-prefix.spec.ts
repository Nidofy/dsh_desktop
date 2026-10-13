/** A permitted buffered provider exposes post-barrier events: the notebook reader must distinguish them from durable evidence. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { SessionAccess, SessionHandle, SessionPersistenceOpenOptions } from '@deepseek-ai/dsh-session-persistence'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { readNotebookDurableEvents } from '../src/notebook-commit.ts'

it('does not return an unflushed event admitted after the acknowledged barrier', async () => {
  const home = await mkdtemp(join(tmpdir(), 'relay01-durable-gap-')), ctx = new Context()
  let buffered: readonly SessionEvent[] = []
  // Actual JSONL keeps the durable prefix. This override models only the permitted
  // same-process buffered append visibility from the public SessionHandle contract.
  class BufferedView extends JsonlSessionPersistence {
    override async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
      const raw = await super.open(id, access, options)
      return { id: raw.id, header: raw.header, inheritedEventCount: raw.inheritedEventCount, access: raw.access,
        async read(offset = 0, length, readOptions) {
          const result = await raw.read(0, undefined, readOptions)
          const events = [...result.events, ...buffered]
          return { eventState: result.eventState, events: events.slice(offset, length === undefined ? undefined : offset + length) }
        },
        append: (events, appendOptions) => raw.append(events, appendOptions),
        flush: flushOptions => raw.flush(flushOptions),
        close: () => raw.close(),
        [Symbol.asyncDispose]: () => raw.close(),
      }
    }
  }
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(BufferedView, { root: join(home, 'sessions') })
  const session = Session.create(SessionId('relay01-durable-gap'))
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'durable original' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const writer = await ctx.sessionPersistence.create(session.header)
  await writer.append(session.snapshotEvents())
  onTestFinished(async () => {
    vi.restoreAllMocks(); await writer.close(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true })
  })
  vi.spyOn(ctx.sessions, 'get').mockReturnValue(session)
  vi.spyOn(ctx.sessions, 'flush').mockImplementation(async () => {
    await writer.flush()
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'buffered after barrier' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    buffered = session.snapshotEvents().slice(1)
    return true
  })
  const observed = await readNotebookDurableEvents(ctx, session.id, new AbortController().signal)
  expect(observed.map(event => event.seq)).toEqual([0])
})
