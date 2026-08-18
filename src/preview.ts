import { ANNOTATOR_SCRIPT } from './annotator-script.ts'

export interface PreviewPolicy {
  allowRemoteHosts?: boolean
  allowedHosts?: readonly string[]
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]'])

function normalizeHost(host: string): string {
  return host.trim().toLowerCase()
}

export function isLoopbackHost(hostname: string): boolean {
  const host = normalizeHost(hostname)
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost')
}

export function assertPreviewUrl(rawUrl: string, policy: PreviewPolicy = {}): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('预览地址不是有效 URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http 或 https 预览地址')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error('预览地址不能包含用户名或密码')
  }

  const allowed = new Set((policy.allowedHosts ?? []).map(normalizeHost))
  if (policy.allowRemoteHosts !== true && !isLoopbackHost(url.hostname) && !allowed.has(normalizeHost(url.hostname))) {
    throw new Error('默认只允许预览本机地址；请在插件配置中显式允许远程主机')
  }
  return url
}

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function buildPreviewHtml(html: string, targetUrl: string): string {
  const baseTag = `<base href="${htmlEscape(targetUrl)}">`
  const safeScript = ANNOTATOR_SCRIPT.replace(/<\/script/gi, '<\\/script')
  const scriptTag = `<script>${safeScript}</script>`
  const withBase = /<head[^>]*>/i.test(html)
    ? html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`)
    : `${baseTag}${html}`

  return /<\/body>/i.test(withBase)
    ? withBase.replace(/<\/body>/i, `${scriptTag}</body>`)
    : `${withBase}${scriptTag}`
}

export async function readHtmlWithLimit(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`页面超过 ${maxBytes} 字节的预览上限`)
  }
  if (response.body === null) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`页面超过 ${maxBytes} 字节的预览上限`)
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}
