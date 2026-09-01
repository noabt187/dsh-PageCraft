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
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  isWorkspaceImageFile,
  isWorkspaceTextFile,
  normalizeWorkspacePath,
  workspaceLanguage,
} from './workspace.ts'
import type {
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceHistoryEntry,
  WorkspaceSummary,
} from './workspace.ts'

export const DEFAULT_MAX_WORKSPACE_TEXT_BYTES = 2 * 1024 * 1024
export const DEFAULT_WORKSPACE_HISTORY_LIMIT = 20
export const DEFAULT_WORKSPACE_HISTORY_MAX_BYTES = 20 * 1024 * 1024

const HISTORY_DIRECTORY = '.pagecraft/workspace-history'

export interface WorkspaceOptions {
  maxTextBytes?: number
  historyLimit?: number
  historyMaxBytes?: number
}

export interface WorkspaceEntryInput {
  parent: string
  name: string
  kind: 'file' | 'directory'
  content?: string
}

export interface ResolvedWorkspaceTarget {
  root: string
  selectedRoot: string
  target: string
  relativePath: string
}

interface StoredHistoryEntry extends WorkspaceHistoryEntry {
  content: string
}

export class WorkspaceExplorerError extends Error {
  override readonly name = 'WorkspaceExplorerError'

  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'WORKSPACE_ERROR',
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
  if (!isAbsolute(cwd)) throw new WorkspaceExplorerError('当前会话没有有效的绝对工作目录', 409, 'SESSION_CWD_INVALID')
  return resolve(cwd)
}

function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`)
}

function normalizedPath(value: unknown, label: string): string {
  const path = normalizeWorkspacePath(value)
  if (path === null) throw new WorkspaceExplorerError(`${label}路径无效`, 400, 'WORKSPACE_PATH_INVALID')
  return path
}

function relativeToRoot(root: string, target: string): string {
  const path = relative(root, target).split(sep).join('/')
  return path.length === 0 ? '.' : path
}

async function existingRealPath(path: string, missingCode: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new WorkspaceExplorerError('文件或目录不存在', 404, missingCode)
    }
    throw error
  }
}

export async function resolveWorkspaceTarget(
  cwd: string,
  selectedFolder: unknown,
  path: unknown,
  mustExist: boolean,
): Promise<ResolvedWorkspaceTarget> {
  const root = workspaceRoot(cwd)
  const selectedPath = normalizedPath(selectedFolder, '所选文件夹')
  const targetPath = normalizedPath(path, '目标')
  const selectedRoot = selectedPath === '.' ? root : resolve(root, selectedPath)
  const target = targetPath === '.' ? root : resolve(root, targetPath)

  if (!isWithin(root, selectedRoot) || !isWithin(selectedRoot, target)) {
    throw new WorkspaceExplorerError('目标路径超出当前打开的文件夹', 403, 'WORKSPACE_PATH_FORBIDDEN')
  }

  const realRoot = await existingRealPath(root, 'WORKSPACE_ROOT_NOT_FOUND')
  const realSelectedRoot = await existingRealPath(selectedRoot, 'WORKSPACE_FOLDER_NOT_FOUND')
  if (!isWithin(realRoot, realSelectedRoot)) {
    throw new WorkspaceExplorerError('所选文件夹通过符号链接指向工作区之外', 403, 'WORKSPACE_SYMLINK_ESCAPE')
  }
  const selectedMetadata = await lstat(selectedRoot)
  if (!selectedMetadata.isDirectory()) {
    throw new WorkspaceExplorerError('所选路径不是文件夹', 409, 'WORKSPACE_FOLDER_REQUIRED')
  }
  if (selectedMetadata.isSymbolicLink()) {
    throw new WorkspaceExplorerError('不能把符号链接作为可编辑工作区', 403, 'WORKSPACE_SYMLINK_FORBIDDEN')
  }

  try {
    const metadata = await lstat(target)
    if (metadata.isSymbolicLink()) {
      throw new WorkspaceExplorerError('源码工作区不允许打开或编辑符号链接', 403, 'WORKSPACE_SYMLINK_FORBIDDEN')
    }
    const realTarget = await realpath(target)
    if (!isWithin(realSelectedRoot, realTarget)) {
      throw new WorkspaceExplorerError('符号链接指向所选文件夹之外', 403, 'WORKSPACE_SYMLINK_ESCAPE')
    }
  } catch (error) {
    if (error instanceof WorkspaceExplorerError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    if (mustExist) throw new WorkspaceExplorerError('文件或目录不存在', 404, 'WORKSPACE_ENTRY_NOT_FOUND')
    const parent = dirname(target)
    const realParent = await existingRealPath(parent, 'WORKSPACE_PARENT_NOT_FOUND')
    if (!isWithin(realSelectedRoot, realParent)) {
      throw new WorkspaceExplorerError('目标目录通过符号链接越界', 403, 'WORKSPACE_SYMLINK_ESCAPE')
    }
  }

  return { root, selectedRoot, target, relativePath: relativeToRoot(root, target) }
}

function entryKind(metadata: Awaited<ReturnType<typeof lstat>>): WorkspaceEntry['kind'] {
  if (metadata.isSymbolicLink()) return 'symlink'
  if (metadata.isDirectory()) return 'directory'
  return 'file'
}

async function workspaceEntry(root: string, absolutePath: string): Promise<WorkspaceEntry> {
  const metadata = await lstat(absolutePath)
  const path = relativeToRoot(root, absolutePath)
  const kind = entryKind(metadata)
  return {
    path,
    name: basename(absolutePath),
    kind,
    ...(kind === 'file' ? { bytes: metadata.size } : {}),
    updatedAt: metadata.mtime.toISOString(),
    textEditable: kind === 'file' && isWorkspaceTextFile(path),
    imagePreviewable: kind === 'file' && isWorkspaceImageFile(path),
  }
}

function sortEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries.sort((left, right) => {
    if (left.kind !== right.kind) {
      if (left.kind === 'directory') return -1
      if (right.kind === 'directory') return 1
      if (left.kind === 'symlink') return -1
      if (right.kind === 'symlink') return 1
    }
    return left.name.localeCompare(right.name)
  })
}

export async function readWorkspaceSummary(cwd: string, selectedFolder: unknown): Promise<WorkspaceSummary> {
  const selection = normalizedPath(selectedFolder, '所选文件夹')
  const resolved = await resolveWorkspaceTarget(cwd, selection, selection, true)
  return {
    rootPath: resolved.root,
    selectedFolder: selection,
    selectedPath: resolved.selectedRoot,
    watcher: 'unavailable',
    sequence: 0,
  }
}

export async function listWorkspaceFolders(cwd: string, parent: unknown): Promise<WorkspaceEntry[]> {
  const parentPath = normalizedPath(parent, '父文件夹')
  const resolved = await resolveWorkspaceTarget(cwd, '.', parentPath, true)
  const metadata = await lstat(resolved.target)
  if (!metadata.isDirectory()) throw new WorkspaceExplorerError('目标不是文件夹', 409, 'WORKSPACE_DIRECTORY_REQUIRED')
  const children = await readdir(resolved.target, { withFileTypes: true })
  const entries: WorkspaceEntry[] = []
  for (const child of children) {
    if (!child.isDirectory() || child.isSymbolicLink()) continue
    entries.push(await workspaceEntry(resolved.root, resolve(resolved.target, child.name)))
  }
  return sortEntries(entries)
}

export async function listWorkspaceDirectory(
  cwd: string,
  selectedFolder: unknown,
  directory: unknown,
): Promise<WorkspaceEntry[]> {
  const resolved = await resolveWorkspaceTarget(cwd, selectedFolder, directory, true)
  const metadata = await lstat(resolved.target)
  if (!metadata.isDirectory()) throw new WorkspaceExplorerError('目标不是文件夹', 409, 'WORKSPACE_DIRECTORY_REQUIRED')
  const children = await readdir(resolved.target, { withFileTypes: true })
  const entries = await Promise.all(children.map(child => workspaceEntry(resolved.root, resolve(resolved.target, child.name))))
  return sortEntries(entries)
}

function fileSnapshot(path: string, content: string, updatedAt: string): WorkspaceFile {
  return {
    path,
    content,
    hash: sha256(content),
    bytes: Buffer.byteLength(content, 'utf8'),
    updatedAt,
    language: workspaceLanguage(path),
  }
}

export async function readWorkspaceFile(
  cwd: string,
  selectedFolder: unknown,
  path: unknown,
  options: WorkspaceOptions = {},
): Promise<WorkspaceFile> {
  const resolved = await resolveWorkspaceTarget(cwd, selectedFolder, path, true)
  if (!isWorkspaceTextFile(resolved.relativePath)) {
    throw new WorkspaceExplorerError('这个文件不是 PageCraft 支持的文本文件', 415, 'WORKSPACE_TEXT_FILE_REQUIRED')
  }
  const metadata = await stat(resolved.target)
  if (!metadata.isFile()) throw new WorkspaceExplorerError('目标不是文件', 409, 'WORKSPACE_FILE_REQUIRED')
  const maxBytes = options.maxTextBytes ?? DEFAULT_MAX_WORKSPACE_TEXT_BYTES
  if (metadata.size > maxBytes) {
    throw new WorkspaceExplorerError(`文本文件超过 ${maxBytes} 字节限制`, 413, 'WORKSPACE_FILE_TOO_LARGE')
  }
  const body = await readFile(resolved.target)
  if (body.includes(0)) throw new WorkspaceExplorerError('文件包含二进制内容，不能作为文本编辑', 415, 'WORKSPACE_BINARY_FILE')
  return fileSnapshot(resolved.relativePath, body.toString('utf8'), metadata.mtime.toISOString())
}

function imageMimeType(path: string): string | null {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  return null
}

export async function readWorkspaceBlob(
  cwd: string,
  selectedFolder: unknown,
  path: unknown,
): Promise<{ body: Buffer; mimeType: string }> {
  const resolved = await resolveWorkspaceTarget(cwd, selectedFolder, path, true)
  const mimeType = imageMimeType(resolved.relativePath)
  if (mimeType === null) throw new WorkspaceExplorerError('只支持预览 PNG、JPEG、WebP 和 GIF 图片', 415, 'WORKSPACE_IMAGE_REQUIRED')
  const metadata = await stat(resolved.target)
  if (!metadata.isFile()) throw new WorkspaceExplorerError('目标不是文件', 409, 'WORKSPACE_FILE_REQUIRED')
  return { body: await readFile(resolved.target), mimeType }
}

export async function uploadWorkspaceImage(
  cwd: string,
  selectedFolder: unknown,
  parent: unknown,
  fileName: unknown,
  body: Buffer,
): Promise<WorkspaceEntry> {
  const parentPath = normalizedPath(parent, '父文件夹')
  const name = safeEntryName(fileName)
  if (!isWorkspaceImageFile(name)) {
    throw new WorkspaceExplorerError('只支持上传 PNG、JPEG、WebP 和 GIF 图片', 415, 'WORKSPACE_IMAGE_REQUIRED')
  }
  const path = parentPath === '.' ? name : `${parentPath}/${name}`
  const resolved = await resolveWorkspaceTarget(cwd, selectedFolder, path, false)
  try {
    await writeFile(resolved.target, body, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new WorkspaceExplorerError('同名图片已经存在，请先重命名或删除旧文件', 409, 'WORKSPACE_ENTRY_EXISTS')
    }
    throw error
  }
  return workspaceEntry(resolved.root, resolved.target)
}

async function writeTextAtomic(path: string, content: string): Promise<void> {
  const temporary = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.pagecraft-tmp`)
  try {
    await writeFile(temporary, content, 'utf8')
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

function historyRoot(cwd: string, path: string): string {
  return resolve(workspaceRoot(cwd), HISTORY_DIRECTORY, sha256(path))
}

async function readStoredHistory(cwd: string, path: string): Promise<StoredHistoryEntry[]> {
  const directory = historyRoot(cwd, path)
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const entries: StoredHistoryEntry[] = []
  for (const name of names.filter(value => value.endsWith('.json'))) {
    try {
      const value = JSON.parse(await readFile(resolve(directory, name), 'utf8')) as StoredHistoryEntry
      if (value.path === path && typeof value.id === 'string' && typeof value.content === 'string') entries.push(value)
    } catch {
      // Ignore one corrupt recovery record without hiding the current source file.
    }
  }
  return entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

async function saveHistory(
  cwd: string,
  file: WorkspaceFile,
  options: WorkspaceOptions,
): Promise<void> {
  const directory = historyRoot(cwd, file.path)
  await mkdir(directory, { recursive: true })
  const createdAt = new Date().toISOString()
  const entry: StoredHistoryEntry = {
    id: `${Date.now()}-${randomUUID()}`,
    path: file.path,
    hash: file.hash,
    bytes: file.bytes,
    createdAt,
    content: file.content,
  }
  await writeFile(resolve(directory, `${entry.id}.json`), `${JSON.stringify(entry)}\n`, 'utf8')

  const limit = options.historyLimit ?? DEFAULT_WORKSPACE_HISTORY_LIMIT
  const maxBytes = options.historyMaxBytes ?? DEFAULT_WORKSPACE_HISTORY_MAX_BYTES
  const stored = await readStoredHistory(cwd, file.path)
  let totalBytes = stored.reduce((sum, item) => sum + item.bytes, 0)
  for (const item of stored.slice().reverse()) {
    if (stored.length <= limit && totalBytes <= maxBytes) break
    await unlink(resolve(directory, `${item.id}.json`)).catch(() => {})
    stored.splice(stored.indexOf(item), 1)
    totalBytes -= item.bytes
  }
}

export async function saveWorkspaceFile(
  cwd: string,
  selectedFolder: unknown,
  path: unknown,
  content: string,
  baseHash: string,
  options: WorkspaceOptions = {},
): Promise<WorkspaceFile> {
  const maxBytes = options.maxTextBytes ?? DEFAULT_MAX_WORKSPACE_TEXT_BYTES
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new WorkspaceExplorerError(`文本文件超过 ${maxBytes} 字节限制`, 413, 'WORKSPACE_FILE_TOO_LARGE')
  }
  const current = await readWorkspaceFile(cwd, selectedFolder, path, options)
  if (baseHash.length === 0 || current.hash !== baseHash) {
    throw new WorkspaceExplorerError('文件已经被其他程序修改，请先处理冲突', 409, 'WORKSPACE_FILE_CONFLICT', { current })
  }
  const resolved = await resolveWorkspaceTarget(cwd, selectedFolder, current.path, true)
  await saveHistory(cwd, current, options)
  await writeTextAtomic(resolved.target, content)
  const metadata = await stat(resolved.target)
  return fileSnapshot(current.path, content, metadata.mtime.toISOString())
}

function safeEntryName(value: unknown): string {
  if (typeof value !== 'string') throw new WorkspaceExplorerError('文件名无效', 400, 'WORKSPACE_NAME_INVALID')
  const name = value.trim()
  if (name.length === 0 || name.length > 255 || name === '.' || name === '..' || /[<>:"/\\|?*\u0000-\u001f]/.test(name)) {
    throw new WorkspaceExplorerError('文件名无效', 400, 'WORKSPACE_NAME_INVALID')
  }
  return name
}

export async function createWorkspaceEntry(
  cwd: string,
  selectedFolder: unknown,
  input: WorkspaceEntryInput,
): Promise<WorkspaceEntry> {
  const parent = normalizedPath(input.parent, '父文件夹')
  const name = safeEntryName(input.name)
  const path = parent === '.' ? name : `${parent}/${name}`
  const resolved = await resolveWorkspaceTarget(cwd, selectedFolder, path, false)
  try {
    if (input.kind === 'directory') await mkdir(resolved.target)
    else await writeFile(resolved.target, input.content ?? '', { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new WorkspaceExplorerError('同名文件或文件夹已经存在', 409, 'WORKSPACE_ENTRY_EXISTS')
    }
    throw error
  }
  return workspaceEntry(resolved.root, resolved.target)
}

export async function renameWorkspaceEntry(
  cwd: string,
  selectedFolder: unknown,
  path: unknown,
  nextName: unknown,
): Promise<WorkspaceEntry> {
  const source = await resolveWorkspaceTarget(cwd, selectedFolder, path, true)
  if (source.target === source.selectedRoot) {
    throw new WorkspaceExplorerError('不能重命名当前打开的根目录', 409, 'WORKSPACE_ROOT_PROTECTED')
  }
  const target = resolve(dirname(source.target), safeEntryName(nextName))
  const targetPath = relativeToRoot(source.root, target)
  await resolveWorkspaceTarget(cwd, selectedFolder, targetPath, false)
  try {
    await rename(source.target, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new WorkspaceExplorerError('同名文件或文件夹已经存在', 409, 'WORKSPACE_ENTRY_EXISTS')
    }
    throw error
  }
  return workspaceEntry(source.root, target)
}

export async function deleteWorkspaceEntry(cwd: string, selectedFolder: unknown, path: unknown): Promise<void> {
  const resolved = await resolveWorkspaceTarget(cwd, selectedFolder, path, true)
  if (resolved.target === resolved.root || resolved.target === resolved.selectedRoot) {
    throw new WorkspaceExplorerError('不能删除工作区或当前打开的根目录', 409, 'WORKSPACE_ROOT_PROTECTED')
  }
  const metadata = await lstat(resolved.target)
  if (metadata.isFile() && isWorkspaceTextFile(resolved.relativePath)) {
    await saveHistory(cwd, await readWorkspaceFile(cwd, selectedFolder, resolved.relativePath), {})
  }
  await rm(resolved.target, { recursive: metadata.isDirectory(), force: false })
}

export async function readWorkspaceHistory(
  cwd: string,
  selectedFolder: unknown,
  path: unknown,
): Promise<WorkspaceHistoryEntry[]> {
  const resolved = await resolveWorkspaceTarget(cwd, selectedFolder, path, true)
  return (await readStoredHistory(cwd, resolved.relativePath)).map(({ content: _content, ...entry }) => entry)
}

export async function restoreWorkspaceHistory(
  cwd: string,
  selectedFolder: unknown,
  path: unknown,
  historyId: unknown,
  baseHash: string,
  options: WorkspaceOptions = {},
): Promise<WorkspaceFile> {
  if (typeof historyId !== 'string' || historyId.length === 0) {
    throw new WorkspaceExplorerError('历史版本标识无效', 400, 'WORKSPACE_HISTORY_ID_INVALID')
  }
  const current = await readWorkspaceFile(cwd, selectedFolder, path, options)
  if (baseHash.length === 0 || current.hash !== baseHash) {
    throw new WorkspaceExplorerError('文件已经被其他程序修改，请先处理冲突', 409, 'WORKSPACE_FILE_CONFLICT', { current })
  }
  const revision = (await readStoredHistory(cwd, current.path)).find(item => item.id === historyId)
  if (revision === undefined) throw new WorkspaceExplorerError('历史版本不存在', 404, 'WORKSPACE_HISTORY_NOT_FOUND')
  const resolved = await resolveWorkspaceTarget(cwd, selectedFolder, current.path, true)
  await saveHistory(cwd, current, options)
  await writeTextAtomic(resolved.target, revision.content)
  const metadata = await stat(resolved.target)
  return fileSnapshot(current.path, revision.content, metadata.mtime.toISOString())
}
