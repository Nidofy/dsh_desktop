import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

export default defineConfig(['index', 'cli'].map(name => ({
  entry: ['lib/types/' + name + '.js'],
  outDir: 'lib',
  format: ['esm'] as const,
  outputOptions: { codeSplitting: false },
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { alwaysBundle: ['@deepseek-ai/dsh-llm-deepseek', '@deepseek-ai/dsh-skill-filesystem'] },
  plugins: [{
    name: 'nidofy-workbench-adapters',
    resolveId(source, importer) {
      if (source === '@deepseek-ai/dsh-llm-deepseek') {
        return fileURLToPath(new URL('../../packages/llm/llm-deepseek/lib/types/config.js', import.meta.url))
      }
      if (source === '@deepseek-ai/dsh-skill-filesystem') {
        return fileURLToPath(new URL('../../packages/skill/skill-filesystem/lib/types/index.js', import.meta.url))
      }
      if (importer?.replaceAll('\\', '/').includes('/lib/types/')
        && /^(\.\/|\.\.\/workbench\/)legacy\/[a-z-]+\.mjs$/.test(source)) {
        const file = source.slice(source.lastIndexOf('/') + 1)
        return fileURLToPath(new URL(`./src/workbench/legacy/${file}`, import.meta.url))
      }
    },
  }],
})))
