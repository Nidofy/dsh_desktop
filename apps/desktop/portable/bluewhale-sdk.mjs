/** Fixed SDK adapter: one WebGL model, one Idle motion and one texture; no application services. */
import { CubismFramework } from '@cubism/live2dcubismframework'
import { CubismUserModel } from '@cubism/model/cubismusermodel'
import { CubismMatrix44 } from '@cubism/math/cubismmatrix44'
import { CubismMotionQueueManager } from '@cubism/motion/cubismmotionqueuemanager'
import { CubismShaderManager_WebGL } from '@cubism/rendering/cubismshader_webgl'
let occupied = false

/** @param {HTMLCanvasElement} canvas @param {object} resources @param {AbortSignal} signal @returns {Promise<object>} Display-only model ownership. */
export async function createRenderer(canvas, resources, signal) {
  signal.throwIfAborted()
  if (occupied) throw Error('LIVE2D_RENDERER_BUSY')
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false })
  if (!gl) throw Error('LIVE2D_WEBGL_UNAVAILABLE')
  occupied = true
  let user, queue, motion, texture, bitmap, closed = false
  const dispose = () => {
    if (closed) return
    closed = true
    queue?.release(); motion?.release(); user?.release()
    if (texture) gl.deleteTexture(texture)
    bitmap?.close()
    if (CubismFramework.isInitialized()) CubismFramework.dispose()
    occupied = false
  }
  try {
    if (!CubismFramework.isStarted()) CubismFramework.startUp()
    CubismFramework.initialize()
    user = new CubismUserModel()
    user.loadModel(resources.moc.slice().buffer, true)
    if (!user.getModel()) throw Error('LIVE2D_MOC_REFUSED')
    user.getModelMatrix().setHeight(1.85)
    user.createRenderer(canvas.width, canvas.height)
    const renderer = user.getRenderer(); renderer.startUp(gl); renderer.setIsPremultipliedAlpha(true)
    bitmap = await createImageBitmap(new Blob([resources.texture], { type: 'image/png' }))
    signal.throwIfAborted()
    texture = gl.createTexture()
    if (!texture) throw Error('LIVE2D_TEXTURE_UNAVAILABLE')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    renderer.bindTexture(0, texture); gl.bindTexture(gl.TEXTURE_2D, null)
    bitmap.close(); bitmap = null
    motion = user.loadMotion(resources.idle.slice().buffer, resources.idle.byteLength, 'Idle')
    if (!motion) throw Error('LIVE2D_MOTION_REFUSED')
    motion.setEffectIds([], [])
    queue = new CubismMotionQueueManager()
    const shader = CubismShaderManager_WebGL.getInstance().getShader(gl)
    shader.setShaderPath('/fixed-shaders/'); shader.generateShaders()
    // All shader sources are embedded by the SDK builder; generation drains without network callbacks.
    for (let step = 0; step < 32 && !shader._isShaderLoaded; step++) await Promise.resolve()
    if (!shader._isShaderLoaded) throw Error('LIVE2D_SHADER_UNAVAILABLE')
    signal.throwIfAborted()
    const modelMatrix = user.getModelMatrix(), model = user.getModel()
    // Drawable vertices describe this fixed model in model coordinates, including its hair and tail.
    model.update()
    const vertices = Array.from({ length: model.getDrawableCount() }, (_, index) => model.getDrawableVertices(index))
    let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity
    for (const points of vertices) for (let index = 0; index < points.length; index += 2) {
      const x = modelMatrix.transformX(points[index]), y = modelMatrix.transformY(points[index + 1])
      left = Math.min(left, x); right = Math.max(right, x); bottom = Math.min(bottom, y); top = Math.max(top, y)
    }
    if (![left, right, bottom, top].every(Number.isFinite) || right <= left || top <= bottom) throw Error('LIVE2D_BOUNDS_UNAVAILABLE')
    let viewport = { width: canvas.width, height: canvas.height, frame: 'full', zoom: 1, panX: 0, panY: 0 }
    let started = null
    return {
      setViewport(value) {
        if (!['full', 'half', 'portrait'].includes(value.frame)
          || ![value.width, value.height, value.zoom, value.panX, value.panY].every(Number.isFinite)
          || value.width < 1 || value.height < 1 || value.width * value.height > 4_000_000
          || value.zoom < 1 || value.zoom > 1.5 || Math.abs(value.panX) > .15 || Math.abs(value.panY) > .15) throw Error('LIVE2D_VIEWPORT_REFUSED')
        viewport = { ...value, width: Math.floor(value.width), height: Math.floor(value.height) }
        if (canvas.width !== viewport.width) canvas.width = viewport.width
        if (canvas.height !== viewport.height) canvas.height = viewport.height
      },
      draw(time, _state) {
        if (closed || gl.isContextLost()) throw Error('LIVE2D_CONTEXT_LOST')
        started ??= time
        const seconds = time - started, model = user.getModel()
        model.loadParameters()
        if (queue.isFinished()) queue.startMotion(motion, false)
        queue.doUpdateMotion(model, seconds); model.saveParameters(); model.update()
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
        // Upper anchored crops preserve headwear; full framing contains the complete drawable bounds.
        const extentX = right - left, extentY = top - bottom
        const fraction = viewport.frame === 'portrait' ? .32 : viewport.frame === 'half' ? .62 : 1.12
        const cropHeight = extentY * fraction, cropWidth = viewport.frame === 'full' ? extentX * 1.12 : cropHeight * .78
        const centerX = (left + right) / 2 - (viewport.frame === 'full' ? 0 : .08 * extentX) + viewport.panX * extentX
        const centerY = viewport.frame === 'full' ? (top + bottom) / 2 + viewport.panY * extentY : top - cropHeight / 2 + extentY * .035 + viewport.panY * extentY
        const fit = (viewport.frame === 'full' ? Math.min(2 / cropHeight, 2 * canvas.width / canvas.height / cropWidth) : 2 / cropHeight) * viewport.zoom
        const matrix = new CubismMatrix44()
        matrix.scale(fit * canvas.height / canvas.width, fit)
        matrix.translate(-centerX * fit * canvas.height / canvas.width, -centerY * fit)
        matrix.multiplyByMatrix(user.getModelMatrix())
        renderer.setMvpMatrix(matrix); renderer.setRenderState(null, [0, 0, canvas.width, canvas.height]); renderer.drawModel()
      }, dispose,
    }
  } catch (error) { dispose(); throw error }
}
