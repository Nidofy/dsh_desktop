/** Owns an explicitly trusted document-level script. Removing its element does not revoke executed code. */
export class OfflineScriptOwner {
  private loaded = false
  private pending: { script: HTMLScriptElement; promise: Promise<void>; cancel(): void } | undefined
  private readonly consumers = new Set<symbol>()
  constructor(private readonly path: string) {}
  /** Share loading while each display lifetime can cancel independently.
   * @param signal - Display lifetime, held until its renderer is disposed.
   * @returns Completion of the fixed script load, or cancellation/failure.
   */
  async acquire(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.loaded) return
    if (!this.pending) {
      const script = document.createElement('script'), gate = Promise.withResolvers<void>()
      const finish = (error?: Error): void => {
        clearTimeout(timer); script.onload = null; script.onerror = null; script.remove()
        this.pending = undefined
        if (error) gate.reject(error)
        else { this.loaded = true; gate.resolve() }
      }
      const timer = setTimeout(() => { finish(Error('LIVE2D_WEB_SDK_UNAVAILABLE')) }, 10000)
      this.pending = { script, promise: gate.promise, cancel: () => { finish(Error('LIVE2D_WEB_SDK_CANCELLED')) } }
      script.src = this.path
      script.onload = () => { finish() }
      script.onerror = () => { finish(Error('LIVE2D_WEB_SDK_UNAVAILABLE')) }
      document.head.append(script)
    }
    const pending = this.pending, id = Symbol(), cancelled = Promise.withResolvers<never>()
    this.consumers.add(id)
    const abort = (): void => {
      this.consumers.delete(id); cancelled.reject(signal.reason)
      if (this.consumers.size === 0 && this.pending === pending) pending.cancel()
    }
    signal.addEventListener('abort', abort, { once: true })
    try { await Promise.race([pending.promise, cancelled.promise]); signal.throwIfAborted() }
    finally { signal.removeEventListener('abort', abort); this.consumers.delete(id) }
  }
}
