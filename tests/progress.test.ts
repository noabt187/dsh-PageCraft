import assert from 'node:assert/strict'
import test from 'node:test'
import { createVisualBatch, transitionBatch } from '../src/history.ts'
import { classifyRunningCalls, deriveBatchProgress, formatElapsed, visualOutcome } from '../src/progress.ts'

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

function batch(id: string, createdAt = 1_000) {
  return transitionBatch(createVisualBatch({
    id, sessionId: 'session', mode: 'webpage', url: annotation.url, annotations: [annotation], createdAt,
  }), 'queued', {}, createdAt + 10)
}

test('running tool calls map to observable progress stages, including nested calls', () => {
  assert.equal(classifyRunningCalls([{ name: 'read_file', input: 'src/App.tsx' }]).stage, 'locating')
  assert.equal(classifyRunningCalls([{ name: 'shell', input: 'Get-FileHash .pagecraft/history/a/manifest.json' }]).stage, 'checkpointing')
  assert.equal(classifyRunningCalls([{ name: 'apply_patch', input: 'src/App.tsx' }]).stage, 'editing')
  assert.equal(classifyRunningCalls([{ name: 'agent', children: [{ name: 'shell', input: 'npm run build' }] }]).stage, 'verifying')
  assert.equal(classifyRunningCalls([{ name: 'unknown_tool' }]).stage, 'thinking')
})

test('queue matching uses batch id and reports exact tasks ahead', () => {
  const record = batch('batch-two')
  const progress = deriveBatchProgress(record, {
    running: true,
    queue: [
      { preview: 'ordinary prompt' },
      { preview: '[frontend-feedback] batch-two' },
    ],
  }, [record], 6_000)
  assert.equal(progress.stage, 'queued')
  assert.equal(progress.queueAhead, 1)
  assert.match(progress.detail, /1 个任务/)
})

test('oldest unfinished PageCraft batch owns live tool activity', () => {
  const first = batch('first', 1_000)
  const second = batch('second', 2_000)
  const snapshot = { running: true, queue: [{ preview: 'second' }], runningCalls: [{ name: 'apply_patch' }] }
  assert.equal(deriveBatchProgress(first, snapshot, [second, first], 3_000).stage, 'editing')
  assert.equal(deriveBatchProgress(second, snapshot, [first, second], 3_000).stage, 'queued')
})

test('visual outcomes distinguish changed, unchanged, and missing evidence', () => {
  const base = batch('visual')
  const snapshot = {
    id: 'before', stage: 'before' as const, capturedAt: 1, url: annotation.url,
    viewport: { preset: 'desktop', width: 1440, height: 900, devicePixelRatio: 1 }, dataUrl: 'data:image/png;base64,AAAA',
  }
  assert.equal(visualOutcome({ ...base, before: snapshot }), 'unverified')
  assert.equal(visualOutcome({ ...base, before: snapshot, after: { ...snapshot, id: 'after', stage: 'after' } }), 'unchanged')
  assert.equal(visualOutcome({ ...base, before: snapshot, after: { ...snapshot, id: 'after', stage: 'after', dataUrl: 'data:image/png;base64,BBBB' } }), 'changed')
})

test('elapsed time formatting covers seconds, minutes, and hours', () => {
  assert.equal(formatElapsed(59_900), '59 秒')
  assert.equal(formatElapsed(65_000), '1 分 05 秒')
  assert.equal(formatElapsed(3_720_000), '1 小时 2 分')
})
