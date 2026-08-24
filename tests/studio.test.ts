import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MOTION_PRESETS,
  THEME_PRESETS,
  buildMotionPrompt,
  buildRollbackPrompt,
  buildThemePrompt,
} from '../src/studio.ts'

function payloadOf(value: string): Record<string, any> {
  return JSON.parse(value.slice(value.indexOf('{')))
}

test('theme presets are distinct executable design systems', () => {
  assert.deepEqual(THEME_PRESETS.map(item => item.id), [
    'editorial-light',
    'product-neutral',
    'cinema-dark',
  ])
  assert.equal(new Set(THEME_PRESETS.map(item => JSON.stringify(item.tokens))).size, 3)
})

test('theme work orders preserve bounded visual context', () => {
  const prompt = buildThemePrompt({
    batchId: 'batch-theme-01',
    theme: 'editorial-light',
    scope: 'design-system',
    viewport: { preset: 'mobile', width: 390.4, height: 844.2, devicePixelRatio: 2 },
    screenshot: { id: 'shot-before', kind: 'before', delivery: 'attached', mimeType: 'image/webp' },
  })
  assert.ok(prompt.startsWith('[frontend-theme]\n'))
  const payload = payloadOf(prompt)
  assert.equal(payload.batchId, 'batch-theme-01')
  assert.equal(payload.preset.name, 'Editorial Light')
  assert.deepEqual(payload.viewport, { preset: 'mobile', width: 390, height: 844, devicePixelRatio: 2 })
  assert.equal(payload.screenshot.delivery, 'attached')
  assert.throws(() => buildThemePrompt({ batchId: 'x', theme: 'custom' }), /customBrief/)
})

test('motion presets all define reduced-motion, mobile and performance fallbacks', () => {
  assert.equal(MOTION_PRESETS.length, 8)
  for (const preset of MOTION_PRESETS) {
    assert.ok(preset.reducedMotion.length > 0)
    assert.ok(preset.mobileFallback.length > 0)
    assert.ok(preset.performanceBudget.maxConcurrentAnimations > 0)
    assert.ok(preset.performanceBudget.maxMediaBytes > 0)
    assert.ok(preset.performanceBudget.mainThreadBudgetMs > 0)
  }
  const prompt = buildMotionPrompt({ batchId: 'motion-1', preset: 'ambient-video', intensity: 'cinematic' })
  assert.ok(prompt.startsWith('[frontend-motion]\n'))
  const payload = payloadOf(prompt)
  assert.equal(payload.preset.id, 'ambient-video')
  assert.match(payload.preset.reducedMotion, /静态/)
})

test('rollback work orders normalize paths and require verifiable hashes', () => {
  const hash = 'A'.repeat(64)
  const prompt = buildRollbackPrompt({
    batchId: 'batch.rollback-1',
    expectedPostHashes: { 'src\\App.tsx': hash },
  })
  assert.ok(prompt.startsWith('[frontend-rollback]\n'))
  assert.match(prompt, /禁止 git reset --hard/)
  assert.deepEqual(payloadOf(prompt).expectedPostHashes, { 'src/App.tsx': hash.toLowerCase() })
  const manifestPrompt = buildRollbackPrompt({ batchId: 'x', expectedPostHashes: {} })
  assert.equal(payloadOf(manifestPrompt).expectedPostHashesSource, '.pagecraft/history/x/manifest.json')
  assert.throws(() => buildRollbackPrompt({ batchId: '../escape', expectedPostHashes: { a: hash } }), /batchId 无效/)
  assert.throws(() => buildRollbackPrompt({ batchId: 'x', expectedPostHashes: { '../escape': hash } }), /路径无效/)
  assert.throws(() => buildRollbackPrompt({ batchId: 'x', expectedPostHashes: { 'src/App.tsx': 'not-a-hash' } }), /哈希无效/)
})

test('studio work orders reject impossible viewport dimensions', () => {
  assert.throws(() => buildThemePrompt({
    batchId: 'x',
    theme: 'product-neutral',
    viewport: { preset: 'bad', width: 10, height: 100, devicePixelRatio: 10 },
  }), /viewport/)
})
