import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_PREVIEW_URL,
  MAX_PREVIEW_HISTORY_ENTRIES,
  apply,
  assertPreviewUrl,
  buildAnnotationPrompt,
  buildPreviewErrorHtml,
  buildPreviewHtml,
  currentPreviewUrl,
  movePreviewNavigation,
  normalizePreviewUrl,
  pushPreviewNavigation,
  readHtmlWithLimit,
  previewHistoryStorageKey,
  previewUrlStorageKey,
  resolvePersistedPreviewNavigation,
  resolvePersistedPreviewUrl,
  resolvePreviewFrameLocation,
} from '../lib/index.js'

test('preview URL policy defaults to loopback and permits explicit hosts', () => {
  assert.equal(assertPreviewUrl('http://localhost:5173/page').hostname, 'localhost')
  assert.equal(assertPreviewUrl('http://ui.localhost:3000').hostname, 'ui.localhost')
  assert.throws(() => assertPreviewUrl('https://example.com'), /默认只允许/)
  assert.equal(assertPreviewUrl('https://example.com', { allowedHosts: ['example.com'] }).hostname, 'example.com')
  assert.throws(() => assertPreviewUrl('file:///tmp/index.html'), /http 或 https/)
  assert.throws(() => assertPreviewUrl('http://user:secret@localhost:5173'), /用户名或密码/)
})

test('preview HTML receives base URL and annotator before body close', () => {
  const result = buildPreviewHtml('<html><head><title>x</title></head><body>Hello</body></html>', 'http://localhost:5173/path/')
  assert.match(result, /<head><base href="http:\/\/localhost:5173\/path\/">/)
  assert.match(result, /dsh-frontend-feedback-selected/)
  assert.match(result, /dsh-frontend-feedback-navigate/)
  assert.equal(result.match(/document\.addEventListener\('click'/g)?.length, 1)
  assert.ok(result.indexOf('dsh-frontend-feedback-selected') < result.indexOf('</body>'))
})

test('preview frame uses a distinct loopback origin for untrusted pages', () => {
  const remote = resolvePreviewFrameLocation('https://www.baidu.com/', 'http://localhost:3080/', 3)
  assert.equal(new URL(remote.src).origin, 'http://127.0.0.1:3080')
  assert.equal(new URL(remote.src).searchParams.get('url'), 'https://www.baidu.com/')
  assert.equal(remote.allowSameOrigin, true)

  const fragment = resolvePreviewFrameLocation('http://localhost:5173/docs#install', 'http://localhost:3080/', 4)
  assert.equal(new URL(fragment.src).searchParams.get('url'), 'http://localhost:5173/docs#install')
  assert.equal(new URL(fragment.src).hash, '#install')

  const self = resolvePreviewFrameLocation('http://localhost:3080/', 'http://localhost:3080/', 0)
  assert.equal(new URL(self.src).origin, 'http://localhost:3080')
  assert.equal(self.allowSameOrigin, true)

  const network = resolvePreviewFrameLocation('http://localhost:5173/', 'http://192.168.1.8:3080/', 0)
  assert.equal(new URL(network.src).origin, 'http://192.168.1.8:3080')
  assert.equal(network.allowSameOrigin, false)
})

test('preview URL persistence is session-scoped and rejects invalid stored values', () => {
  assert.notEqual(previewUrlStorageKey('session-a'), previewUrlStorageKey('session-b'))
  assert.equal(resolvePersistedPreviewUrl('http://127.0.0.1:8090'), 'http://127.0.0.1:8090/')
  assert.equal(resolvePersistedPreviewUrl('https://example.com/demo'), 'https://example.com/demo')
  assert.equal(resolvePersistedPreviewUrl('file:///tmp/page.html'), DEFAULT_PREVIEW_URL)
  assert.equal(resolvePersistedPreviewUrl('not a url'), DEFAULT_PREVIEW_URL)
  assert.equal(resolvePersistedPreviewUrl(null), DEFAULT_PREVIEW_URL)
})

test('preview navigation history is session-scoped, validated, and bounded', () => {
  assert.notEqual(previewHistoryStorageKey('session-a'), previewHistoryStorageKey('session-b'))
  assert.deepEqual(resolvePersistedPreviewNavigation(null, 'http://127.0.0.1:8090'), {
    entries: ['http://127.0.0.1:8090/'],
    index: 0,
  })
  assert.deepEqual(resolvePersistedPreviewNavigation(JSON.stringify({
    entries: ['http://localhost:3000/a', 'file:///tmp/nope', 'https://example.com/b'],
    index: 2,
  })), {
    entries: ['http://localhost:3000/a', 'https://example.com/b'],
    index: 1,
  })

  const entries = Array.from({ length: MAX_PREVIEW_HISTORY_ENTRIES + 5 }, (_, index) => `http://localhost:3000/${index}`)
  const restored = resolvePersistedPreviewNavigation(JSON.stringify({ entries, index: entries.length - 1 }))
  assert.equal(restored.entries.length, MAX_PREVIEW_HISTORY_ENTRIES)
  assert.equal(restored.entries[0], 'http://localhost:3000/5')
  assert.equal(restored.index, MAX_PREVIEW_HISTORY_ENTRIES - 1)
  assert.deepEqual(resolvePersistedPreviewNavigation('{broken', 'https://example.com/fallback'), {
    entries: ['https://example.com/fallback'],
    index: 0,
  })
})

test('preview navigation operations truncate forward history and respect boundaries', () => {
  const base = {
    entries: ['http://localhost:3000/a', 'http://localhost:3000/b', 'http://localhost:3000/c'],
    index: 1,
  }
  const pushed = pushPreviewNavigation(base, 'http://localhost:3000/d')
  assert.deepEqual(pushed, {
    entries: ['http://localhost:3000/a', 'http://localhost:3000/b', 'http://localhost:3000/d'],
    index: 2,
  })
  assert.equal(currentPreviewUrl(pushed), 'http://localhost:3000/d')
  assert.equal(pushPreviewNavigation(pushed, currentPreviewUrl(pushed)), pushed)

  const back = movePreviewNavigation(pushed, -1)
  assert.deepEqual(back, { ...pushed, index: 1 })
  assert.deepEqual(movePreviewNavigation(back!, 1), pushed)
  assert.equal(movePreviewNavigation({ entries: ['http://localhost:3000/a'], index: 0 }, -1), null)
  assert.equal(normalizePreviewUrl('file:///tmp/page.html'), null)
  assert.throws(() => pushPreviewNavigation(base, 'file:///tmp/page.html'), /http 或 https/)
})

test('preview errors are visible and reported to the parent frame', () => {
  const html = buildPreviewErrorHtml(502, '无法获取目标页面：connection refused')
  assert.match(html, /HTTP 502/)
  assert.match(html, /预览加载失败/)
  assert.match(html, /dsh-frontend-feedback-error/)
  assert.match(html, /connection refused/)

  const escaped = buildPreviewErrorHtml(502, '<img src=x onerror=alert(1)>')
  assert.doesNotMatch(escaped, /<img src=x/)
  assert.match(escaped, /&lt;img src=x onerror=alert\(1\)&gt;/)
})

test('annotation prompt retains source evidence and implementation contract', () => {
  const prompt = buildAnnotationPrompt([{
    url: 'http://localhost:5173/',
    tagName: 'button',
    selector: '#submit',
    domPath: 'html > body > main > button',
    text: '提交',
    rect: { x: 20, y: 40, width: 96, height: 40 },
    comment: '改成更醒目的主按钮',
  }])
  assert.match(prompt, /^\[frontend-feedback\]/)
  assert.match(prompt, /frontend-page-builder Skill/)
  assert.match(prompt, /CSS selector: #submit/)
  assert.match(prompt, /修改要求: 改成更醒目的主按钮/)
  assert.throws(() => buildAnnotationPrompt([]), /至少需要/)
})

test('response reader enforces the configured byte limit', async () => {
  const response = new Response('123456', { headers: { 'content-type': 'text/html' } })
  await assert.rejects(() => readHtmlWithLimit(response, 5), /预览上限/)
})

test('plugin registers the host route and bundled skill', () => {
  const registrations: unknown[] = []
  const skills: any[] = []
  const ctx = {
    webServer: {
      register(route: unknown) {
        registrations.push(route)
        return () => {}
      },
    },
    skills: {
      register(skill: any) {
        skills.push(skill)
        return () => {}
      },
    },
    effect(register: () => () => void) { register() },
  }
  apply(ctx)
  assert.equal(registrations.length, 1)
  assert.equal(skills[0]?.name, 'frontend-page-builder')
  assert.match(skills[0]?.content, /## Initial build/)
  assert.doesNotMatch(skills[0]?.content, /^---/)
})
