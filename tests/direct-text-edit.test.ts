import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import {
  DirectTextEditService,
  type DomTextSelection,
} from '../lib/index.js'

async function directEditFixture(t: TestContext, source: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'pagecraft-direct-edit-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await mkdir(join(cwd, 'src'), { recursive: true })
  await writeFile(join(cwd, 'src', 'App.tsx'), source)
  return cwd
}

function selection(displayedText: string): DomTextSelection {
  return {
    pageUrl: 'http://localhost:5173/',
    framePath: [],
    selector: 'h1',
    fingerprint: `h1|${displayedText}`,
    displayedText,
    tagName: 'h1',
    attributes: {},
    nearbyText: [],
  }
}

test('direct text transaction commits only after verified DOM text', async (t) => {
  const cwd = await directEditFixture(t, 'export const App=()=> <h1>旧标题</h1>\n')
  const service = new DirectTextEditService({ verificationTimeoutMs: 8_000, retentionMs: 120_000 })
  t.after(() => service.dispose())

  const started = await service.start(cwd, 'src', selection('旧标题'), '新标题')
  assert.match(await readFile(join(cwd, 'src', 'App.tsx'), 'utf8'), /新标题/)
  const result = await service.verify(cwd, {
    transactionId: started.transactionId,
    verified: true,
    observedText: '新标题',
  })
  assert.equal(result.status, 'committed')
})

test('failed verification rolls back only when written hash is still current', async (t) => {
  const cwd = await directEditFixture(t, 'export const App=()=> <h1>旧标题</h1>\n')
  const service = new DirectTextEditService()
  t.after(() => service.dispose())

  const started = await service.start(cwd, 'src', selection('旧标题'), '错误标题')
  const rolledBack = await service.verify(cwd, {
    transactionId: started.transactionId,
    verified: false,
    observedText: '旧标题',
  })
  assert.equal(rolledBack.status, 'rolled_back')
  assert.match(await readFile(join(cwd, 'src', 'App.tsx'), 'utf8'), /旧标题/)

  const second = await service.start(cwd, 'src', selection('旧标题'), '第二标题')
  await writeFile(join(cwd, 'src', 'App.tsx'), 'export const App=()=> <h1>外部修改</h1>\n')
  const conflict = await service.verify(cwd, {
    transactionId: second.transactionId,
    verified: false,
    observedText: '外部修改',
  })
  assert.equal(conflict.status, 'conflict')
  assert.match(await readFile(join(cwd, 'src', 'App.tsx'), 'utf8'), /外部修改/)
})

test('direct text edits preserve syntax escaping and reject stale selections', async (t) => {
  const cwd = await directEditFixture(t, "export const App=()=> <h1>{'旧标题'}</h1>\n")
  const service = new DirectTextEditService()
  t.after(() => service.dispose())

  const started = await service.start(cwd, 'src', selection('旧标题'), "新的 '标题'")
  assert.match(await readFile(join(cwd, 'src', 'App.tsx'), 'utf8'), /新的 \\'标题\\'/)
  await service.verify(cwd, { transactionId: started.transactionId, verified: false })
  await assert.rejects(
    () => service.start(cwd, 'src', selection('不存在的标题'), '不会写入'),
    (error: any) => error.code === 'TEXT_SOURCE_NOT_FOUND',
  )
})
