import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createVisualBatch,
  estimateBatchBytes,
  pruneVisualHistory,
  transitionBatch,
  validateSnapshot,
  VisualHistoryStore,
} from '../src/history.ts'
import { buildAnnotationPrompt } from '../src/shared.ts'

const annotation = {
  kind: 'element' as const,
  url: 'http://localhost:5173/',
  tagName: 'button',
  selector: '#save',
  domPath: 'html > body > button',
  text: '保存',
  rect: { x: 10, y: 20, width: 80, height: 36 },
  comment: '改成主按钮',
}

test('visual batches have stable state transitions and reject unsafe jumps', () => {
  const batch = createVisualBatch({
    id: 'batch-1',
    sessionId: 'session-1',
    mode: 'webpage',
    url: annotation.url,
    annotations: [annotation],
    createdAt: 100,
  })
  assert.equal(batch.status, 'capturing-before')
  const queued = transitionBatch(batch, 'queued', {}, 110)
  const running = transitionBatch(queued, 'running', {}, 120)
  const capturing = transitionBatch(running, 'capturing-after', {}, 130)
  const completed = transitionBatch(capturing, 'completed', {}, 140)
  assert.equal(completed.updatedAt, 140)
  assert.throws(() => transitionBatch(completed, 'running'), /不能从 completed/)
})

test('history pruning keeps newest records within count and byte budgets', () => {
  const records = Array.from({ length: 5 }, (_, index) => ({
    ...createVisualBatch({
      id: `batch-${index}`,
      sessionId: 'session-1',
      mode: 'webpage' as const,
      url: annotation.url,
      annotations: [annotation],
      createdAt: index,
    }),
    updatedAt: index,
  }))
  assert.deepEqual(pruneVisualHistory(records, 3, Number.POSITIVE_INFINITY).map(record => record.id), [
    'batch-4', 'batch-3', 'batch-2',
  ])
  assert.equal(estimateBatchBytes(records[0]) > 0, true)
})

test('oversized screenshots degrade to metadata instead of breaking history', () => {
  const snapshot = validateSnapshot({
    id: 'snap-1',
    stage: 'before',
    capturedAt: 1,
    url: annotation.url,
    viewport: { preset: 'desktop', width: 1440, height: 900, devicePixelRatio: 1 },
    dataUrl: `data:image/png;base64,${'A'.repeat(8 * 1024 * 1024)}`,
  })
  assert.equal(snapshot.dataUrl, undefined)
  assert.match(snapshot.error ?? '', /超过 5 MB/)
})

test('annotation prompts carry a safe batch id and checkpoint protocol', () => {
  const prompt = buildAnnotationPrompt([annotation], { batchId: 'batch-20260824.1' })
  const payload = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1))
  assert.equal(payload.batchId, 'batch-20260824.1')
  assert.match(prompt, /\.pagecraft\/history\/.*manifest\.json/)
  assert.throws(() => buildAnnotationPrompt([annotation], { batchId: '../escape' }), /batchId 无效/)
})

test('history store falls back to bounded in-memory records when IndexedDB is unavailable', async () => {
  const store = new VisualHistoryStore()
  const batch = createVisualBatch({
    id: 'memory-1', sessionId: 'session-memory', mode: 'webpage', url: annotation.url, annotations: [annotation], createdAt: 1,
  })
  await store.put(batch)
  const records = await store.list('session-memory')
  assert.equal(store.isPersistent, false)
  assert.equal(records[0]?.id, 'memory-1')
  await store.remove('memory-1')
  assert.equal((await store.list('session-memory')).length, 0)
})
