import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WorkspaceWatchHub } from '../lib/index.js'

function waitForEvent(events: Array<{ paths: string[] }>, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (!events.some(event => event.paths.includes(path))) return
      clearTimeout(deadline)
      clearInterval(interval)
      resolve()
    }, 25)
    const deadline = setTimeout(() => {
      clearInterval(interval)
      reject(new Error(`missing watcher event for ${path}`))
    }, 3_000)
  })
}

test('watch hub batches disk changes and shares one root watcher', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pagecraft-watch-'))
  await mkdir(join(root, 'assets'))
  const hub = new WorkspaceWatchHub({ debounceMs: 150 })
  t.after(async () => {
    hub.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const first: Array<{ sequence: number; paths: string[] }> = []
  const second: Array<{ sequence: number; paths: string[] }> = []
  const unsubscribeA = hub.subscribe(root, event => first.push(event))
  const unsubscribeB = hub.subscribe(root, event => second.push(event))
  t.after(unsubscribeA)
  t.after(unsubscribeB)

  await writeFile(join(root, 'assets', 'one.png'), Buffer.from([1]))
  await writeFile(join(root, 'assets', 'two.png'), Buffer.from([2]))
  await waitForEvent(first, 'assets')
  assert.equal(second.at(-1)?.sequence, first.at(-1)?.sequence)
  assert.equal(hub.activeRootCount(), 1)
  assert.equal(hub.status(root), 'connected')
})
