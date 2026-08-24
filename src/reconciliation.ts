import type { VisualBatchRecord } from './history.ts'

export interface ReconciliationContentBlock {
  type?: string
  text?: string
}

export interface ReconciliationNode {
  kind?: string
  seq?: number
  turn?: number
  message?: string
  interrupted?: boolean
  content?: readonly ReconciliationContentBlock[]
  blocks?: readonly { kind?: string; text?: string }[]
}

export interface ReconciliationQueueItem {
  preview?: string
  text?: string | null
}

export interface ReconciliationSnapshot {
  running?: boolean
  queue?: readonly ReconciliationQueueItem[]
  nodes?: readonly ReconciliationNode[]
  turnEnds?: ReadonlyMap<number, number>
}

export type BatchReconciliationDecision =
  | { kind: 'queued' }
  | { kind: 'running' }
  | { kind: 'completed'; turn: number }
  | { kind: 'failed'; turn: number; error: string }
  | { kind: 'waiting'; reason: 'request-missing' | 'turn-open' | 'completion-unmatched' }

export interface BatchReconciliation {
  batchId: string
  decision: BatchReconciliationDecision
}

function contentText(node: ReconciliationNode): string {
  const content = (node.content ?? [])
    .filter(block => block.type === 'text' || typeof block.text === 'string')
    .map(block => block.text ?? '')
  const blocks = (node.blocks ?? [])
    .filter(block => block.kind === 'text' || typeof block.text === 'string')
    .map(block => block.text ?? '')
  return [...content, ...blocks].join('\n')
}

function queueContains(batchId: string, queue: readonly ReconciliationQueueItem[]): boolean {
  return queue.some(item => `${item.preview ?? ''}\n${item.text ?? ''}`.includes(batchId))
}

function requestNodeFor(batchId: string, nodes: readonly ReconciliationNode[]): ReconciliationNode | undefined {
  return nodes
    .filter(node => (node.kind === 'user' || node.kind === 'steering') && contentText(node).includes(batchId))
    .sort((a, b) => (b.seq ?? -1) - (a.seq ?? -1))[0]
}

function nextInputSeq(after: number, nodes: readonly ReconciliationNode[]): number | undefined {
  return nodes
    .filter(node => (node.kind === 'user' || node.kind === 'steering') && typeof node.seq === 'number' && node.seq > after)
    .map(node => node.seq as number)
    .sort((a, b) => a - b)[0]
}

function completionFor(
  record: VisualBatchRecord,
  request: ReconciliationNode,
  snapshot: ReconciliationSnapshot,
  claimedTurns: ReadonlySet<number>,
): BatchReconciliationDecision {
  const requestSeq = request.seq
  if (requestSeq === undefined) return { kind: 'waiting', reason: 'completion-unmatched' }
  const boundary = nextInputSeq(requestSeq, snapshot.nodes ?? [])
  const baseline = record.baselineCompletedTurn ?? -1
  const candidates = [...(snapshot.turnEnds ?? new Map<number, number>()).entries()]
    .filter(([turn, endSeq]) => turn > baseline && endSeq > requestSeq && (boundary === undefined || endSeq < boundary))
    .sort((a, b) => a[1] - b[1])

  for (const [turn] of candidates) {
    if (claimedTurns.has(turn)) continue
    const error = (snapshot.nodes ?? []).find(node => node.kind === 'turn-error' && node.turn === turn)
    if (error !== undefined) {
      return { kind: 'failed', turn, error: error.message ?? 'Agent 未能完成 PageCraft 修改。' }
    }
    const assistant = (snapshot.nodes ?? []).find(node =>
      node.kind === 'assistant'
      && node.turn === turn
      && node.interrupted !== true
      && (node.seq ?? -1) > requestSeq,
    )
    if (assistant !== undefined) return { kind: 'completed', turn }
  }
  return { kind: 'waiting', reason: candidates.length > 0 ? 'completion-unmatched' : 'turn-open' }
}

export function maxCompletedTurn(snapshot: ReconciliationSnapshot): number | undefined {
  const turns = [...(snapshot.turnEnds ?? new Map<number, number>()).keys()]
  return turns.length === 0 ? undefined : Math.max(...turns)
}

/**
 * Rebuild PageCraft batch ownership from durable conversation facts. This works
 * after the panel was unmounted and therefore missed the live running edges.
 */
export function reconcilePageCraftBatches(
  records: readonly VisualBatchRecord[],
  snapshot: ReconciliationSnapshot,
): BatchReconciliation[] {
  const unfinished = records
    .filter(record => record.status === 'queued' || record.status === 'running')
    .sort((a, b) => a.createdAt - b.createdAt)
  const nodes = snapshot.nodes ?? []
  const queue = snapshot.queue ?? []
  const claimedTurns = new Set(records.flatMap(record => record.settledTurn === undefined ? [] : [record.settledTurn]))
  let runningAssigned = false

  return unfinished.map(record => {
    if (queueContains(record.id, queue)) {
      return { batchId: record.id, decision: { kind: 'queued' } }
    }
    const request = requestNodeFor(record.id, nodes)
    if (snapshot.running === true && !runningAssigned && (request !== undefined || record === unfinished[0])) {
      runningAssigned = true
      return { batchId: record.id, decision: { kind: 'running' } }
    }
    if (request === undefined) {
      return { batchId: record.id, decision: { kind: 'waiting', reason: 'request-missing' } }
    }
    const decision = completionFor(record, request, snapshot, claimedTurns)
    if (decision.kind === 'completed' || decision.kind === 'failed') claimedTurns.add(decision.turn)
    return { batchId: record.id, decision }
  })
}
