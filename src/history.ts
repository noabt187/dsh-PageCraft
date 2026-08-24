import type { FeedbackComment } from './shared.ts'
import type { PageCraftMode } from './presentation.ts'

export type BatchStatus =
  | 'capturing-before'
  | 'queued'
  | 'running'
  | 'capturing-after'
  | 'completed'
  | 'failed'
  | 'rollback-pending'
  | 'rolled-back'
  | 'rollback-conflict'

export interface VisualSnapshot {
  id: string
  stage: 'before' | 'after' | 'rollback'
  capturedAt: number
  url: string
  viewport: { preset: string; width: number; height: number; devicePixelRatio: number }
  mimeType?: string
  width?: number
  height?: number
  dataUrl?: string
  error?: string
}

export interface BatchFileChange {
  path: string
  beforeHash?: string
  afterHash?: string
}

export interface VisualBatchRecord {
  id: string
  sessionId: string
  mode: PageCraftMode
  url: string
  createdAt: number
  updatedAt: number
  status: BatchStatus
  annotations: FeedbackComment[]
  before?: VisualSnapshot
  after?: VisualSnapshot
  rollback?: VisualSnapshot
  files?: BatchFileChange[]
  verification?: string
  error?: string
  /** Time at which DSH accepted the PageCraft prompt. Optional for legacy history records. */
  submittedAt?: number
  /** Largest completed conversation turn observed immediately before submission. */
  baselineCompletedTurn?: number
  /** Whether PageCraft observed this batch owning a live Agent turn. */
  observedRunning?: boolean
  /** Conversation turn used to settle this batch after the Agent completed. */
  settledTurn?: number
}

export interface CreateVisualBatchInput {
  id?: string
  sessionId: string
  mode: PageCraftMode
  url: string
  annotations: readonly FeedbackComment[]
  createdAt?: number
}

export const MAX_HISTORY_RECORDS = 50
export const MAX_HISTORY_BYTES = 25 * 1024 * 1024
export const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024

const TRANSITIONS: Record<BatchStatus, readonly BatchStatus[]> = {
  'capturing-before': ['queued', 'failed'],
  queued: ['running', 'capturing-after', 'failed'],
  running: ['capturing-after', 'failed'],
  'capturing-after': ['completed', 'failed'],
  completed: ['rollback-pending'],
  failed: ['queued', 'rollback-pending'],
  'rollback-pending': ['rolled-back', 'rollback-conflict', 'failed'],
  'rolled-back': [],
  'rollback-conflict': ['rollback-pending'],
}

function fallbackBatchId(now: number): string {
  return `pc-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createBatchId(now = Date.now()): string {
  return globalThis.crypto?.randomUUID?.() ?? fallbackBatchId(now)
}

export function createVisualBatch(input: CreateVisualBatchInput): VisualBatchRecord {
  const createdAt = input.createdAt ?? Date.now()
  return {
    id: input.id ?? createBatchId(createdAt),
    sessionId: input.sessionId,
    mode: input.mode,
    url: input.url,
    createdAt,
    updatedAt: createdAt,
    status: 'capturing-before',
    annotations: input.annotations.map(annotation => ({ ...annotation })),
  }
}

export function transitionBatch(
  record: VisualBatchRecord,
  status: BatchStatus,
  patch: Partial<Omit<VisualBatchRecord, 'id' | 'sessionId' | 'createdAt' | 'status'>> = {},
  now = Date.now(),
): VisualBatchRecord {
  if (record.status !== status && !TRANSITIONS[record.status].includes(status)) {
    throw new Error(`批次不能从 ${record.status} 变为 ${status}`)
  }
  return { ...record, ...patch, status, updatedAt: now }
}

function dataUrlBytes(value: string | undefined): number {
  if (value === undefined) return 0
  const comma = value.indexOf(',')
  if (comma < 0) return value.length * 2
  const payloadLength = value.length - comma - 1
  return Math.ceil(payloadLength * 0.75)
}

export function estimateBatchBytes(record: VisualBatchRecord): number {
  return JSON.stringify({ ...record, before: undefined, after: undefined, rollback: undefined }).length * 2
    + dataUrlBytes(record.before?.dataUrl)
    + dataUrlBytes(record.after?.dataUrl)
    + dataUrlBytes(record.rollback?.dataUrl)
}

export function pruneVisualHistory(
  records: readonly VisualBatchRecord[],
  maxRecords = MAX_HISTORY_RECORDS,
  maxBytes = MAX_HISTORY_BYTES,
): VisualBatchRecord[] {
  const newest = [...records].sort((a, b) => b.updatedAt - a.updatedAt)
  const kept: VisualBatchRecord[] = []
  let bytes = 0
  for (const record of newest) {
    const recordBytes = estimateBatchBytes(record)
    if (kept.length >= maxRecords) break
    if (kept.length > 0 && bytes + recordBytes > maxBytes) continue
    kept.push(record)
    bytes += recordBytes
  }
  return kept
}

export function validateSnapshot(snapshot: VisualSnapshot): VisualSnapshot {
  if (snapshot.dataUrl !== undefined && dataUrlBytes(snapshot.dataUrl) > MAX_SNAPSHOT_BYTES) {
    return { ...snapshot, dataUrl: undefined, error: '截图超过 5 MB 历史上限，已仅保留元数据。' }
  }
  return snapshot
}

const DB_NAME = 'dsh-pagecraft-history'
const DB_VERSION = 1
const STORE_NAME = 'batches'

function openHistoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('无法打开 PageCraft 历史数据库'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('sessionId', 'sessionId', { unique: false })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('PageCraft 历史数据库操作失败'))
  })
}

export class VisualHistoryStore {
  private memory = new Map<string, VisualBatchRecord>()
  private persistent = true

  get isPersistent(): boolean {
    return this.persistent
  }

  async list(sessionId: string): Promise<VisualBatchRecord[]> {
    try {
      const database = await openHistoryDatabase()
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const index = transaction.objectStore(STORE_NAME).index('sessionId')
      const records = await requestResult(index.getAll(sessionId) as IDBRequest<VisualBatchRecord[]>)
      database.close()
      return pruneVisualHistory(records)
    } catch {
      this.persistent = false
      return pruneVisualHistory([...this.memory.values()].filter(record => record.sessionId === sessionId))
    }
  }

  async put(record: VisualBatchRecord): Promise<void> {
    const normalized = {
      ...record,
      before: record.before === undefined ? undefined : validateSnapshot(record.before),
      after: record.after === undefined ? undefined : validateSnapshot(record.after),
      rollback: record.rollback === undefined ? undefined : validateSnapshot(record.rollback),
    }
    this.memory.set(normalized.id, normalized)
    try {
      const database = await openHistoryDatabase()
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      await requestResult(transaction.objectStore(STORE_NAME).put(normalized))
      database.close()
      await this.prune(normalized.sessionId)
    } catch {
      this.persistent = false
    }
  }

  async remove(id: string): Promise<void> {
    this.memory.delete(id)
    try {
      const database = await openHistoryDatabase()
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      await requestResult(transaction.objectStore(STORE_NAME).delete(id))
      database.close()
    } catch {
      this.persistent = false
    }
  }

  private async prune(sessionId: string): Promise<void> {
    const records = await this.list(sessionId)
    const keep = new Set(pruneVisualHistory(records).map(record => record.id))
    try {
      const database = await openHistoryDatabase()
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const all = await requestResult(store.index('sessionId').getAll(sessionId) as IDBRequest<VisualBatchRecord[]>)
      await Promise.all(all.filter(record => !keep.has(record.id)).map(record => requestResult(store.delete(record.id))))
      database.close()
    } catch {
      this.persistent = false
    }
  }
}
