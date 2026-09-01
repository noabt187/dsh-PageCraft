export const PAGECRAFT_WORKSPACE_PATH = '/api/frontend-feedback/workspace'
export const PAGECRAFT_WORKSPACE_FOLDERS_PATH = '/api/frontend-feedback/workspace/folders'
export const PAGECRAFT_WORKSPACE_DIRECTORY_PATH = '/api/frontend-feedback/workspace/directory'
export const PAGECRAFT_WORKSPACE_FILE_PATH = '/api/frontend-feedback/workspace/file'
export const PAGECRAFT_WORKSPACE_BLOB_PATH = '/api/frontend-feedback/workspace/blob'
export const PAGECRAFT_WORKSPACE_ENTRY_PATH = '/api/frontend-feedback/workspace/entry'
export const PAGECRAFT_WORKSPACE_HISTORY_PATH = '/api/frontend-feedback/workspace/history'
export const PAGECRAFT_WORKSPACE_RESTORE_PATH = '/api/frontend-feedback/workspace/restore'
export const PAGECRAFT_WORKSPACE_EVENTS_PATH = '/api/frontend-feedback/workspace/events'
export const PAGECRAFT_WORKSPACE_TEXT_EDIT_PATH = '/api/frontend-feedback/workspace/text-edit'
export const PAGECRAFT_WORKSPACE_TEXT_VERIFY_PATH = '/api/frontend-feedback/workspace/text-verify'

export interface WorkspaceSummary {
  rootPath: string
  selectedFolder: string
  selectedPath: string
  watcher: 'connected' | 'degraded' | 'unavailable'
  sequence: number
}

export interface WorkspaceEntry {
  path: string
  name: string
  kind: 'file' | 'directory' | 'symlink'
  bytes?: number
  updatedAt: string
  textEditable: boolean
  imagePreviewable: boolean
}

export interface WorkspaceFile {
  path: string
  content: string
  hash: string
  bytes: number
  updatedAt: string
  language: string
}

export interface WorkspaceHistoryEntry {
  id: string
  path: string
  hash: string
  bytes: number
  createdAt: string
}

export interface WorkspaceEvent {
  sequence: number
  kind: 'invalidate' | 'rescan'
  paths: string[]
}

export interface DomTextSelection {
  pageUrl: string
  framePath: number[]
  selector: string
  fingerprint: string
  displayedText: string
  tagName: string
  attributes: Record<string, string>
  nearbyText: string[]
  slideId?: string
  textKey?: string
}

export interface DirectTextEditStart {
  transactionId: string
  path: string
  line: number
  previousText: string
  replacementText: string
  writtenHash: string
  expiresAt: string
}

export interface DirectTextEditVerification {
  transactionId: string
  verified: boolean
  observedText?: string
}

export interface DirectTextEditResult {
  status: 'committed' | 'rolled_back' | 'conflict'
  path: string
  line: number
  message: string
  file?: WorkspaceFile
}

const TEXT_EXTENSIONS = new Set([
  '.css',
  '.csv',
  '.htm',
  '.html',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.md',
  '.markdown',
  '.mdx',
  '.mjs',
  '.cjs',
  '.scss',
  '.less',
  '.svelte',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
])

const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp'])

function extensionOf(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const dot = path.lastIndexOf('.')
  return dot > slash ? path.slice(dot).toLowerCase() : ''
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function normalizeWorkspacePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replaceAll('\\', '/')
  if (trimmed === '.' || trimmed === './') return '.'
  const normalized = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed
  if (normalized.length === 0 || normalized.length > 1_000) return null
  if (normalized.startsWith('/') || normalized.startsWith('//') || /^[a-zA-Z]:/.test(normalized)) return null
  const segments = normalized.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..' || /[\u0000-\u001f]/.test(segment))) {
    return null
  }
  return segments.join('/')
}

export function isWorkspaceTextFile(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(path))
}

export function isWorkspaceImageFile(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path))
}

export function workspaceLanguage(path: string): string {
  const extension = extensionOf(path)
  if (extension === '.json' || extension === '.jsonc') return 'json'
  if (extension === '.ts' || extension === '.tsx') return 'typescript'
  if (extension === '.js' || extension === '.jsx' || extension === '.mjs' || extension === '.cjs') return 'javascript'
  if (extension === '.css' || extension === '.scss' || extension === '.less') return 'css'
  if (extension === '.html' || extension === '.htm' || extension === '.vue' || extension === '.svelte') return 'html'
  if (extension === '.md' || extension === '.markdown' || extension === '.mdx') return 'markdown'
  if (extension === '.yaml' || extension === '.yml') return 'yaml'
  if (extension === '.xml' || extension === '.svg') return 'xml'
  return 'text'
}

export function workspaceFolderStorageKey(rootPath: string, sessionId: string): string {
  const normalizedRoot = rootPath.trim().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  return `dsh-pagecraft.workspace-folder:${fnv1a(normalizedRoot)}:${encodeURIComponent(sessionId)}`
}

export function workspaceLayoutStorageKey(rootPath: string, sessionId: string): string {
  const normalizedRoot = rootPath.trim().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  return `dsh-pagecraft.workspace-layout:${fnv1a(normalizedRoot)}:${encodeURIComponent(sessionId)}`
}
