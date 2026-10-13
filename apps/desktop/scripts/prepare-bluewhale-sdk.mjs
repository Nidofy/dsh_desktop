/** Compile the user-authorized fixed Cubism Web 5-r.5 adapter and embed every WebGL shader. */
import { readFile, readdir, writeFile, copyFile, mkdir } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const sdk = resolve(process.argv[2] ?? ''), repo = resolve(import.meta.dirname, '../../..')
const info = await readFile(join(sdk, 'cubism-info.yml'), 'utf8')
if (!/^version: 5-r\.5\s*$/mu.test(info)) throw Error('Only the explicitly selected Cubism Web 5-r.5 SDK is supported.')
const require = createRequire(import.meta.url), viteRequire = createRequire(require.resolve('vite/package.json'))
const { build } = await import(pathToFileURL(viteRequire.resolve('esbuild')).href)
const shaderDirectory = join(sdk, 'Framework/Shaders/WebGL'), shaderNames = await readdir(shaderDirectory)
if (shaderNames.length !== 13 || shaderNames.some(name => !/^[a-z]+\.(vert|frag)$/u.test(name))) throw Error('SDK shader closure changed.')
const sources = Object.fromEntries(await Promise.all(shaderNames.map(async name => [name, await readFile(join(shaderDirectory, name), 'utf8')])))
const target = join(repo, 'packages/nidofy/desktop-extras/assets/companion/bluewhale/live2d')
await mkdir(target, { recursive: true })
await build({ entryPoints: [join(repo, 'apps/desktop/portable/bluewhale-sdk.mjs')], bundle: true, format: 'esm', platform: 'browser',
  outfile: join(target, 'bluewhale-sdk.mjs'), target: 'es2022', legalComments: 'eof', plugins: [{ name: 'fixed-authorized-cubism', setup(build) {
    build.onResolve({ filter: /^@cubism\// }, args => ({ path: join(sdk, 'Framework/src', args.path.slice('@cubism/'.length) + '.ts') }))
    build.onLoad({ filter: /cubismshader_webgl\.ts$/ }, async args => {
      const source = await readFile(args.path, 'utf8'), original = 'const response = await fetch(url);\n    return await response.text();'
      if (source.split(original).length !== 2) throw Error('SDK shader loader changed.')
      const contents = source.replace(original, `const sources = ${JSON.stringify(sources)};\n    const name = url.slice(url.lastIndexOf('/') + 1);\n    if (!(name in sources)) throw Error('LIVE2D_SHADER_REFUSED');\n    return sources[name];`)
      return { contents, loader: 'ts', resolveDir: dirname(args.path) }
    })
  } }] })
for (const [source, name] of [['Core/live2dcubismcore.min.js', 'live2dcubismcore.min.js'], ['Core/LICENSE.md', 'CORE-LICENSE.md'],
  ['Framework/LICENSE.md', 'FRAMEWORK-LICENSE.md'], ['NOTICE.md', 'SDK-NOTICE.md'], ['cubism-info.yml', 'SDK-INFO.yml']]) await copyFile(join(sdk, source), join(target, name))
await writeFile(join(target, 'SOURCE.txt'), `User-provided local SDK: ${sdk}\nVersion: Cubism SDK for Web 5-r.5, compatible with Cubism 5.3.\nCore copied unchanged; Framework bundled for the fixed adapter.\nAdapter build replaces SDK shader fetch with the exact 13 local embedded shader sources.\nNo sample models, source projects or external fetch paths are included.\nFor personal local development; publication authorization is not certified.\n`)
console.log('Fixed offline Cubism adapter prepared:', target)
