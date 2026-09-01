import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import { PresentationDocumentError, readPresentationJob, resolvePresentationJobDirectory } from './document.ts'
import { isPresentationImageSlotId } from './presentation.ts'
import type {
  PresentationAsset,
  PresentationAssetBinding,
  PresentationAssetFit,
  PresentationAssetManifest,
} from './presentation.ts'

export const DEFAULT_MAX_PRESENTATION_ASSET_BYTES = 20 * 1024 * 1024

export interface PresentationImageInfo {
  extension: string
  mimeType: string
  width: number
  height: number
}

interface BindPresentationAssetOptions {
  assetId: string | null
  fit?: PresentationAssetFit
  focalPoint?: { x?: number; y?: number }
}

export interface PresentationAssetFile {
  asset: PresentationAsset
  body: Buffer
}

const manifestLocks = new Map<string, Promise<void>>()

function emptyManifest(): PresentationAssetManifest {
  return { assets: [], bindings: [], updatedAt: new Date(0).toISOString() }
}

function safeAssetName(value: string): string {
  const name = basename(value.trim()).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 240)
  if (name.length === 0) throw new PresentationDocumentError('图片文件名不能为空', 400, 'ASSET_NAME_REQUIRED')
  return name
}

function assertDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 50_000 || height > 50_000) {
    throw new PresentationDocumentError('图片尺寸无效或过大', 415, 'INVALID_IMAGE_DIMENSIONS')
  }
}

function pngInfo(bytes: Buffer): PresentationImageInfo | null {
  const signature = '89504e470d0a1a0a'
  if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== signature) return null
  if (bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new PresentationDocumentError('PNG 图片结构无效', 415, 'INVALID_IMAGE')
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  assertDimensions(width, height)
  return { extension: '.png', mimeType: 'image/png', width, height }
}

function gifInfo(bytes: Buffer): PresentationImageInfo | null {
  const signature = bytes.subarray(0, 6).toString('ascii')
  if (bytes.length < 10 || (signature !== 'GIF87a' && signature !== 'GIF89a')) return null
  const width = bytes.readUInt16LE(6)
  const height = bytes.readUInt16LE(8)
  assertDimensions(width, height)
  return { extension: '.gif', mimeType: 'image/gif', width, height }
}

function jpegInfo(bytes: Buffer): PresentationImageInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    offset += 2
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) break
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) break
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isStartOfFrame && length >= 7) {
      const height = bytes.readUInt16BE(offset + 3)
      const width = bytes.readUInt16BE(offset + 5)
      assertDimensions(width, height)
      return { extension: '.jpg', mimeType: 'image/jpeg', width, height }
    }
    offset += length
  }
  throw new PresentationDocumentError('JPEG 图片结构无效', 415, 'INVALID_IMAGE')
}

function webpInfo(bytes: Buffer): PresentationImageInfo | null {
  if (bytes.length < 30 || bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') return null
  const format = bytes.subarray(12, 16).toString('ascii')
  let width = 0
  let height = 0
  if (format === 'VP8X') {
    width = bytes.readUIntLE(24, 3) + 1
    height = bytes.readUIntLE(27, 3) + 1
  } else if (format === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21)
    width = (bits & 0x3fff) + 1
    height = ((bits >>> 14) & 0x3fff) + 1
  } else if (format === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    width = bytes.readUInt16LE(26) & 0x3fff
    height = bytes.readUInt16LE(28) & 0x3fff
  } else {
    throw new PresentationDocumentError('WebP 图片结构无效', 415, 'INVALID_IMAGE')
  }
  assertDimensions(width, height)
  return { extension: '.webp', mimeType: 'image/webp', width, height }
}

export function inspectPresentationImage(bytes: Buffer): PresentationImageInfo {
  const info = pngInfo(bytes) ?? gifInfo(bytes) ?? jpegInfo(bytes) ?? webpInfo(bytes)
  if (info === null) {
    throw new PresentationDocumentError('仅支持 PNG、JPEG、WebP 和 GIF 图片', 415, 'UNSUPPORTED_ASSET_TYPE')
  }
  return info
}

function manifestPath(cwd: string, jobId: string): string {
  return resolve(resolvePresentationJobDirectory(cwd, jobId), 'assets.json')
}

function assetDirectory(cwd: string, jobId: string): string {
  return resolve(resolvePresentationJobDirectory(cwd, jobId), 'assets')
}

function assetFilePath(cwd: string, jobId: string, file: string): string {
  const directory = assetDirectory(cwd, jobId)
  const path = resolve(resolvePresentationJobDirectory(cwd, jobId), file)
  if (!path.startsWith(`${directory}${sep}`)) {
    throw new PresentationDocumentError('素材路径越界', 400, 'ASSET_PATH_ESCAPE')
  }
  return path
}

function normalizeManifest(value: unknown): PresentationAssetManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return emptyManifest()
  const source = value as Partial<PresentationAssetManifest>
  const assets = Array.isArray(source.assets) ? source.assets.filter(isAsset) : []
  const assetIds = new Set(assets.map(asset => asset.id))
  const bindings = Array.isArray(source.bindings)
    ? source.bindings.filter(binding => isBinding(binding) && assetIds.has(binding.assetId))
    : []
  return {
    assets,
    bindings,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date(0).toISOString(),
  }
}

function isAsset(value: unknown): value is PresentationAsset {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const asset = value as Partial<PresentationAsset>
  return typeof asset.id === 'string'
    && /^asset-[a-f0-9]{16}$/.test(asset.id)
    && typeof asset.name === 'string'
    && typeof asset.file === 'string'
    && asset.file.startsWith(`assets/${asset.id}.`)
    && typeof asset.mimeType === 'string'
    && Number.isInteger(asset.bytes) && Number(asset.bytes) > 0
    && Number.isInteger(asset.width) && Number(asset.width) > 0
    && Number.isInteger(asset.height) && Number(asset.height) > 0
    && asset.source === 'user-upload'
    && typeof asset.createdAt === 'string'
}

function isBinding(value: unknown): value is PresentationAssetBinding {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const binding = value as Partial<PresentationAssetBinding>
  return isPresentationImageSlotId(binding.slotId)
    && typeof binding.assetId === 'string'
    && (binding.fit === 'cover' || binding.fit === 'contain')
    && binding.focalPoint !== undefined
    && Number.isFinite(binding.focalPoint.x)
    && Number.isFinite(binding.focalPoint.y)
    && typeof binding.updatedAt === 'string'
}

async function readManifestFile(cwd: string, jobId: string): Promise<PresentationAssetManifest> {
  try {
    const value = JSON.parse(await readFile(manifestPath(cwd, jobId), 'utf8'))
    return normalizeManifest(value)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyManifest()
    if (error instanceof SyntaxError) {
      throw new PresentationDocumentError('素材清单已损坏，请修复 assets.json 后重试', 500, 'ASSET_MANIFEST_INVALID', { cause: error })
    }
    throw error
  }
}

async function writeManifest(cwd: string, jobId: string, manifest: PresentationAssetManifest): Promise<void> {
  const path = manifestPath(cwd, jobId)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

async function withManifestLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = manifestLocks.get(key) ?? Promise.resolve()
  let release = (): void => {}
  const current = new Promise<void>((resolveCurrent) => { release = resolveCurrent })
  const queued = previous.then(() => current)
  manifestLocks.set(key, queued)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (manifestLocks.get(key) === queued) manifestLocks.delete(key)
  }
}

function clampUnit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, Number(value)))
}

export async function readPresentationAssets(cwd: string, jobId: string): Promise<PresentationAssetManifest> {
  await readPresentationJob(cwd, jobId)
  return readManifestFile(cwd, jobId)
}

export async function uploadPresentationAsset(
  cwd: string,
  jobId: string,
  fileName: string,
  bytes: Buffer,
  now = new Date(),
): Promise<PresentationAssetManifest> {
  await readPresentationJob(cwd, jobId)
  if (bytes.length === 0) throw new PresentationDocumentError('上传的图片是空文件', 400, 'EMPTY_ASSET')
  const name = safeAssetName(fileName)
  const image = inspectPresentationImage(bytes)
  const digest = createHash('sha256').update(bytes).digest('hex')
  const id = `asset-${digest.slice(0, 16)}`

  return withManifestLock(manifestPath(cwd, jobId), async () => {
    const manifest = await readManifestFile(cwd, jobId)
    if (manifest.assets.some(asset => asset.id === id)) return manifest
    await mkdir(assetDirectory(cwd, jobId), { recursive: true })
    const file = `assets/${id}${image.extension}`
    await writeFile(assetFilePath(cwd, jobId, file), bytes, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    const createdAt = now.toISOString()
    manifest.assets.push({
      id,
      name,
      file,
      mimeType: image.mimeType,
      bytes: bytes.length,
      width: image.width,
      height: image.height,
      source: 'user-upload',
      createdAt,
    })
    manifest.updatedAt = createdAt
    await writeManifest(cwd, jobId, manifest)
    return manifest
  })
}

export async function bindPresentationAsset(
  cwd: string,
  jobId: string,
  slotId: string,
  options: BindPresentationAssetOptions,
  now = new Date(),
): Promise<PresentationAssetManifest> {
  await readPresentationJob(cwd, jobId)
  if (!isPresentationImageSlotId(slotId)) {
    throw new PresentationDocumentError('图片槽位 ID 无效', 400, 'INVALID_IMAGE_SLOT')
  }
  return withManifestLock(manifestPath(cwd, jobId), async () => {
    const manifest = await readManifestFile(cwd, jobId)
    const index = manifest.bindings.findIndex(binding => binding.slotId === slotId)
    if (options.assetId === null) {
      if (index >= 0) manifest.bindings.splice(index, 1)
    } else {
      if (!manifest.assets.some(asset => asset.id === options.assetId)) {
        throw new PresentationDocumentError('选择的图片素材不存在', 404, 'ASSET_NOT_FOUND')
      }
      const updatedAt = now.toISOString()
      const binding: PresentationAssetBinding = {
        slotId,
        assetId: options.assetId,
        fit: options.fit === 'contain' ? 'contain' : 'cover',
        focalPoint: {
          x: clampUnit(options.focalPoint?.x, 0.5),
          y: clampUnit(options.focalPoint?.y, 0.5),
        },
        updatedAt,
      }
      if (index >= 0) manifest.bindings[index] = binding
      else manifest.bindings.push(binding)
    }
    manifest.updatedAt = now.toISOString()
    await writeManifest(cwd, jobId, manifest)
    return manifest
  })
}

export async function deletePresentationAsset(cwd: string, jobId: string, assetId: string): Promise<PresentationAssetManifest> {
  await readPresentationJob(cwd, jobId)
  return withManifestLock(manifestPath(cwd, jobId), async () => {
    const manifest = await readManifestFile(cwd, jobId)
    const index = manifest.assets.findIndex(asset => asset.id === assetId)
    if (index < 0) throw new PresentationDocumentError('图片素材不存在', 404, 'ASSET_NOT_FOUND')
    if (manifest.bindings.some(binding => binding.assetId === assetId)) {
      throw new PresentationDocumentError('图片仍被幻灯片使用，请先从对应槽位移除或替换', 409, 'ASSET_IN_USE')
    }
    const [asset] = manifest.assets.splice(index, 1)
    await unlink(assetFilePath(cwd, jobId, asset.file)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    manifest.updatedAt = new Date().toISOString()
    await writeManifest(cwd, jobId, manifest)
    return manifest
  })
}

export async function readPresentationAsset(cwd: string, jobId: string, assetId: string): Promise<PresentationAssetFile> {
  const manifest = await readPresentationAssets(cwd, jobId)
  const asset = manifest.assets.find(item => item.id === assetId)
  if (asset === undefined) throw new PresentationDocumentError('图片素材不存在', 404, 'ASSET_NOT_FOUND')
  return { asset, body: await readFile(assetFilePath(cwd, jobId, asset.file)) }
}
