import type { IncomingMessage, ServerResponse } from 'node:http'
import skillMarkdown from '../skills/frontend-page-builder/SKILL.md'
import presentationSkillMarkdown from '../skills/presentation-builder/SKILL.md'
import {
  DEFAULT_MAX_PRESENTATION_ASSET_BYTES,
  bindPresentationAsset,
  deletePresentationAsset,
  readPresentationAsset,
  readPresentationAssets,
  uploadPresentationAsset,
} from './assets.ts'
import {
  DEFAULT_MAX_DOCUMENT_BYTES,
  DEFAULT_MAX_EXTRACTED_TEXT_CHARACTERS,
  PresentationDocumentError,
  createPresentationSource,
  parsePlanRequestBody,
  readPresentationJob,
  readRequestBodyWithLimit,
  resolvePresentationJobDirectory,
  savePresentationPlan,
} from './document.ts'
import {
  PRESENTATION_ASSETS_PATH,
  PRESENTATION_ASSET_BINDING_PATH,
  PRESENTATION_ASSET_PATH,
  PRESENTATION_JOB_PATH,
  PRESENTATION_PLAN_PATH,
  PRESENTATION_SOURCE_PATH,
} from './presentation.ts'
import {
  PRESENTATION_WORKSPACE_ASSET_PATH,
  PRESENTATION_WORKSPACE_BIND_ASSET_PATH,
  PRESENTATION_WORKSPACE_ENTRY_PATH,
  PRESENTATION_WORKSPACE_FILE_PATH,
  PRESENTATION_WORKSPACE_HISTORY_PATH,
  PRESENTATION_WORKSPACE_MIGRATE_PATH,
  PRESENTATION_WORKSPACE_PATH,
  PRESENTATION_WORKSPACE_RESTORE_PATH,
  PRESENTATION_WORKSPACE_TREE_PATH,
} from './presentation-workspace.ts'
import {
  PAGECRAFT_WORKSPACE_BLOB_PATH,
  PAGECRAFT_WORKSPACE_DIRECTORY_PATH,
  PAGECRAFT_WORKSPACE_ENTRY_PATH,
  PAGECRAFT_WORKSPACE_EVENTS_PATH,
  PAGECRAFT_WORKSPACE_FILE_PATH,
  PAGECRAFT_WORKSPACE_FOLDERS_PATH,
  PAGECRAFT_WORKSPACE_HISTORY_PATH,
  PAGECRAFT_WORKSPACE_PATH,
  PAGECRAFT_WORKSPACE_RESTORE_PATH,
  PAGECRAFT_WORKSPACE_TEXT_EDIT_PATH,
  PAGECRAFT_WORKSPACE_TEXT_VERIFY_PATH,
} from './workspace.ts'
import { DirectTextEditService } from './direct-text-edit.ts'
import { SourceTextResolverError } from './source-text-resolver.ts'
import { isDomTextSelection } from './shared.ts'
import {
  DEFAULT_MAX_WORKSPACE_TEXT_BYTES,
  WorkspaceExplorerError,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  listWorkspaceDirectory,
  listWorkspaceFolders,
  readWorkspaceBlob,
  readWorkspaceFile,
  readWorkspaceHistory,
  readWorkspaceSummary,
  renameWorkspaceEntry,
  resolveWorkspaceTarget,
  restoreWorkspaceHistory,
  saveWorkspaceFile,
  uploadWorkspaceImage,
} from './workspace-explorer.ts'
import { WorkspaceWatchHub } from './workspace-watcher.ts'
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
import {
  DEFAULT_MAX_PRESENTATION_SOURCE_BYTES,
  PresentationWorkspaceError,
  bindPresentationProjectAsset,
  createPresentationEntry,
  deletePresentationEntry,
  deletePresentationProjectAsset,
  listPresentationProjectAssets,
  migratePresentationWorkspace,
  readPresentationFileHistory,
  readPresentationProjectAsset,
  readPresentationSourceFile,
  readPresentationWorkspaceSummary,
  readPresentationWorkspaceTree,
  renamePresentationEntry,
  restorePresentationFileHistory,
  savePresentationSourceFile,
  uploadPresentationProjectAsset,
} from './source-workspace.ts'

export const name = 'frontend-feedback'
export const inject = ['webServer', 'skills', 'sessions']

export interface Config {
  allowRemoteHosts?: boolean
  allowedHosts?: string[]
  maxHtmlBytes?: number
  maxResourceBytes?: number
  maxDocumentBytes?: number
  maxPresentationAssetBytes?: number
  maxPresentationSourceBytes?: number
  maxWorkspaceTextBytes?: number
  maxExtractedTextCharacters?: number
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
  sessions: {
    get(sessionId: string): { header: { cwd?: string } } | undefined
  }
  effect(register: () => (() => void), label: string): void
}

interface PresentationRequestContext {
  requestUrl: URL
  cwd: string
}

const DEFAULT_MAX_HTML_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_RESOURCE_BYTES = 20 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15_000
const SKILL_DESCRIPTION = 'Build or redesign polished frontend pages and components, then refine them from [frontend-feedback] DOM or area annotations. Use for initial UI implementation, visual/layout work, responsive behavior, accessibility, selector-specific iteration, or adding content inside a user-drawn region.'
const PRESENTATION_SKILL_DESCRIPTION = 'Plan, create, and refine browser-based HTML/React presentations from [presentation-outline] document sources, [presentation-create-from-document] approved plans, [presentation-create] briefs, and [presentation-feedback] annotations, using source-grounded story structure, progressive status, reusable layouts, stable PageCraft slide IDs, themes, and visual verification.'

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

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(`${JSON.stringify(value)}\n`)
}

interface RequestCancellation {
  signal: AbortSignal
  dispose(): void
}

function trackRequestCancellation(req: IncomingMessage, res: ServerResponse): RequestCancellation {
  const controller = new AbortController()

  function abortRequest(): void {
    controller.abort()
  }

  function abortClosedResponse(): void {
    if (!res.writableEnded) abortRequest()
  }

  req.once('aborted', abortRequest)
  res.once('close', abortClosedResponse)
  return {
    signal: controller.signal,
    dispose() {
      req.off('aborted', abortRequest)
      res.off('close', abortClosedResponse)
    },
  }
}

function sendPresentationError(res: ServerResponse, error: unknown): void {
  if (error instanceof SourceTextResolverError) {
    sendJson(res, error.status, { error: { code: error.code, message: error.message, details: error.details } })
    return
  }
  if (error instanceof WorkspaceExplorerError) {
    sendJson(res, error.status, { error: { code: error.code, message: error.message, details: error.details } })
    return
  }
  if (error instanceof PresentationWorkspaceError) {
    sendJson(res, error.status, { error: { code: error.code, message: error.message, details: error.details } })
    return
  }
  if (error instanceof PresentationDocumentError) {
    sendJson(res, error.status, { error: { code: error.code, message: error.message } })
    return
  }
  sendJson(res, 500, { error: { code: 'PRESENTATION_INTERNAL_ERROR', message: describeError(error) } })
}

async function readJsonRequest(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse((await readRequestBodyWithLimit(req, maxBytes)).toString('utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('Expected an object')
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof PresentationDocumentError || error instanceof PresentationWorkspaceError) throw error
    throw new PresentationWorkspaceError('请求正文不是有效 JSON 对象', 400, 'INVALID_REQUEST_JSON', undefined, { cause: error })
  }
}

function rejectUnsupportedMethod(
  req: IncomingMessage,
  res: ServerResponse,
  allowedMethod: 'GET' | 'POST',
): boolean {
  if (req.method === allowedMethod) return false
  res.setHeader('allow', allowedMethod)
  sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: `只支持 ${allowedMethod}` } })
  return true
}

function rejectUnsupportedMethods(req: IncomingMessage, res: ServerResponse, allowedMethods: string[]): boolean {
  if (req.method !== undefined && allowedMethods.includes(req.method)) return false
  res.setHeader('allow', allowedMethods.join(', '))
  sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: `只支持 ${allowedMethods.join('、')}` } })
  return true
}

function presentationRequest(req: IncomingMessage, ctx: PluginContext): PresentationRequestContext {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost')
  const sessionId = requestUrl.searchParams.get('sessionId')?.trim() ?? ''
  if (sessionId.length === 0 || sessionId.length > 200) {
    throw new PresentationDocumentError('缺少有效的 sessionId', 400, 'SESSION_ID_REQUIRED')
  }
  const session = ctx.sessions.get(sessionId)
  if (session === undefined) throw new PresentationDocumentError('当前会话不存在或尚未连接', 404, 'SESSION_NOT_FOUND')
  const cwd = session.header.cwd
  if (cwd === undefined || cwd.trim().length === 0) {
    throw new PresentationDocumentError('当前会话没有工作目录，无法保存演示文稿资料', 409, 'SESSION_CWD_REQUIRED')
  }
  return { requestUrl, cwd }
}

function workspaceSelection(requestUrl: URL): string {
  return requestUrl.searchParams.get('selectedFolder')?.trim() || '.'
}

function workspaceTextOptions(config: Config): { maxTextBytes: number } {
  return { maxTextBytes: config.maxWorkspaceTextBytes ?? DEFAULT_MAX_WORKSPACE_TEXT_BYTES }
}

async function handleWorkspaceSummary(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PluginContext,
  watchers: WorkspaceWatchHub,
): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'GET')) return
  try {
    const { requestUrl, cwd } = presentationRequest(req, ctx)
    const summary = await readWorkspaceSummary(cwd, workspaceSelection(requestUrl))
    sendJson(res, 200, {
      ...summary,
      watcher: watchers.status(summary.selectedPath),
      sequence: watchers.currentSequence(summary.selectedPath),
    })
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handleWorkspaceFolders(req: IncomingMessage, res: ServerResponse, ctx: PluginContext): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'GET')) return
  try {
    const { requestUrl, cwd } = presentationRequest(req, ctx)
    sendJson(res, 200, await listWorkspaceFolders(cwd, requestUrl.searchParams.get('parent') ?? '.'))
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handleWorkspaceDirectory(req: IncomingMessage, res: ServerResponse, ctx: PluginContext): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'GET')) return
  try {
    const { requestUrl, cwd } = presentationRequest(req, ctx)
    const selectedFolder = workspaceSelection(requestUrl)
    sendJson(res, 200, await listWorkspaceDirectory(
      cwd,
      selectedFolder,
      requestUrl.searchParams.get('path') ?? selectedFolder,
    ))
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handleWorkspaceFile(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PluginContext,
  config: Config,
): Promise<void> {
  if (rejectUnsupportedMethods(req, res, ['GET', 'PUT'])) return
  try {
    const { requestUrl, cwd } = presentationRequest(req, ctx)
    const options = workspaceTextOptions(config)
    if (req.method === 'GET') {
      sendJson(res, 200, await readWorkspaceFile(
        cwd,
        workspaceSelection(requestUrl),
        requestUrl.searchParams.get('path'),
        options,
      ))
      return
    }
    const value = await readJsonRequest(req, options.maxTextBytes + 64 * 1024)
    sendJson(res, 200, await saveWorkspaceFile(
      cwd,
      value.selectedFolder,
      value.path,
      typeof value.content === 'string' ? value.content : '',
      typeof value.baseHash === 'string' ? value.baseHash : '',
      options,
    ))
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handleWorkspaceBlob(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PluginContext,
  config: Config,
): Promise<void> {
  if (rejectUnsupportedMethods(req, res, ['GET', 'POST'])) return
  const cancellation = trackRequestCancellation(req, res)
  try {
    const { requestUrl, cwd } = presentationRequest(req, ctx)
    if (req.method === 'POST') {
      const fileName = requestUrl.searchParams.get('filename')?.trim() ?? ''
      const parent = requestUrl.searchParams.get('parent')?.trim() || workspaceSelection(requestUrl)
      const body = await readRequestBodyWithLimit(
        req,
        config.maxPresentationAssetBytes ?? DEFAULT_MAX_PRESENTATION_ASSET_BYTES,
        cancellation.signal,
      )
      sendJson(res, 201, await uploadWorkspaceImage(cwd, workspaceSelection(requestUrl), parent, fileName, body))
      return
    }
    const { body, mimeType } = await readWorkspaceBlob(
      cwd,
      workspaceSelection(requestUrl),
      requestUrl.searchParams.get('path'),
    )
    res.writeHead(200, {
      'content-type': mimeType,
      'content-length': body.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
    })
    res.end(body)
  } catch (error) {
    sendPresentationError(res, error)
  } finally {
    cancellation.dispose()
  }
}

async function handleWorkspaceEntry(req: IncomingMessage, res: ServerResponse, ctx: PluginContext): Promise<void> {
  if (rejectUnsupportedMethods(req, res, ['POST', 'PATCH', 'DELETE'])) return
  try {
    const { cwd } = presentationRequest(req, ctx)
    const value = await readJsonRequest(req, 128 * 1024)
    if (req.method === 'POST') {
      sendJson(res, 201, await createWorkspaceEntry(cwd, value.selectedFolder, {
        parent: typeof value.parent === 'string' ? value.parent : '',
        name: typeof value.name === 'string' ? value.name : '',
        kind: value.kind === 'directory' ? 'directory' : 'file',
        content: typeof value.content === 'string' ? value.content : undefined,
      }))
      return
    }
    if (req.method === 'PATCH') {
      sendJson(res, 200, await renameWorkspaceEntry(cwd, value.selectedFolder, value.path, value.nextName))
      return
    }
    await deleteWorkspaceEntry(cwd, value.selectedFolder, value.path)
    sendJson(res, 200, { deleted: true })
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handleWorkspaceHistory(req: IncomingMessage, res: ServerResponse, ctx: PluginContext): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'GET')) return
  try {
    const { requestUrl, cwd } = presentationRequest(req, ctx)
    sendJson(res, 200, await readWorkspaceHistory(
      cwd,
      workspaceSelection(requestUrl),
      requestUrl.searchParams.get('path'),
    ))
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handleWorkspaceRestore(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PluginContext,
  config: Config,
): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'POST')) return
  try {
    const { cwd } = presentationRequest(req, ctx)
    const value = await readJsonRequest(req, 64 * 1024)
    sendJson(res, 200, await restoreWorkspaceHistory(
      cwd,
      value.selectedFolder,
      value.path,
      value.historyId,
      typeof value.baseHash === 'string' ? value.baseHash : '',
      workspaceTextOptions(config),
    ))
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handleWorkspaceEvents(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PluginContext,
  watchers: WorkspaceWatchHub,
): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'GET')) return
  try {
    const { requestUrl, cwd } = presentationRequest(req, ctx)
    const selectedFolder = workspaceSelection(requestUrl)
    const resolved = await resolveWorkspaceTarget(cwd, selectedFolder, selectedFolder, true)
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-content-type-options': 'nosniff',
    })
    res.write(`event: ready\ndata: ${JSON.stringify({ sequence: watchers.currentSequence(resolved.selectedRoot) })}\n\n`)
    const unsubscribe = watchers.subscribe(resolved.selectedRoot, event => {
      if (!res.writableEnded) res.write(`event: workspace\ndata: ${JSON.stringify(event)}\n\n`)
    })
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n')
    }, 20_000)
    res.once('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  } catch (error) {
    if (!res.headersSent) sendPresentationError(res, error)
    else res.end()
  }
}

async function handleWorkspaceTextEdit(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PluginContext,
  service: DirectTextEditService,
): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'POST')) return
  try {
    const { cwd } = presentationRequest(req, ctx)
    const value = await readJsonRequest(req, 128 * 1024)
    if (!isDomTextSelection(value.selection)) {
      throw new WorkspaceExplorerError('文字选择信息无效，请重新选择页面文字', 400, 'TEXT_SELECTION_INVALID')
    }
    if (typeof value.replacementText !== 'string') {
      throw new WorkspaceExplorerError('缺少要显示的新文字', 400, 'TEXT_REPLACEMENT_REQUIRED')
    }
    sendJson(res, 200, await service.start(
      cwd,
      typeof value.selectedFolder === 'string' ? value.selectedFolder : '.',
      value.selection,
      value.replacementText,
    ))
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handleWorkspaceTextVerify(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PluginContext,
  service: DirectTextEditService,
): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'POST')) return
  try {
    const { cwd } = presentationRequest(req, ctx)
    const value = await readJsonRequest(req, 64 * 1024)
    if (typeof value.transactionId !== 'string' || typeof value.verified !== 'boolean') {
      throw new WorkspaceExplorerError('页面验证结果无效', 400, 'TEXT_VERIFICATION_INVALID')
    }
    sendJson(res, 200, await service.verify(cwd, {
      transactionId: value.transactionId,
      verified: value.verified,
      ...(typeof value.observedText === 'string' ? { observedText: value.observedText } : {}),
    }))
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handlePresentationSource(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PluginContext,
  config: Config,
): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'POST')) return
  const cancellation = trackRequestCancellation(req, res)
  try {
    const { requestUrl, cwd } = presentationRequest(req, ctx)
    const fileName = requestUrl.searchParams.get('filename')?.trim() ?? ''
    if (fileName.length === 0) throw new PresentationDocumentError('缺少文件名', 400, 'FILE_NAME_REQUIRED')
    const body = await readRequestBodyWithLimit(
      req,
      config.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES,
      cancellation.signal,
    )
    const snapshot = await createPresentationSource(cwd, fileName, body, {
      maxTextCharacters: config.maxExtractedTextCharacters ?? DEFAULT_MAX_EXTRACTED_TEXT_CHARACTERS,
      signal: cancellation.signal,
    })
    sendJson(res, 201, snapshot)
  } catch (error) {
    sendPresentationError(res, error)
  } finally {
    cancellation.dispose()
  }
}

async function handlePresentationJob(req: IncomingMessage, res: ServerResponse, ctx: PluginContext): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'GET')) return
  try {
    const { requestUrl, cwd } = presentationRequest(req, ctx)
    const jobId = requestUrl.searchParams.get('jobId')?.trim() ?? ''
    const snapshot = await readPresentationJob(cwd, jobId)
    sendJson(res, 200, snapshot)
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handlePresentationPlan(req: IncomingMessage, res: ServerResponse, ctx: PluginContext): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'POST')) return
  try {
    const { requestUrl, cwd } = presentationRequest(req, ctx)
    const jobId = requestUrl.searchParams.get('jobId')?.trim() ?? ''
    const body = await readRequestBodyWithLimit(req, 1024 * 1024)
    const plan = parsePlanRequestBody(body)
    const snapshot = await savePresentationPlan(cwd, jobId, plan)
    sendJson(res, 200, snapshot)
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handlePresentationAssets(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PluginContext,
  config: Config,
): Promise<void> {
  if (rejectUnsupportedMethods(req, res, ['GET', 'POST'])) return
  const cancellation = trackRequestCancellation(req, res)
  try {
    const { requestUrl, cwd } = presentationRequest(req, ctx)
    const jobId = requestUrl.searchParams.get('jobId')?.trim() ?? ''
    if (req.method === 'GET') {
      sendJson(res, 200, await readPresentationAssets(cwd, jobId))
      return
    }
    const fileName = requestUrl.searchParams.get('filename')?.trim() ?? ''
    if (fileName.length === 0) throw new PresentationDocumentError('缺少图片文件名', 400, 'ASSET_NAME_REQUIRED')
    const body = await readRequestBodyWithLimit(
      req,
      config.maxPresentationAssetBytes ?? DEFAULT_MAX_PRESENTATION_ASSET_BYTES,
      cancellation.signal,
    )
    sendJson(res, 201, await uploadPresentationAsset(cwd, jobId, fileName, body))
  } catch (error) {
    sendPresentationError(res, error)
  } finally {
    cancellation.dispose()
  }
}

async function handlePresentationAsset(req: IncomingMessage, res: ServerResponse, ctx: PluginContext): Promise<void> {
  if (rejectUnsupportedMethods(req, res, ['GET', 'DELETE'])) return
  try {
    const { requestUrl, cwd } = presentationRequest(req, ctx)
    const jobId = requestUrl.searchParams.get('jobId')?.trim() ?? ''
    const assetId = requestUrl.searchParams.get('assetId')?.trim() ?? ''
    if (req.method === 'DELETE') {
      sendJson(res, 200, await deletePresentationAsset(cwd, jobId, assetId))
      return
    }
    const { asset, body } = await readPresentationAsset(cwd, jobId, assetId)
    res.writeHead(200, {
      'content-type': asset.mimeType,
      'content-length': body.length,
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'cross-origin',
    })
    res.end(body)
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handlePresentationAssetBinding(req: IncomingMessage, res: ServerResponse, ctx: PluginContext): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'POST')) return
  try {
    const { requestUrl, cwd } = presentationRequest(req, ctx)
    const jobId = requestUrl.searchParams.get('jobId')?.trim() ?? ''
    const parsed = JSON.parse((await readRequestBodyWithLimit(req, 64 * 1024)).toString('utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new PresentationDocumentError('图片绑定请求格式无效', 400, 'INVALID_BINDING_JSON')
    }
    const value = parsed as Record<string, unknown>
    const slotId = typeof value.slotId === 'string' ? value.slotId : ''
    const assetId = value.assetId === null ? null : typeof value.assetId === 'string' ? value.assetId : ''
    const focalPoint = value.focalPoint !== null && typeof value.focalPoint === 'object'
      ? value.focalPoint as { x?: number; y?: number }
      : undefined
    const manifest = await bindPresentationAsset(cwd, jobId, slotId, {
      assetId,
      fit: value.fit === 'contain' ? 'contain' : 'cover',
      focalPoint,
    })
    sendJson(res, 200, manifest)
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendPresentationError(res, new PresentationDocumentError('图片绑定请求不是有效 JSON', 400, 'INVALID_BINDING_JSON'))
      return
    }
    sendPresentationError(res, error)
  }
}

async function handlePresentationWorkspace(req: IncomingMessage, res: ServerResponse, ctx: PluginContext): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'GET')) return
  try {
    const { cwd } = presentationRequest(req, ctx)
    sendJson(res, 200, await readPresentationWorkspaceSummary(cwd))
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handlePresentationWorkspaceTree(req: IncomingMessage, res: ServerResponse, ctx: PluginContext): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'GET')) return
  try {
    const { cwd } = presentationRequest(req, ctx)
    sendJson(res, 200, await readPresentationWorkspaceTree(cwd))
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handlePresentationWorkspaceFile(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PluginContext,
  config: Config,
): Promise<void> {
  if (rejectUnsupportedMethods(req, res, ['GET', 'PUT'])) return
  try {
    const { cwd, requestUrl } = presentationRequest(req, ctx)
    const options = { maxSourceBytes: config.maxPresentationSourceBytes ?? DEFAULT_MAX_PRESENTATION_SOURCE_BYTES }
    if (req.method === 'GET') {
      sendJson(res, 200, await readPresentationSourceFile(cwd, requestUrl.searchParams.get('path'), options))
      return
    }
    const value = await readJsonRequest(req, options.maxSourceBytes + 64 * 1024)
    sendJson(res, 200, await savePresentationSourceFile(
      cwd,
      value.path,
      typeof value.content === 'string' ? value.content : '',
      typeof value.baseHash === 'string' ? value.baseHash : '',
      options,
    ))
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handlePresentationWorkspaceEntry(req: IncomingMessage, res: ServerResponse, ctx: PluginContext): Promise<void> {
  if (rejectUnsupportedMethods(req, res, ['POST', 'PATCH', 'DELETE'])) return
  try {
    const { cwd } = presentationRequest(req, ctx)
    const value = await readJsonRequest(req, 128 * 1024)
    if (req.method === 'POST') {
      const kind = value.kind === 'directory' ? 'directory' : 'file'
      sendJson(res, 201, await createPresentationEntry(cwd, {
        path: typeof value.path === 'string' ? value.path : '',
        kind,
        content: typeof value.content === 'string' ? value.content : undefined,
      }))
      return
    }
    if (req.method === 'PATCH') {
      sendJson(res, 200, await renamePresentationEntry(cwd, value.path, value.nextPath))
      return
    }
    sendJson(res, 200, await deletePresentationEntry(cwd, value.path))
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handlePresentationWorkspaceHistory(req: IncomingMessage, res: ServerResponse, ctx: PluginContext): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'GET')) return
  try {
    const { cwd, requestUrl } = presentationRequest(req, ctx)
    sendJson(res, 200, await readPresentationFileHistory(cwd, requestUrl.searchParams.get('path')))
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handlePresentationWorkspaceRestore(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PluginContext,
  config: Config,
): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'POST')) return
  try {
    const { cwd } = presentationRequest(req, ctx)
    const value = await readJsonRequest(req, 64 * 1024)
    sendJson(res, 200, await restorePresentationFileHistory(
      cwd,
      value.path,
      typeof value.historyId === 'string' ? value.historyId : '',
      typeof value.baseHash === 'string' ? value.baseHash : '',
      { maxSourceBytes: config.maxPresentationSourceBytes ?? DEFAULT_MAX_PRESENTATION_SOURCE_BYTES },
    ))
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handlePresentationWorkspaceAsset(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PluginContext,
  config: Config,
): Promise<void> {
  if (rejectUnsupportedMethods(req, res, ['GET', 'POST', 'DELETE'])) return
  const cancellation = trackRequestCancellation(req, res)
  try {
    const { cwd, requestUrl } = presentationRequest(req, ctx)
    if (req.method === 'GET') {
      const path = requestUrl.searchParams.get('path')
      if (path === null) {
        sendJson(res, 200, await listPresentationProjectAssets(cwd))
        return
      }
      const { body, mimeType } = await readPresentationProjectAsset(cwd, path)
      res.writeHead(200, {
        'content-type': mimeType,
        'content-length': body.length,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'cross-origin',
      })
      res.end(body)
      return
    }
    if (req.method === 'DELETE') {
      const value = await readJsonRequest(req, 64 * 1024)
      sendJson(res, 200, await deletePresentationProjectAsset(cwd, value.path))
      return
    }
    const fileName = requestUrl.searchParams.get('filename')?.trim() ?? ''
    const body = await readRequestBodyWithLimit(
      req,
      config.maxPresentationAssetBytes ?? DEFAULT_MAX_PRESENTATION_ASSET_BYTES,
      cancellation.signal,
    )
    sendJson(res, 201, await uploadPresentationProjectAsset(cwd, fileName, body))
  } catch (error) {
    sendPresentationError(res, error)
  } finally {
    cancellation.dispose()
  }
}

async function handlePresentationWorkspaceBindAsset(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PluginContext,
  config: Config,
): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'POST')) return
  try {
    const { cwd } = presentationRequest(req, ctx)
    const value = await readJsonRequest(req, 64 * 1024)
    const focal = value.focalPoint !== null && typeof value.focalPoint === 'object'
      ? value.focalPoint as { x?: number; y?: number }
      : undefined
    sendJson(res, 200, await bindPresentationProjectAsset(cwd, {
      imageKey: typeof value.imageKey === 'string' ? value.imageKey : '',
      assetPath: typeof value.assetPath === 'string' ? value.assetPath : '',
      alt: typeof value.alt === 'string' ? value.alt : undefined,
      fit: value.fit === 'contain' ? 'contain' : 'cover',
      focalPoint: focal,
      baseHash: typeof value.baseHash === 'string' ? value.baseHash : '',
    }, { maxSourceBytes: config.maxPresentationSourceBytes ?? DEFAULT_MAX_PRESENTATION_SOURCE_BYTES }))
  } catch (error) {
    sendPresentationError(res, error)
  }
}

async function handlePresentationWorkspaceMigrate(req: IncomingMessage, res: ServerResponse, ctx: PluginContext): Promise<void> {
  if (rejectUnsupportedMethod(req, res, 'POST')) return
  try {
    const { cwd } = presentationRequest(req, ctx)
    const value = await readJsonRequest(req, 64 * 1024)
    sendJson(res, 200, await migratePresentationWorkspace(
      cwd,
      typeof value.jobId === 'string' ? value.jobId : undefined,
    ))
  } catch (error) {
    sendPresentationError(res, error)
  }
}

export function apply(ctx: PluginContext, config: Config = {}): void {
  const workspaceWatchers = new WorkspaceWatchHub()
  const directTextEdits = new DirectTextEditService()
  ctx.effect(() => () => workspaceWatchers.dispose(), 'frontend-feedback: workspace watcher')
  ctx.effect(() => () => directTextEdits.dispose(), 'frontend-feedback: direct text edits')

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

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PAGECRAFT_WORKSPACE_PATH,
    handler: (req, res) => handleWorkspaceSummary(req, res, ctx, workspaceWatchers),
  }), 'frontend-feedback: workspace summary route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PAGECRAFT_WORKSPACE_FOLDERS_PATH,
    handler: (req, res) => handleWorkspaceFolders(req, res, ctx),
  }), 'frontend-feedback: workspace folders route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PAGECRAFT_WORKSPACE_DIRECTORY_PATH,
    handler: (req, res) => handleWorkspaceDirectory(req, res, ctx),
  }), 'frontend-feedback: workspace directory route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PAGECRAFT_WORKSPACE_FILE_PATH,
    handler: (req, res) => handleWorkspaceFile(req, res, ctx, config),
  }), 'frontend-feedback: workspace file route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PAGECRAFT_WORKSPACE_BLOB_PATH,
    handler: (req, res) => handleWorkspaceBlob(req, res, ctx, config),
  }), 'frontend-feedback: workspace blob route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PAGECRAFT_WORKSPACE_ENTRY_PATH,
    handler: (req, res) => handleWorkspaceEntry(req, res, ctx),
  }), 'frontend-feedback: workspace entry route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PAGECRAFT_WORKSPACE_HISTORY_PATH,
    handler: (req, res) => handleWorkspaceHistory(req, res, ctx),
  }), 'frontend-feedback: workspace history route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PAGECRAFT_WORKSPACE_RESTORE_PATH,
    handler: (req, res) => handleWorkspaceRestore(req, res, ctx, config),
  }), 'frontend-feedback: workspace restore route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PAGECRAFT_WORKSPACE_EVENTS_PATH,
    handler: (req, res) => handleWorkspaceEvents(req, res, ctx, workspaceWatchers),
  }), 'frontend-feedback: workspace events route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PAGECRAFT_WORKSPACE_TEXT_EDIT_PATH,
    handler: (req, res) => handleWorkspaceTextEdit(req, res, ctx, directTextEdits),
  }), 'frontend-feedback: workspace text edit route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PAGECRAFT_WORKSPACE_TEXT_VERIFY_PATH,
    handler: (req, res) => handleWorkspaceTextVerify(req, res, ctx, directTextEdits),
  }), 'frontend-feedback: workspace text verification route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENTATION_SOURCE_PATH,
    handler: (req, res) => handlePresentationSource(req, res, ctx, config),
  }), 'frontend-feedback: presentation source route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENTATION_JOB_PATH,
    handler: (req, res) => handlePresentationJob(req, res, ctx),
  }), 'frontend-feedback: presentation job route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENTATION_PLAN_PATH,
    handler: (req, res) => handlePresentationPlan(req, res, ctx),
  }), 'frontend-feedback: presentation plan route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENTATION_ASSETS_PATH,
    handler: (req, res) => handlePresentationAssets(req, res, ctx, config),
  }), 'frontend-feedback: presentation assets route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENTATION_ASSET_PATH,
    handler: (req, res) => handlePresentationAsset(req, res, ctx),
  }), 'frontend-feedback: presentation asset route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENTATION_ASSET_BINDING_PATH,
    handler: (req, res) => handlePresentationAssetBinding(req, res, ctx),
  }), 'frontend-feedback: presentation asset binding route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENTATION_WORKSPACE_PATH,
    handler: (req, res) => handlePresentationWorkspace(req, res, ctx),
  }), 'frontend-feedback: presentation source workspace route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENTATION_WORKSPACE_TREE_PATH,
    handler: (req, res) => handlePresentationWorkspaceTree(req, res, ctx),
  }), 'frontend-feedback: presentation source tree route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENTATION_WORKSPACE_FILE_PATH,
    handler: (req, res) => handlePresentationWorkspaceFile(req, res, ctx, config),
  }), 'frontend-feedback: presentation source file route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENTATION_WORKSPACE_ENTRY_PATH,
    handler: (req, res) => handlePresentationWorkspaceEntry(req, res, ctx),
  }), 'frontend-feedback: presentation source entry route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENTATION_WORKSPACE_HISTORY_PATH,
    handler: (req, res) => handlePresentationWorkspaceHistory(req, res, ctx),
  }), 'frontend-feedback: presentation source history route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENTATION_WORKSPACE_RESTORE_PATH,
    handler: (req, res) => handlePresentationWorkspaceRestore(req, res, ctx, config),
  }), 'frontend-feedback: presentation source restore route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENTATION_WORKSPACE_ASSET_PATH,
    handler: (req, res) => handlePresentationWorkspaceAsset(req, res, ctx, config),
  }), 'frontend-feedback: presentation project asset route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENTATION_WORKSPACE_BIND_ASSET_PATH,
    handler: (req, res) => handlePresentationWorkspaceBindAsset(req, res, ctx, config),
  }), 'frontend-feedback: presentation project asset binding route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENTATION_WORKSPACE_MIGRATE_PATH,
    handler: (req, res) => handlePresentationWorkspaceMigrate(req, res, ctx),
  }), 'frontend-feedback: presentation source migration route')

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
  DEFAULT_MAX_PRESENTATION_ASSET_BYTES,
  bindPresentationAsset,
  deletePresentationAsset,
  readPresentationAsset,
  readPresentationAssets,
  uploadPresentationAsset,
} from './assets.ts'
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
  isDomTextSelection,
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
  DEFAULT_MAX_DOCUMENT_BYTES,
  DEFAULT_MAX_EXTRACTED_TEXT_CHARACTERS,
  SUPPORTED_PRESENTATION_DOCUMENT_EXTENSIONS,
  PresentationDocumentError,
  createPresentationSource,
  extractPresentationDocument,
  parsePlanRequestBody,
  readPresentationJob,
  readRequestBodyWithLimit,
  resolvePresentationJobDirectory,
  savePresentationPlan,
} from './document.ts'
export {
  DEFAULT_MAX_PRESENTATION_SOURCE_BYTES,
  DEFAULT_PRESENTATION_HISTORY_MAX_BYTES,
  DEFAULT_PRESENTATION_HISTORY_LIMIT,
  PresentationWorkspaceError,
  bindPresentationProjectAsset,
  createPresentationEntry,
  deletePresentationEntry,
  deletePresentationProjectAsset,
  listPresentationProjectAssets,
  migratePresentationWorkspace,
  readPresentationFileHistory,
  readPresentationProjectAsset,
  readPresentationSourceFile,
  readPresentationWorkspaceSummary,
  readPresentationWorkspaceTree,
  renamePresentationEntry,
  restorePresentationFileHistory,
  savePresentationSourceFile,
  uploadPresentationProjectAsset,
} from './source-workspace.ts'
export {
  DEFAULT_PRESENTATION_BRIEF,
  DEFAULT_PRESENTATION_DOCUMENT_BRIEF,
  buildPresentationCreationPrompt,
  buildPresentationDocumentPrompt,
  buildPresentationOutlinePrompt,
  isPresentationJobId,
  isPresentationImageSlotId,
  isPresentationRequestSettled,
  isPresentationSlideSummary,
  normalizePresentationJobSnapshot,
  normalizePresentationPlan,
  presentationJobStorageKey,
  PRESENTATION_ASSETS_PATH,
  PRESENTATION_ASSET_BINDING_PATH,
  PRESENTATION_ASSET_PATH,
  PRESENTATION_JOB_PATH,
  PRESENTATION_PLAN_PATH,
  PRESENTATION_SOURCE_PATH,
  resolvePresentationSlides,
} from './presentation.ts'
export {
  PRESENTATION_PROJECT_MANIFEST,
  PRESENTATION_WORKSPACE_ASSET_PATH,
  PRESENTATION_WORKSPACE_BIND_ASSET_PATH,
  PRESENTATION_WORKSPACE_ENTRY_PATH,
  PRESENTATION_WORKSPACE_FILE_PATH,
  PRESENTATION_WORKSPACE_HISTORY_PATH,
  PRESENTATION_WORKSPACE_MIGRATE_PATH,
  PRESENTATION_WORKSPACE_PATH,
  PRESENTATION_WORKSPACE_RESTORE_PATH,
  PRESENTATION_WORKSPACE_TREE_PATH,
  isPresentationTextFile,
  normalizePresentationProjectManifest,
  normalizePresentationProjectPath,
  presentationSourceLanguage,
  presentationWorkspaceLayoutStorageKey,
} from './presentation-workspace.ts'
export {
  PAGECRAFT_WORKSPACE_BLOB_PATH,
  PAGECRAFT_WORKSPACE_DIRECTORY_PATH,
  PAGECRAFT_WORKSPACE_ENTRY_PATH,
  PAGECRAFT_WORKSPACE_EVENTS_PATH,
  PAGECRAFT_WORKSPACE_FILE_PATH,
  PAGECRAFT_WORKSPACE_FOLDERS_PATH,
  PAGECRAFT_WORKSPACE_HISTORY_PATH,
  PAGECRAFT_WORKSPACE_PATH,
  PAGECRAFT_WORKSPACE_RESTORE_PATH,
  PAGECRAFT_WORKSPACE_TEXT_EDIT_PATH,
  PAGECRAFT_WORKSPACE_TEXT_VERIFY_PATH,
  isWorkspaceImageFile,
  isWorkspaceTextFile,
  normalizeWorkspacePath,
  workspaceFolderStorageKey,
  workspaceLanguage,
  workspaceLayoutStorageKey,
} from './workspace.ts'
export {
  DEFAULT_MAX_WORKSPACE_TEXT_BYTES,
  DEFAULT_WORKSPACE_HISTORY_LIMIT,
  DEFAULT_WORKSPACE_HISTORY_MAX_BYTES,
  WorkspaceExplorerError,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  listWorkspaceDirectory,
  listWorkspaceFolders,
  readWorkspaceBlob,
  readWorkspaceFile,
  readWorkspaceHistory,
  readWorkspaceSummary,
  renameWorkspaceEntry,
  resolveWorkspaceTarget,
  restoreWorkspaceHistory,
  saveWorkspaceFile,
  uploadWorkspaceImage,
} from './workspace-explorer.ts'
export { WorkspaceWatchHub } from './workspace-watcher.ts'
export { DirectTextEditService } from './direct-text-edit.ts'
export {
  encodeSourceTextReplacement,
  parseSourceTextCandidates,
} from './source-text-parsers.ts'
export {
  SourceTextResolverError,
  resolveDomTextSource,
} from './source-text-resolver.ts'
export type {
  SourceTextCandidate,
  SourceTextKind,
} from './source-text-parsers.ts'
export type {
  ResolvedSourceText,
  SourceTextResolverOptions,
} from './source-text-resolver.ts'
export type {
  DirectTextEditResult,
  DirectTextEditStart,
  DirectTextEditVerification,
  DomTextSelection,
  WorkspaceEntry,
  WorkspaceEvent,
  WorkspaceFile,
  WorkspaceHistoryEntry,
  WorkspaceSummary,
} from './workspace.ts'
