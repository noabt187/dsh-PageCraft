import type { WorkspaceEntry, WorkspaceEvent, WorkspaceFile } from '../workspace.ts'

export interface WorkspaceTreeState {
  selectedFolder: string
  children: Map<string, WorkspaceEntry[]>
  expanded: Set<string>
  loading: Set<string>
  stale: Set<string>
}

export interface OpenWorkspaceFileState {
  path: string
  file: Pick<WorkspaceFile, 'content' | 'hash' | 'updatedAt'>
  draft: string
  conflict: Pick<WorkspaceFile, 'content' | 'hash' | 'updatedAt'> | null
}

export interface WorkspaceEventReduction {
  tree: WorkspaceTreeState
  lastSequence: number
  rescanRequired: boolean
}

export function initialWorkspaceTreeState(selectedFolder: string): WorkspaceTreeState {
  return {
    selectedFolder,
    children: new Map(),
    expanded: new Set([selectedFolder]),
    loading: new Set(),
    stale: new Set([selectedFolder]),
  }
}

export function applyDirectoryListing(
  state: WorkspaceTreeState,
  path: string,
  entries: WorkspaceEntry[],
): WorkspaceTreeState {
  const children = new Map(state.children)
  children.set(path, entries)
  const loading = new Set(state.loading)
  loading.delete(path)
  const stale = new Set(state.stale)
  stale.delete(path)
  return { ...state, children, loading, stale }
}

export function setDirectoryLoading(state: WorkspaceTreeState, path: string): WorkspaceTreeState {
  const loading = new Set(state.loading)
  loading.add(path)
  return { ...state, loading }
}

export function toggleDirectory(state: WorkspaceTreeState, path: string): WorkspaceTreeState {
  const expanded = new Set(state.expanded)
  if (expanded.has(path) && path !== state.selectedFolder) expanded.delete(path)
  else expanded.add(path)
  return { ...state, expanded }
}

export function invalidateWorkspacePaths(state: WorkspaceTreeState, paths: string[]): WorkspaceTreeState {
  const stale = new Set(state.stale)
  for (const path of paths) stale.add(path === '.' && state.selectedFolder !== '.' ? state.selectedFolder : path)
  return { ...state, stale }
}

export function applyWorkspaceEvent(
  tree: WorkspaceTreeState,
  lastSequence: number,
  event: WorkspaceEvent,
): WorkspaceEventReduction {
  const sequenceMissed = lastSequence > 0 && event.sequence !== lastSequence + 1
  const rescanRequired = event.kind === 'rescan' || sequenceMissed
  const paths = rescanRequired ? Array.from(tree.expanded) : event.paths
  return {
    tree: invalidateWorkspacePaths(tree, paths.length > 0 ? paths : [tree.selectedFolder]),
    lastSequence: event.sequence,
    rescanRequired,
  }
}

export function reconcileOpenFile(
  state: OpenWorkspaceFileState,
  disk: Pick<WorkspaceFile, 'content' | 'hash' | 'updatedAt'>,
): OpenWorkspaceFileState {
  if (state.draft === state.file.content) {
    return { ...state, file: disk, draft: disk.content, conflict: null }
  }
  if (state.file.hash === disk.hash) return state
  return { ...state, conflict: disk }
}

export function workspaceEntryByPath(state: WorkspaceTreeState, path: string): WorkspaceEntry | null {
  for (const entries of state.children.values()) {
    const match = entries.find(entry => entry.path === path)
    if (match !== undefined) return match
  }
  return null
}
