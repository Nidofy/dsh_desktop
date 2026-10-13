import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionInputShell } from '../src/client/input/facade.ts'
import type { DraftAttachmentId } from '../src/client/contract/input.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import { appendWorkbenchExcerpt } from '../src/client/input/workbench-bridge.ts'
import { $getRoot, $getSelection, $isRangeSelection, UNDO_COMMAND } from 'lexical'

it('appends to the official composer without losing a reference, attachment or existing text, and refuses stale revisions', () => {
  const shell = new SessionInputShell({
    actx: new Context(), defaultSink: vi.fn(),
    commandAttachments: { serialize: async () => [], release: () => {}, unsupportedNotice: value => value },
  })
  try {
    shell.setDraft('Keep this @ref')
    expect(shell.insertReference({ source: 'reference', ref: '@[Research](dsh-session:InNvdXJjZSI)', label: 'Research', clipboardText: '@[Research](dsh-session:InNvdXJjZSI)' }, {
      start: 10, end: 14, draftRev: shell.snapshot.draftRev,
    })).toBe(true)
    shell.addAttachments([brandString<DraftAttachmentId>('attachment-fixture')])
    const before = shell.snapshot
    expect(appendWorkbenchExcerpt(shell, before.draftRev, '\nSelected diff')).toBe(true)
    expect(shell.snapshot.draft).toBe(before.draft + '\nSelected diff')
    expect(shell.snapshot.attachmentIds).toEqual(before.attachmentIds)
    expect(appendWorkbenchExcerpt(shell, before.draftRev, '\nDuplicate')).toBe(false)
    expect(shell.snapshot.draft).not.toContain('Duplicate')
    expect(shell.snapshot.draft).toContain('@[Research](dsh-session:InNvdXJjZSI)')
  } finally { shell.dispose() }
})

it('appends explicit analysis as one undo step while preserving caret, references and attachments', async () => {
  const send = vi.fn(), shell = new SessionInputShell({ actx: new Context(), defaultSink: send,
    commandAttachments: { serialize: async () => [], release: () => {}, unsupportedNotice: value => value } })
  try {
    shell.setDraft('Original @ref')
    shell.insertReference({ source: 'reference', ref: 'r', label: 'Research', clipboardText: '@Research' }, { start: 9, end: 13, draftRev: shell.snapshot.draftRev })
    shell.addAttachments([brandString<DraftAttachmentId>('analysis-attachment')])
    shell.editor.update(() => { $getRoot().getFirstDescendant()?.selectStart() }, { discrete: true })
    const selected = () => shell.editor.getEditorState().read(() => {
      const selection = $getSelection()
      return $isRangeSelection(selection) ? { anchor: { ...selection.anchor }, focus: { ...selection.focus } } : null
    })
    const before = shell.snapshot, caret = selected()
    expect(shell.appendText('Suggestion\nNext step', before.draftRev)).toBe(true)
    expect(shell.snapshot.draft).toBe(before.draft + '\nSuggestion\nNext step')
    expect(shell.snapshot.attachmentIds).toEqual(before.attachmentIds)
    expect(shell.snapshot.occurrences).toEqual(before.occurrences); expect(selected()).toEqual(caret)
    expect(shell.appendText('duplicate', before.draftRev)).toBe(false); expect(send).not.toHaveBeenCalled()
    shell.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await Promise.resolve()
    expect(shell.snapshot.draft).toBe(before.draft); expect(selected()).toEqual(caret)
  } finally { shell.dispose() }
})
