export const PRESENTATION_WORKSPACE_PATH = '/api/frontend-feedback/presentation-workspace'
export const PRESENTATION_WORKSPACE_TREE_PATH = '/api/frontend-feedback/presentation-workspace/tree'
export const PRESENTATION_WORKSPACE_FILE_PATH = '/api/frontend-feedback/presentation-workspace/file'
export const PRESENTATION_WORKSPACE_ENTRY_PATH = '/api/frontend-feedback/presentation-workspace/entry'
export const PRESENTATION_WORKSPACE_HISTORY_PATH = '/api/frontend-feedback/presentation-workspace/history'
export const PRESENTATION_WORKSPACE_RESTORE_PATH = '/api/frontend-feedback/presentation-workspace/restore'
export const PRESENTATION_WORKSPACE_ASSET_PATH = '/api/frontend-feedback/presentation-workspace/asset'
export const PRESENTATION_WORKSPACE_BIND_ASSET_PATH = '/api/frontend-feedback/presentation-workspace/bind-asset'
export const PRESENTATION_WORKSPACE_MIGRATE_PATH = '/api/frontend-feedback/presentation-workspace/migrate'

export const PRESENTATION_PROJECT_MANIFEST = 'pagecraft-presentation.json'

export interface PresentationProjectManifest {
  name: string
  sourceRoot: string
  deck: string
  theme: string
  assets: string
  publicAssetBase: string
  editableFiles: string[]
}

export interface PresentationWorkspaceSummary {
  available: boolean
  workspacePath: string
  manifest?: PresentationProjectManifest
  reason?: string
  migrationAvailable?: boolean
}

export interface PresentationWorkspaceTreeEntry {
  path: string
  name: string
  kind: 'file' | 'directory'
  protected: boolean
  children?: PresentationWorkspaceTreeEntry[]
}

export interface PresentationWorkspaceFile {
  path: string
  content: string
  hash: string
  bytes: number
  updatedAt: string
  language: string
  protected: boolean
}

export interface PresentationWorkspaceHistoryEntry {
  id: string
  path: string
  hash: string
  bytes: number
  createdAt: string
}

export interface PresentationWorkspaceConflict {
  current: PresentationWorkspaceFile
}

export interface PresentationProjectAsset {
  id: string
  name: string
  path: string
  publicUrl: string
  mimeType: string
  bytes: number
  width: number
  height: number
  references: string[]
}

export interface PresentationProjectAssetList {
  assets: PresentationProjectAsset[]
}

const TEXT_EXTENSIONS = new Set(['.json', '.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.htm', '.md', '.markdown'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

export function normalizePresentationProjectPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '')
  if (normalized.length === 0 || normalized.length > 500) return null
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.startsWith('//')) return null
  const segments = normalized.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..' || /[\u0000-\u001f]/.test(segment))) return null
  return segments.join('/')
}

export function isPresentationTextFile(path: string): boolean {
  const dot = path.lastIndexOf('.')
  return dot >= 0 && TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

export function presentationSourceLanguage(path: string): string {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (extension === '.json') return 'json'
  if (extension === '.ts' || extension === '.tsx') return 'typescript'
  if (extension === '.js' || extension === '.jsx') return 'javascript'
  if (extension === '.css') return 'css'
  if (extension === '.html' || extension === '.htm') return 'html'
  if (extension === '.md' || extension === '.markdown') return 'markdown'
  return 'text'
}

export function normalizePresentationProjectManifest(value: unknown): PresentationProjectManifest | null {
  if (!isRecord(value)) return null
  const name = stringValue(value.name, 200)
  const sourceRoot = normalizePresentationProjectPath(value.sourceRoot)
  const deck = normalizePresentationProjectPath(value.deck)
  const theme = normalizePresentationProjectPath(value.theme)
  const assets = normalizePresentationProjectPath(value.assets)
  const publicAssetBase = stringValue(value.publicAssetBase, 300)
  if (!name || sourceRoot === null || deck === null || theme === null || assets === null) return null
  if (!publicAssetBase.startsWith('/') || publicAssetBase.includes('..') || publicAssetBase.includes('?') || publicAssetBase.includes('#')) return null
  if (!deck.startsWith(`${sourceRoot}/`) || !theme.startsWith(`${sourceRoot}/`)) return null
  if (!Array.isArray(value.editableFiles)) return null
  const editableFiles = Array.from(new Set(value.editableFiles
    .map(normalizePresentationProjectPath)
    .filter((path): path is string => path !== null && path.startsWith(`${sourceRoot}/`) && isPresentationTextFile(path))))
    .slice(0, 500)
  if (!editableFiles.includes(deck) || !editableFiles.includes(theme)) return null
  return { name, sourceRoot, deck, theme, assets, publicAssetBase: publicAssetBase.replace(/\/$/, ''), editableFiles }
}

export function presentationWorkspaceLayoutStorageKey(sessionId: string): string {
  return `dsh-pagecraft.presentation-workspace-layout:${sessionId}`
}
