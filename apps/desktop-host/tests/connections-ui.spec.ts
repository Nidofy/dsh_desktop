import { expect, it } from 'vitest'
import { connectionsHtml } from '../src/connections/ui.ts'

/** Locale and copy check for the presenter; the page's API behavior is replayed in connections-api.spec.ts. */
it('offers explicit credential retention in both locales and renders no secret material', () => {
  for (const chinese of [false, true]) {
    const page = connectionsHtml(chinese)
    expect(page).toContain(chinese ? '留空保留已存凭据' : 'blank keeps the stored credential')
    expect(page).toContain("{mode:'keep'}")
    expect(page).toContain("{mode:'replace',value:key}")
    expect(page).toContain('missing-credential')
    expect(page).toContain(chinese ? '配置文件不可读，已禁止覆盖保存' : 'configuration unreadable; overwriting saves are blocked')
    expect(page).toContain(chinese ? '有待清理的凭据引用' : 'credential cleanup pending')
    expect(page).toContain(chinese ? '凭据清理未完成，已暂缓新保存' : 'credential cleanup unfinished; new saves are paused')
    expect(page).not.toContain('synthetic-')
    expect(page).not.toContain('NIDOFY_REV_')
  }
})
