import {randomBytes} from 'node:crypto';

const hex = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
export class SnapshotPipe {
  #token; #pending = new Map(); #send;
  constructor(send) { this.#send = send; }
  configure(value) {
    if (this.#token || !hex(value?.token) || !hex(value?.engineId)) return;
    this.#token = value.token;
  }
  get enabled() { return Boolean(this.#token); }
  receive(line) {
    if (!line.startsWith('snapshot ') || line.length > 16384) return;
    let value; try { value = JSON.parse(line.slice(9)); } catch { return; }
    if (!hex(value.id) || typeof value.ok !== 'boolean') return;
    const pending = this.#pending.get(value.id);
    if (!pending) return; // Late acknowledgements never revive a timed-out step.
    if (value.ok) pending.resolve(value.value); else pending.reject(Error('SNAPSHOT_UNAVAILABLE'));
  }
  request(command, {signal, timeoutMs = 14000, requestId = randomBytes(16).toString('hex')} = {}) {
    if (!this.enabled) return Promise.resolve({status:'DISABLED'});
    if (signal?.aborted || !hex(requestId) || this.#pending.has(requestId) || this.#pending.size >= 64 || timeoutMs <= 0) return Promise.reject(Error('SNAPSHOT_UNAVAILABLE'));
    return new Promise((resolve, reject) => {
      const finish = (fn, value) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.#pending.delete(requestId); fn(value); };
      const abort = () => finish(reject, Error('SNAPSHOT_UNCONFIRMED'));
      const timer = setTimeout(abort, Math.min(timeoutMs, 15000));
      this.#pending.set(requestId, {resolve:value=>finish(resolve,value), reject:error=>finish(reject,error)});
      signal?.addEventListener('abort', abort, {once:true});
      try {
        const line = 'dsh snapshot: ' + JSON.stringify({token:this.#token,id:requestId,command}) + '\n';
        if (Buffer.byteLength(line) > 16384) throw Error('SNAPSHOT_LIMIT');
        this.#send(line);
      } catch { abort(); }
    });
  }
  close() { for (const item of [...this.#pending.values()]) item.reject(Error('SNAPSHOT_PIPE_CLOSED')); this.#token = undefined; }
}

export const snapshotPipe = new SnapshotPipe(line => process.stdout.write(line));
