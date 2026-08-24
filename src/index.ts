import type { IncomingMessage, ServerResponse } from 'node:http'
import skillMarkdown from '../skills/frontend-page-builder/SKILL.md'
import presentationSkillMarkdown from '../skills/presentation-builder/SKILL.md'
import {
  PREVIEW_RESOURCE_PATH,
  PreviewRedirectError,
  assertPreviewUrl,
  buildPreviewHtml,
  escapeHtml,
  fetchPreviewTarget,
  readBodyWithLimit,
  readHtmlWithLimit,
} from './preview.ts'

export const name = 'frontend-feedback'
export const inject = ['webServer', 'skills']

export interface Config {
  allowRemoteHosts?: boolean
  allowedHosts?: string[]
  maxHtmlBytes?: number
  maxResourceBytes?: number
  requestTimeoutMs?: number
}

interface PluginContext {
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
    }): () => void
  }
  skills: {
    register(skill: {
      name: string
      description: string
      source: string
      resourceBase: { kind: 'opaque'; description: string }
      content: string
    }): () => void
  }
  effect(register: () => (() => void), label: string): void
}

const DEFAULT_MAX_HTML_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_RESOURCE_BYTES = 20 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15_000
const SKILL_DESCRIPTION = 'Build or redesign polished frontend pages and components, then refine them from [frontend-feedback] DOM or area annotations. Use for initial UI implementation, visual/layout work, responsive behavior, accessibility, selector-specific iteration, or adding content inside a user-drawn region.'
const PRESENTATION_SKILL_DESCRIPTION = 'Create and refine browser-based HTML/React presentations from [presentation-create] briefs and [presentation-feedback] slide annotations, using coherent story structure, reusable layouts, stable PageCraft slide IDs, themes, and visual verification.'

function markdownBody(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function buildPreviewErrorHtml(status: number, message: string): string {
  const safeMessage = escapeHtml(message)
  const payload = JSON.stringify({
    type: 'dsh-frontend-feedback-error',
    status,
    message,
  }).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>预览加载失败</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f8f7; color: #17231b; }
    main { width: min(560px, calc(100% - 48px)); padding: 28px; border: 1px solid #cbd8cf; border-radius: 14px; background: white; box-shadow: 0 18px 50px rgba(30, 60, 40, .12); }
    strong { display: block; color: #a33a3a; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 10px 0 12px; font-size: 22px; }
    p { margin: 0; color: #536259; line-height: 1.65; word-break: break-word; }
    code { display: inline-block; margin-top: 16px; padding: 5px 8px; border-radius: 6px; background: #edf2ee; color: #405047; }
  </style>
</head>
<body>
  <main><strong>HTTP ${status}</strong><h1>预览加载失败</h1><p>${safeMessage}</p><code>frontend-feedback</code></main>
  <script>window.parent.postMessage(${payload}, '*')</script>
</body>
</html>`
}

function sendPreviewError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(buildPreviewErrorHtml(status, message))
}

async function handlePreview(req: IncomingMessage, res: ServerResponse, config: Config): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET')
    sendPreviewError(res, 405, '只支持 GET')
    return
  }

  const requestUrl = new URL(req.url ?? '/', 'http://localhost')
  const rawTarget = requestUrl.searchParams.get('url')
  if (rawTarget === null || rawTarget.trim().length === 0) {
    sendPreviewError(res, 400, '缺少 url 查询参数')
    return
  }

  const policy = {
    allowRemoteHosts: config.allowRemoteHosts,
    allowedHosts: config.allowedHosts,
  }
  let target: URL
  try {
    target = assertPreviewUrl(rawTarget, policy)
  } catch (error) {
    sendPreviewError(res, 400, describeError(error))
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const { response: upstream, target: finalTarget } = await fetchPreviewTarget(target, policy, controller.signal)
    if (!upstream.ok) {
      sendPreviewError(res, 502, `目标页面返回 HTTP ${upstream.status}`)
      return
    }
    const contentType = upstream.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      sendPreviewError(res, 415, `目标内容不是 HTML（${contentType || '未知类型'}）`)
      return
    }
    const html = await readHtmlWithLimit(upstream, config.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES)
    const output = buildPreviewHtml(html, finalTarget.href)
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    })
    res.end(output)
  } catch (error) {
    if (error instanceof PreviewRedirectError) {
      sendPreviewError(res, 400, error.message)
      return
    }
    const message = error instanceof Error && error.name === 'AbortError'
      ? '获取目标页面超时'
      : `无法获取目标页面：${describeError(error)}`
    sendPreviewError(res, 502, message)
  } finally {
    clearTimeout(timeout)
  }
}

function sendResourceError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(message)
}

async function handlePreviewResource(req: IncomingMessage, res: ServerResponse, config: Config): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET')
    sendResourceError(res, 405, '只支持 GET')
    return
  }

  const requestUrl = new URL(req.url ?? '/', 'http://localhost')
  const rawTarget = requestUrl.searchParams.get('url')
  if (rawTarget === null || rawTarget.trim().length === 0) {
    sendResourceError(res, 400, '缺少 url 查询参数')
    return
  }

  const policy = {
    allowRemoteHosts: config.allowRemoteHosts,
    allowedHosts: config.allowedHosts,
  }
  let target: URL
  try {
    target = assertPreviewUrl(rawTarget, policy)
  } catch (error) {
    sendResourceError(res, 400, describeError(error))
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const requestAccept = Array.isArray(req.headers.accept)
      ? req.headers.accept.join(',')
      : req.headers.accept ?? '*/*'
    const { response: upstream } = await fetchPreviewTarget(
      target,
      policy,
      controller.signal,
      fetch,
      requestAccept,
    )
    if (!upstream.ok) {
      sendResourceError(res, upstream.status, `目标资源返回 HTTP ${upstream.status}`)
      return
    }
    const body = await readBodyWithLimit(upstream, config.maxResourceBytes ?? DEFAULT_MAX_RESOURCE_BYTES)
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'cross-origin',
    })
    res.end(body)
  } catch (error) {
    if (error instanceof PreviewRedirectError) {
      sendResourceError(res, 400, error.message)
      return
    }
    const message = error instanceof Error && error.name === 'AbortError'
      ? '获取目标资源超时'
      : `无法获取目标资源：${describeError(error)}`
    sendResourceError(res, 502, message)
  } finally {
    clearTimeout(timeout)
  }
}

export function apply(ctx: PluginContext, config: Config = {}): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/frontend-feedback/preview',
    handler: (req, res) => handlePreview(req, res, config),
  }), 'frontend-feedback: preview route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PREVIEW_RESOURCE_PATH,
    handler: (req, res) => handlePreviewResource(req, res, config),
  }), 'frontend-feedback: preview resource route')

  ctx.skills.register({
    name: 'frontend-page-builder',
    description: SKILL_DESCRIPTION,
    source: 'bundled',
    resourceBase: {
      kind: 'opaque',
      description: 'The skill is bundled into dsh-frontend-feedback and is self-contained.',
    },
    content: markdownBody(skillMarkdown),
  })

  ctx.skills.register({
    name: 'presentation-builder',
    description: PRESENTATION_SKILL_DESCRIPTION,
    source: 'bundled',
    resourceBase: {
      kind: 'opaque',
      description: 'The skill is bundled into dsh-frontend-feedback and is self-contained.',
    },
    content: markdownBody(presentationSkillMarkdown),
  })
}

export {
  MAX_PREVIEW_REDIRECTS,
  PREVIEW_RESOURCE_PATH,
  PreviewRedirectError,
  assertPreviewUrl,
  buildPreviewHtml,
  buildPreviewRuntimeScript,
  fetchPreviewTarget,
  readBodyWithLimit,
  readHtmlWithLimit,
} from './preview.ts'
export {
  DEFAULT_PREVIEW_URL,
  MAX_PREVIEW_HISTORY_ENTRIES,
  MAX_PERSISTED_FEEDBACK_COMMENTS,
  buildAnnotationPrompt,
  currentPreviewUrl,
  emptyFeedbackDraft,
  feedbackDraftStorageKey,
  isAreaSelection,
  isElementSelection,
  isFeedbackComment,
  isFeedbackDraftEmpty,
  isFeedbackSelection,
  movePreviewNavigation,
  normalizePreviewUrl,
  previewHistoryStorageKey,
  previewUrlStorageKey,
  pushPreviewNavigation,
  resolvePersistedFeedbackDraft,
  resolvePersistedPreviewNavigation,
  resolvePersistedPreviewUrl,
  resolvePreviewFrameLocation,
} from './shared.ts'
export {
  DEFAULT_PRESENTATION_BRIEF,
  buildPresentationCreationPrompt,
  isPresentationSlideSummary,
  resolvePresentationSlides,
} from './presentation.ts'
