import type { VisualBatchRecord } from './history.ts'

export type BatchProgressStage =
  | 'preparing'
  | 'queued'
  | 'thinking'
  | 'locating'
  | 'checkpointing'
  | 'editing'
  | 'verifying'
  | 'finalizing'
  | 'completed'
  | 'failed'

export interface PageCraftQueueItem {
  preview?: string
  placement?: 'queued' | 'steering' | 'context' | string
}

export interface PageCraftRunningToolCall {
  name?: string
  toolName?: string
  input?: unknown
  arguments?: unknown
  startedAt?: number | string
  children?: readonly PageCraftRunningToolCall[]
  calls?: readonly PageCraftRunningToolCall[]
}

export interface PageCraftSessionSnapshot {
  running?: boolean
  queue?: readonly PageCraftQueueItem[]
  runningCalls?: readonly PageCraftRunningToolCall[]
  partial?: { turn?: number; step?: number } | null
  promptError?: { op?: string; error?: { message?: string } | string } | null
}

export type VisualOutcome = 'changed' | 'unchanged' | 'unverified'

export interface BatchProgress {
  batchId: string
  stage: BatchProgressStage
  label: string
  detail: string
  elapsedMs: number
  queueAhead: number
  annotationCount: number
  viewport?: string
  outcome?: VisualOutcome
  error?: string
}

const STAGE_ORDER: readonly BatchProgressStage[] = [
  'preparing', 'queued', 'thinking', 'locating', 'checkpointing',
  'editing', 'verifying', 'finalizing', 'completed', 'failed',
]

const STAGE_LABEL: Record<BatchProgressStage, string> = {
  preparing: '准备上下文',
  queued: '等待 Agent',
  thinking: 'Agent 正在处理',
  locating: '定位源码组件',
  checkpointing: '保存安全检查点',
  editing: '修改页面源码',
  verifying: '构建并验证结果',
  finalizing: '同步预览与截图',
  completed: '处理完成',
  failed: '处理失败',
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) ?? '' } catch { return '' }
}

function flattenCalls(calls: readonly PageCraftRunningToolCall[] | undefined): PageCraftRunningToolCall[] {
  const flattened: PageCraftRunningToolCall[] = []
  for (const call of calls ?? []) {
    flattened.push(call)
    flattened.push(...flattenCalls(call.children ?? call.calls))
  }
  return flattened
}

export function classifyRunningCalls(calls: readonly PageCraftRunningToolCall[] | undefined): {
  stage: Extract<BatchProgressStage, 'thinking' | 'locating' | 'checkpointing' | 'editing' | 'verifying'>
  detail: string
} {
  const flattened = flattenCalls(calls)
  if (flattened.length === 0) return { stage: 'thinking', detail: 'Agent 已接收任务，正在规划下一步操作' }
  const call = flattened[flattened.length - 1]
  const name = `${call.name ?? call.toolName ?? '工具'}`
  const args = textOf(call.input ?? call.arguments)
  const evidence = `${name} ${args}`.toLowerCase()
  const shortArgs = args.replace(/\s+/g, ' ').slice(0, 90)
  const detail = shortArgs.length > 0 ? `${name} · ${shortArgs}` : `正在执行 ${name}`

  if (/test|check|build|typecheck|lint|screenshot|browser|playwright|npm\s+(test|run)/.test(evidence)) {
    return { stage: 'verifying', detail }
  }
  if (/apply_patch|str_replace|(^|\W)(write|edit|patch)(\W|$)|set-content|add-content|out-file/.test(evidence)) {
    return { stage: 'editing', detail }
  }
  if (/get-filehash|\.pagecraft[\\/]history|manifest\.json|revert\.patch|checkpoint/.test(evidence)) {
    return { stage: 'checkpointing', detail }
  }
  if (/read|glob|search|find|rg\b|get-content|select-string|list|tree/.test(evidence)) {
    return { stage: 'locating', detail }
  }
  return { stage: 'thinking', detail }
}

export function visualOutcome(record: VisualBatchRecord): VisualOutcome {
  if (record.before?.dataUrl === undefined || record.after?.dataUrl === undefined) return 'unverified'
  return record.before.dataUrl === record.after.dataUrl ? 'unchanged' : 'changed'
}

function errorMessage(snapshot: PageCraftSessionSnapshot): string | undefined {
  const value = snapshot.promptError?.error
  if (typeof value === 'string') return value
  return value?.message
}

function queuePosition(batchId: string, queue: readonly PageCraftQueueItem[]): number {
  return queue.findIndex(item => (item.preview ?? '').includes(batchId))
}

export function deriveBatchProgress(
  record: VisualBatchRecord,
  snapshot: PageCraftSessionSnapshot = {},
  records: readonly VisualBatchRecord[] = [record],
  now = Date.now(),
): BatchProgress {
  const queue = snapshot.queue ?? []
  const position = queuePosition(record.id, queue)
  const error = record.error ?? errorMessage(snapshot)
  let stage: BatchProgressStage
  let detail: string

  if (error !== undefined && record.status === 'failed') {
    stage = 'failed'
    detail = error
  } else if (record.status === 'capturing-before') {
    stage = 'preparing'
    detail = '正在捕获修改前页面并整理评注上下文'
  } else if (record.status === 'capturing-after') {
    stage = 'finalizing'
    detail = 'Agent 已结束，正在刷新预览并捕获修改后页面'
  } else if (record.status === 'completed' || record.status === 'rolled-back') {
    stage = 'completed'
    const outcome = visualOutcome(record)
    detail = outcome === 'changed'
      ? '检测到页面视觉变化，可查看修改前后对比'
      : outcome === 'unchanged'
        ? '未检测到视觉变化，可能是非视觉修改或目标文件未更新'
        : '任务已结束，但缺少完整截图，无法验证视觉变化'
  } else if (record.status === 'failed' || record.status === 'rollback-conflict') {
    stage = 'failed'
    detail = error ?? '任务未能安全完成，请查看错误后重试'
  } else if (record.status === 'rollback-pending') {
    stage = 'checkpointing'
    detail = '正在核对文件哈希并安全恢复此批次'
  } else if (position >= 0) {
    stage = 'queued'
    detail = position === 0 ? '已进入 DSH 队列，等待当前任务结束' : `DSH 队列中还有 ${position} 个任务在前面`
  } else if (snapshot.running === true) {
    const unfinished = records
      .filter(item => ['queued', 'running'].includes(item.status))
      .sort((a, b) => a.createdAt - b.createdAt)
    if (unfinished[0]?.id === record.id) {
      const activity = classifyRunningCalls(snapshot.runningCalls)
      stage = activity.stage
      detail = activity.detail
    } else {
      stage = 'queued'
      detail = '等待前面的 PageCraft 批次完成'
    }
  } else {
    stage = record.status === 'running' ? 'finalizing' : 'queued'
    detail = record.status === 'running' ? 'Agent 已停止，正在等待预览结算' : '任务已发送，等待 Agent 开始'
  }

  return {
    batchId: record.id,
    stage,
    label: STAGE_LABEL[stage],
    detail,
    elapsedMs: Math.max(0, now - record.createdAt),
    queueAhead: Math.max(0, position),
    annotationCount: record.annotations.length,
    viewport: record.before?.viewport.preset,
    ...(stage === 'completed' ? { outcome: visualOutcome(record) } : {}),
    ...(error === undefined ? {} : { error }),
  }
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (minutes < 60) return `${minutes} 分 ${remainder.toString().padStart(2, '0')} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

export function progressStepState(step: BatchProgressStage, current: BatchProgressStage): 'done' | 'current' | 'upcoming' {
  if (current === 'failed') return step === 'failed' ? 'current' : 'done'
  const currentIndex = STAGE_ORDER.indexOf(current)
  const stepIndex = STAGE_ORDER.indexOf(step)
  return stepIndex < currentIndex ? 'done' : stepIndex === currentIndex ? 'current' : 'upcoming'
}
