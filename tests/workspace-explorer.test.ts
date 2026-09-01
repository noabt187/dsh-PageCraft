import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  listWorkspaceDirectory,
  listWorkspaceFolders,
  readWorkspaceFile,
  readWorkspaceHistory,
  readWorkspaceSummary,
  renameWorkspaceEntry,
  restoreWorkspaceHistory,
  saveWorkspaceFile,
} from '../lib/index.js'

async function createWorkspaceFixture(t: TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'pagecraft-file-ops-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await mkdir(join(cwd, 'slides', 'assets'), { recursive: true })
  await writeFile(join(cwd, 'slides', 'deck.json'), '{"title":"old"}\n')
  await writeFile(join(cwd, 'slides', 'assets', 'machine.png'), Buffer.from([137, 80, 78, 71]))
  return cwd
}

test('real workspace listing preserves physical image directories', async (t) => {
  const cwd = await createWorkspaceFixture(t)
  await mkdir(join(cwd, 'slides', 'present-assets'))

  const entries = await listWorkspaceDirectory(cwd, 'slides', 'slides')
  assert.deepEqual(entries.map(entry => [entry.name, entry.kind]), [
    ['assets', 'directory'],
    ['present-assets', 'directory'],
    ['deck.json', 'file'],
  ])
  const assets = await listWorkspaceDirectory(cwd, 'slides', 'slides/assets')
  assert.deepEqual(assets.map(entry => entry.path), ['slides/assets/machine.png'])
})

test('folder browsing never crosses cwd or follows an escaping symlink', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'pagecraft-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'pagecraft-outside-'))
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })
  await mkdir(join(cwd, 'safe'))
  await symlink(outside, join(cwd, 'safe', 'escape'), 'junction')

  assert.deepEqual((await listWorkspaceFolders(cwd, '.')).map(entry => entry.path), ['safe'])
  await assert.rejects(() => listWorkspaceDirectory(cwd, 'safe', 'safe/escape'), /符号链接/)
  await assert.rejects(() => readWorkspaceSummary(cwd, '../outside'), /路径/)
})

test('workspace writes real files atomically and refuses stale hashes', async (t) => {
  const cwd = await createWorkspaceFixture(t)
  const opened = await readWorkspaceFile(cwd, 'slides', 'slides/deck.json')
  const saved = await saveWorkspaceFile(cwd, 'slides', opened.path, '{"title":"new"}\n', opened.hash)
  assert.equal(await readFile(join(cwd, 'slides', 'deck.json'), 'utf8'), '{"title":"new"}\n')
  await writeFile(join(cwd, 'slides', 'deck.json'), '{"title":"external"}\n')
  await assert.rejects(
    () => saveWorkspaceFile(cwd, 'slides', opened.path, opened.content, saved.hash),
    (error: any) => error.code === 'WORKSPACE_FILE_CONFLICT',
  )
})

test('workspace mutations stay inside the selected root and history restores by hash', async (t) => {
  const cwd = await createWorkspaceFixture(t)
  await createWorkspaceEntry(cwd, 'slides', { parent: 'slides', name: 'notes.md', kind: 'file', content: '# Notes\n' })
  await renameWorkspaceEntry(cwd, 'slides', 'slides/notes.md', 'speaker.md')
  const file = await readWorkspaceFile(cwd, 'slides', 'slides/speaker.md')
  const changed = await saveWorkspaceFile(cwd, 'slides', file.path, '# Changed\n', file.hash)
  const [revision] = await readWorkspaceHistory(cwd, 'slides', file.path)
  assert.ok(revision)
  const restored = await restoreWorkspaceHistory(cwd, 'slides', file.path, revision.id, changed.hash)
  assert.equal(restored.content, '# Notes\n')
  await deleteWorkspaceEntry(cwd, 'slides', file.path)
  await assert.rejects(() => readWorkspaceFile(cwd, 'slides', file.path), /不存在/)
  await assert.rejects(() => deleteWorkspaceEntry(cwd, 'slides', 'slides'), /根目录/)
})
