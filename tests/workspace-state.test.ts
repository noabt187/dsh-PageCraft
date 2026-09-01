import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyDirectoryListing,
  applyWorkspaceEvent,
  initialWorkspaceTreeState,
  invalidateWorkspacePaths,
  reconcileOpenFile,
} from '../src/client/workspace-state.ts'

test('lazy workspace state preserves exact parents and expansion', () => {
  let state = initialWorkspaceTreeState('slides')
  state = applyDirectoryListing(state, 'slides', [
    { path: 'slides/assets', name: 'assets', kind: 'directory', updatedAt: '1', textEditable: false, imagePreviewable: false },
    { path: 'slides/deck.json', name: 'deck.json', kind: 'file', bytes: 2, updatedAt: '1', textEditable: true, imagePreviewable: false },
  ])
  state = { ...state, expanded: new Set(['slides', 'slides/assets']) }
  state = applyDirectoryListing(state, 'slides/assets', [
    { path: 'slides/assets/machine.png', name: 'machine.png', kind: 'file', bytes: 4, updatedAt: '1', textEditable: false, imagePreviewable: true },
  ])
  assert.deepEqual(state.children.get('slides/assets')?.map(item => item.path), ['slides/assets/machine.png'])
  assert.equal(state.expanded.has('slides/assets'), true)
  state = invalidateWorkspacePaths(state, ['slides/assets'])
  assert.equal(state.stale.has('slides/assets'), true)
})

test('external changes reload clean files but preserve dirty drafts', () => {
  const clean = {
    path: 'slides/deck.json',
    file: { content: '{"a":1}\n', hash: 'old', updatedAt: '1' },
    draft: '{"a":1}\n',
    conflict: null,
  }
  const dirty = { ...clean, draft: '{"a":2}\n' }
  const disk = { content: '{"a":3}\n', hash: 'new', updatedAt: '2' }
  assert.deepEqual(reconcileOpenFile(clean, disk), { ...clean, file: disk, draft: disk.content, conflict: null })
  assert.deepEqual(reconcileOpenFile(dirty, disk), { ...dirty, conflict: disk })
})

test('missed SSE sequence requests a root rescan', () => {
  const tree = applyDirectoryListing(initialWorkspaceTreeState('slides'), 'slides', [])
  const result = applyWorkspaceEvent(tree, 4, {
    sequence: 7,
    kind: 'invalidate',
    paths: ['slides/assets'],
  })
  assert.equal(result.lastSequence, 7)
  assert.equal(result.rescanRequired, true)
  assert.equal(result.tree.stale.has('slides'), true)
})
