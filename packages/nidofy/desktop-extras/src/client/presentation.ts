/** Local character framing has no Session, model-request or permission authority. */
export type CompanionMode = 'assistant' | 'project' | 'tools'
export type DetailSurface = 'environment' | 'progress' | 'pet-attention' | 'side-analysis' | 'quick-settings' | 'appearance' | 'status' | 'attention'
export type FramePreset = 'full' | 'half' | 'portrait'
export interface CharacterPresentation { frame: FramePreset; zoom: number; panX: number; panY: number; animation: boolean }
export const defaultPresentation: CharacterPresentation = { frame: 'half', zoom: 1, panX: 0, panY: 0, animation: false }
/** Bound backing-store work independently of display scaling.
 * @param width - Measured CSS width. @param height - Measured CSS height. @param dpr - Device pixel ratio.
 * @returns Integer backing dimensions within a four-megapixel budget.
 */
export function rasterSize(width: number, height: number, dpr: number): { width: number; height: number } {
  if (![width, height, dpr].every(Number.isFinite) || width <= 0 || height <= 0 || dpr <= 0) return { width: 1, height: 1 }
  const ratio = Math.min(dpr, 2, Math.sqrt(4_000_000 / (width * height)))
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) }
}
