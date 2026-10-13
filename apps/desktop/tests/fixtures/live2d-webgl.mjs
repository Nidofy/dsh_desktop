/** Real offline Core/Framework/model WebGL, lifecycle churn and process observations over an isolated Electron renderer. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const repo = resolve(import.meta.dirname, '../../../..'), evidence = resolve(process.argv[2])
await mkdir(evidence, { recursive: true })
const require = createRequire(join(repo, 'apps/web/package.json')), { _electron } = require('playwright')
const viteRequire = createRequire(require.resolve('vite/package.json')), { build } = await import(pathToFileURL(viteRequire.resolve('esbuild')).href)
await build({ entryPoints: [join(repo, 'packages/nidofy/desktop-extras/src/client/fixed-live2d.ts')], format: 'esm', platform: 'browser',
  outfile: join(evidence, 'controller.mjs'), target: 'es2022' })
const assets = join(repo, 'packages/nidofy/desktop-extras/assets/companion/bluewhale/live2d'), requests = [], errors = []
const html = `<html><head><meta charset="utf-8"></head><body style="margin:0;background:#202733"><canvas width="410" height="548"></canvas><script type="module">
import { FixedLive2dController, loadBluewhaleSdk } from '/controller.mjs';
const canvas = document.querySelector('canvas'), notices = [];
const frames = new Set(), listeners = new Set(), gpu = {};
const requestFrame = requestAnimationFrame.bind(globalThis), cancelFrame = cancelAnimationFrame.bind(globalThis);
globalThis.requestAnimationFrame = callback => { const id = requestFrame(time => { frames.delete(id); callback(time) }); frames.add(id); return id };
globalThis.cancelAnimationFrame = id => { frames.delete(id); cancelFrame(id) };
const addListener = canvas.addEventListener.bind(canvas), removeListener = canvas.removeEventListener.bind(canvas);
canvas.addEventListener = (type, listener, options) => { if (type === 'webglcontextlost') listeners.add(listener); addListener(type, listener, options) };
canvas.removeEventListener = (type, listener, options) => { if (type === 'webglcontextlost') listeners.delete(listener); removeListener(type, listener, options) };
const gl = canvas.getContext('webgl');
for (const kind of ['Texture','Buffer','Framebuffer','Renderbuffer','Program','Shader']) {
  const live = new Set(), create = gl['create'+kind].bind(gl), remove = gl['delete'+kind].bind(gl); gpu[kind] = live;
  gl['create'+kind] = (...args) => { const value = create(...args); if (value) live.add(value); return value };
  gl['delete'+kind] = value => { live.delete(value); return remove(value) };
}
const allocations = () => ({ frames:frames.size, listeners:listeners.size, gpu:Object.fromEntries(Object.entries(gpu).map(([kind,live])=>[kind,live.size])) });
const controller = new FixedLive2dController(error => notices.push(String(error)));
const factory = async (canvas, resources, signal) => {
  const renderer = await (await loadBluewhaleSdk(signal))(canvas, resources, signal);
  globalThis.fixture.renderer = renderer; return renderer;
};
globalThis.fixture = { controller, canvas, notices, factory, allocations };
</script></body></html>`
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname
    requests.push(path)
    if (path === '/') { response.setHeader('content-type', 'text/html'); response.end(html); return }
    const prefix = '/api/nidofy-extras/assets/companion/bluewhale/live2d/'
    if (path !== '/controller.mjs' && (!path.startsWith(prefix) || path.includes('..'))) { response.writeHead(404); response.end(); return }
    const file = path === '/controller.mjs' ? join(evidence, 'controller.mjs') : join(assets, path.slice(prefix.length))
    response.setHeader('content-type', /\.(mjs|js)$/u.test(file) ? 'text/javascript' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream')
    response.end(await readFile(file))
  } catch (error) { errors.push(String(error)); response.writeHead(500); response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(?:path|systemroot|windir|comspec|pathext)$/iu.test(name)))
const data = join(evidence, 'data')
await mkdir(data, { recursive: true })
const app = await _electron.launch({ executablePath: join(repo, 'apps/desktop/.desktop-build/targets/win-x64/electron/electron.exe'),
  args: [join(import.meta.dirname, 'live2d-webgl-main.mjs')], env: { ...environment,
    DSH_LIVE2D_TEST_URL: `http://127.0.0.1:${server.address().port}/`, DSH_LIVE2D_TEST_DATA: data }, timeout: 45000, chromiumSandbox: true })
const observations = [], logs = []
try {
  app.process().stdout?.on('data', chunk => logs.push(String(chunk))); app.process().stderr?.on('data', chunk => logs.push(String(chunk)))
  assert(!app.process().spawnargs.includes('--no-sandbox'))
  const page = await app.firstWindow(), consoles = []
  page.on('console', message => { if (message.type() === 'error') consoles.push(message.text()) })
  page.on('pageerror', error => consoles.push(String(error)))
  await page.waitForFunction(() => !!globalThis.fixture)
  const sandbox = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences())
  assert.equal(sandbox.sandbox, true); assert.equal(sandbox.nodeIntegration, false); assert.equal(sandbox.contextIsolation, true)
  const start = async () => page.evaluate(async () => { await fixture.controller.start(fixture.canvas, fixture.factory) })
  await start(); await page.waitForTimeout(1000)
  assert.deepEqual(await page.evaluate(() => fixture.notices), [])
  const visible = await page.evaluate(() => {
    fixture.renderer.draw(performance.now() / 1000, 'idle')
    const gl = fixture.canvas.getContext('webgl'), pixels = new Uint8Array(410 * 548 * 4)
    gl.readPixels(0, 0, 410, 548, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    return { alpha: pixels.filter((value, index) => index % 4 === 3 && value !== 0).length, glError: gl.getError(), notices: fixture.notices,
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null }
  })
  await page.screenshot({ path: join(evidence, 'bluewhale-webgl.png') })
  observations.push({ phase: 'active-before', metrics: await app.evaluate(({ app }) => app.getAppMetrics()), visible })
  assert(visible.alpha > 1000, JSON.stringify(visible))
  await page.evaluate(() => fixture.controller.stop())
  const released = await page.evaluate(() => fixture.allocations())
  assert.equal(released.frames, 0); assert.equal(released.listeners, 0)
  assert(Object.values(released.gpu).every(count => count === 0), JSON.stringify(released))
  for (let index = 0; index < 100; index++) {
    await start(); await page.evaluate(() => new Promise(requestAnimationFrame)); await page.evaluate(() => fixture.controller.stop())
    const allocations = await page.evaluate(() => fixture.allocations())
    assert.deepEqual(allocations, released)
    if ([0, 49, 99].includes(index)) observations.push({ phase: 'cycle-' + (index + 1), metrics: await app.evaluate(({ app }) => app.getAppMetrics()) })
  }
  await start()
  await page.evaluate(() => fixture.canvas.getContext('webgl').getExtension('WEBGL_lose_context').loseContext())
  await page.waitForFunction(() => fixture.notices.includes('Error: LIVE2D_CONTEXT_LOST'))
  await page.evaluate(() => fixture.controller.stop())
  assert.equal(consoles.length, 0, consoles.join('\n')); assert.equal(errors.length, 0, errors.join('\n'))
  assert(requests.every(path => path === '/' || path === '/controller.mjs' || path.startsWith('/api/nidofy-extras/assets/companion/bluewhale/live2d/')))
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ status: 'PASSED', rendererSandbox: sandbox,
    cycles: 100, releasedAllocations: released, identicalReleasedAllocationsAfterEveryCycle: true,
    contextLossFallback: true, requests: [...new Set(requests)], requestCount: requests.length,
    modelRequests: 0, toolExecutions: 0, observations, hardwareGpuMemory: 'NOT_OBSERVABLE', consoles }, null, 2) + '\n')
  console.log('Real fixed-model offline WebGL / 100 cycles / context-loss fallback passed:', evidence)
} finally {
  await app.close(); await new Promise(resolve => server.close(resolve))
  await writeFile(join(evidence, 'electron.log'), logs.join(''))
}
