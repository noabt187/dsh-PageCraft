import { ANNOTATOR_SCRIPT } from './annotator-script.ts'

export interface PreviewPolicy {
  allowRemoteHosts?: boolean
  allowedHosts?: readonly string[]
}

export interface PreviewFetchResult {
  response: Response
  target: URL
}

export const MAX_PREVIEW_REDIRECTS = 5
export const PREVIEW_RESOURCE_PATH = '/api/frontend-feedback/resource'

export class PreviewRedirectError extends Error {
  override readonly name = 'PreviewRedirectError'
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

export async function fetchPreviewTarget(
  initialTarget: URL,
  policy: PreviewPolicy,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  accept = 'text/html,application/xhtml+xml',
): Promise<PreviewFetchResult> {
  let target = initialTarget
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetcher(target, {
      headers: {
        accept,
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
      cache: 'no-store',
      redirect: 'manual',
      signal,
    })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || location === null) {
      return { response, target }
    }

    await response.body?.cancel()
    if (redirectCount >= MAX_PREVIEW_REDIRECTS) {
      throw new PreviewRedirectError(`目标页面重定向超过 ${MAX_PREVIEW_REDIRECTS} 次`)
    }
    try {
      target = assertPreviewUrl(new URL(location, target).href, policy)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new PreviewRedirectError(`重定向被拒绝：${message}`)
    }
  }
}

export function buildPreviewRuntimeScript(targetUrl: string): string {
  const targetOrigin = JSON.stringify(new URL(targetUrl).origin).replaceAll('<', '\\u003c')
  const resourcePath = JSON.stringify(PREVIEW_RESOURCE_PATH)
  return `(() => {
  const targetOrigin = ${targetOrigin};
  const resourcePath = ${resourcePath};
  const proxyUrl = (value, method) => {
    const normalizedMethod = String(method || 'GET').toUpperCase();
    if (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') return null;
    const target = new URL(value, document.baseURI);
    if (target.origin !== targetOrigin || target.origin === window.location.origin) return null;
    const proxy = new URL(resourcePath, window.location.origin);
    proxy.searchParams.set('url', target.href);
    return proxy.href;
  };

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      const request = input instanceof Request ? input : null;
      const method = init?.method || request?.method || 'GET';
      const value = request ? request.url : input instanceof URL ? input.href : String(input);
      const proxied = proxyUrl(value, method);
      if (proxied !== null) {
        return request === null
          ? nativeFetch(proxied, init)
          : nativeFetch(new Request(proxied, request), init);
      }
    } catch {
      // Fall back to the page's original request so its own error handling remains intact.
    }
    return nativeFetch(input, init);
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    let nextUrl = url;
    try {
      nextUrl = proxyUrl(String(url), method) || url;
    } catch {
      // Preserve native XHR behavior for malformed or unsupported requests.
    }
    return nativeOpen.call(this, method, nextUrl, ...rest);
  };
})();`
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function buildPreviewHtml(html: string, targetUrl: string): string {
  const baseTag = `<base href="${escapeHtml(targetUrl)}">`
  const runtimeScript = buildPreviewRuntimeScript(targetUrl).replace(/<\/script/gi, '<\\/script')
  const runtimeTag = `<script>${runtimeScript}</script>`
  const safeScript = ANNOTATOR_SCRIPT.replace(/<\/script/gi, '<\\/script')
  const scriptTag = `<script>${safeScript}</script>`
  const withBase = /<head[^>]*>/i.test(html)
    ? html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}${runtimeTag}`)
    : `${baseTag}${runtimeTag}${html}`

  return /<\/body>/i.test(withBase)
    ? withBase.replace(/<\/body>/i, `${scriptTag}</body>`)
    : `${withBase}${scriptTag}`
}

export async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`资源超过 ${maxBytes} 字节的预览上限`)
  }
  if (response.body === null) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`资源超过 ${maxBytes} 字节的预览上限`)
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

export async function readHtmlWithLimit(response: Response, maxBytes: number): Promise<string> {
  try {
    return new TextDecoder().decode(await readBodyWithLimit(response, maxBytes))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('资源超过')) {
      throw new Error(error.message.replace('资源超过', '页面超过'))
    }
    throw error
  }
}
