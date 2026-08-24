import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  assertTrustedRequestSource,
  classifyPreviewAddress,
  createConcurrencyLimiter,
  createResourceToken,
  createResourceTokenSecret,
  resolveAndAssertPreviewHost,
  verifyResourceToken,
} from '../src/security.ts'
import { buildPreviewRuntimeScript, fetchPreviewTarget } from '../src/preview.ts'

test('classifies loopback, private, metadata, reserved, and public addresses', () => {
  assert.equal(classifyPreviewAddress('127.0.0.1'), 'loopback')
  assert.equal(classifyPreviewAddress('::1'), 'loopback')
  assert.equal(classifyPreviewAddress('::ffff:127.0.0.1'), 'loopback')
  assert.equal(classifyPreviewAddress('10.2.3.4'), 'private')
  assert.equal(classifyPreviewAddress('172.20.1.1'), 'private')
  assert.equal(classifyPreviewAddress('192.168.1.9'), 'private')
  assert.equal(classifyPreviewAddress('fd12::1'), 'private')
  assert.equal(classifyPreviewAddress('169.254.169.254'), 'metadata')
  assert.equal(classifyPreviewAddress('169.254.170.2'), 'metadata')
  assert.equal(classifyPreviewAddress('100.100.100.200'), 'metadata')
  assert.equal(classifyPreviewAddress('fd00:ec2::254'), 'metadata')
  assert.equal(classifyPreviewAddress('169.254.1.2'), 'restricted')
  assert.equal(classifyPreviewAddress('224.0.0.1'), 'restricted')
  assert.equal(classifyPreviewAddress('2001:db8::1'), 'restricted')
  assert.equal(classifyPreviewAddress('2001:0db8::1'), 'restricted')
  assert.equal(classifyPreviewAddress('64:ff9b::7f00:1'), 'restricted')
  assert.equal(classifyPreviewAddress('2002:7f00:1::'), 'restricted')
  assert.equal(classifyPreviewAddress('8.8.8.8'), 'public')
  assert.equal(classifyPreviewAddress('2606:4700:4700::1111'), 'public')
})

test('DNS policy rejects private and mixed answers unless explicitly enabled', async () => {
  const privateResolver = async () => [{ address: '192.168.1.20', family: 4 }]
  await assert.rejects(
    resolveAndAssertPreviewHost(new URL('http://devbox.test'), {
      allowRemoteHosts: true,
      resolveHostname: privateResolver,
    }),
    /allowPrivateHosts/,
  )
  await assert.doesNotReject(resolveAndAssertPreviewHost(new URL('http://devbox.test'), {
    allowRemoteHosts: true,
    allowPrivateHosts: true,
    resolveHostname: privateResolver,
  }))

  const mixedResolver = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.8', family: 4 },
  ]
  await assert.rejects(
    resolveAndAssertPreviewHost(new URL('https://mixed.test'), {
      allowRemoteHosts: true,
      resolveHostname: mixedResolver,
    }),
    /allowPrivateHosts/,
  )
})

test('metadata is never enabled by the private-host switch', async () => {
  await assert.rejects(
    resolveAndAssertPreviewHost(new URL('http://metadata.test'), {
      allowRemoteHosts: true,
      allowPrivateHosts: true,
      resolveHostname: async () => [{ address: '169.254.169.254', family: 4 }],
    }),
    /metadata/,
  )
})

test('localhost names must resolve exclusively to loopback addresses', async () => {
  await assert.rejects(
    resolveAndAssertPreviewHost(new URL('http://ui.localhost'), {
      allowRemoteHosts: true,
      allowPrivateHosts: true,
      resolveHostname: async () => [
        { address: '127.0.0.1', family: 4 },
        { address: '192.168.1.8', family: 4 },
      ],
    }),
    /non-loopback|loopback/,
  )
})

test('each redirect hop is DNS-validated before fetching and final host is rechecked', async () => {
  const lookups: string[] = []
  const requests: string[] = []
  const resolver = async (hostname: string) => {
    lookups.push(hostname)
    return [{ address: '93.184.216.34', family: 4 }]
  }
  const fetcher = async (input: string | URL | Request) => {
    requests.push(String(input))
    return requests.length === 1
      ? new Response(null, { status: 302, headers: { location: 'https://cdn.test/asset' } })
      : new Response('ok')
  }
  const result = await fetchPreviewTarget(
    new URL('https://app.test/start'),
    { allowRemoteHosts: true, resolveHostname: resolver },
    new AbortController().signal,
    fetcher as typeof fetch,
  )
  assert.equal(result.target.href, 'https://cdn.test/asset')
  assert.deepEqual(requests, ['https://app.test/start', 'https://cdn.test/asset'])
  assert.deepEqual(lookups, ['app.test', 'cdn.test', 'cdn.test'])
})

test('resource tokens are short-lived, tamper-evident, and origin-bound', () => {
  const secret = createResourceTokenSecret()
  const token = createResourceToken('https://example.com/path', secret, 1_000, 10_000)
  assert.deepEqual(verifyResourceToken(token, 'https://example.com/asset', secret, 10_500), {
    origin: 'https://example.com',
    expiresAt: 11_000,
  })
  assert.throws(() => verifyResourceToken(`${token.slice(0, -1)}x`, 'https://example.com', secret, 10_500), /签名/)
  assert.throws(() => verifyResourceToken(token, 'https://cdn.example.com', secret, 10_500), /origin/)
  assert.throws(() => verifyResourceToken(token, 'https://example.com', secret, 11_000), /过期/)
})

test('preview runtime attaches the signed resource token', () => {
  const script = buildPreviewRuntimeScript('https://example.com/', 'signed-token')
  assert.match(script, /const resourceToken = "signed-token"/)
  assert.match(script, /searchParams\.set\('token', resourceToken\)/)
  assert.doesNotThrow(() => new Function(script))
})

test('request source accepts loopback aliases only on the Harness port', () => {
  const request = (origin: string, host = '127.0.0.1:3080') => ({
    headers: { origin, host },
  }) as never
  assert.doesNotThrow(() => assertTrustedRequestSource(request('http://localhost:3080')))
  assert.throws(() => assertTrustedRequestSource(request('http://localhost:4173')), /Harness host/)
  assert.throws(() => assertTrustedRequestSource(request('https://evil.example')), /Harness host/)
  assert.doesNotThrow(() => assertTrustedRequestSource(
    request('https://studio.example', 'studio.example'),
    false,
    ['https://studio.example'],
  ))
  assert.throws(() => assertTrustedRequestSource(
    request('https://studio.example', 'studio.example'),
    false,
    ['https://other.example'],
  ), /allowedRequestOrigins/)
})

test('concurrency limiter bounds active gateway requests and releases idempotently', () => {
  const limiter = createConcurrencyLimiter(2)
  const first = limiter.acquire()
  const second = limiter.acquire()
  assert.ok(first)
  assert.ok(second)
  assert.equal(limiter.active(), 2)
  assert.equal(limiter.acquire(), null)
  first.release()
  first.release()
  assert.equal(limiter.active(), 1)
  assert.ok(limiter.acquire())
})

test('bundled gateway defaults disable remote and private targets', async () => {
  const config = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(config, /allowRemoteHosts:\s*false/)
  assert.match(config, /allowPrivateHosts:\s*false/)
  assert.match(config, /allowedHosts:\s*\[\]/)
  assert.match(config, /maxConcurrentRequests:\s*8/)
})
