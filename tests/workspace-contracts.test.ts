import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PAGECRAFT_WORKSPACE_DIRECTORY_PATH,
  PAGECRAFT_WORKSPACE_EVENTS_PATH,
  PAGECRAFT_WORKSPACE_TEXT_EDIT_PATH,
  isWorkspaceImageFile,
  isWorkspaceTextFile,
  normalizeWorkspacePath,
  workspaceFolderStorageKey,
  workspaceLanguage,
} from '../lib/index.js'

test('workspace paths allow root and descendants but reject escape paths', () => {
  assert.equal(normalizeWorkspacePath('.'), '.')
  assert.equal(normalizeWorkspacePath('./'), '.')
  assert.equal(normalizeWorkspacePath('src\\slides'), 'src/slides')
  assert.equal(normalizeWorkspacePath('./src/slides'), 'src/slides')
  assert.equal(normalizeWorkspacePath('../secret'), null)
  assert.equal(normalizeWorkspacePath('D:\\secret'), null)
  assert.equal(normalizeWorkspacePath('/secret'), null)
  assert.equal(normalizeWorkspacePath('src//slides'), null)
})

test('workspace contracts cover frontend text and stable session storage', () => {
  for (const path of ['index.html', 'App.tsx', 'Slide.vue', 'Deck.svelte', 'copy.json', 'notes.mdx', 'icon.svg']) {
    assert.equal(isWorkspaceTextFile(path), true, path)
  }
  assert.equal(isWorkspaceTextFile('machine.png'), false)
  assert.equal(isWorkspaceImageFile('machine.webp'), true)
  assert.equal(isWorkspaceImageFile('icon.svg'), false)
  assert.equal(workspaceLanguage('App.tsx'), 'typescript')
  assert.equal(workspaceFolderStorageKey('D:\\project', 'session-1'), workspaceFolderStorageKey('D:\\project', 'session-1'))
  assert.notEqual(workspaceFolderStorageKey('D:\\project', 'session-1'), workspaceFolderStorageKey('D:\\other', 'session-1'))
  assert.equal(PAGECRAFT_WORKSPACE_DIRECTORY_PATH, '/api/frontend-feedback/workspace/directory')
  assert.equal(PAGECRAFT_WORKSPACE_EVENTS_PATH, '/api/frontend-feedback/workspace/events')
  assert.equal(PAGECRAFT_WORKSPACE_TEXT_EDIT_PATH, '/api/frontend-feedback/workspace/text-edit')
})
