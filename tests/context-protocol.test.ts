import assert from 'node:assert/strict'
import test from 'node:test'
import { ANNOTATOR_SCRIPT } from '../src/annotator-script.ts'
import {
  buildAnnotationPrompt,
  isAnnotationViewport,
  isAreaSelection,
  isElementSelection,
  isFeedbackComment,
  isResponsiveScope,
  isScreenshotCaptureRequest,
  isScreenshotCaptureResult,
  isScreenshotContext,
  isSourceHints,
} from '../src/shared.ts'

const reactHints = {
  framework: 'react' as const,
  component: 'SaveButton',
  owners: ['SaveButton', 'CheckoutForm', 'CheckoutPage'],
  file: 'src/components/SaveButton.tsx',
  line: 18,
  column: 4,
  stableId: 'data-pagecraft-id=checkout-save',
  evidence: ['explicit:data-pagecraft-source', 'react:fiber-owner', 'dom:interactive-element'],
  confidence: 0.99,
}

test('SourceHints guard validates bounded evidence and confidence', () => {
  assert.equal(isSourceHints(reactHints), true)
  assert.equal(isSourceHints({ ...reactHints, confidence: 1.01 }), false)
  assert.equal(isSourceHints({ ...reactHints, evidence: [] }), false)
  assert.equal(isSourceHints({ ...reactHints, line: 0 }), false)
  assert.equal(isSourceHints({ ...reactHints, framework: 'angular' }), false)
  assert.equal(isSourceHints({ ...reactHints, owners: Array.from({ length: 17 }, () => 'Owner') }), false)
})

test('responsive viewport, scope, and screenshot metadata guards are strict', () => {
  const viewport = { preset: 'mobile', width: 390, height: 844, devicePixelRatio: 2 }
  assert.equal(isAnnotationViewport(viewport), true)
  assert.equal(isAnnotationViewport({ ...viewport, preset: '' }), false)
  assert.equal(isAnnotationViewport({ ...viewport, width: 0 }), false)
  assert.equal(isResponsiveScope('current-breakpoint'), true)
  assert.equal(isResponsiveScope('current-and-smaller'), true)
  assert.equal(isResponsiveScope('all-breakpoints'), true)
  assert.equal(isResponsiveScope('desktop-only'), false)

  assert.equal(isScreenshotContext({
    kind: 'selection',
    width: 780,
    height: 240,
    mimeType: 'image/webp',
    byteLength: 3210,
    dataUrl: 'data:image/webp;base64,AAAA',
  }), true)
  assert.equal(isScreenshotContext({
    kind: 'selection', width: 780, height: 240, mimeType: 'image/webp', dataUrl: 'data:image/png;base64,AAAA',
  }), false)

  assert.equal(isScreenshotCaptureRequest({
    type: 'dsh-pagecraft-capture-request', requestId: 'capture-1', kind: 'viewport',
    format: 'webp', quality: 0.78, maxDimension: 1600,
  }), true)
  assert.equal(isScreenshotCaptureRequest({
    type: 'dsh-pagecraft-capture-request', requestId: 'capture-1', kind: 'viewport',
    format: 'png', quality: 0.78, maxDimension: 1600,
  }), false)
  assert.equal(isScreenshotCaptureResult({
    type: 'dsh-pagecraft-capture-result', requestId: 'capture-1', ok: true,
    dataUrl: 'data:image/webp;base64,AAAA', width: 390, height: 844, mimeType: 'image/webp',
  }), true)
  assert.equal(isScreenshotCaptureResult({
    type: 'dsh-pagecraft-capture-result', requestId: 'capture-2', ok: false, error: 'Canvas unavailable',
  }), true)
  assert.equal(isScreenshotCaptureResult({
    type: 'dsh-pagecraft-capture-result', requestId: 'capture-3', ok: true,
    dataUrl: `data:image/png;base64,${'A'.repeat(7 * 1024 * 1024)}`,
    width: 100, height: 100, mimeType: 'image/png',
  }), false)
})

test('DOM work orders include trusted-shape context without embedding screenshot bytes', () => {
  const element = {
    kind: 'element' as const,
    url: 'http://localhost:5173/checkout',
    tagName: 'button',
    selector: '[data-pagecraft-id="checkout-save"]',
    domPath: 'html > body > main > form > button',
    text: '保存',
    html: '<button data-pagecraft-id="checkout-save">保存</button>',
    container: {
      tagName: 'form',
      selector: 'form.checkout',
      html: '<form class="checkout">...</form>',
      sourceHints: { ...reactHints, component: 'CheckoutForm', confidence: 0.9 },
    },
    rect: { x: 24, y: 128, width: 120, height: 44 },
    sourceHints: reactHints,
    viewport: { preset: 'mobile', width: 390, height: 844, devicePixelRatio: 2 },
    scope: 'current-and-smaller' as const,
    screenshot: {
      kind: 'selection' as const,
      width: 240,
      height: 88,
      mimeType: 'image/webp' as const,
      byteLength: 1024,
      dataUrl: 'data:image/webp;base64,AAAA',
    },
    comment: '移动端按钮占满容器宽度',
  }

  assert.equal(isElementSelection(element), true)
  assert.equal(isFeedbackComment(element), true)
  const prompt = buildAnnotationPrompt([element])
  const payload = JSON.parse(prompt.slice(prompt.indexOf('{')))
  const annotation = payload.annotations[0]
  assert.deepEqual(annotation.sourceHints, reactHints)
  assert.deepEqual(annotation.viewport, element.viewport)
  assert.equal(annotation.scope, 'current-and-smaller')
  assert.deepEqual(annotation.target.container.sourceHints, element.container.sourceHints)
  assert.equal(annotation.screenshot.byteLength, 1024)
  assert.equal(annotation.screenshot.dataUrl, undefined)
  assert.doesNotMatch(prompt, /base64,AAAA/)
  assert.match(prompt, /媒体查询、容器查询和设计令牌/)
})

test('area work orders preserve legacy payloads and enrich responsive source evidence when present', () => {
  const legacy = {
    kind: 'area' as const,
    url: 'http://localhost:5173/',
    coordinateSpace: 'viewport' as const,
    rawRect: { x: 100, y: 120, width: 200, height: 160 },
    rect: { x: 104, y: 120, width: 200, height: 160 },
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    alignment: { threshold: 8, guides: [] },
    nearby: [],
  }
  assert.equal(isAreaSelection(legacy), true)

  const enriched = {
    ...legacy,
    viewport: { ...legacy.viewport, preset: 'laptop' },
    scope: 'all-breakpoints' as const,
    sourceHints: { ...reactHints, component: 'DashboardGrid', confidence: 0.86 },
    container: {
      tagName: 'section',
      selector: '.dashboard-grid',
      html: '<section class="dashboard-grid"></section>',
      relation: 'container' as const,
      rect: { x: 40, y: 80, width: 1200, height: 640 },
      distance: 0,
      sourceHints: { ...reactHints, component: 'DashboardGrid', confidence: 0.86 },
    },
    comment: '新增一张统计卡片',
    operation: 'insert' as const,
  }
  assert.equal(isAreaSelection(enriched), true)
  assert.equal(isFeedbackComment(enriched), true)
  const prompt = buildAnnotationPrompt([enriched])
  const payload = JSON.parse(prompt.slice(prompt.indexOf('{')))
  assert.deepEqual(payload.annotations[0].viewport, {
    preset: 'laptop', width: 1280, height: 800, devicePixelRatio: 1,
  })
  assert.equal(payload.annotations[0].scope, 'all-breakpoints')
  assert.equal(payload.annotations[0].sourceHints.component, 'DashboardGrid')
  assert.equal(payload.annotations[0].target.container.sourceHints.component, 'DashboardGrid')
})

test('annotator runtime advertises framework hints, responsive context, and fixed capture protocol', () => {
  assert.doesNotThrow(() => new Function(ANNOTATOR_SCRIPT))
  assert.match(ANNOTATOR_SCRIPT, /data-pagecraft-source/)
  assert.match(ANNOTATOR_SCRIPT, /__reactFiber/)
  assert.match(ANNOTATOR_SCRIPT, /String\.fromCharCode\(36\)/)
  assert.match(ANNOTATOR_SCRIPT, /__vueParentComponent/)
  assert.match(ANNOTATOR_SCRIPT, /__svelte_meta/)
  assert.match(ANNOTATOR_SCRIPT, /sourceHints: sourceHintsFor/)
  assert.match(ANNOTATOR_SCRIPT, /scope: responsiveScope/)
  assert.match(ANNOTATOR_SCRIPT, /dsh-pagecraft-responsive-context/)
  assert.match(ANNOTATOR_SCRIPT, /dsh-pagecraft-capture-request/)
  assert.match(ANNOTATOR_SCRIPT, /dsh-pagecraft-capture-result/)
  assert.match(ANNOTATOR_SCRIPT, /requestId, ok: true/)
  assert.match(ANNOTATOR_SCRIPT, /requestId,[\s\S]*ok: false,[\s\S]*error:/)
  assert.match(ANNOTATOR_SCRIPT, /image\/webp/)
  assert.match(ANNOTATOR_SCRIPT, /maxDimension/)
  assert.match(ANNOTATOR_SCRIPT, /querySelectorAll\('\[data-dsh-annotator-ui\], script, noscript'\)/)
  assert.match(ANNOTATOR_SCRIPT, /SVG foreignObject screenshot capture/)
})
