import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {snapshotPipe} from './task-snapshot-bridge.mjs';

// Content is never added to prompts or offered through a model tool. The native
// supervisor alone resolves the user-armed, immutable-per-turn file scope.
export function installTaskSnapshots(ctx, pipe = snapshotPipe) {
  const turns = new Map(), endings = new Map(), stopped = new AbortController();
  const key = (id, turn) => JSON.stringify([id, turn]);
  const workspaceKey = cwd => process.platform === 'win32' ? resolve(cwd).toLowerCase() : resolve(cwd);
  const remember = (k, value) => {
    if (turns.size >= 512) {
      for (const [old, state] of turns) { if (state.done) { turns.delete(old); break; } }
      if (turns.size >= 512) return false;
    }
    turns.set(k, value); return true;
  };
  const abandon = requestId => pipe.request({action:'abandon',requestId},{timeoutMs:2000}).catch(()=>{});
  ctx.effect?.(() => () => stopped.abort());
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next(), {agent,turn,signal} = payload, header = agent.session.header;
    if (decision.kind !== 'enter' || !decision.messages?.length || header.origin === 'subagent' || !header.cwd || !pipe.enabled || stopped.signal.aborted) return decision;
    const k = key(header.id,turn);
    if (turns.has(k)) { const existing=turns.get(k);await existing.start;return existing.status==='UNCONFIRMED'?{kind:'reject'}:decision; }
    const state = {done:false, workspace:workspaceKey(header.cwd), status:'PENDING', capture:null, start:null};
    if (!remember(k,state)) return {kind:'reject'};
    state.start = (async () => {
      // An immediately queued next turn cannot overtake the previous end sample.
      await endings.get(state.workspace);
      const admission = AbortSignal.any([signal,stopped.signal,AbortSignal.timeout(15000)]);
      const requestId = randomBytes(16).toString('hex'), expiresAt = Date.now()+14000;
      try {
        const capture = await pipe.request({action:'begin',workspace:header.cwd,sessionId:header.id,turn,expiresAt},{signal:admission,requestId});
        if (capture?.status === 'DISABLED') { state.status='DISABLED'; return; }
        if (capture?.status !== 'CAPTURED' || !capture.id || !capture.binding) throw Error('SNAPSHOT_UNAVAILABLE');
        const confirmed = await pipe.request({action:'confirm',id:capture.id,binding:capture.binding},{signal:admission,timeoutMs:expiresAt-Date.now()});
        if (confirmed?.status !== 'CONFIRMED' || admission.aborted) throw Error('SNAPSHOT_UNCONFIRMED');
        state.capture = capture; state.status='CONFIRMED';
      } catch { state.status='UNCONFIRMED'; void abandon(requestId); }
    })();
    await state.start;
    // Armed protection must be confirmed before any model/tool step is admitted.
    // An unavailable supervisor cannot be mistaken for a disabled file scope.
    return state.status==='UNCONFIRMED'?{kind:'reject'}:decision;
  });
  ctx.on('session/event', (session,event) => {
    if (event.type !== 'turn/end' || session.header.origin === 'subagent') return;
    const state = turns.get(key(session.header.id,event.data?.turn));
    if (!state || state.ending) return;
    state.ending = (async () => {
      await state.start;
      if (!state.capture) return;
      const {id,binding} = state.capture;
      try {
        const result = await pipe.request({action:'end',id,binding,expiresAt:Date.now()+14000},{signal:stopped.signal});
        state.status = result?.status === 'SEALED' ? 'SEALED' : 'UNCONFIRMED';
      } catch { state.status='UNCONFIRMED'; void abandon(binding.requestId); }
    })().finally(() => {
      state.done = true;
      if (endings.get(state.workspace) === state.ending) endings.delete(state.workspace);
    });
    // Include concurrent ends from the same workspace before admitting a new turn.
    const previous = endings.get(state.workspace);
    const barrier = previous ? Promise.allSettled([previous,state.ending]) : state.ending;
    endings.set(state.workspace,barrier);
    void barrier.finally(() => { if (endings.get(state.workspace) === barrier) endings.delete(state.workspace); });
  });
  return {status:(id,turn)=>turns.get(key(id,turn))?.status ?? 'UNKNOWN'};
}
