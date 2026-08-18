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

const LOOPBACK_PREVIEW_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]'])

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
