export interface ElementSelection {
  url: string
  tagName: string
  selector: string
  domPath: string
  text: string
  rect: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface ElementComment extends ElementSelection {
  comment: string
}

export interface PreviewFrameLocation {
  src: string
  allowSameOrigin: boolean
}

export interface PreviewNavigationState {
  entries: string[]
  index: number
}

export const DEFAULT_PREVIEW_URL = 'http://localhost:5173'
export const MAX_PREVIEW_HISTORY_ENTRIES = 50

const PREVIEW_URL_STORAGE_PREFIX = 'dsh-frontend-feedback.preview-url:'
const PREVIEW_HISTORY_STORAGE_PREFIX = 'dsh-frontend-feedback.preview-history:'
const LOOPBACK_PREVIEW_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]'])

export function previewUrlStorageKey(sessionId: string): string {
  return `${PREVIEW_URL_STORAGE_PREFIX}${encodeURIComponent(sessionId)}`
}

export function previewHistoryStorageKey(sessionId: string): string {
  return `${PREVIEW_HISTORY_STORAGE_PREFIX}${encodeURIComponent(sessionId)}`
}

export function normalizePreviewUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.href
  } catch {
    return null
  }
}

export function resolvePersistedPreviewUrl(value: string | null | undefined): string {
  return normalizePreviewUrl(value) ?? DEFAULT_PREVIEW_URL
}

export function currentPreviewUrl(navigation: PreviewNavigationState): string {
  return navigation.entries[navigation.index] ?? DEFAULT_PREVIEW_URL
}

export function pushPreviewNavigation(
  navigation: PreviewNavigationState,
  targetUrl: string,
): PreviewNavigationState {
  const normalizedTarget = normalizePreviewUrl(targetUrl)
  if (normalizedTarget === null) throw new Error('只支持有效的 http 或 https 地址')
  if (currentPreviewUrl(navigation) === normalizedTarget) return navigation

  const entries = [...navigation.entries.slice(0, navigation.index + 1), normalizedTarget]
    .slice(-MAX_PREVIEW_HISTORY_ENTRIES)
  return { entries, index: entries.length - 1 }
}

export function movePreviewNavigation(
  navigation: PreviewNavigationState,
  delta: -1 | 1,
): PreviewNavigationState | null {
  const index = navigation.index + delta
  return index < 0 || index >= navigation.entries.length
    ? null
    : { ...navigation, index }
}

export function resolvePersistedPreviewNavigation(
  value: string | null | undefined,
  fallbackUrl: string | null | undefined = DEFAULT_PREVIEW_URL,
): PreviewNavigationState {
  const fallback = resolvePersistedPreviewUrl(fallbackUrl)
  if (value === null || value === undefined || value.trim().length === 0) {
    return { entries: [fallback], index: 0 }
  }

  try {
    const parsed = JSON.parse(value) as { entries?: unknown; index?: unknown }
    if (!Array.isArray(parsed.entries)) return { entries: [fallback], index: 0 }

    const requestedIndex = Number.isInteger(parsed.index) ? Number(parsed.index) : parsed.entries.length - 1
    const normalized: string[] = []
    let normalizedIndex = -1
    parsed.entries.forEach((entry, sourceIndex) => {
      const url = normalizePreviewUrl(entry)
      if (url === null) return
      normalized.push(url)
      if (sourceIndex <= requestedIndex) normalizedIndex = normalized.length - 1
    })
    if (normalized.length === 0) return { entries: [fallback], index: 0 }

    const offset = Math.max(0, normalized.length - MAX_PREVIEW_HISTORY_ENTRIES)
    const entries = normalized.slice(offset)
    const index = Math.min(
      entries.length - 1,
      Math.max(0, (normalizedIndex < 0 ? 0 : normalizedIndex) - offset),
    )
    return { entries, index }
  } catch {
    return { entries: [fallback], index: 0 }
  }
}

function isLoopbackPreviewHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return LOOPBACK_PREVIEW_HOSTS.has(host) || host.endsWith('.localhost')
}

function effectivePort(url: URL): string {
  if (url.port.length > 0) return url.port
  return url.protocol === 'https:' ? '443' : '80'
}

/**
 * Put untrusted proxied pages on the other loopback hostname whenever possible.
 * This lets dynamic pages retain an ordinary origin without sharing the Harness
 * parent origin. A loopback target running on the Harness port uses its own
 * hostname so its same-origin module assets continue to work.
 */
export function resolvePreviewFrameLocation(
  targetUrl: string,
  harnessUrl: string,
  revision = 0,
): PreviewFrameLocation {
  const target = new URL(targetUrl)
  const harness = new URL(harnessUrl)
  const bothLoopback = isLoopbackPreviewHost(target.hostname) && isLoopbackPreviewHost(harness.hostname)
  const targetIsHarness = bothLoopback
    && target.protocol === harness.protocol
    && effectivePort(target) === effectivePort(harness)

  let previewOrigin: URL
  let allowSameOrigin = false
  if (targetIsHarness) {
    previewOrigin = new URL(target.origin)
    allowSameOrigin = true
  } else if (harness.hostname === 'localhost' || harness.hostname.endsWith('.localhost')) {
    previewOrigin = new URL(harness.origin)
    previewOrigin.hostname = '127.0.0.1'
    allowSameOrigin = true
  } else if (harness.hostname === '127.0.0.1' || harness.hostname === '[::1]') {
    previewOrigin = new URL(harness.origin)
    previewOrigin.hostname = 'localhost'
    allowSameOrigin = true
  } else {
    // A non-loopback deployment has no automatically safe alternate origin.
    // Keep the opaque-origin sandbox instead of granting a remote page access
    // to the Harness parent origin.
    previewOrigin = new URL(harness.origin)
  }

  const endpoint = new URL('/api/frontend-feedback/preview', previewOrigin)
  endpoint.searchParams.set('url', target.href)
  endpoint.searchParams.set('revision', String(revision))
  endpoint.hash = target.hash
  return { src: endpoint.href, allowSameOrigin }
}

function line(label: string, value: string): string {
  return `${label}: ${value.length > 0 ? value : '(empty)'}`
}

export function buildAnnotationPrompt(comments: readonly ElementComment[]): string {
  if (comments.length === 0) throw new Error('至少需要一条元素评注')

  const entries = comments.map((item, index) => [
    `## 评注 ${index + 1}`,
    line('页面', item.url),
    line('元素', `<${item.tagName}>`),
    line('CSS selector', item.selector),
    line('DOM path', item.domPath),
    line('当前文本', item.text),
    `视口位置: x=${item.rect.x}, y=${item.rect.y}, width=${item.rect.width}, height=${item.rect.height}`,
    line('修改要求', item.comment),
  ].join('\n')).join('\n\n')

  return [
    '[frontend-feedback]',
    '请使用 frontend-page-builder Skill 处理以下前端页面评注。',
    '先在当前工作区定位这些 selector 对应的组件和样式，再实施局部修改；不要只输出建议。',
    '保持未被评注区域的行为和视觉层级，完成后运行与改动相称的构建或测试，并简要说明验证结果。',
    '',
    entries,
  ].join('\n')
}

export function isElementSelection(value: unknown): value is ElementSelection {
  if (value === null || typeof value !== 'object') return false
  const item = value as Partial<ElementSelection>
  const rect = item.rect as Partial<ElementSelection['rect']> | undefined
  return typeof item.url === 'string'
    && typeof item.tagName === 'string'
    && typeof item.selector === 'string'
    && typeof item.domPath === 'string'
    && typeof item.text === 'string'
    && rect !== undefined
    && typeof rect.x === 'number'
    && typeof rect.y === 'number'
    && typeof rect.width === 'number'
    && typeof rect.height === 'number'
}
