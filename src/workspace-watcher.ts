import { watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { dirname, relative, sep } from 'node:path'
import type { WorkspaceEvent } from './workspace.ts'

export interface WorkspaceWatchOptions {
  debounceMs?: number
  ownWriteWindowMs?: number
}

type WorkspaceWatcherStatus = 'connected' | 'degraded' | 'unavailable'

interface RootState {
  watcher: FSWatcher
  listeners: Set<(event: WorkspaceEvent) => void>
  pendingPaths: Set<string>
  sequence: number
  status: WorkspaceWatcherStatus
  timer: ReturnType<typeof setTimeout> | null
  ownWrites: Map<string, number>
}

function normalizedRelativePath(root: string, value: string | Buffer | null): string | null {
  if (value === null) return null
  const raw = Buffer.isBuffer(value) ? value.toString('utf8') : value
  const normalized = raw.replaceAll('\\', '/').replace(/^\.\//, '')
  if (normalized.length === 0 || normalized.startsWith('../') || normalized === '..') return null
  if (normalized.startsWith('.pagecraft/workspace-history/')) return null
  if (/\.pagecraft-tmp$/.test(normalized)) return null
  const absoluteRelative = relative(root, `${root}${sep}${normalized.split('/').join(sep)}`)
  if (absoluteRelative.startsWith('..') || absoluteRelative.includes(`..${sep}`)) return null
  return normalized
}

function parentPath(path: string): string {
  const parent = dirname(path.replaceAll('/', sep)).split(sep).join('/')
  return parent === '.' || parent.length === 0 ? '.' : parent
}

export class WorkspaceWatchHub {
  readonly #debounceMs: number
  readonly #ownWriteWindowMs: number
  readonly #roots = new Map<string, RootState>()

  constructor(options: WorkspaceWatchOptions = {}) {
    this.#debounceMs = options.debounceMs ?? 150
    this.#ownWriteWindowMs = options.ownWriteWindowMs ?? 500
  }

  subscribe(root: string, listener: (event: WorkspaceEvent) => void): () => void {
    let state = this.#roots.get(root)
    if (state === undefined) {
      state = this.#createRoot(root)
      this.#roots.set(root, state)
    }
    state.listeners.add(listener)
    return () => {
      const current = this.#roots.get(root)
      if (current === undefined) return
      current.listeners.delete(listener)
      if (current.listeners.size > 0) return
      this.#closeRoot(root, current)
    }
  }

  markOwnWrite(root: string, path: string): void {
    const state = this.#roots.get(root)
    if (state === undefined) return
    state.ownWrites.set(path.replaceAll('\\', '/'), Date.now() + this.#ownWriteWindowMs)
  }

  currentSequence(root: string): number {
    return this.#roots.get(root)?.sequence ?? 0
  }

  status(root: string): WorkspaceWatcherStatus {
    return this.#roots.get(root)?.status ?? 'unavailable'
  }

  activeRootCount(): number {
    return this.#roots.size
  }

  dispose(): void {
    for (const [root, state] of this.#roots) this.#closeRoot(root, state)
  }

  #createRoot(root: string): RootState {
    const state: RootState = {
      watcher: undefined as unknown as FSWatcher,
      listeners: new Set(),
      pendingPaths: new Set(),
      sequence: 0,
      status: 'connected',
      timer: null,
      ownWrites: new Map(),
    }
    state.watcher = watch(root, { recursive: true }, (_eventType, filename) => {
      this.#record(root, state, filename)
    })
    state.watcher.on('error', () => {
      state.status = 'degraded'
      state.pendingPaths.clear()
      state.pendingPaths.add('.')
      this.#scheduleFlush(root, state, 'rescan')
    })
    return state
  }

  #record(root: string, state: RootState, filename: string | Buffer | null): void {
    const now = Date.now()
    for (const [path, expiry] of state.ownWrites) {
      if (expiry <= now) state.ownWrites.delete(path)
    }
    const path = normalizedRelativePath(root, filename)
    if (path === null) {
      if (filename !== null) return
      state.pendingPaths.clear()
      state.pendingPaths.add('.')
      this.#scheduleFlush(root, state, 'rescan')
      return
    }
    if (state.ownWrites.has(path)) return
    state.pendingPaths.add(parentPath(path))
    this.#scheduleFlush(root, state, 'invalidate')
  }

  #scheduleFlush(root: string, state: RootState, kind: WorkspaceEvent['kind']): void {
    if (state.timer !== null) return
    state.timer = setTimeout(() => {
      state.timer = null
      if (this.#roots.get(root) !== state || state.pendingPaths.size === 0) return
      const paths = Array.from(state.pendingPaths).sort((left, right) => left.localeCompare(right))
      state.pendingPaths.clear()
      state.sequence += 1
      const event: WorkspaceEvent = {
        sequence: state.sequence,
        kind: kind === 'rescan' || paths.includes('.') && state.status === 'degraded' ? 'rescan' : 'invalidate',
        paths,
      }
      for (const listener of state.listeners) listener(event)
    }, this.#debounceMs)
  }

  #closeRoot(root: string, state: RootState): void {
    if (state.timer !== null) clearTimeout(state.timer)
    state.watcher.close()
    state.listeners.clear()
    state.pendingPaths.clear()
    state.ownWrites.clear()
    this.#roots.delete(root)
  }
}
