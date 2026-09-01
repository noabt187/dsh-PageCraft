import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  inspectPresentationImage,
  readPresentationAsset,
  readPresentationAssets,
} from './assets.ts'
import { resolvePresentationJobDirectory } from './document.ts'
import { isPresentationJobId } from './presentation.ts'
import {
  PRESENTATION_PROJECT_MANIFEST,
  isPresentationTextFile,
  normalizePresentationProjectManifest,
  normalizePresentationProjectPath,
  presentationSourceLanguage,
} from './presentation-workspace.ts'
import type {
  PresentationProjectAsset,
  PresentationProjectAssetList,
  PresentationProjectManifest,
  PresentationWorkspaceFile,
  PresentationWorkspaceHistoryEntry,
  PresentationWorkspaceSummary,
  PresentationWorkspaceTreeEntry,
} from './presentation-workspace.ts'

export const DEFAULT_MAX_PRESENTATION_SOURCE_BYTES = 2 * 1024 * 1024
export const DEFAULT_PRESENTATION_HISTORY_LIMIT = 20
export const DEFAULT_PRESENTATION_HISTORY_MAX_BYTES = 20 * 1024 * 1024

interface SourceWorkspaceOptions {
  maxSourceBytes?: number
  historyLimit?: number
  historyMaxBytes?: number
}

interface PresentationEntryInput {
  path: string
  kind: 'file' | 'directory'
  content?: string
}

interface ProjectAssetBindingInput {
  imageKey: string
  assetPath: string
  alt?: string
  fit?: 'cover' | 'contain'
  focalPoint?: { x?: number; y?: number }
  baseHash: string
}

interface StoredHistoryEntry extends PresentationWorkspaceHistoryEntry {
  content: string
}

interface DeckSlide {
  id?: unknown
  visual?: unknown
  [key: string]: unknown
}

interface DeckDocument {
  slides?: unknown
  [key: string]: unknown
}

export class PresentationWorkspaceError extends Error {
  override readonly name = 'PresentationWorkspaceError'

  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'PRESENTATION_WORKSPACE_ERROR',
    readonly details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function workspaceRoot(cwd: string): string {
  if (!isAbsolute(cwd)) throw new PresentationWorkspaceError('当前会话没有有效的绝对工作目录', 409, 'SESSION_CWD_INVALID')
  return resolve(cwd)
}

function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`)
}

function normalizedPath(value: unknown): string {
  const path = normalizePresentationProjectPath(value)
  if (path === null) throw new PresentationWorkspaceError('文件路径无效', 400, 'INVALID_PRESENTATION_PATH')
  return path
}

function manifestFile(cwd: string): string {
  return resolve(workspaceRoot(cwd), PRESENTATION_PROJECT_MANIFEST)
}

function protectedPaths(manifest: PresentationProjectManifest): Set<string> {
  return new Set([PRESENTATION_PROJECT_MANIFEST, manifest.deck, manifest.theme])
}

function sourcePathAllowed(manifest: PresentationProjectManifest, path: string): boolean {
  return path === PRESENTATION_PROJECT_MANIFEST || manifest.editableFiles.includes(path)
}

function entryPathAllowed(manifest: PresentationProjectManifest, path: string): boolean {
  return path === manifest.sourceRoot || path.startsWith(`${manifest.sourceRoot}/`)
}

function assetPathAllowed(manifest: PresentationProjectManifest, path: string): boolean {
  return path.startsWith(`${manifest.assets}/`)
}

async function validateResolvedPath(cwd: string, relativePath: string, allowedRoot: string, mustExist: boolean): Promise<string> {
  const root = workspaceRoot(cwd)
  const target = resolve(root, relativePath)
  const declaredRoot = resolve(root, allowedRoot)
  if (!isWithin(declaredRoot, target)) {
    throw new PresentationWorkspaceError('文件路径超出演示文稿允许范围', 403, 'PRESENTATION_PATH_FORBIDDEN')
  }

  try {
    const [realDeclaredRoot, realTarget] = await Promise.all([realpath(declaredRoot), realpath(target)])
    if (!isWithin(realDeclaredRoot, realTarget)) {
      throw new PresentationWorkspaceError('符号链接指向演示文稿目录之外', 403, 'PRESENTATION_SYMLINK_ESCAPE')
    }
    const metadata = await lstat(target)
    if (metadata.isSymbolicLink()) {
      throw new PresentationWorkspaceError('源码工作区不允许编辑符号链接', 403, 'PRESENTATION_SYMLINK_FORBIDDEN')
    }
    return target
  } catch (error) {
    if (error instanceof PresentationWorkspaceError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    if (mustExist) throw new PresentationWorkspaceError('文件或目录不存在', 404, 'PRESENTATION_ENTRY_NOT_FOUND')
  }

  const parent = dirname(target)
  const realDeclaredRoot = await realpath(declaredRoot)
  const realParent = await realpath(parent).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new PresentationWorkspaceError('目标目录不存在', 404, 'PRESENTATION_PARENT_NOT_FOUND')
    throw error
  })
  if (!isWithin(realDeclaredRoot, realParent)) {
    throw new PresentationWorkspaceError('目标目录通过符号链接越界', 403, 'PRESENTATION_SYMLINK_ESCAPE')
  }
  return target
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeTextAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, 'utf8')
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

async function readManifest(cwd: string): Promise<PresentationProjectManifest> {
  try {
    const value = JSON.parse(await readFile(manifestFile(cwd), 'utf8'))
    const manifest = normalizePresentationProjectManifest(value)
    if (manifest === null) throw new PresentationWorkspaceError('pagecraft-presentation.json 格式无效', 422, 'PRESENTATION_MANIFEST_INVALID')
    await Promise.all([
      validateResolvedPath(cwd, manifest.sourceRoot, manifest.sourceRoot, true),
      validateResolvedPath(cwd, manifest.deck, manifest.sourceRoot, true),
      validateResolvedPath(cwd, manifest.theme, manifest.sourceRoot, true),
    ])
    return manifest
  } catch (error) {
    if (error instanceof PresentationWorkspaceError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new PresentationWorkspaceError('当前项目还没有 PageCraft PPT 源码清单', 404, 'PRESENTATION_MANIFEST_NOT_FOUND')
    }
    if (error instanceof SyntaxError) {
      throw new PresentationWorkspaceError('pagecraft-presentation.json 不是有效 JSON', 422, 'PRESENTATION_MANIFEST_INVALID', undefined, { cause: error })
    }
    throw error
  }
}

function fileSnapshot(path: string, content: string, updatedAt: string, manifest: PresentationProjectManifest): PresentationWorkspaceFile {
  return {
    path,
    content,
    hash: sha256(content),
    bytes: Buffer.byteLength(content, 'utf8'),
    updatedAt,
    language: presentationSourceLanguage(path),
    protected: protectedPaths(manifest).has(path),
  }
}

function fileName(path: string): string {
  const parts = path.split('/')
  return parts.at(-1) ?? path
}

interface MutableTreeEntry extends PresentationWorkspaceTreeEntry {
  children: MutableTreeEntry[]
}

function treeFromPaths(
  rootPath: string,
  paths: string[],
  protectedSet: Set<string>,
  directories: Set<string> = new Set(),
): PresentationWorkspaceTreeEntry {
  const root: MutableTreeEntry = {
    path: rootPath,
    name: fileName(rootPath),
    kind: 'directory',
    protected: false,
    children: [],
  }
  for (const path of paths.sort((left, right) => left.localeCompare(right))) {
    if (path === rootPath || !path.startsWith(`${rootPath}/`)) continue
    const parts = path.slice(rootPath.length + 1).split('/')
    let parent = root
    let currentPath = rootPath
    for (const [index, part] of parts.entries()) {
      currentPath = `${currentPath}/${part}`
      const kind = index === parts.length - 1 && !directories.has(currentPath) ? 'file' : 'directory'
      let child = parent.children.find(item => item.path === currentPath)
      if (child === undefined) {
        child = { path: currentPath, name: part, kind, protected: protectedSet.has(currentPath), children: [] }
        parent.children.push(child)
      }
      parent = child
    }
  }
  const sortChildren = (entry: MutableTreeEntry): void => {
    entry.children.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    entry.children.forEach(sortChildren)
  }
  sortChildren(root)
  return root
}

async function discoverAssetPaths(cwd: string, manifest: PresentationProjectManifest): Promise<string[]> {
  const directory = resolve(workspaceRoot(cwd), manifest.assets)
  await mkdir(directory, { recursive: true })
  const output: string[] = []

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > 6 || output.length >= 500) return
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const absolute = resolve(current, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      output.push(relative(workspaceRoot(cwd), absolute).replaceAll('\\', '/'))
    }
  }

  await walk(directory, 0)
  return output
}

async function discoverSourceDirectories(cwd: string, manifest: PresentationProjectManifest): Promise<string[]> {
  const root = workspaceRoot(cwd)
  const sourceRoot = resolve(root, manifest.sourceRoot)
  const output: string[] = []

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > 12 || output.length >= 500) return
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const absolute = resolve(current, entry.name)
      output.push(relative(root, absolute).replaceAll('\\', '/'))
      await walk(absolute, depth + 1)
    }
  }

  await walk(sourceRoot, 0)
  return output
}

function historyDirectory(cwd: string, path: string): string {
  return resolve(workspaceRoot(cwd), '.pagecraft', 'presentation-workspace-history', sha256(path).slice(0, 20))
}

async function storeHistory(
  cwd: string,
  path: string,
  content: string,
  options: SourceWorkspaceOptions,
): Promise<void> {
  const directory = historyDirectory(cwd, path)
  await mkdir(directory, { recursive: true })
  const createdAt = new Date().toISOString()
  const id = `${createdAt.replace(/[:.]/g, '-')}-${sha256(content).slice(0, 12)}`
  const entry: StoredHistoryEntry = {
    id,
    path,
    hash: sha256(content),
    bytes: Buffer.byteLength(content, 'utf8'),
    createdAt,
    content,
  }
  await writeJsonAtomic(resolve(directory, `${id}.json`), entry)
  const files = (await readdir(directory)).filter(name => name.endsWith('.json')).sort().reverse()
  const historyLimit = Math.max(1, options.historyLimit ?? DEFAULT_PRESENTATION_HISTORY_LIMIT)
  const historyMaxBytes = Math.max(
    options.maxSourceBytes ?? DEFAULT_MAX_PRESENTATION_SOURCE_BYTES,
    options.historyMaxBytes ?? DEFAULT_PRESENTATION_HISTORY_MAX_BYTES,
  )
  let retainedBytes = 0
  const stale: string[] = []
  for (const [index, name] of files.entries()) {
    const file = resolve(directory, name)
    const bytes = (await stat(file)).size
    if (index >= historyLimit || (index > 0 && retainedBytes + bytes > historyMaxBytes)) stale.push(file)
    else retainedBytes += bytes
  }
  await Promise.all(stale.map(file => unlink(file).catch(() => {})))
}

async function updateManifest(cwd: string, manifest: PresentationProjectManifest): Promise<void> {
  const normalized = normalizePresentationProjectManifest(manifest)
  if (normalized === null) throw new PresentationWorkspaceError('更新后的演示文稿清单无效', 422, 'PRESENTATION_MANIFEST_INVALID')
  await writeJsonAtomic(manifestFile(cwd), normalized)
}

async function currentSourceFile(cwd: string, path: string, manifest: PresentationProjectManifest, maxBytes: number): Promise<PresentationWorkspaceFile> {
  if (!sourcePathAllowed(manifest, path)) {
    throw new PresentationWorkspaceError('文件不在演示文稿可编辑清单中', 403, 'PRESENTATION_FILE_FORBIDDEN')
  }
  if (path !== PRESENTATION_PROJECT_MANIFEST && !isPresentationTextFile(path)) {
    throw new PresentationWorkspaceError('该文件类型不能作为文本编辑', 415, 'PRESENTATION_FILE_TYPE_UNSUPPORTED')
  }
  const allowedRoot = path === PRESENTATION_PROJECT_MANIFEST ? '.' : manifest.sourceRoot
  const absolute = path === PRESENTATION_PROJECT_MANIFEST
    ? manifestFile(cwd)
    : await validateResolvedPath(cwd, path, allowedRoot, true)
  const metadata = await stat(absolute)
  if (!metadata.isFile()) throw new PresentationWorkspaceError('目标不是文本文件', 415, 'PRESENTATION_ENTRY_NOT_FILE')
  if (metadata.size > maxBytes) throw new PresentationWorkspaceError('源码文件超过编辑大小限制', 413, 'PRESENTATION_FILE_TOO_LARGE')
  const content = await readFile(absolute, 'utf8')
  if (content.includes('\u0000')) throw new PresentationWorkspaceError('二进制文件不能在源码编辑器中打开', 415, 'PRESENTATION_FILE_BINARY')
  return fileSnapshot(path, content, metadata.mtime.toISOString(), manifest)
}

function validateJsonContent(path: string, content: string): void {
  if (extname(path).toLowerCase() !== '.json') return
  try {
    JSON.parse(content)
  } catch (error) {
    throw new PresentationWorkspaceError(
      `JSON 语法错误：${error instanceof Error ? error.message : String(error)}`,
      422,
      'PRESENTATION_JSON_INVALID',
      undefined,
      { cause: error },
    )
  }
}

function safeCreatedPath(manifest: PresentationProjectManifest, input: unknown): string {
  const path = normalizedPath(input)
  if (!entryPathAllowed(manifest, path) || path === manifest.sourceRoot) {
    throw new PresentationWorkspaceError('只能在演示文稿源码目录中创建文件', 403, 'PRESENTATION_ENTRY_FORBIDDEN')
  }
  return path
}

function assetExtension(info: { extension: string }): string {
  return info.extension === '.jpeg' ? '.jpg' : info.extension
}

function safeAssetStem(fileName: string): string {
  const stem = basename(fileName, extname(fileName))
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return stem || 'image'
}

function deckSlides(value: unknown): DeckSlide[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const slides = (value as DeckDocument).slides
  return Array.isArray(slides) ? slides.filter(slide => slide !== null && typeof slide === 'object' && !Array.isArray(slide)) as DeckSlide[] : []
}

function visualSource(slide: DeckSlide): string | null {
  if (slide.visual === null || typeof slide.visual !== 'object' || Array.isArray(slide.visual)) return null
  const src = (slide.visual as Record<string, unknown>).src
  return typeof src === 'string' ? src : null
}

function publicAssetUrl(manifest: PresentationProjectManifest, assetPath: string): string {
  const suffix = assetPath.slice(manifest.assets.length + 1).split('/').map(encodeURIComponent).join('/')
  return `${manifest.publicAssetBase}/${suffix}`
}

function referencedSlides(deck: unknown, publicUrl: string): string[] {
  return deckSlides(deck)
    .filter(slide => visualSource(slide) === publicUrl)
    .map(slide => typeof slide.id === 'string' ? slide.id : '')
    .filter(Boolean)
}

export async function readPresentationWorkspaceSummary(cwd: string): Promise<PresentationWorkspaceSummary> {
  const workspacePath = workspaceRoot(cwd)
  try {
    return { available: true, workspacePath, manifest: await readManifest(cwd) }
  } catch (error) {
    if (error instanceof PresentationWorkspaceError && error.code === 'PRESENTATION_MANIFEST_NOT_FOUND') {
      return { available: false, workspacePath, reason: error.message, migrationAvailable: true }
    }
    if (error instanceof PresentationWorkspaceError) {
      return { available: false, workspacePath, reason: error.message, migrationAvailable: false }
    }
    throw error
  }
}

export async function readPresentationWorkspaceTree(cwd: string): Promise<PresentationWorkspaceTreeEntry[]> {
  const manifest = await readManifest(cwd)
  const sourcePaths = manifest.editableFiles.filter(asyncPath => asyncPath.startsWith(`${manifest.sourceRoot}/`))
  const sourceDirectories = await discoverSourceDirectories(cwd, manifest)
  const assetPaths = await discoverAssetPaths(cwd, manifest)
  return [
    {
      path: PRESENTATION_PROJECT_MANIFEST,
      name: PRESENTATION_PROJECT_MANIFEST,
      kind: 'file',
      protected: true,
    },
    treeFromPaths(
      manifest.sourceRoot,
      [...sourceDirectories, ...sourcePaths],
      protectedPaths(manifest),
      new Set(sourceDirectories),
    ),
    treeFromPaths(manifest.assets, assetPaths, new Set()),
  ]
}

export async function readPresentationSourceFile(
  cwd: string,
  rawPath: unknown,
  options: SourceWorkspaceOptions = {},
): Promise<PresentationWorkspaceFile> {
  const manifest = await readManifest(cwd)
  return currentSourceFile(cwd, normalizedPath(rawPath), manifest, options.maxSourceBytes ?? DEFAULT_MAX_PRESENTATION_SOURCE_BYTES)
}

export async function savePresentationSourceFile(
  cwd: string,
  rawPath: unknown,
  content: string,
  baseHash: string,
  options: SourceWorkspaceOptions = {},
): Promise<PresentationWorkspaceFile> {
  const manifest = await readManifest(cwd)
  const path = normalizedPath(rawPath)
  const maxBytes = options.maxSourceBytes ?? DEFAULT_MAX_PRESENTATION_SOURCE_BYTES
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new PresentationWorkspaceError('源码内容超过保存大小限制', 413, 'PRESENTATION_FILE_TOO_LARGE')
  }
  const current = await currentSourceFile(cwd, path, manifest, maxBytes)
  if (current.hash !== baseHash) {
    throw new PresentationWorkspaceError('文件已经被 Agent 或其他编辑器修改', 409, 'PRESENTATION_FILE_CONFLICT', { current })
  }
  validateJsonContent(path, content)
  if (path === PRESENTATION_PROJECT_MANIFEST && normalizePresentationProjectManifest(JSON.parse(content)) === null) {
    throw new PresentationWorkspaceError('演示文稿清单格式无效', 422, 'PRESENTATION_MANIFEST_INVALID')
  }
  await storeHistory(cwd, path, current.content, options)
  const absolute = path === PRESENTATION_PROJECT_MANIFEST
    ? manifestFile(cwd)
    : await validateResolvedPath(cwd, path, manifest.sourceRoot, true)
  await writeTextAtomic(absolute, content)
  const metadata = await stat(absolute)
  const nextManifest = path === PRESENTATION_PROJECT_MANIFEST
    ? normalizePresentationProjectManifest(JSON.parse(content)) ?? manifest
    : manifest
  return fileSnapshot(path, content, metadata.mtime.toISOString(), nextManifest)
}

export async function createPresentationEntry(cwd: string, input: PresentationEntryInput): Promise<PresentationWorkspaceTreeEntry[]> {
  const manifest = await readManifest(cwd)
  const path = safeCreatedPath(manifest, input.path)
  const target = await validateResolvedPath(cwd, path, manifest.sourceRoot, false)
  if (input.kind === 'directory') {
    await mkdir(target)
  } else {
    if (!isPresentationTextFile(path)) throw new PresentationWorkspaceError('不支持创建这种源码文件', 415, 'PRESENTATION_FILE_TYPE_UNSUPPORTED')
    validateJsonContent(path, input.content ?? '')
    await writeFile(target, input.content ?? '', { encoding: 'utf8', flag: 'wx' })
    manifest.editableFiles = [...manifest.editableFiles, path]
    await updateManifest(cwd, manifest)
  }
  return readPresentationWorkspaceTree(cwd)
}

export async function renamePresentationEntry(cwd: string, rawPath: unknown, rawNextPath: unknown): Promise<PresentationWorkspaceTreeEntry[]> {
  const manifest = await readManifest(cwd)
  const path = safeCreatedPath(manifest, rawPath)
  const nextPath = safeCreatedPath(manifest, rawNextPath)
  if (protectedPaths(manifest).has(path)) throw new PresentationWorkspaceError('受保护文件不能重命名', 409, 'PRESENTATION_ENTRY_PROTECTED')
  const source = await validateResolvedPath(cwd, path, manifest.sourceRoot, true)
  const target = await validateResolvedPath(cwd, nextPath, manifest.sourceRoot, false)
  if (source === target) return readPresentationWorkspaceTree(cwd)
  const metadata = await lstat(source)
  if (metadata.isFile() && !isPresentationTextFile(nextPath)) {
    throw new PresentationWorkspaceError('源码文件只能重命名为支持的文本类型', 415, 'PRESENTATION_FILE_TYPE_UNSUPPORTED')
  }
  try {
    await lstat(target)
    throw new PresentationWorkspaceError('目标文件或目录已经存在', 409, 'PRESENTATION_ENTRY_EXISTS')
  } catch (error) {
    if (error instanceof PresentationWorkspaceError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await rename(source, target)
  manifest.editableFiles = manifest.editableFiles.map(file => {
    if (file === path) return nextPath
    if (file.startsWith(`${path}/`)) return `${nextPath}${file.slice(path.length)}`
    return file
  })
  await updateManifest(cwd, manifest)
  return readPresentationWorkspaceTree(cwd)
}

export async function deletePresentationEntry(cwd: string, rawPath: unknown): Promise<PresentationWorkspaceTreeEntry[]> {
  const manifest = await readManifest(cwd)
  const path = safeCreatedPath(manifest, rawPath)
  if (protectedPaths(manifest).has(path)) throw new PresentationWorkspaceError('受保护文件不能删除', 409, 'PRESENTATION_ENTRY_PROTECTED')
  const target = await validateResolvedPath(cwd, path, manifest.sourceRoot, true)
  const metadata = await lstat(target)
  if (metadata.isDirectory()) await rm(target, { recursive: true })
  else await unlink(target)
  manifest.editableFiles = manifest.editableFiles.filter(file => file !== path && !file.startsWith(`${path}/`))
  await updateManifest(cwd, manifest)
  return readPresentationWorkspaceTree(cwd)
}

export async function readPresentationFileHistory(cwd: string, rawPath: unknown): Promise<PresentationWorkspaceHistoryEntry[]> {
  const manifest = await readManifest(cwd)
  const path = normalizedPath(rawPath)
  if (!sourcePathAllowed(manifest, path)) throw new PresentationWorkspaceError('文件不在可编辑清单中', 403, 'PRESENTATION_FILE_FORBIDDEN')
  const directory = historyDirectory(cwd, path)
  try {
    const files = (await readdir(directory)).filter(name => name.endsWith('.json')).sort().reverse()
    const entries: PresentationWorkspaceHistoryEntry[] = []
    for (const file of files) {
      const value = JSON.parse(await readFile(resolve(directory, file), 'utf8')) as StoredHistoryEntry
      entries.push({ id: value.id, path: value.path, hash: value.hash, bytes: value.bytes, createdAt: value.createdAt })
    }
    return entries
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export async function restorePresentationFileHistory(
  cwd: string,
  rawPath: unknown,
  historyId: string,
  baseHash: string,
  options: SourceWorkspaceOptions = {},
): Promise<PresentationWorkspaceFile> {
  const path = normalizedPath(rawPath)
  if (!/^[0-9TZ-]+-[a-f0-9]{12}$/.test(historyId)) throw new PresentationWorkspaceError('历史版本 ID 无效', 400, 'PRESENTATION_HISTORY_ID_INVALID')
  const value = JSON.parse(await readFile(resolve(historyDirectory(cwd, path), `${historyId}.json`), 'utf8')) as StoredHistoryEntry
  if (value.path !== path || typeof value.content !== 'string') throw new PresentationWorkspaceError('历史版本数据无效', 422, 'PRESENTATION_HISTORY_INVALID')
  return savePresentationSourceFile(cwd, path, value.content, baseHash, options)
}

export async function listPresentationProjectAssets(cwd: string): Promise<PresentationProjectAssetList> {
  const manifest = await readManifest(cwd)
  const deckFile = await readPresentationSourceFile(cwd, manifest.deck)
  const deck = JSON.parse(deckFile.content) as unknown
  const assets: PresentationProjectAsset[] = []
  for (const path of await discoverAssetPaths(cwd, manifest)) {
    const absolute = await validateResolvedPath(cwd, path, manifest.assets, true)
    const body = await readFile(absolute)
    try {
      const image = inspectPresentationImage(body)
      const publicUrl = publicAssetUrl(manifest, path)
      assets.push({
        id: sha256(body).slice(0, 16),
        name: fileName(path),
        path,
        publicUrl,
        mimeType: image.mimeType,
        bytes: body.length,
        width: image.width,
        height: image.height,
        references: referencedSlides(deck, publicUrl),
      })
    } catch {
      // The public directory may contain non-image files. They remain visible
      // in the file tree but are omitted from the managed image library.
    }
  }
  return { assets }
}

export async function uploadPresentationProjectAsset(cwd: string, fileName: string, body: Buffer): Promise<PresentationProjectAssetList> {
  const manifest = await readManifest(cwd)
  const image = inspectPresentationImage(body)
  const digest = sha256(body)
  const path = `${manifest.assets}/${safeAssetStem(fileName)}-${digest.slice(0, 8)}${assetExtension(image)}`
  await mkdir(resolve(workspaceRoot(cwd), manifest.assets), { recursive: true })
  const target = await validateResolvedPath(cwd, path, manifest.assets, false)
  await writeFile(target, body, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })
  return listPresentationProjectAssets(cwd)
}

export async function bindPresentationProjectAsset(
  cwd: string,
  input: ProjectAssetBindingInput,
  options: SourceWorkspaceOptions = {},
): Promise<{ file: PresentationWorkspaceFile; assets: PresentationProjectAsset[] }> {
  const manifest = await readManifest(cwd)
  const match = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,79})\.visual$/.exec(input.imageKey)
  if (match === null) throw new PresentationWorkspaceError('图片编辑键无效', 400, 'PRESENTATION_IMAGE_KEY_INVALID')
  const assetPath = normalizedPath(input.assetPath)
  if (!assetPathAllowed(manifest, assetPath)) throw new PresentationWorkspaceError('图片不在项目素材目录中', 403, 'PRESENTATION_ASSET_FORBIDDEN')
  await validateResolvedPath(cwd, assetPath, manifest.assets, true)
  const deckFile = await readPresentationSourceFile(cwd, manifest.deck, options)
  if (deckFile.hash !== input.baseHash) {
    throw new PresentationWorkspaceError('deck.json 已被其他操作修改', 409, 'PRESENTATION_FILE_CONFLICT', { current: deckFile })
  }
  const deck = JSON.parse(deckFile.content) as DeckDocument
  const slide = deckSlides(deck).find(item => item.id === match[1])
  if (slide === undefined) throw new PresentationWorkspaceError('找不到图片槽位对应的幻灯片', 404, 'PRESENTATION_SLIDE_NOT_FOUND')
  const x = Math.min(1, Math.max(0, Number.isFinite(input.focalPoint?.x) ? Number(input.focalPoint?.x) : 0.5))
  const y = Math.min(1, Math.max(0, Number.isFinite(input.focalPoint?.y) ? Number(input.focalPoint?.y) : 0.5))
  slide.visual = {
    type: 'image',
    src: publicAssetUrl(manifest, assetPath),
    alt: typeof input.alt === 'string' ? input.alt.trim().slice(0, 300) : '',
    fit: input.fit === 'contain' ? 'contain' : 'cover',
    position: `${Math.round(x * 100)}% ${Math.round(y * 100)}%`,
  }
  const file = await savePresentationSourceFile(cwd, manifest.deck, `${JSON.stringify(deck, null, 2)}\n`, deckFile.hash, options)
  return { file, assets: (await listPresentationProjectAssets(cwd)).assets }
}

export async function deletePresentationProjectAsset(cwd: string, rawPath: unknown): Promise<PresentationProjectAssetList> {
  const manifest = await readManifest(cwd)
  const path = normalizedPath(rawPath)
  if (!assetPathAllowed(manifest, path)) throw new PresentationWorkspaceError('图片不在项目素材目录中', 403, 'PRESENTATION_ASSET_FORBIDDEN')
  const publicUrl = publicAssetUrl(manifest, path)
  const deck = JSON.parse((await readPresentationSourceFile(cwd, manifest.deck)).content) as unknown
  const references = referencedSlides(deck, publicUrl)
  if (references.length > 0) {
    throw new PresentationWorkspaceError('图片仍被幻灯片使用，请先替换对应槽位', 409, 'PRESENTATION_ASSET_IN_USE', { references })
  }
  await unlink(await validateResolvedPath(cwd, path, manifest.assets, true))
  return listPresentationProjectAssets(cwd)
}

export async function readPresentationProjectAsset(cwd: string, rawPath: unknown): Promise<{ body: Buffer; mimeType: string }> {
  const manifest = await readManifest(cwd)
  const path = normalizedPath(rawPath)
  if (!assetPathAllowed(manifest, path)) throw new PresentationWorkspaceError('图片不在项目素材目录中', 403, 'PRESENTATION_ASSET_FORBIDDEN')
  const body = await readFile(await validateResolvedPath(cwd, path, manifest.assets, true))
  return { body, mimeType: inspectPresentationImage(body).mimeType }
}

async function discoverPresentationSourceFiles(cwd: string): Promise<string[]> {
  const root = workspaceRoot(cwd)
  const ignored = new Set(['.git', '.pagecraft', 'node_modules', 'dist', 'build', '.next', 'coverage'])
  const files: string[] = []

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 5 || files.length >= 2000) return
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || ignored.has(entry.name)) continue
      const absolute = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      files.push(relative(root, absolute).replaceAll('\\', '/'))
    }
  }

  await walk(root, 0)
  return files
}

async function discoverFilesInside(cwd: string, relativeRoot: string): Promise<string[]> {
  const root = workspaceRoot(cwd)
  const directory = resolve(root, relativeRoot)
  const files: string[] = []

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > 6 || files.length >= 500) return
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const absolute = resolve(current, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1)
        continue
      }
      if (entry.isFile()) files.push(relative(root, absolute).replaceAll('\\', '/'))
    }
  }

  try {
    await walk(directory, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return files
}

function presentationTitle(deck: unknown, cwd: string): string {
  if (deck !== null && typeof deck === 'object' && !Array.isArray(deck)) {
    const title = (deck as Record<string, unknown>).title
    if (typeof title === 'string' && title.trim().length > 0) return title.trim().slice(0, 200)
  }
  return basename(workspaceRoot(cwd)).slice(0, 200) || 'PageCraft Presentation'
}

async function migrateLegacyTaskAssets(
  cwd: string,
  jobId: string,
  manifest: PresentationProjectManifest,
  deck: DeckDocument,
): Promise<DeckDocument> {
  if (!isPresentationJobId(jobId)) return deck
  let legacy
  try {
    legacy = await readPresentationAssets(cwd, jobId)
  } catch {
    return deck
  }
  if (legacy.assets.length === 0) return deck
  const copied = new Map<string, string>()
  await mkdir(resolve(workspaceRoot(cwd), manifest.assets), { recursive: true })
  for (const asset of legacy.assets) {
    const { body } = await readPresentationAsset(cwd, jobId, asset.id)
    const image = inspectPresentationImage(body)
    const path = `${manifest.assets}/${safeAssetStem(asset.name)}-${sha256(body).slice(0, 8)}${assetExtension(image)}`
    await writeFile(await validateResolvedPath(cwd, path, manifest.assets, false), body, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    copied.set(asset.id, publicAssetUrl(manifest, path))
  }
  const slides = deckSlides(deck)
  for (const binding of legacy.bindings) {
    const slide = slides.find(item => typeof item.id === 'string' && binding.slotId.startsWith(item.id))
    const src = copied.get(binding.assetId)
    if (slide === undefined || src === undefined) continue
    slide.visual = {
      type: 'image',
      src,
      alt: '',
      fit: binding.fit,
      position: `${Math.round(binding.focalPoint.x * 100)}% ${Math.round(binding.focalPoint.y * 100)}%`,
    }
  }
  return deck
}

export async function migratePresentationWorkspace(cwd: string, legacyJobId?: string): Promise<PresentationWorkspaceSummary> {
  const current = await readPresentationWorkspaceSummary(cwd)
  if (current.available) return current
  let files = await discoverPresentationSourceFiles(cwd)
  const candidates: Array<{ path: string; deck: DeckDocument }> = []

  if (legacyJobId !== undefined && isPresentationJobId(legacyJobId)) {
    const taskRoot = relative(workspaceRoot(cwd), resolvePresentationJobDirectory(cwd, legacyJobId)).replaceAll('\\', '/')
    const taskFiles = await discoverFilesInside(cwd, taskRoot)
    const taskDeckPath = `${taskRoot}/deck.json`
    if (taskFiles.includes(taskDeckPath)) {
      try {
        const taskDeck = JSON.parse(await readFile(resolve(workspaceRoot(cwd), taskDeckPath), 'utf8')) as DeckDocument
        if (taskDeck !== null && typeof taskDeck === 'object' && !Array.isArray(taskDeck)) {
          candidates.push({ path: taskDeckPath, deck: taskDeck })
          files = Array.from(new Set([...files, ...taskFiles]))
        }
      } catch {
        // The exact task deck is incomplete or invalid; fall back to safe project discovery.
      }
    }
  }

  const discoveryPaths = candidates.length > 0 ? [] : files.filter(file => file.endsWith('/deck.json'))
  for (const path of discoveryPaths) {
    try {
      const deck = JSON.parse(await readFile(resolve(workspaceRoot(cwd), path), 'utf8')) as DeckDocument
      if (deckSlides(deck).length > 0) candidates.push({ path, deck })
    } catch {
      // Invalid or unrelated deck.json files are not migration candidates.
    }
  }
  if (candidates.length !== 1) {
    throw new PresentationWorkspaceError(
      candidates.length === 0
        ? '没有找到位于独立源码目录中的标准 deck.json，需要 Agent 完成一次迁移'
        : '找到多个可能的 deck.json，无法安全判断目标，需要 Agent 完成一次迁移',
      409,
      'PRESENTATION_MIGRATION_AMBIGUOUS',
      { candidates: candidates.map(candidate => candidate.path) },
    )
  }
  const candidate = candidates[0]
  const sourceRoot = dirname(candidate.path).replaceAll('\\', '/')
  if (sourceRoot === '.' || sourceRoot.length === 0) {
    throw new PresentationWorkspaceError('根目录中的 deck.json 无法安全自动迁移，需要 Agent 整理到独立演示目录', 409, 'PRESENTATION_MIGRATION_AMBIGUOUS')
  }
  const theme = `${sourceRoot}/theme.css`
  if (!files.includes(theme)) await writeFile(resolve(workspaceRoot(cwd), theme), ':root { color-scheme: light; }\n', { flag: 'wx' })
  const editableFiles = Array.from(new Set([
    candidate.path,
    theme,
    ...files.filter(path => path.startsWith(`${sourceRoot}/`) && isPresentationTextFile(path)),
  ])).sort()
  const manifest: PresentationProjectManifest = {
    name: presentationTitle(candidate.deck, cwd),
    sourceRoot,
    deck: candidate.path,
    theme,
    assets: 'public/pagecraft-assets',
    publicAssetBase: '/pagecraft-assets',
    editableFiles,
  }
  await mkdir(resolve(workspaceRoot(cwd), manifest.assets), { recursive: true })
  await updateManifest(cwd, manifest)
  const originalDeck = `${JSON.stringify(candidate.deck, null, 2)}\n`
  const migratedDeck = await migrateLegacyTaskAssets(
    cwd,
    legacyJobId ?? '',
    manifest,
    JSON.parse(originalDeck) as DeckDocument,
  )
  if (`${JSON.stringify(migratedDeck, null, 2)}\n` !== originalDeck) {
    await storeHistory(cwd, candidate.path, originalDeck, {})
    await writeTextAtomic(resolve(workspaceRoot(cwd), candidate.path), `${JSON.stringify(migratedDeck, null, 2)}\n`)
  }
  return { available: true, workspacePath: workspaceRoot(cwd), manifest }
}
