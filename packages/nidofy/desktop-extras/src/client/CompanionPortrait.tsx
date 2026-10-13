/** Fixed-model loading remains explicitly selected and keeps the static portrait when the Web SDK is absent. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { FixedLive2dController, loadBluewhaleSdk } from './fixed-live2d.ts'
/** @param props - Visibility and localized fallback copy, without model or execution authority.
 * @returns Fixed animation and a static failure fallback.
 */
export function CompanionPortrait({ active, t }: { active: boolean; t: PropsLocale<'nidofy.environment'>['t'] }) {
  const [requested, setRequested] = useState(false), [failed, setFailed] = useState(false), [rendered, setRendered] = useState(false)
  const [canvasGeneration, setCanvasGeneration] = useState(0)
  const [portraitFailed, setPortraitFailed] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null), wrapper = useRef<HTMLDivElement>(null)
  const [intersecting, setIntersecting] = useState(true)
  const controller = useRef(new FixedLive2dController(() => { setFailed(true); setRendered(false) }))
  useEffect(() => {
    if (!wrapper.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => { setIntersecting(entries.some(row => row.isIntersecting)) })
    observer.observe(wrapper.current)
    return () =>{  observer.disconnect() }
  }, [])
  useEffect(() => {
    setRendered(false)
    if (!active || !intersecting || !requested || !canvas.current) return
    let current = true
    setFailed(false)
    void controller.current.start(canvas.current, async (target, resources, signal) => {
      const factory = await loadBluewhaleSdk(signal)
      return factory(target, resources, signal)
    }).then(() => { if (current) setRendered(true) }).catch(() => { if (current) setFailed(true) })
    const display = controller.current
    return () => { current = false; void display.stop() }
  }, [active, intersecting, requested, canvasGeneration])
  return <div ref={wrapper} style={{ height: '100%' }}><img src="/api/nidofy-extras/assets/companion/bluewhale/upperbody.png" alt={t('companion')} draggable={false} hidden={rendered || portraitFailed} onError={() => { setPortraitFailed(true) }} />
    {portraitFailed && !rendered && <p role="status">{t('portraitUnavailable')}</p>}
    <canvas key={canvasGeneration} ref={canvas} width={410} height={548} hidden={!rendered} style={{ display: rendered ? 'block' : 'none', width: 'auto', height: '100%', maxWidth: '100%', maxHeight: 220, margin: '0 auto' }} aria-label={t('live2dModel')} />
    <button style={{ position: 'absolute', bottom: 0, right: 0, zIndex: 2 }} disabled={!active} onClick={() => { if (!requested) setCanvasGeneration(value => value + 1); setRequested(!requested) }}>{t(requested ? 'live2dDisable' : 'live2dEnable')}</button>
    {failed && <p role="status">{t('live2dUnavailable')}</p>}</div>
}
