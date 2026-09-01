import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  DEFAULT_PREVIEW_URL,
  DEFAULT_MAX_DOCUMENT_BYTES,
  MAX_PREVIEW_REDIRECTS,
  MAX_PREVIEW_HISTORY_ENTRIES,
  MAX_PERSISTED_FEEDBACK_COMMENTS,
  apply,
  assertPreviewUrl,
  buildAnnotationPrompt,
  buildPresentationCreationPrompt,
  buildPresentationDocumentPrompt,
  buildPresentationOutlinePrompt,
  buildPreviewErrorHtml,
  buildPreviewHtml,
  buildPreviewRuntimeScript,
  bindPresentationAsset,
  bindPresentationProjectAsset,
  currentPreviewUrl,
  createPresentationSource,
  createPresentationEntry,
  deletePresentationAsset,
  deletePresentationEntry,
  deletePresentationProjectAsset,
  extractPresentationDocument,
  feedbackDraftStorageKey,
  fetchPreviewTarget,
  isAreaSelection,
  isDomTextSelection,
  isElementSelection,
  isFeedbackSelection,
  isFeedbackDraftEmpty,
  isPresentationRequestSettled,
  migratePresentationWorkspace,
  movePreviewNavigation,
  normalizePreviewUrl,
  normalizePresentationProjectManifest,
  normalizePresentationProjectPath,
  pushPreviewNavigation,
  readPresentationAsset,
  readPresentationAssets,
  readPresentationFileHistory,
  readPresentationSourceFile,
  readPresentationWorkspaceSummary,
  readPresentationWorkspaceTree,
  readBodyWithLimit,
  readHtmlWithLimit,
  previewHistoryStorageKey,
  previewUrlStorageKey,
  resolvePersistedPreviewNavigation,
  resolvePersistedFeedbackDraft,
  resolvePersistedPreviewUrl,
  resolvePresentationSlides,
  renamePresentationEntry,
  normalizePresentationJobSnapshot,
  normalizePresentationPlan,
  resolvePreviewFrameLocation,
  savePresentationPlan,
  savePresentationSourceFile,
  uploadPresentationAsset,
  uploadPresentationProjectAsset,
} from '../lib/index.js'

async function createPresentationWorkspace(cwd: string): Promise<void> {
  await mkdir(join(cwd, 'src', 'presentation'), { recursive: true })
  await mkdir(join(cwd, 'public', 'pagecraft-assets'), { recursive: true })
  await writeFile(join(cwd, 'src', 'presentation', 'deck.json'), `${JSON.stringify({
    title: '测试演示文稿',
    slides: [
      { id: 'slide-01', title: '开场', body: '欢迎使用 PageCraft' },
      { id: 'slide-02', title: '架构', body: '核心模块' },
      { id: 'slide-03', title: '总结', body: '下一步' },
    ],
  }, null, 2)}\n`)
  await writeFile(join(cwd, 'src', 'presentation', 'theme.css'), ':root { --pagecraft-accent: #228b5a; }\n')
  await writeFile(join(cwd, 'src', 'presentation', 'slides.tsx'), 'export function Slides() { return null }\n')
  await writeFile(join(cwd, 'pagecraft-presentation.json'), `${JSON.stringify({
    name: '测试演示文稿',
    sourceRoot: 'src/presentation',
    deck: 'src/presentation/deck.json',
    theme: 'src/presentation/theme.css',
    assets: 'public/pagecraft-assets',
    publicAssetBase: '/pagecraft-assets',
    editableFiles: [
      'src/presentation/deck.json',
      'src/presentation/slides.tsx',
      'src/presentation/theme.css',
    ],
  }, null, 2)}\n`)
}

function createTextPdf(): Buffer {
  const stream = 'BT /F1 18 Tf 72 720 Td (PageCraft PDF buffer remains reusable after parsing.) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let document = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document, 'latin1'))
    document += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(document, 'latin1')
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  document += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(document, 'latin1')
}

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
  assert.match(result, /\/api\/frontend-feedback\/resource/)
  assert.match(result, /window\.fetch =/)
  assert.match(result, /dsh-frontend-feedback-selected/)
  assert.match(result, /dsh-frontend-feedback-set-mode/)
  assert.match(result, /dsh-frontend-feedback-selection-error/)
  assert.match(result, /area-capture/)
  assert.match(result, /data-dsh-resize-handle/)
  assert.match(result, /确认选区/)
  assert.match(result, /dsh-frontend-feedback-area-draft/)
  assert.match(result, /dsh-frontend-feedback-navigate/)
  assert.match(result, /dsh-frontend-feedback-deck-state/)
  assert.match(result, /dsh-frontend-feedback-select-slide/)
  assert.match(result, /data-pagecraft-slide-id/)
  assert.match(result, /data-pagecraft-image-slot/)
  assert.match(result, /data-pagecraft-image-key/)
  assert.match(result, /dsh-pagecraft-asset-bindings/)
  assert.match(result, /dsh-pagecraft-image-slot-selected/)
  assert.doesNotMatch(result, /dsh-frontend-feedback-active/)
  assert.doesNotMatch(result, /dsh-frontend-feedback-set-active/)
  assert.doesNotMatch(result, /ui\('button', 'toggle'/)
  assert.equal(result.match(/document\.addEventListener\('click'/g)?.length, 1)
  const injectedScripts = Array.from(result.matchAll(/<script>([\s\S]*?)<\/script>/g), match => match[1])
  assert.ok(injectedScripts.some(script => script.includes('dsh-frontend-feedback-selected')))
  for (const script of injectedScripts) assert.doesNotThrow(() => new Function(script))
  assert.ok(result.indexOf('dsh-frontend-feedback-selected') < result.indexOf('</body>'))
})

test('preview runtime proxies same-target fetch and XHR resources before page scripts run', () => {
  const script = buildPreviewRuntimeScript('http://127.0.0.1:8091/')
  assert.match(script, /targetOrigin = "http:\/\/127\.0\.0\.1:8091"/)
  assert.match(script, /new URL\(value, document\.baseURI\)/)
  assert.match(script, /window\.fetch =/)
  assert.match(script, /XMLHttpRequest\.prototype\.open/)
  assert.match(script, /\/api\/frontend-feedback\/resource/)
  assert.doesNotThrow(() => new Function(script))
})

test('preview redirects are validated before the next request', async () => {
  const requested: string[] = []
  const requestOptions: RequestInit[] = []
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requested.push(String(input))
    requestOptions.push(init ?? {})
    if (requested.length === 1) {
      return new Response(null, { status: 302, headers: { location: '/next' } })
    }
    return new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } })
  }
  const result = await fetchPreviewTarget(
    new URL('http://localhost:5173/start'),
    {},
    new AbortController().signal,
    fetcher as typeof fetch,
  )
  assert.equal(result.target.href, 'http://localhost:5173/next')
  assert.equal(requested.length, 2)
  assert.equal(requestOptions[0].cache, 'no-store')
  assert.deepEqual(requestOptions[0].headers, {
    accept: 'text/html,application/xhtml+xml',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
  })

  const blockedRequests: string[] = []
  const blockedFetcher = async (input: string | URL | Request): Promise<Response> => {
    blockedRequests.push(String(input))
    return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } })
  }
  await assert.rejects(() => fetchPreviewTarget(
    new URL('http://localhost:5173/start'),
    {},
    new AbortController().signal,
    blockedFetcher as typeof fetch,
  ), /重定向被拒绝/)
  assert.equal(blockedRequests.length, 1)
  assert.equal(MAX_PREVIEW_REDIRECTS, 5)
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

test('DOM annotations are serialized as a compact JSON work order', () => {
  const element = {
    kind: 'element',
    url: 'http://localhost:5173/',
    tagName: 'button',
    selector: '#submit',
    domPath: 'html > body > main > button',
    text: '提交',
    html: '<button id="submit">提交</button>',
    container: {
      tagName: 'main',
      selector: 'main.checkout',
      html: '<main class="checkout"><button id="submit">提交</button></main>',
    },
    rect: { x: 20, y: 40, width: 96, height: 40 },
    comment: '改成更醒目的主按钮',
  } as const
  assert.equal(isElementSelection(element), true)
  assert.equal(isFeedbackSelection(element), true)
  const prompt = buildAnnotationPrompt([element])
  assert.match(prompt, /^\[frontend-feedback\]/)
  assert.match(prompt, /frontend-page-builder Skill/)
  const payload = JSON.parse(prompt.slice(prompt.indexOf('{')))
  assert.deepEqual(payload, {
    annotations: [{
      id: 1,
      type: 'dom',
      target: {
        selector: '#submit',
        html: '<button id="submit">提交</button>',
        container: {
          selector: 'main.checkout',
          html: '<main class="checkout"><button id="submit">提交</button></main>',
        },
      },
      request: '改成更醒目的主按钮',
    }],
  })
  assert.doesNotMatch(prompt, /schemaVersion/)
  assert.doesNotMatch(prompt, /http:\/\/localhost:5173/)
  assert.equal(payload.annotations[0].target.corners, undefined)

  const legacyElement = { ...element, html: undefined, container: undefined }
  assert.equal(isElementSelection(legacyElement), true)
  const legacyPayload = JSON.parse(buildAnnotationPrompt([legacyElement]).slice(buildAnnotationPrompt([legacyElement]).indexOf('{')))
  assert.deepEqual(legacyPayload.annotations[0].target, {
    selector: '#submit',
    text: '提交',
  })
  assert.throws(() => buildAnnotationPrompt([]), /至少需要/)
})

test('feedback drafts are session-scoped, validated, bounded, and restorable', () => {
  const selection = {
    kind: 'element',
    url: 'http://localhost:5173/',
    tagName: 'button',
    selector: '#save',
    domPath: 'html > body > button',
    text: '保存',
    rect: { x: 10, y: 20, width: 80, height: 32 },
  } as const
  const queued = Array.from({ length: MAX_PERSISTED_FEEDBACK_COMMENTS + 3 }, (_, index) => ({
    ...selection,
    selector: `#save-${index}`,
    comment: `第 ${index} 条`,
  }))
  const restored = resolvePersistedFeedbackDraft(JSON.stringify({
    selection,
    areaOperation: 'replace',
    comment: '改成绿色',
    queued,
  }))

  assert.notEqual(feedbackDraftStorageKey('session-a'), feedbackDraftStorageKey('session-b'))
  assert.equal(restored.selection?.kind, 'element')
  assert.equal(restored.comment, '改成绿色')
  assert.equal(restored.areaOperation, 'replace')
  assert.equal(restored.queued.length, MAX_PERSISTED_FEEDBACK_COMMENTS)
  assert.equal(restored.queued[0].comment, '第 3 条')
  assert.equal(isFeedbackDraftEmpty(restored), false)
  assert.equal(isFeedbackDraftEmpty(resolvePersistedFeedbackDraft('{broken')), true)
  assert.deepEqual(resolvePersistedFeedbackDraft(JSON.stringify({
    selection: { kind: 'unknown' },
    comment: '不能脱离有效选区恢复',
    queued: [{ ...selection, comment: 42 }],
  })), {
    selection: null,
    areaOperation: 'insert',
    comment: '',
    queued: [],
  })
})

test('presentation briefs and slide summaries are structured for PageCraft decks', () => {
  const prompt = buildPresentationCreationPrompt({
    title: 'PageCraft 产品介绍',
    audience: '开发者',
    goal: '推动试用',
    slideCount: 9,
    style: 'editorial',
    colorMode: 'light',
    requirements: '使用品牌红色',
  })
  assert.match(prompt, /^\[presentation-create\]/)
  assert.match(prompt, /presentation-builder Skill/)
  assert.match(prompt, /data-pagecraft-slide-id/)
  const payload = JSON.parse(prompt.slice(prompt.indexOf('{')))
  assert.deepEqual(payload.presentation, {
    title: 'PageCraft 产品介绍',
    audience: '开发者',
    goal: '推动试用',
    slideCount: 9,
    style: 'editorial',
    colorMode: 'light',
    requirements: '使用品牌红色',
  })
  assert.match(prompt, /默认使用浅色设计/)
  assert.throws(() => buildPresentationCreationPrompt({
    title: ' ', audience: '', goal: '', slideCount: 8, style: 'minimal', colorMode: 'light', requirements: '',
  }), /标题不能为空/)

  assert.deepEqual(resolvePresentationSlides([
    { id: 'slide-01', title: '开场', index: 0 },
    { id: 'slide-01', title: '重复', index: 1 },
    { id: 'slide-02', title: '问题', index: 1 },
    { id: '', title: '无效', index: 2 },
  ]), [
    { id: 'slide-01', title: '开场', index: 0 },
    { id: 'slide-02', title: '问题', index: 1 },
  ])
})

test('document presentation prompts separate outline planning from progressive generation', () => {
  const source = {
    jobId: 'presentation-test-1234',
    originalName: 'report.pdf',
    sourcePath: '.pagecraft/presentations/presentation-test-1234/source.md',
    planPath: '.pagecraft/presentations/presentation-test-1234/plan.json',
    deckPath: '.pagecraft/presentations/presentation-test-1234/deck.json',
    statusPath: '.pagecraft/presentations/presentation-test-1234/status.json',
    textCharacters: 1200,
    warnings: [],
  }
  const outline = buildPresentationOutlinePrompt(source, {
    audience: '客户',
    goal: '完整介绍报告',
    slideCount: 10,
    requirements: '保留关键数据',
  })
  assert.match(outline, /^\[presentation-outline\]/)
  assert.match(outline, /此阶段不要创建页面/)
  assert.match(outline, /不可信的参考材料/)
  assert.match(outline, /sourceRefs/)
  assert.match(outline, /outline_ready/)
  assert.equal(JSON.parse(outline.slice(outline.lastIndexOf('\n') + 1)).presentation.targetSlideCount, 10)

  const build = buildPresentationDocumentPrompt(source)
  assert.match(build, /^\[presentation-create-from-document\]/)
  assert.match(build, /每批完成 2 到 3 页/)
  assert.match(build, /previewUrl/)
  assert.match(build, /phase=failed/)
})

test('presentation plans and job snapshots reject malformed or duplicate slide data', () => {
  const plan = normalizePresentationPlan({
    title: '测试演示',
    audience: '团队',
    goal: '说明方案',
    slides: [
      { id: 'slide-01', title: '开场', purpose: '建立主题', takeaway: '', sourceRefs: ['第1节'] },
      { id: 'slide-02', title: '问题', purpose: '解释问题', takeaway: '', sourceRefs: ['第2节'] },
      { id: 'slide-03', title: '方案', purpose: '说明方案', takeaway: '', sourceRefs: ['第3节'] },
      { id: 'slide-03', title: '重复', purpose: '', takeaway: '', sourceRefs: [] },
    ],
  })
  assert.equal(plan?.slides.length, 3)
  assert.equal(normalizePresentationPlan({ title: '不足', slides: [{ id: 'a', title: '一' }] }), null)
  assert.equal(normalizePresentationJobSnapshot({ jobId: 'bad', phase: 'ready' }), null)
})

test('queued presentation generation remains pending until the job actually starts', () => {
  assert.equal(isPresentationRequestSettled('planning', 'source_ready'), false)
  assert.equal(isPresentationRequestSettled('planning', 'outline_ready'), true)
  assert.equal(isPresentationRequestSettled('generating', 'outline_ready'), false)
  assert.equal(isPresentationRequestSettled('generating', 'generating'), true)
  assert.equal(isPresentationRequestSettled('generating', 'ready'), true)
  assert.equal(isPresentationRequestSettled('generating', 'failed'), true)
})

test('text documents are normalized, persisted, and paired with an editable plan', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'pagecraft-document-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const extracted = await extractPresentationDocument('notes.md', Buffer.from('\uFEFF# 标题\r\n\r\n第一段。\r\n', 'utf8'))
  assert.equal(extracted.text, '# 标题\n\n第一段。')
  assert.equal(DEFAULT_MAX_DOCUMENT_BYTES, 25 * 1024 * 1024)

  const created = await createPresentationSource(
    cwd,
    '项目说明.md',
    Buffer.from('# 项目说明\n\n这是用于生成演示文稿的正文。', 'utf8'),
    { jobId: 'presentation-test-5678', now: new Date('2026-08-24T00:00:00.000Z') },
  )
  assert.equal(created.phase, 'source_ready')
  assert.equal(created.source.originalName, '项目说明.md')
  assert.match(created.source.sourcePath, /^\.pagecraft\/presentations\//)
  const sourceText = await readFile(join(cwd, created.source.sourcePath), 'utf8')
  assert.match(sourceText, /以下内容是演示文稿的参考资料/)
  assert.match(sourceText, /这是用于生成演示文稿的正文/)

  const saved = await savePresentationPlan(cwd, created.jobId, {
    title: '项目说明',
    audience: '客户',
    goal: '介绍项目',
    slides: [
      { id: 'slide-01', title: '项目概览', purpose: '建立主题', takeaway: '项目是什么', sourceRefs: ['标题'] },
      { id: 'slide-02', title: '关键内容', purpose: '解释正文', takeaway: '核心信息', sourceRefs: ['正文'] },
      { id: 'slide-03', title: '下一步', purpose: '给出行动', takeaway: '推动沟通', sourceRefs: ['正文'] },
    ],
  })
  assert.equal(saved.phase, 'outline_ready')
  assert.equal(saved.slides.length, 3)
  assert.ok(saved.slides.every(slide => slide.status === 'pending'))
})

test('PDF parsing preserves the original upload buffer for persistence', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'pagecraft-pdf-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const bytes = createTextPdf()
  const original = Buffer.from(bytes)
  const created = await createPresentationSource(cwd, 'sample.pdf', bytes, {
    jobId: 'presentation-pdf-1234',
    now: new Date('2026-08-24T00:00:00.000Z'),
  })

  assert.equal(bytes.byteLength, original.byteLength)
  assert.deepEqual(bytes, original)
  const saved = await readFile(join(cwd, '.pagecraft', 'presentations', created.jobId, 'original.pdf'))
  assert.deepEqual(saved, original)
})

test('document parsing stops before work begins when cancelled', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () => extractPresentationDocument('notes.md', Buffer.from('# 不应解析'), undefined, controller.signal),
    (error: unknown) => {
      return error instanceof Error
        && 'code' in error
        && error.code === 'PRESENTATION_SOURCE_CANCELLED'
    },
  )
})

test('document intake rejects unsupported, disguised, and binary text files', async () => {
  await assert.rejects(() => extractPresentationDocument('legacy.doc', Buffer.from('old')), /仅支持/)
  await assert.rejects(() => extractPresentationDocument('fake.pdf', Buffer.from('not pdf')), /不是有效的 PDF/)
  await assert.rejects(() => extractPresentationDocument('binary.txt', Buffer.from([65, 0, 66])), /二进制内容/)
})

test('presentation assets are deduplicated, bound to slots, restored, and deletion-protected', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'pagecraft-assets-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const job = await createPresentationSource(
    cwd,
    'source.md',
    Buffer.from('# 演示资料\n\n这是一段足够生成演示文稿的测试内容。', 'utf8'),
    { jobId: 'presentation-assets-1234', now: new Date('2026-08-24T00:00:00.000Z') },
  )
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=', 'base64')
  const uploaded = await uploadPresentationAsset(cwd, job.jobId, 'machine.png', png, new Date('2026-08-24T01:00:00.000Z'))
  assert.equal(uploaded.assets.length, 1)
  assert.equal(uploaded.assets[0].width, 1)
  assert.equal(uploaded.assets[0].height, 1)
  assert.equal(uploaded.assets[0].mimeType, 'image/png')

  const duplicate = await uploadPresentationAsset(cwd, job.jobId, 'same-image.png', png)
  assert.equal(duplicate.assets.length, 1)
  const assetId = duplicate.assets[0].id
  const bound = await bindPresentationAsset(cwd, job.jobId, 'slide-02-main-visual', {
    assetId,
    fit: 'contain',
    focalPoint: { x: 2, y: -1 },
  })
  assert.deepEqual(bound.bindings[0], {
    slotId: 'slide-02-main-visual',
    assetId,
    fit: 'contain',
    focalPoint: { x: 1, y: 0 },
    updatedAt: bound.bindings[0].updatedAt,
  })
  const stored = await readPresentationAsset(cwd, job.jobId, assetId)
  assert.deepEqual(stored.body, png)
  await assert.rejects(() => deletePresentationAsset(cwd, job.jobId, assetId), /仍被幻灯片使用/)

  await bindPresentationAsset(cwd, job.jobId, 'slide-02-main-visual', { assetId: null })
  const removed = await deletePresentationAsset(cwd, job.jobId, assetId)
  assert.equal(removed.assets.length, 0)
  assert.equal((await readPresentationAssets(cwd, job.jobId)).bindings.length, 0)
  await assert.rejects(() => uploadPresentationAsset(cwd, job.jobId, 'fake.png', Buffer.from('not an image')), /仅支持/)
  await assert.rejects(() => bindPresentationAsset(cwd, job.jobId, '../escape', { assetId: null }), /槽位 ID 无效/)
})

test('presentation workspace paths and manifests reject unsafe project access', () => {
  assert.equal(normalizePresentationProjectPath('src/presentation/deck.json'), 'src/presentation/deck.json')
  assert.equal(normalizePresentationProjectPath('../secret.txt'), null)
  assert.equal(normalizePresentationProjectPath('D:\\secret.txt'), null)
  assert.equal(normalizePresentationProjectPath('/etc/passwd'), null)
  assert.equal(normalizePresentationProjectManifest({
    name: 'Deck',
    sourceRoot: 'src/presentation',
    deck: 'src/presentation/deck.json',
    theme: 'src/presentation/theme.css',
    assets: 'public/pagecraft-assets',
    publicAssetBase: '/pagecraft-assets',
    editableFiles: ['src/presentation/deck.json', 'src/presentation/theme.css', '../secret.txt'],
  })?.editableFiles.length, 2)
  assert.equal(normalizePresentationProjectManifest({
    name: 'Deck',
    sourceRoot: 'src/presentation',
    deck: 'deck.json',
    theme: 'src/presentation/theme.css',
    assets: 'public/pagecraft-assets',
    publicAssetBase: '/pagecraft-assets',
    editableFiles: ['deck.json', 'src/presentation/theme.css'],
  }), null)
})

test('presentation source workspace saves with conflicts, history, and restricted file operations', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'pagecraft-workspace-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await createPresentationWorkspace(cwd)

  const summary = await readPresentationWorkspaceSummary(cwd)
  assert.equal(summary.available, true)
  assert.equal(summary.manifest?.deck, 'src/presentation/deck.json')
  const tree = await readPresentationWorkspaceTree(cwd)
  assert.equal(tree[0].path, 'pagecraft-presentation.json')
  assert.equal(tree[1].path, 'src/presentation')
  assert.equal(tree[2].path, 'public/pagecraft-assets')

  const original = await readPresentationSourceFile(cwd, 'src/presentation/deck.json')
  const nextContent = original.content.replace('核心模块', '持久化源码模块')
  const saved = await savePresentationSourceFile(cwd, original.path, nextContent, original.hash)
  assert.match(saved.content, /持久化源码模块/)
  await assert.rejects(
    () => savePresentationSourceFile(cwd, original.path, original.content, original.hash),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'PRESENTATION_FILE_CONFLICT',
  )
  const history = await readPresentationFileHistory(cwd, original.path)
  assert.equal(history.length, 1)
  assert.equal(history[0].hash, original.hash)

  await createPresentationEntry(cwd, { path: 'src/presentation/notes.md', kind: 'file', content: '# Notes\n' })
  assert.equal((await readPresentationSourceFile(cwd, 'src/presentation/notes.md')).content, '# Notes\n')
  await renamePresentationEntry(cwd, 'src/presentation/notes.md', 'src/presentation/speaker-notes.md')
  assert.equal((await readPresentationSourceFile(cwd, 'src/presentation/speaker-notes.md')).content, '# Notes\n')
  await deletePresentationEntry(cwd, 'src/presentation/speaker-notes.md')
  await assert.rejects(() => readPresentationSourceFile(cwd, 'src/presentation/speaker-notes.md'), /可编辑清单/)
  await assert.rejects(() => deletePresentationEntry(cwd, 'src/presentation/deck.json'), /受保护文件/)
  const withDirectory = await createPresentationEntry(cwd, { path: 'src/presentation/sections', kind: 'directory' })
  const sourceRoot = withDirectory.find(entry => entry.path === 'src/presentation')
  assert.equal(sourceRoot?.children?.some(entry => entry.path === 'src/presentation/sections' && entry.kind === 'directory'), true)
  await createPresentationEntry(cwd, { path: 'src/presentation/sections/intro.md', kind: 'file', content: '# Intro\n' })
  await assert.rejects(
    () => renamePresentationEntry(cwd, 'src/presentation/sections/intro.md', 'src/presentation/sections/intro.png'),
    /支持的文本类型/,
  )
  await assert.rejects(
    () => renamePresentationEntry(cwd, 'src/presentation/sections/intro.md', 'src/presentation/deck.json'),
    /已经存在/,
  )
  await assert.rejects(
    () => createPresentationEntry(cwd, { path: 'src/escape.ts', kind: 'file', content: '' }),
    /只能在演示文稿源码目录/,
  )
})

test('project image binding writes deck.json and protects referenced files', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'pagecraft-project-assets-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await createPresentationWorkspace(cwd)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=', 'base64')

  const uploaded = await uploadPresentationProjectAsset(cwd, 'machine.png', png)
  assert.equal(uploaded.assets.length, 1)
  assert.equal(uploaded.assets[0].publicUrl.startsWith('/pagecraft-assets/'), true)
  const deck = await readPresentationSourceFile(cwd, 'src/presentation/deck.json')
  const bound = await bindPresentationProjectAsset(cwd, {
    imageKey: 'slide-02.visual',
    assetPath: uploaded.assets[0].path,
    alt: '五轴机床主视图',
    fit: 'contain',
    focalPoint: { x: 0.25, y: 0.75 },
    baseHash: deck.hash,
  })
  const document = JSON.parse(bound.file.content)
  assert.deepEqual(document.slides[1].visual, {
    type: 'image',
    src: uploaded.assets[0].publicUrl,
    alt: '五轴机床主视图',
    fit: 'contain',
    position: '25% 75%',
  })
  assert.deepEqual(bound.assets[0].references, ['slide-02'])
  await assert.rejects(() => deletePresentationProjectAsset(cwd, uploaded.assets[0].path), /仍被幻灯片使用/)
  await assert.rejects(() => bindPresentationProjectAsset(cwd, {
    imageKey: '../escape.visual',
    assetPath: uploaded.assets[0].path,
    baseHash: bound.file.hash,
  }), /图片编辑键无效/)
})

test('legacy deck migration only accepts one unambiguous presentation source', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'pagecraft-migration-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await mkdir(join(cwd, 'legacy', 'slides'), { recursive: true })
  await writeFile(join(cwd, 'legacy', 'slides', 'deck.json'), `${JSON.stringify({
    title: 'Legacy deck',
    slides: [
      { id: 'slide-01', title: 'One' },
      { id: 'slide-02', title: 'Two' },
      { id: 'slide-03', title: 'Three' },
    ],
  })}\n`)
  await writeFile(join(cwd, 'legacy', 'slides', 'render.tsx'), 'export const deck = true\n')

  const migrated = await migratePresentationWorkspace(cwd)
  assert.equal(migrated.available, true)
  assert.equal(migrated.manifest?.sourceRoot, 'legacy/slides')
  assert.equal(migrated.manifest?.deck, 'legacy/slides/deck.json')
  assert.equal(migrated.manifest?.theme, 'legacy/slides/theme.css')
  assert.equal((await readPresentationWorkspaceSummary(cwd)).available, true)

  const ambiguousCwd = await mkdtemp(join(tmpdir(), 'pagecraft-migration-ambiguous-'))
  t.after(() => rm(ambiguousCwd, { recursive: true, force: true }))
  for (const directory of ['deck-a', 'deck-b']) {
    await mkdir(join(ambiguousCwd, directory), { recursive: true })
    await writeFile(join(ambiguousCwd, directory, 'deck.json'), JSON.stringify({ slides: [
      { id: 'slide-01' }, { id: 'slide-02' }, { id: 'slide-03' },
    ] }))
  }
  await assert.rejects(() => migratePresentationWorkspace(ambiguousCwd), /找到多个可能/)
})

test('source workspace follows the exact PageCraft document task directory', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'pagecraft-task-workspace-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const job = await createPresentationSource(
    cwd,
    'brief.md',
    Buffer.from('# Brief\n\nEnough source text for a generated presentation.', 'utf8'),
    { jobId: 'presentation-source-sync-1234' },
  )
  await writeFile(join(cwd, job.source.deckPath), JSON.stringify({
    title: 'Task deck',
    slides: [
      { id: 'slide-01', title: 'One' },
      { id: 'slide-02', title: 'Two' },
      { id: 'slide-03', title: 'Three' },
    ],
  }))

  const migrated = await migratePresentationWorkspace(cwd, job.jobId)
  assert.equal(migrated.available, true)
  assert.equal(migrated.workspacePath, cwd)
  assert.equal(migrated.manifest?.sourceRoot, `.pagecraft/presentations/${job.jobId}`)
  assert.equal(migrated.manifest?.deck, job.source.deckPath.replaceAll('\\', '/'))
  const tree = await readPresentationWorkspaceTree(cwd)
  const sourceRoot = tree.find(entry => entry.path === migrated.manifest?.sourceRoot)
  assert.equal(sourceRoot?.children?.some(entry => entry.name === 'source.md'), true)
  assert.equal(sourceRoot?.children?.some(entry => entry.name === 'deck.json'), true)
})

test('presentation annotations identify the owning slide and use the presentation skill', () => {
  const element = {
    kind: 'element' as const,
    url: 'http://localhost:5173/deck',
    tagName: 'h2',
    selector: '[data-pagecraft-slide-id="slide-02"] h2',
    domPath: 'html > body > section > h2',
    text: '问题背景',
    rect: { x: 80, y: 64, width: 420, height: 72 },
    presentation: { slideId: 'slide-02', slideTitle: '问题背景', slideIndex: 1 },
    comment: '标题更短，并增加上方留白',
  }
  assert.equal(isElementSelection(element), true)
  const prompt = buildAnnotationPrompt([element], { mode: 'presentation' })
  assert.match(prompt, /^\[presentation-feedback\]/)
  assert.match(prompt, /presentation-builder Skill/)
  assert.doesNotMatch(prompt, /frontend-page-builder Skill/)
  const payload = JSON.parse(prompt.slice(prompt.indexOf('{')))
  assert.deepEqual(payload.annotations[0].slide, {
    id: 'slide-02',
    title: '问题背景',
    index: 1,
  })
  assert.equal(payload.annotations[0].request, '标题更短，并增加上方留白')
})

test('area annotations provide container-relative geometry and affected DOM without model-side arithmetic', () => {
  const area = {
    kind: 'area' as const,
    url: 'http://localhost:5173/dashboard',
    coordinateSpace: 'viewport' as const,
    rawRect: { x: 297, y: 161, width: 246, height: 178 },
    rect: { x: 296, y: 160, width: 248, height: 176 },
    viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 400, devicePixelRatio: 1.25 },
    alignment: {
      threshold: 8,
      guides: [{
        axis: 'x' as const,
        coordinate: 296,
        anchor: 'left edge',
        source: 'dom' as const,
        sourceSelector: '.stats-grid > article',
        distance: 1,
      }],
    },
    container: {
      tagName: 'section',
      selector: '.stats-grid',
      html: '<section class="stats-grid"><article class="stat-card">...</article></section>',
      relation: 'container' as const,
      rect: { x: 64, y: 120, width: 1152, height: 480 },
      distance: 0,
    },
    nearby: [{
      tagName: 'article',
      selector: '.stats-grid > article',
      html: '<article class="stat-card">当前卡片</article>',
      relation: 'intersects' as const,
      rect: { x: 64, y: 160, width: 216, height: 176 },
      distance: 16,
    }],
    comment: '新增一个趋势卡片，与左侧统计卡片顶边对齐',
    operation: 'insert' as const,
  }

  assert.equal(isAreaSelection(area), true)
  assert.equal(isFeedbackSelection(area), true)
  const legacyArea = {
    ...area,
    container: { ...area.container, html: undefined },
    nearby: area.nearby.map(reference => ({ ...reference, html: undefined })),
  }
  assert.equal(isAreaSelection(legacyArea), true)
  const legacyPrompt = buildAnnotationPrompt([legacyArea])
  const legacyPayload = JSON.parse(legacyPrompt.slice(legacyPrompt.indexOf('{')))
  assert.equal(legacyPayload.annotations[0].target.container.selector, '.stats-grid')
  assert.equal(legacyPayload.annotations[0].target.container.html, undefined)
  assert.equal(legacyPayload.annotations[0].target.affectedDom[0].selector, '.stats-grid > article')
  assert.equal(isAreaSelection({
    ...area,
    alignment: { ...area.alignment, guides: Array.from({ length: 9 }, () => area.alignment.guides[0]) },
  }), false)
  const prompt = buildAnnotationPrompt([area])
  const payload = JSON.parse(prompt.slice(prompt.indexOf('{')))
  const annotation = payload.annotations[0]
  assert.equal(annotation.operation, 'insert')
  assert.equal(annotation.layoutBehavior, 'push-following-content')
  assert.deepEqual(annotation.target.container, {
    selector: '.stats-grid',
    html: '<section class="stats-grid"><article class="stat-card">...</article></section>',
  })
  assert.deepEqual(annotation.target.position, {
    coordinateOrigin: 'container-top-left',
    x: 232,
    y: 40,
    width: 248,
    height: 176,
    corners: {
      topLeft: [232, 40],
      topRight: [480, 40],
      bottomRight: [480, 216],
      bottomLeft: [232, 216],
    },
  })
  assert.deepEqual(annotation.target.affectedDom, [{
    selector: '.stats-grid > article',
    html: '<article class="stat-card">当前卡片</article>',
    relation: 'intersects',
  }])
  assert.doesNotMatch(prompt, /rawRect|viewport|scrollX|pageRect|schemaVersion/)
})

test('DOM text evidence validates bounded source-resolution context', () => {
  assert.equal(isDomTextSelection({
    pageUrl: 'http://localhost:5173/slides/1',
    framePath: [],
    selector: '[data-pagecraft-text-key="slide-01.title"]',
    fingerprint: 'text-key|slide-01.title',
    displayedText: '旧标题',
    tagName: 'h1',
    attributes: { 'data-pagecraft-text-key': 'slide-01.title' },
    nearbyText: ['副标题'],
    slideId: 'slide-01',
    textKey: 'slide-01.title',
  }), true)
  assert.equal(isDomTextSelection({ displayedText: 'x' }), false)
})

test('client exposes one launcher and no duplicate conversation view', async () => {
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(bundle, /conversation\.input\.left/)
  assert.match(bundle, /AREA_OPERATIONS/)
  assert.match(bundle, /aria-pressed/)
  assert.match(bundle, /push-following-content/)
  assert.match(bundle, /useSyncExternalStore/)
  assert.match(bundle, /sessionActivity/)
  assert.match(bundle, /refreshPreview/)
  assert.match(bundle, /dsh-frontend-feedback\.draft:/)
  assert.match(bundle, /dsh-frontend-feedback-restore-area/)
  assert.match(bundle, /clearDraftButton/)
  assert.match(bundle, /buildPresentationOutlinePrompt/)
  assert.match(bundle, /buildPresentationDocumentPrompt/)
  assert.match(bundle, /presentation\/source/)
  assert.match(bundle, /presentation\/plan/)
  assert.match(bundle, /dsh-pagecraft\.presentation-job:/)
  assert.match(bundle, /PresentationDocumentDialog/)
  assert.match(bundle, /uploadAndPlan/)
  assert.match(bundle, /AbortController/)
  assert.match(bundle, /cancelSourceProcessing/)
  assert.match(bundle, /removeSelectedFile/)
  assert.match(bundle, /saveAndGenerate/)
  assert.match(bundle, /generationSubmissionRef/)
  assert.match(bundle, /isPresentationRequestSettled/)
  assert.match(bundle, /dsh-frontend-feedback-request-deck-state/)
  assert.match(bundle, /AssetLibraryDialog/)
  assert.match(bundle, /dsh-pagecraft-image-slot-selected/)
  assert.match(bundle, /dsh-pagecraft-asset-bindings/)
  assert.match(bundle, /presentation\/asset-binding/)
  assert.match(bundle, /presentationWorkspace/)
  assert.match(bundle, /WorkspaceExplorer/)
  assert.match(bundle, /ProjectAssetLibraryDialog/)
  assert.match(bundle, /workspace\/text-edit/)
  assert.match(bundle, /workspace\/text-verify/)
  assert.match(bundle, /startDirectTextEdit/)
  assert.match(bundle, /dsh-pagecraft-convert-text-selection/)
  assert.doesNotMatch(bundle, /saveSelectedText/)
  assert.match(bundle, /WORKSPACE_FILE_CONFLICT/)
  assert.doesNotMatch(bundle, /conversation\.view/)
  assert.equal(bundle.match(/ctx\.slots\.inject/g)?.length, 1)
})

test('preview runtime exposes the DOM text-selection verification protocol', async () => {
  const bundle = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(bundle, /dsh-pagecraft-text-selected/)
  assert.match(bundle, /dsh-pagecraft-verify-text/)
  assert.match(bundle, /dsh-pagecraft-text-verification/)
  assert.match(bundle, /dsh-pagecraft-convert-text-selection/)
})

test('response reader enforces the configured byte limit', async () => {
  const response = new Response('123456', { headers: { 'content-type': 'text/html' } })
  await assert.rejects(() => readHtmlWithLimit(response, 5), /预览上限/)
  await assert.rejects(() => readBodyWithLimit(new Response('123456'), 5), /资源超过/)
  assert.deepEqual(Array.from(await readBodyWithLimit(new Response('abc'), 5)), [97, 98, 99])
})

test('plugin registers the host route and both builder skills', () => {
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
    sessions: {
      get() { return { header: { cwd: 'D:\\workspace' } } },
    },
    effect(register: () => () => void) { register() },
  }
  apply(ctx)
  assert.equal(registrations.length, 28)
  assert.deepEqual(registrations.map((route: any) => route.path), [
    '/api/frontend-feedback/preview',
    '/api/frontend-feedback/resource',
    '/api/frontend-feedback/workspace',
    '/api/frontend-feedback/workspace/folders',
    '/api/frontend-feedback/workspace/directory',
    '/api/frontend-feedback/workspace/file',
    '/api/frontend-feedback/workspace/blob',
    '/api/frontend-feedback/workspace/entry',
    '/api/frontend-feedback/workspace/history',
    '/api/frontend-feedback/workspace/restore',
    '/api/frontend-feedback/workspace/events',
    '/api/frontend-feedback/workspace/text-edit',
    '/api/frontend-feedback/workspace/text-verify',
    '/api/frontend-feedback/presentation/source',
    '/api/frontend-feedback/presentation/job',
    '/api/frontend-feedback/presentation/plan',
    '/api/frontend-feedback/presentation/assets',
    '/api/frontend-feedback/presentation/asset',
    '/api/frontend-feedback/presentation/asset-binding',
    '/api/frontend-feedback/presentation-workspace',
    '/api/frontend-feedback/presentation-workspace/tree',
    '/api/frontend-feedback/presentation-workspace/file',
    '/api/frontend-feedback/presentation-workspace/entry',
    '/api/frontend-feedback/presentation-workspace/history',
    '/api/frontend-feedback/presentation-workspace/restore',
    '/api/frontend-feedback/presentation-workspace/asset',
    '/api/frontend-feedback/presentation-workspace/bind-asset',
    '/api/frontend-feedback/presentation-workspace/migrate',
  ])
  assert.equal(skills.length, 2)
  assert.equal(skills[0]?.name, 'frontend-page-builder')
  assert.match(skills[0]?.content, /## Initial build/)
  assert.doesNotMatch(skills[0]?.content, /^---/)
  assert.equal(skills[1]?.name, 'presentation-builder')
  assert.match(skills[1]?.content, /## Create a deck/)
  assert.match(skills[1]?.content, /data-pagecraft-slide-id/)
  assert.match(skills[1]?.content, /colorMode/)
  assert.match(skills[1]?.content, /near-black/)
  assert.match(skills[1]?.content, /## Plan from a document/)
  assert.match(skills[1]?.content, /## Build from an approved outline/)
  assert.match(skills[1]?.content, /sourceRefs/)
  assert.match(skills[1]?.content, /data-pagecraft-image-slot/)
  assert.match(skills[1]?.content, /pagecraft-presentation\.json/)
  assert.match(skills[1]?.content, /data-pagecraft-text-key/)
  assert.match(skills[1]?.content, /data-pagecraft-image-key/)
  assert.doesNotMatch(skills[1]?.content, /^---/)
})
