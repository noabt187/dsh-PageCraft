import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { IncomingMessage } from 'node:http'

export type PreviewAddressKind = 'loopback' | 'private' | 'metadata' | 'restricted' | 'public'

export interface ResolvedAddress {
  address: string
  family: number
}

export type PreviewDnsResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>

export interface PreviewSecurityPolicy {
  allowRemoteHosts?: boolean
  allowPrivateHosts?: boolean
  allowedHosts?: readonly string[]
  resolveHostname?: PreviewDnsResolver
  requiredOrigin?: string
}

export interface ResourceTokenPayload {
  origin: string
  expiresAt: number
}

const LOOPBACK_NAMES = new Set(['localhost'])
const METADATA_IPV4 = new Set(['169.254.169.254', '169.254.170.2', '100.100.100.200', '168.63.129.16'])
const METADATA_IPV6 = new Set(['fd00:ec2::254', 'fe80::a9fe:a9fe'])

export function normalizePreviewHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = normalizePreviewHost(hostname)
  return LOOPBACK_NAMES.has(host) || host.endsWith('.localhost')
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const values = parts.map(part => Number(part))
  return values.every((value, index) => Number.isInteger(value) && value >= 0 && value <= 255 && String(value) === parts[index])
    ? values
    : null
}

function embeddedIpv4(address: string): string | null {
  const normalized = normalizePreviewHost(address)
  if (!normalized.startsWith('::ffff:')) return null
  const tail = normalized.slice('::ffff:'.length)
  if (parseIpv4(tail)) return tail
  const groups = tail.split(':')
  if (groups.length !== 2 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null
  const high = Number.parseInt(groups[0], 16)
  const low = Number.parseInt(groups[1], 16)
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
}

export function classifyPreviewAddress(rawAddress: string): PreviewAddressKind {
  const address = normalizePreviewHost(rawAddress)
  const mapped = embeddedIpv4(address)
  if (mapped !== null) return classifyPreviewAddress(mapped)

  if (isIP(address) === 4) {
    if (METADATA_IPV4.has(address)) return 'metadata'
    const octets = parseIpv4(address)!
    const [a, b, c] = octets
    if (a === 127) return 'loopback'
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private'
    if (a === 169 && b === 254) return 'restricted'
    if (
      a === 0 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    ) return 'restricted'
    return 'public'
  }

  if (isIP(address) === 6) {
    if (METADATA_IPV6.has(address)) return 'metadata'
    if (address === '::1') return 'loopback'
    if (address === '::') return 'restricted'
    const first = Number.parseInt(address.split(':', 1)[0] || '0', 16)
    if (address.startsWith('::') || first === 0x64 || first === 0x2002) return 'restricted'
    if ((first & 0xfe00) === 0xfc00) return 'private'
    if ((first & 0xffc0) === 0xfe80) return 'restricted'
    const groups = address.split(':')
    const second = Number.parseInt(groups[1] || '0', 16)
    if ((first & 0xff00) === 0xff00 || (first === 0x2001 && (second === 0 || second === 0x0db8))) return 'restricted'
    return 'public'
  }

  throw new Error(`Invalid IP address: ${rawAddress}`)
}

export function assertAddressAllowed(address: string, policy: PreviewSecurityPolicy, hostname: string): void {
  const kind = classifyPreviewAddress(address)
  if (kind === 'metadata') throw new Error(`拒绝访问云 metadata 地址（${hostname}）`)
  if (kind === 'restricted') throw new Error(`拒绝访问链路本地、保留或组播地址（${hostname}）`)
  if (kind === 'private' && policy.allowPrivateHosts !== true) {
    throw new Error(`目标解析到私网地址；如确需局域网预览，请显式开启 allowPrivateHosts（${hostname}）`)
  }
  if (kind !== 'loopback' && isLoopbackHostname(hostname)) {
    throw new Error(`本地主机名解析到非 loopback 地址（${hostname}）`)
  }
  if (kind !== 'loopback' && !isLoopbackHostname(hostname)) {
    const allowed = new Set((policy.allowedHosts ?? []).map(normalizePreviewHost))
    if (policy.allowRemoteHosts !== true && !allowed.has(normalizePreviewHost(hostname))) {
      throw new Error('默认只允许预览本机地址；请显式允许该远程主机')
    }
  }
}

const defaultResolver: PreviewDnsResolver = async hostname => lookup(hostname, { all: true, verbatim: true })

export async function resolveAndAssertPreviewHost(url: URL, policy: PreviewSecurityPolicy = {}): Promise<readonly ResolvedAddress[]> {
  const hostname = normalizePreviewHost(url.hostname)
  if (isIP(hostname)) {
    assertAddressAllowed(hostname, policy, hostname)
    return [{ address: hostname, family: isIP(hostname) }]
  }

  const resolver = policy.resolveHostname ?? defaultResolver
  let addresses: readonly ResolvedAddress[]
  try {
    addresses = await resolver(hostname)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`无法解析目标主机 ${hostname}：${message}`)
  }
  if (addresses.length === 0) throw new Error(`目标主机没有可用的 DNS 记录（${hostname}）`)
  for (const result of addresses) assertAddressAllowed(result.address, policy, hostname)
  return addresses
}

export function createResourceTokenSecret(): Uint8Array {
  return randomBytes(32)
}

function encodePayload(payload: ResourceTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function signPayload(encodedPayload: string, secret: Uint8Array): Buffer {
  return createHmac('sha256', secret).update(encodedPayload).digest()
}

export function createResourceToken(origin: string, secret: Uint8Array, ttlMs = 60_000, now = Date.now()): string {
  const normalizedOrigin = new URL(origin).origin
  const boundedTtlMs = Math.min(Math.max(Number.isFinite(ttlMs) ? ttlMs : 60_000, 1_000), 5 * 60_000)
  const encodedPayload = encodePayload({ origin: normalizedOrigin, expiresAt: now + boundedTtlMs })
  return `${encodedPayload}.${signPayload(encodedPayload, secret).toString('base64url')}`
}

export function verifyResourceToken(token: string, expectedOrigin: string, secret: Uint8Array, now = Date.now()): ResourceTokenPayload {
  const [encodedPayload, encodedSignature, extra] = token.split('.')
  if (!encodedPayload || !encodedSignature || extra !== undefined) throw new Error('资源令牌格式无效')
  const actualSignature = Buffer.from(encodedSignature, 'base64url')
  const expectedSignature = signPayload(encodedPayload, secret)
  if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
    throw new Error('资源令牌签名无效')
  }

  let payload: ResourceTokenPayload
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as ResourceTokenPayload
  } catch {
    throw new Error('资源令牌内容无效')
  }
  if (typeof payload.origin !== 'string' || typeof payload.expiresAt !== 'number') throw new Error('资源令牌内容无效')
  if (payload.expiresAt <= now) throw new Error('资源令牌已过期')
  if (payload.origin !== new URL(expectedOrigin).origin) throw new Error('资源令牌与目标 origin 不匹配')
  return payload
}

function requestOrigin(req: IncomingMessage): string | null {
  const header = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin
  if (header) return header
  const referer = Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer
  if (!referer) return null
  try { return new URL(referer).origin } catch { return 'invalid' }
}

export function assertTrustedRequestSource(
  req: IncomingMessage,
  requireSource = false,
  allowedOrigins: readonly string[] = [],
): void {
  const source = requestOrigin(req)
  if (source === 'invalid') throw new Error('请求来源无效')
  if (source === null) {
    if (requireSource) throw new Error('缺少可信请求来源')
    return
  }
  const host = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host
  if (!host) throw new Error('缺少 Host 请求头')
  let sourceUrl: URL
  try { sourceUrl = new URL(source) } catch { throw new Error('请求来源无效') }
  let requestUrl: URL
  try { requestUrl = new URL(`http://${host}`) } catch { throw new Error('Host 请求头无效') }
  const normalizedAllowedOrigins = new Set(allowedOrigins.map(origin => new URL(origin).origin))
  if (normalizedAllowedOrigins.size > 0 && !normalizedAllowedOrigins.has(sourceUrl.origin)) {
    throw new Error('请求来源不在 allowedRequestOrigins 中')
  }
  const requestHost = normalizePreviewHost(requestUrl.hostname)
  const sourceHost = normalizePreviewHost(sourceUrl.hostname)
  const sourceIsLoopback = isLoopbackHostname(sourceHost) || classifyPreviewAddressSafe(sourceHost) === 'loopback'
  const requestIsLoopback = isLoopbackHostname(requestHost) || classifyPreviewAddressSafe(requestHost) === 'loopback'
  if ((sourceHost !== requestHost && !(sourceIsLoopback && requestIsLoopback)) || sourceUrl.port !== requestUrl.port) {
    throw new Error('请求来源与 Harness host 不一致')
  }
}

function classifyPreviewAddressSafe(value: string): PreviewAddressKind | null {
  try { return isIP(value) ? classifyPreviewAddress(value) : null } catch { return null }
}

export interface RequestLease {
  release(): void
}

export function createConcurrencyLimiter(maxConcurrentRequests: number): { acquire(): RequestLease | null; active(): number } {
  const maximum = Number.isInteger(maxConcurrentRequests) && maxConcurrentRequests > 0 ? maxConcurrentRequests : 8
  let current = 0
  return {
    acquire() {
      if (current >= maximum) return null
      current += 1
      let released = false
      return {
        release() {
          if (released) return
          released = true
          current -= 1
        },
      }
    },
    active: () => current,
  }
}
