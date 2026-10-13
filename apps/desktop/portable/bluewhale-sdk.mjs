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
    let started = null
    return {
      draw(time, _state) {
        if (closed || gl.isContextLost()) throw Error('LIVE2D_CONTEXT_LOST')
        started ??= time
        const seconds = time - started, model = user.getModel()
        model.loadParameters()
        if (queue.isFinished()) queue.startMotion(motion, false)
        queue.doUpdateMotion(model, seconds); model.saveParameters(); model.update()
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
        const matrix = new CubismMatrix44(); matrix.scale(canvas.height / canvas.width, 1)
        matrix.multiplyByMatrix(user.getModelMatrix())
        renderer.setMvpMatrix(matrix); renderer.setRenderState(null, [0, 0, canvas.width, canvas.height]); renderer.drawModel()
      }, dispose,
    }
  } catch (error) { dispose(); throw error }
}
