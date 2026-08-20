export interface SelectionPoint {
  x: number
  y: number
}

export interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ElementSelection {
  kind?: 'element'
  url: string
  tagName: string
  selector: string
  domPath: string
  text: string
  rect: SelectionRect
}

export interface ElementComment extends ElementSelection {
  comment: string
}

export interface AreaAlignmentGuide {
  axis: 'x' | 'y'
  coordinate: number
  anchor: string
  source: 'dom' | 'grid'
  sourceSelector?: string
  distance: number
}

export interface AreaReferenceElement {
  tagName: string
  selector: string
  relation: 'container' | 'contains-center' | 'intersects' | 'nearby'
  rect: SelectionRect
  distance: number
}

export interface AreaSelection {
  kind: 'area'
  url: string
  coordinateSpace: 'viewport'
  rawRect: SelectionRect
  rect: SelectionRect
  pageRect: SelectionRect
  rawCorners: {
    topLeft: SelectionPoint
    topRight: SelectionPoint
    bottomRight: SelectionPoint
    bottomLeft: SelectionPoint
  }
  corners: {
    topLeft: SelectionPoint
    topRight: SelectionPoint
    bottomRight: SelectionPoint
    bottomLeft: SelectionPoint
  }
  pageCorners: {
    topLeft: SelectionPoint
    topRight: SelectionPoint
    bottomRight: SelectionPoint
    bottomLeft: SelectionPoint
  }
  viewport: {
    width: number
    height: number
    scrollX: number
    scrollY: number
    devicePixelRatio: number
  }
  normalized: {
    left: number
    top: number
    width: number
    height: number
  }
  alignment: {
    snapped: boolean
    threshold: number
    guides: AreaAlignmentGuide[]
  }
  container?: AreaReferenceElement
  nearby: AreaReferenceElement[]
}

export interface AreaComment extends AreaSelection {
  comment: string
}

export type FeedbackSelection = ElementSelection | AreaSelection
export type FeedbackComment = ElementComment | AreaComment

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

function point(value: SelectionPoint): string {
  return `(${value.x}, ${value.y})`
}

function rect(value: SelectionRect): string {
  return `x=${value.x}, y=${value.y}, width=${value.width}, height=${value.height}`
}

function formatAreaGuide(guide: AreaAlignmentGuide): string {
  const target = guide.source === 'grid'
    ? '8px grid'
    : guide.sourceSelector ?? 'nearby DOM'
  return `${guide.axis}=${guide.coordinate} (${guide.anchor}, ${target}, delta=${guide.distance}px)`
}

function formatReference(item: AreaReferenceElement): string {
  return `${item.relation}: <${item.tagName}> ${item.selector}; ${rect(item.rect)}; distance=${item.distance}px`
}

function formatElementComment(item: ElementComment, index: number): string {
  return [
    `## 评注 ${index + 1} · DOM 元素`,
    line('页面', item.url),
    line('元素', `<${item.tagName}>`),
    line('CSS selector', item.selector),
    line('DOM path', item.domPath),
    line('当前文本', item.text),
    `视口位置: ${rect(item.rect)}`,
    line('修改要求', item.comment),
  ].join('\n')
}

function formatAreaComment(item: AreaComment, index: number): string {
  const guides = item.alignment.guides.length === 0
    ? '(none; infer alignment from the surrounding layout)'
    : item.alignment.guides.map(formatAreaGuide).join('; ')
  const nearby = item.nearby.length === 0
    ? '(none)'
    : item.nearby.map(formatReference).join('\n- ')
  return [
    `## 评注 ${index + 1} · 区域框选（可新增 DOM）`,
    line('页面', item.url),
    `视口: width=${item.viewport.width}, height=${item.viewport.height}, scrollX=${item.viewport.scrollX}, scrollY=${item.viewport.scrollY}, dpr=${item.viewport.devicePixelRatio}`,
    `原始视口矩形: ${rect(item.rawRect)}`,
    `原始视口四点: top-left=${point(item.rawCorners.topLeft)}, top-right=${point(item.rawCorners.topRight)}, bottom-right=${point(item.rawCorners.bottomRight)}, bottom-left=${point(item.rawCorners.bottomLeft)}`,
    `视口矩形: ${rect(item.rect)}`,
    `视口四点: top-left=${point(item.corners.topLeft)}, top-right=${point(item.corners.topRight)}, bottom-right=${point(item.corners.bottomRight)}, bottom-left=${point(item.corners.bottomLeft)}`,
    `页面矩形: ${rect(item.pageRect)}`,
    `页面四点: top-left=${point(item.pageCorners.topLeft)}, top-right=${point(item.pageCorners.topRight)}, bottom-right=${point(item.pageCorners.bottomRight)}, bottom-left=${point(item.pageCorners.bottomLeft)}`,
    `相对视口: left=${item.normalized.left}, top=${item.normalized.top}, width=${item.normalized.width}, height=${item.normalized.height}`,
    `吸附信息: snapped=${item.alignment.snapped}, threshold=${item.alignment.threshold}px; ${guides}`,
    line('建议容器', item.container === undefined ? '' : formatReference(item.container)),
    `附近元素:\n- ${nearby}`,
    line('修改要求', item.comment),
  ].join('\n')
}

export function buildAnnotationPrompt(comments: readonly FeedbackComment[]): string {
  if (comments.length === 0) throw new Error('至少需要一条页面评注')

  const entries = comments.map((item, index) => item.kind === 'area'
    ? formatAreaComment(item, index)
    : formatElementComment(item, index)).join('\n\n')

  return [
    '[frontend-feedback]',
    '请使用 frontend-page-builder Skill 处理以下前端页面评注。',
    '先在当前工作区定位这些 selector 对应的组件和样式，再实施局部修改；不要只输出建议。',
    '“区域框选”表示用户希望在该视觉区域新增或调整内容；它可能没有现成 DOM。请结合建议容器、附近元素、对齐参考和现有布局系统确定源码归属。',
    '区域坐标是视觉证据而不是绝对定位指令。优先使用现有 Grid/Flex、容器边界和设计间距；若原始框选略有偏差，以一致的边缘、中心线和响应式布局为准，避免机械生成 viewport-specific absolute positioning。',
    '保持未被评注区域的行为和视觉层级，完成后运行与改动相称的构建或测试，并简要说明验证结果。',
    '',
    entries,
  ].join('\n')
}

export function isElementSelection(value: unknown): value is ElementSelection {
  if (value === null || typeof value !== 'object') return false
  const item = value as Partial<ElementSelection>
  const rect = item.rect as Partial<ElementSelection['rect']> | undefined
  return item.kind !== 'area'
    && typeof item.url === 'string'
    && typeof item.tagName === 'string'
    && typeof item.selector === 'string'
    && typeof item.domPath === 'string'
    && typeof item.text === 'string'
    && rect !== undefined
    && isFiniteNumber(rect.x)
    && isFiniteNumber(rect.y)
    && isFiniteNumber(rect.width)
    && isFiniteNumber(rect.height)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPoint(value: unknown): value is SelectionPoint {
  if (value === null || typeof value !== 'object') return false
  const item = value as Partial<SelectionPoint>
  return isFiniteNumber(item.x) && isFiniteNumber(item.y)
}

function isRect(value: unknown): value is SelectionRect {
  if (value === null || typeof value !== 'object') return false
  const item = value as Partial<SelectionRect>
  return isFiniteNumber(item.x)
    && isFiniteNumber(item.y)
    && isFiniteNumber(item.width)
    && isFiniteNumber(item.height)
}

function isAreaGuide(value: unknown): value is AreaAlignmentGuide {
  if (value === null || typeof value !== 'object') return false
  const item = value as Partial<AreaAlignmentGuide>
  return (item.axis === 'x' || item.axis === 'y')
    && isFiniteNumber(item.coordinate)
    && typeof item.anchor === 'string'
    && (item.source === 'dom' || item.source === 'grid')
    && (item.sourceSelector === undefined || typeof item.sourceSelector === 'string')
    && isFiniteNumber(item.distance)
}

function isAreaReference(value: unknown): value is AreaReferenceElement {
  if (value === null || typeof value !== 'object') return false
  const item = value as Partial<AreaReferenceElement>
  return typeof item.tagName === 'string'
    && typeof item.selector === 'string'
    && (item.relation === 'container'
      || item.relation === 'contains-center'
      || item.relation === 'intersects'
      || item.relation === 'nearby')
    && isRect(item.rect)
    && isFiniteNumber(item.distance)
}

export function isAreaSelection(value: unknown): value is AreaSelection {
  if (value === null || typeof value !== 'object') return false
  const item = value as Partial<AreaSelection>
  const rawCorners = item.rawCorners as Partial<AreaSelection['rawCorners']> | undefined
  const corners = item.corners as Partial<AreaSelection['corners']> | undefined
  const pageCorners = item.pageCorners as Partial<AreaSelection['pageCorners']> | undefined
  const viewport = item.viewport as Partial<AreaSelection['viewport']> | undefined
  const normalized = item.normalized as Partial<AreaSelection['normalized']> | undefined
  const alignment = item.alignment as Partial<AreaSelection['alignment']> | undefined
  return item.kind === 'area'
    && typeof item.url === 'string'
    && item.coordinateSpace === 'viewport'
    && isRect(item.rawRect)
    && isRect(item.rect)
    && isRect(item.pageRect)
    && rawCorners !== undefined
    && isPoint(rawCorners.topLeft)
    && isPoint(rawCorners.topRight)
    && isPoint(rawCorners.bottomRight)
    && isPoint(rawCorners.bottomLeft)
    && corners !== undefined
    && isPoint(corners.topLeft)
    && isPoint(corners.topRight)
    && isPoint(corners.bottomRight)
    && isPoint(corners.bottomLeft)
    && pageCorners !== undefined
    && isPoint(pageCorners.topLeft)
    && isPoint(pageCorners.topRight)
    && isPoint(pageCorners.bottomRight)
    && isPoint(pageCorners.bottomLeft)
    && viewport !== undefined
    && isFiniteNumber(viewport.width)
    && isFiniteNumber(viewport.height)
    && isFiniteNumber(viewport.scrollX)
    && isFiniteNumber(viewport.scrollY)
    && isFiniteNumber(viewport.devicePixelRatio)
    && normalized !== undefined
    && isFiniteNumber(normalized.left)
    && isFiniteNumber(normalized.top)
    && isFiniteNumber(normalized.width)
    && isFiniteNumber(normalized.height)
    && alignment !== undefined
    && typeof alignment.snapped === 'boolean'
    && isFiniteNumber(alignment.threshold)
    && Array.isArray(alignment.guides)
    && alignment.guides.length <= 8
    && alignment.guides.every(isAreaGuide)
    && (item.container === undefined || isAreaReference(item.container))
    && Array.isArray(item.nearby)
    && item.nearby.length <= 8
    && item.nearby.every(isAreaReference)
}

export function isFeedbackSelection(value: unknown): value is FeedbackSelection {
  return isAreaSelection(value) || isElementSelection(value)
}
