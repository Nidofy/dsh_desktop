/** One opt-in local renderer survives mode and framing changes. */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { FixedLive2dController, loadBluewhaleSdk } from './fixed-live2d.ts'
import { defaultPresentation, rasterSize } from './presentation.ts'
import type { CharacterPresentation } from './presentation.ts'

/** @param props - Local display preferences and visibility without execution authority.
 * @returns One canvas with a static, honestly bounded fallback.
 */
export function CompanionPortrait({ active, t, presentation = defaultPresentation, onCapability, onFailure }: {
  active: boolean
  t: PropsLocale<'nidofy.environment'>['t']
  presentation?: CharacterPresentation
  onCapability?: (value: 'none' | 'static' | 'animated') => void
  onFailure?: (value: boolean) => void
}) {
  const [rendered, setRendered] = useState(false), [portraitFailed, setPortraitFailed] = useState(false)
  const [intersecting, setIntersecting] = useState(true)
  const canvas = useRef<HTMLCanvasElement>(null), wrapper = useRef<HTMLDivElement>(null)
  const [controller] = useState(() => new FixedLive2dController(() => { setRendered(false); onCapability?.('static'); onFailure?.(true) }))
  const requested = presentation.animation
  useEffect(() => {
    onCapability?.('static')
    return () => { onCapability?.('none') }
  }, [onCapability])
  useEffect(() => {
    if (!wrapper.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => { setIntersecting(entries.some(row => row.isIntersecting)) })
    observer.observe(wrapper.current)
    return () => { observer.disconnect() }
  }, [])
  useEffect(() => {
    const element = wrapper.current
    if (!element) return
    const update = () => {
      const rect = element.getBoundingClientRect()
      controller.viewport({ ...rasterSize(rect.width, rect.height, window.devicePixelRatio || 1), ...presentation })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    window.addEventListener('resize', update)
    return () => { observer.disconnect(); window.removeEventListener('resize', update) }
  }, [controller, presentation])
  useEffect(() => {
    setRendered(false); onCapability?.('static')
    if (!active || !intersecting || !requested || !canvas.current) return
    let current = true
    onFailure?.(false)
    void controller.start(canvas.current, async (target, resources, signal) => {
      const factory = await loadBluewhaleSdk(signal)
      const renderer = await factory(target, resources, signal)
      if (current && !signal.aborted) onCapability?.(renderer.setViewport ? 'animated' : 'static')
      return renderer
    }).then(() => { if (current) setRendered(true) }).catch(() => { if (current) onFailure?.(true) })
    return () => { current = false; void controller.stop() }
  }, [active, intersecting, requested, controller, onCapability, onFailure])
  const frame = presentation.frame === 'portrait' ? 'portrait' : 'half'
  return <div ref={wrapper} className="nidofy-portrait" data-frame={frame} style={{ '--character-zoom': presentation.zoom, '--character-x': `${presentation.panX * 100}%`, '--character-y': `${presentation.panY * 100}%` } as CSSProperties}>
    <img src="/api/nidofy-extras/assets/companion/bluewhale/upperbody.png" alt={t('companion')} draggable={false} hidden={rendered || portraitFailed} onError={() => { setPortraitFailed(true) }} />
    {portraitFailed && !rendered && <p role="status">{t('portraitUnavailable')}</p>}
    <canvas key={requested ? 'animated' : 'static'} ref={canvas} width={410} height={548} hidden={!rendered} aria-label={t('live2dModel')} />
  </div>
}
