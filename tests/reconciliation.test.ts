import assert from 'node:assert/strict'
import test from 'node:test'
import { createVisualBatch, transitionBatch } from '../src/history.ts'
import { maxCompletedTurn, reconcilePageCraftBatches } from '../src/reconciliation.ts'

function queuedBatch(id: string, createdAt = 100, baselineCompletedTurn?: number) {
  const created = createVisualBatch({
    id,
    sessionId: 'session',
    mode: 'webpage',
    url: 'http://localhost:5173/',
    annotations: [],
    createdAt,
  })
  return transitionBatch(created, 'queued', { baselineCompletedTurn, submittedAt: createdAt + 1 }, createdAt + 1)
}

function user(seq: number, batchId: string) {
  return { kind: 'user', seq, content: [{ type: 'text', text: `[frontend-feedback]\nbatchId=${batchId}` }] }
}

test('keeps a batch queued while its prompt is still in the DSH queue', () => {
  const batch = queuedBatch('batch-a')
  const [result] = reconcilePageCraftBatches([batch], {
    running: true,
    queue: [{ preview: 'batch-a' }],
    nodes: [],
    turnEnds: new Map(),
  })
  assert.equal(result?.decision.kind, 'queued')
})

test('marks the oldest admitted batch running', () => {
  const first = queuedBatch('batch-a', 100)
  const second = queuedBatch('batch-b', 200)
  const results = reconcilePageCraftBatches([second, first], {
    running: true,
    queue: [{ preview: 'batch-b' }],
    nodes: [user(10, 'batch-a')],
    turnEnds: new Map(),
  })
  assert.equal(results[0]?.decision.kind, 'running')
  assert.equal(results[1]?.decision.kind, 'queued')
})

test('recovers a completed batch after the PageCraft panel was closed', () => {
  const batch = queuedBatch('batch-a', 100, 3)
  const [result] = reconcilePageCraftBatches([batch], {
    running: false,
    queue: [],
    nodes: [user(40, 'batch-a'), { kind: 'assistant', seq: 45, turn: 4, blocks: [{ kind: 'text', text: 'done' }] }],
    turnEnds: new Map([[3, 30], [4, 50]]),
  })
  assert.deepEqual(result?.decision, { kind: 'completed', turn: 4 })
})

test('does not confuse a later unrelated turn with a missing PageCraft request', () => {
  const batch = queuedBatch('batch-a')
  const [result] = reconcilePageCraftBatches([batch], {
    running: false,
    queue: [],
    nodes: [user(40, 'ordinary-task'), { kind: 'assistant', seq: 45, turn: 4 }],
    turnEnds: new Map([[4, 50]]),
  })
  assert.deepEqual(result?.decision, { kind: 'waiting', reason: 'request-missing' })
})

test('maps multiple PageCraft requests to distinct completed turns', () => {
  const first = queuedBatch('batch-a', 100)
  const second = queuedBatch('batch-b', 200)
  const results = reconcilePageCraftBatches([first, second], {
    running: false,
    queue: [],
    nodes: [
      user(10, 'batch-a'),
      { kind: 'assistant', seq: 15, turn: 1 },
      user(20, 'batch-b'),
      { kind: 'assistant', seq: 25, turn: 2 },
    ],
    turnEnds: new Map([[1, 18], [2, 28]]),
  })
  assert.deepEqual(results.map(result => result.decision), [
    { kind: 'completed', turn: 1 },
    { kind: 'completed', turn: 2 },
  ])
})

test('surfaces an Agent turn error instead of reporting visual completion', () => {
  const batch = queuedBatch('batch-a')
  const [result] = reconcilePageCraftBatches([batch], {
    running: false,
    queue: [],
    nodes: [user(10, 'batch-a'), { kind: 'turn-error', seq: 15, turn: 1, message: 'tool failed' }],
    turnEnds: new Map([[1, 18]]),
  })
  assert.deepEqual(result?.decision, { kind: 'failed', turn: 1, error: 'tool failed' })
})

test('maxCompletedTurn returns the current durable baseline', () => {
  assert.equal(maxCompletedTurn({ turnEnds: new Map() }), undefined)
  assert.equal(maxCompletedTurn({ turnEnds: new Map([[2, 10], [7, 20], [4, 30]]) }), 7)
})
