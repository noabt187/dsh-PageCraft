import assert from 'node:assert/strict'
import test from 'node:test'
import { applyGuidanceDraft, buildGuidanceSuggestions, classifySelection, toggleConstraint } from '../src/guidance.ts'

const viewport = { id: 'mobile', label: 'Mobile', width: 390, height: 844 }

function element(tagName: string, text = '') {
  return {
    kind: 'element' as const,
    url: 'http://localhost:5173/',
    tagName,
    selector: `#target-${tagName}`,
    domPath: `html > body > ${tagName}`,
    text,
    rect: { x: 10, y: 20, width: 180, height: 44 },
  }
}

test('element categories produce four contextual, editable suggestions', () => {
  assert.equal(classifySelection(element('button', '保存')), 'action')
  assert.equal(classifySelection(element('h2', '订单')), 'text')
  assert.equal(classifySelection(element('input')), 'form')
  assert.equal(classifySelection(element('section')), 'container')
  assert.equal(classifySelection(element('img')), 'media')

  const model = buildGuidanceSuggestions(element('button', '保存'), {
    viewport, scope: 'current-breakpoint',
  })
  assert.equal(model.suggestions.length, 4)
  assert.match(model.suggestions[0].draft, /保存/)
  assert.match(model.suggestions[0].draft, /Mobile（390×844）/)
  assert.match(model.suggestions[0].draft, /保留现有点击逻辑/)
})

test('area suggestions explain insert, overlay, and replace semantics', () => {
  const area = {
    kind: 'area' as const,
    url: 'http://localhost:5173/',
    coordinateSpace: 'viewport' as const,
    rawRect: { x: 10, y: 20, width: 300, height: 180 },
    rect: { x: 10, y: 20, width: 300, height: 180 },
    viewport: { width: 390, height: 844, scrollX: 0, scrollY: 0, devicePixelRatio: 2 },
    alignment: { threshold: 8, guides: [] },
    nearby: [],
  }
  for (const [operation, phrase] of [['insert', '正常文档流'], ['overlay', '覆盖层'], ['replace', '替换框内']] as const) {
    const model = buildGuidanceSuggestions(area, { viewport, scope: 'all-breakpoints', areaOperation: operation })
    assert.equal(model.category, 'area')
    assert.match(model.suggestions[0].draft, new RegExp(phrase))
    assert.match(model.suggestions[0].draft, /全部响应式断点/)
  }
})

test('guidance never overwrites existing user text and constraints are idempotent', () => {
  assert.equal(applyGuidanceDraft('', '新草稿'), '新草稿')
  assert.equal(applyGuidanceDraft('保留字段名', '新草稿'), '保留字段名；新草稿')
  assert.equal(toggleConstraint('改成蓝色', '保留现有业务逻辑'), '改成蓝色；保留现有业务逻辑')
  assert.equal(toggleConstraint('改成蓝色；保留现有业务逻辑', '保留现有业务逻辑'), '改成蓝色；保留现有业务逻辑')
})

test('dynamic DOM text is sanitized and bounded in generated drafts', () => {
  const unsafe = element('button', `保存\u0000${'非常长'.repeat(80)}`)
  const model = buildGuidanceSuggestions(unsafe, { viewport, scope: 'current-and-smaller' })
  assert.doesNotMatch(model.target, /\u0000/)
  assert.ok(model.target.length <= 54)
  assert.match(model.suggestions[0].draft, /及更小断点/)
})
