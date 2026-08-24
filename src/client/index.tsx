import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  buildPresentationCreationPrompt,
  resolvePresentationSlides,
} from '../presentation.ts'
import type { PageCraftMode, PresentationBrief, PresentationSlideSummary } from '../presentation.ts'
import {
  buildAnnotationPrompt,
  cornersFromRect,
  currentPreviewUrl,
  feedbackDraftStorageKey,
  isFeedbackDraftEmpty,
  isFeedbackSelection,
  isScreenshotCaptureResult,
  movePreviewNavigation,
  normalizePreviewUrl,
  previewHistoryStorageKey,
  previewUrlStorageKey,
  pushPreviewNavigation,
  resolvePersistedFeedbackDraft,
  resolvePersistedPreviewNavigation,
  resolvePersistedPreviewUrl,
  resolvePreviewFrameLocation,
} from '../shared.ts'
import type {
  AnnotationViewport,
  AreaOperation,
  FeedbackComment,
  FeedbackDraftState,
  FeedbackSelection,
  PreviewNavigationState,
  ResponsiveScope,
  ScreenshotCaptureResult,
  ScreenshotContext,
} from '../shared.ts'
import {
  createVisualBatch,
  transitionBatch,
  VisualHistoryStore,
} from '../history.ts'
import type { VisualBatchRecord, VisualSnapshot } from '../history.ts'
import { buildMotionPrompt, buildRollbackPrompt, buildThemePrompt } from '../studio.ts'
import type { MotionPresetId, ThemePresetId } from '../studio.ts'
import { VisualHistoryPanel } from './history.tsx'
import { PresentationBriefDialog, SlideRail } from './presentation.tsx'
import { BreakpointToolbar, StudioDrawer, VIEWPORT_PRESETS } from './studio.tsx'
import type { ViewportPreset } from './studio.tsx'
import { GuidanceEditor } from './guidance.tsx'
import { ProgressTimeline } from './progress.tsx'
import { deriveBatchProgress } from '../progress.ts'
import type { PageCraftSessionSnapshot } from '../progress.ts'

export const inject = ['slots', 'sessions']

interface FrontendFeedbackInjected {
  sessionId: string
  sendFeedback: ((text: string, image?: PromptImage) => Promise<SendFeedbackResult>) | null
  sessionActivity: SessionActivity | null
}

interface PromptImage {
  mediaType: 'image/webp' | 'image/png' | 'image/jpeg' | 'image/gif'
  data: string
  name?: string
}

interface SendFeedbackResult {
  imageDelivered: boolean
  warning?: string
}

interface SessionActivity {
  subscribe(listener: () => void): () => void
  getSnapshot(): PageCraftSessionSnapshot
}

interface FrontendFeedbackPanelProps extends FrontendFeedbackInjected {
  workspaceMode: PageCraftMode
  onClose(): void
  onWorkspaceModeChange(mode: PageCraftMode): void
}

interface FeedbackMessage {
  type?: string
  payload?: unknown
  url?: unknown
  message?: unknown
  status?: unknown
  rect?: { width?: unknown; height?: unknown }
  active?: unknown
  slides?: unknown
  activeSlideId?: unknown
  requestId?: unknown
  ok?: unknown
  dataUrl?: unknown
  width?: unknown
  height?: unknown
  mimeType?: unknown
  error?: unknown
}

const colors = {
  panel: '#121816',
  panel2: '#19211e',
  border: '#2c3d34',
  text: '#edf5ef',
  muted: '#9aac9f',
  accent: '#88c99a',
  accentStrong: '#a9e2b7',
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const EMPTY_SESSION_SNAPSHOT: PageCraftSessionSnapshot = Object.freeze({ running: false, queue: [], runningCalls: [] })

function useSessionSnapshot(activity: SessionActivity | null): PageCraftSessionSnapshot {
  const subscribe = useCallback((listener: () => void) => activity?.subscribe(listener) ?? (() => {}), [activity])
  const getSnapshot = useCallback(() => activity?.getSnapshot() ?? EMPTY_SESSION_SNAPSHOT, [activity])
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SESSION_SNAPSHOT)
}

type SelectionMode = 'element' | 'area'

const AREA_OPERATIONS: Array<{ value: AreaOperation; label: string; description: string }> = [
  { value: 'insert', label: '插入', description: '使用正常布局，并推开后续内容' },
  { value: 'overlay', label: '覆盖', description: '浮在现有内容上方，不改变文档流' },
  { value: 'replace', label: '替换', description: '替换框内受影响的现有内容' },
]

function commentFrom(
  selection: FeedbackSelection,
  comment: string,
  areaOperation: AreaOperation,
  viewport?: AnnotationViewport,
  scope?: ResponsiveScope,
  screenshot?: ScreenshotContext,
): FeedbackComment {
  const context = {
    ...selection,
    ...(viewport === undefined ? {} : { viewport }),
    ...(scope === undefined ? {} : { scope }),
    ...(screenshot === undefined ? {} : { screenshot }),
  }
  return selection.kind === 'area'
    ? { ...context, kind: 'area', comment: comment.trim(), operation: areaOperation } as FeedbackComment
    : { ...context, kind: 'element', comment: comment.trim() } as FeedbackComment
}

function cardTitle(item: FeedbackSelection | FeedbackComment): string {
  const slide = item.presentation === undefined ? '' : `${item.presentation.slideIndex + 1}. ${item.presentation.slideTitle} · `
  if (item.kind === 'area') {
    const operation = 'operation' in item
      ? AREA_OPERATIONS.find(option => option.value === item.operation)?.label
      : undefined
    return `${slide}${operation === undefined ? '' : `${operation} · `}区域 ${item.rect.width} × ${item.rect.height} · (${item.rect.x}, ${item.rect.y})`
  }
  const text = item.text.trim()
  return text.length > 0 ? `${slide}${item.selector} · ${text.slice(0, 42)}` : `${slide}${item.selector}`
}

function selectionCode(item: FeedbackSelection): string {
  if (item.kind !== 'area') return item.selector
  const { topLeft, topRight, bottomRight, bottomLeft } = cornersFromRect(item.rect)
  return `TL(${topLeft.x},${topLeft.y}) · TR(${topRight.x},${topRight.y}) · BR(${bottomRight.x},${bottomRight.y}) · BL(${bottomLeft.x},${bottomLeft.y})`
}

function selectionSummary(item: FeedbackSelection): string {
  if (item.kind !== 'area') return item.text
  const guideCount = item.alignment.guides.length
  const container = item.container?.selector
  return [
    `框选 ${item.rect.width} × ${item.rect.height}px`,
    guideCount > 0 ? `已使用 ${guideCount} 条对齐参考` : '未找到明确对齐参考，模型将结合周围布局判断',
    container === undefined ? '' : `建议容器：${container}`,
  ].filter(Boolean).join(' · ')
}

function readStoredValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStoredValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable in hardened/private browser contexts. The
    // current component state still keeps the preview usable for this mount.
  }
}

function removeStoredValue(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Ignore the same restricted-storage cases as reads and writes.
  }
}

function readPersistedPreviewNavigation(sessionId: string): PreviewNavigationState {
  return resolvePersistedPreviewNavigation(
    readStoredValue(previewHistoryStorageKey(sessionId)),
    resolvePersistedPreviewUrl(readStoredValue(previewUrlStorageKey(sessionId))),
  )
}

function persistPreviewNavigation(sessionId: string, navigation: PreviewNavigationState): void {
  writeStoredValue(previewHistoryStorageKey(sessionId), JSON.stringify(navigation))
  // History already contains the current URL. Remove the legacy duplicate
  // after a successful navigation while retaining read migration above.
  removeStoredValue(previewUrlStorageKey(sessionId))
}

function readPersistedFeedbackDraft(sessionId: string): FeedbackDraftState {
  return resolvePersistedFeedbackDraft(readStoredValue(feedbackDraftStorageKey(sessionId)))
}

function persistFeedbackDraft(sessionId: string, draft: FeedbackDraftState): void {
  const key = feedbackDraftStorageKey(sessionId)
  if (isFeedbackDraftEmpty(draft)) {
    removeStoredValue(key)
    return
  }
  writeStoredValue(key, JSON.stringify(draft))
}

function promptImageFromDataUrl(dataUrl: string, name: string): PromptImage | undefined {
  const match = /^data:(image\/(?:webp|png|jpeg|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (match === null) return undefined
  return { mediaType: match[1] as PromptImage['mediaType'], data: match[2], name }
}

function annotationViewport(value: ViewportPreset): AnnotationViewport {
  return {
    preset: value.id,
    width: value.width,
    height: value.height,
    devicePixelRatio: value.devicePixelRatio,
  }
}

function snapshotFromCapture(
  result: ScreenshotCaptureResult,
  stage: VisualSnapshot['stage'],
  url: string,
  viewport: ViewportPreset,
): VisualSnapshot {
  const base = {
    id: `${stage}-${Date.now().toString(36)}`,
    stage,
    capturedAt: Date.now(),
    url,
    viewport: annotationViewport(viewport),
  }
  return result.ok
    ? { ...base, mimeType: result.mimeType, width: result.width, height: result.height, dataUrl: result.dataUrl }
    : { ...base, error: result.error }
}

function FrontendFeedbackPanel({
  sessionId,
  sendFeedback,
  sessionActivity,
  workspaceMode,
  onClose,
  onWorkspaceModeChange,
}: FrontendFeedbackPanelProps) {
  const hasSession = sendFeedback !== null
  const storageId = `${sessionId}:${workspaceMode}`
  const sessionSnapshot = useSessionSnapshot(sessionActivity)
  const agentRunning = sessionSnapshot.running === true
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previousAgentRunningRef = useRef(agentRunning)
  const refreshNoticeRef = useRef<string | null>(null)
  const captureResolversRef = useRef(new Map<string, (result: ScreenshotCaptureResult) => void>())
  const activeBatchIdRef = useRef<string | null>(null)
  const pendingAfterBatchIdRef = useRef<string | null>(null)
  const activeRollbackBatchIdRef = useRef<string | null>(null)
  const pendingRollbackBatchIdRef = useRef<string | null>(null)
  const reconcileBusyRef = useRef(false)
  const historyStore = useMemo(() => new VisualHistoryStore(), [])
  const initialNavigation = useMemo(() => readPersistedPreviewNavigation(storageId), [storageId])
  const initialDraft = useMemo(() => readPersistedFeedbackDraft(storageId), [storageId])
  const navigationRef = useRef(initialNavigation)
  const initialPreviewUrl = currentPreviewUrl(initialNavigation)
  const [urlDraft, setUrlDraft] = useState(initialPreviewUrl)
  const [navigation, setNavigation] = useState(initialNavigation)
  const [revision, setRevision] = useState(0)
  const [selectionMode, setSelectionMode] = useState<SelectionMode | null>(initialDraft.selection?.kind ?? null)
  const [selection, setSelection] = useState<FeedbackSelection | null>(initialDraft.selection)
  const [areaOperation, setAreaOperation] = useState<AreaOperation>(initialDraft.areaOperation)
  const [comment, setComment] = useState(initialDraft.comment)
  const [queued, setQueued] = useState<FeedbackComment[]>(initialDraft.queued)
  const [status, setStatus] = useState(
    !isFeedbackDraftEmpty(initialDraft)
      ? `已恢复自动保存的评注草稿（队列 ${initialDraft.queued.length} 条）。`
      : hasSession
      ? workspaceMode === 'presentation'
        ? '可以新建演示文稿，或打开已有 HTML 演示文稿的预览地址。'
        : '打开页面后，可选择已有 DOM 元素，也可以框选空白区域新增内容。'
      : '当前是空白会话，页面预览和评注可先行使用；若要发送给 Agent，请先发起一条消息创建会话。',
  )
  const [sending, setSending] = useState(false)
  const [slides, setSlides] = useState<PresentationSlideSummary[]>([])
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null)
  const [showPresentationBrief, setShowPresentationBrief] = useState(false)
  const [creatingPresentation, setCreatingPresentation] = useState(false)
  const [viewport, setViewport] = useState<ViewportPreset>(VIEWPORT_PRESETS[0])
  const [responsiveScope, setResponsiveScope] = useState<ResponsiveScope>('current-breakpoint')
  const [captureBusy, setCaptureBusy] = useState(false)
  const [lastScreenshot, setLastScreenshot] = useState<ScreenshotContext | undefined>(undefined)
  const [history, setHistory] = useState<VisualBatchRecord[]>([])
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showStudio, setShowStudio] = useState(false)
  const [studioBusy, setStudioBusy] = useState(false)
  const [rollbackBusy, setRollbackBusy] = useState(false)
  const [clock, setClock] = useState(Date.now())
  const loadedUrl = currentPreviewUrl(navigation)
  const canGoBack = navigation.index > 0
  const canGoForward = navigation.index < navigation.entries.length - 1
  const progressRecords = useMemo(() => history
    .filter(record => ['capturing-before', 'queued', 'running', 'capturing-after', 'failed', 'completed'].includes(record.status))
    .sort((a, b) => a.createdAt - b.createdAt), [history])
  const activeProgressRecord = progressRecords.find(record => !['completed', 'failed'].includes(record.status))
    ?? progressRecords[progressRecords.length - 1]
  const activeProgress = activeProgressRecord === undefined
    ? null
    : deriveBatchProgress(activeProgressRecord, sessionSnapshot, progressRecords, clock)

  useEffect(() => {
    if (activeProgress === null || ['completed', 'failed'].includes(activeProgress.stage)) return
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [activeProgress?.batchId, activeProgress?.stage])

  const previewFrame = useMemo(() => {
    return resolvePreviewFrameLocation(loadedUrl, window.location.href, revision)
  }, [loadedUrl, revision])

  const refreshHistory = useCallback(async () => {
    const records = await historyStore.list(storageId)
    setHistory(records)
    setSelectedHistoryId(current => current !== null && records.some(record => record.id === current)
      ? current
      : records[0]?.id ?? null)
  }, [historyStore, storageId])

  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  useEffect(() => {
    persistFeedbackDraft(storageId, { selection, areaOperation, comment, queued })
  }, [areaOperation, comment, queued, selection, storageId])

  const commitNavigation = useCallback((next: PreviewNavigationState, nextStatus: string) => {
    refreshNoticeRef.current = null
    navigationRef.current = next
    persistPreviewNavigation(storageId, next)
    setNavigation(next)
    setUrlDraft(currentPreviewUrl(next))
    setRevision(value => value + 1)
    setSelection(null)
    setSelectionMode(null)
    setAreaOperation('insert')
    setComment('')
    setLastScreenshot(undefined)
    if (workspaceMode === 'presentation') {
      setSlides([])
      setActiveSlideId(null)
    }
    setStatus(nextStatus)
  }, [storageId, workspaceMode])

  const navigatePreview = useCallback((rawUrl: string, nextStatus = '正在加载预览…') => {
    try {
      const targetUrl = normalizePreviewUrl(rawUrl)
      if (targetUrl === null) throw new Error('只支持有效的 http 或 https 地址')
      commitNavigation(pushPreviewNavigation(navigationRef.current, targetUrl), nextStatus)
    } catch (error) {
      setStatus(`地址无效：${describeError(error)}`)
    }
  }, [commitNavigation])

  const moveInHistory = useCallback((delta: -1 | 1) => {
    const next = movePreviewNavigation(navigationRef.current, delta)
    if (next === null) return
    commitNavigation(next, delta < 0 ? '正在返回上一页…' : '正在前往下一页…')
  }, [commitNavigation])

  const refreshPreview = useCallback((loadingStatus: string, readyStatus: string) => {
    refreshNoticeRef.current = readyStatus
    setSelection(null)
    setSelectionMode(null)
    setAreaOperation('insert')
    setComment('')
    setStatus(loadingStatus)
    setRevision(value => value + 1)
  }, [])

  const postResponsiveContext = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({
      type: 'dsh-pagecraft-responsive-context',
      viewport: annotationViewport(viewport),
      scope: responsiveScope,
    }, '*')
  }, [responsiveScope, viewport])

  useEffect(() => {
    postResponsiveContext()
  }, [postResponsiveContext])

  const requestCapture = useCallback((kind: 'viewport' | 'selection'): Promise<ScreenshotCaptureResult> => {
    return new Promise(resolve => {
      const requestId = `capture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const timeout = window.setTimeout(() => {
        captureResolversRef.current.delete(requestId)
        resolve({ type: 'dsh-pagecraft-capture-result', requestId, ok: false, error: '截图请求超时；DOM 评注仍可正常发送。' })
      }, 12_000)
      captureResolversRef.current.set(requestId, result => {
        window.clearTimeout(timeout)
        resolve(result)
      })
      iframeRef.current?.contentWindow?.postMessage({
        type: 'dsh-pagecraft-capture-request',
        requestId,
        kind,
        format: 'webp',
        quality: 0.78,
        maxDimension: 1600,
      }, '*')
    })
  }, [])

  useEffect(() => () => {
    for (const [requestId, resolve] of captureResolversRef.current) {
      resolve({ type: 'dsh-pagecraft-capture-result', requestId, ok: false, error: 'PageCraft 面板已关闭。' })
    }
    captureResolversRef.current.clear()
  }, [])

  const captureForStage = useCallback(async (stage: VisualSnapshot['stage']): Promise<VisualSnapshot> => {
    const result = await requestCapture('viewport')
    return snapshotFromCapture(result, stage, loadedUrl, viewport)
  }, [loadedUrl, requestCapture, viewport])

  const captureNow = useCallback(async () => {
    setCaptureBusy(true)
    try {
      const result = await requestCapture(selection === null ? 'viewport' : 'selection')
      if (!result.ok) {
        setLastScreenshot({ kind: selection === null ? 'viewport' : 'selection', width: 1, height: 1, mimeType: 'image/png', error: result.error })
        setStatus(`截图失败：${result.error}`)
        return
      }
      setLastScreenshot({
        kind: selection === null ? 'viewport' : 'selection',
        width: result.width,
        height: result.height,
        mimeType: result.mimeType,
        capturedAt: new Date().toISOString(),
        dataUrl: result.dataUrl,
      })
      setStatus(`已捕获 ${result.width} × ${result.height} 截图；发送时会优先作为图像上下文交给 Agent。`)
    } finally {
      setCaptureBusy(false)
    }
  }, [requestCapture, selection])

  useEffect(() => {
    const wasRunning = previousAgentRunningRef.current
    previousAgentRunningRef.current = agentRunning
    if (!wasRunning && agentRunning && activeBatchIdRef.current !== null) {
      const batchId = activeBatchIdRef.current
      void (async () => {
        const record = (await historyStore.list(storageId)).find(item => item.id === batchId)
        if (record?.status === 'queued') {
          await historyStore.put(transitionBatch(record, 'running'))
          await refreshHistory()
        }
      })()
      return
    }
    if (!wasRunning || agentRunning) return

    const activeBatchId = activeBatchIdRef.current
    if (activeBatchId !== null) {
      void (async () => {
        const record = (await historyStore.list(storageId)).find(item => item.id === activeBatchId)
        if (record !== undefined) {
          const next = transitionBatch(record, 'capturing-after')
          await historyStore.put(next)
          pendingAfterBatchIdRef.current = activeBatchId
          await refreshHistory()
        }
        activeBatchIdRef.current = null
        refreshPreview('Agent 已完成，正在同步最新页面…', 'Agent 修改完成，正在捕获修改后页面。')
      })()
      return
    }
    const rollbackBatchId = activeRollbackBatchIdRef.current
    if (rollbackBatchId !== null) {
      activeRollbackBatchIdRef.current = null
      pendingRollbackBatchIdRef.current = rollbackBatchId
      refreshPreview('Agent 已完成恢复检查，正在同步页面…', '正在捕获恢复后的页面。')
      return
    }
    if (selection !== null || queued.length > 0) {
      setStatus('Agent 已完成修改。当前还有未发送评注，为避免丢失没有自动刷新；请处理评注后点击上方刷新按钮。')
      return
    }
    refreshPreview('Agent 已完成，正在同步最新页面…', 'Agent 修改完成，页面评注已自动加载最新页面。')
  }, [agentRunning, historyStore, queued.length, refreshHistory, refreshPreview, selection, storageId])

  useEffect(() => {
    if (reconcileBusyRef.current || pendingAfterBatchIdRef.current !== null) return
    const unfinished = history
      .filter(record => record.status === 'queued' || record.status === 'running')
      .sort((a, b) => a.createdAt - b.createdAt)
    if (unfinished.length === 0 || activeBatchIdRef.current !== null) return
    const queue = sessionSnapshot.queue
    const runningCandidate = unfinished.find(record => !queue?.some(item => (item.preview ?? '').includes(record.id)))

    if (agentRunning && runningCandidate !== undefined) {
      activeBatchIdRef.current = runningCandidate.id
      if (runningCandidate.status === 'queued') {
        reconcileBusyRef.current = true
        void historyStore.put(transitionBatch(runningCandidate, 'running'))
          .then(refreshHistory)
          .finally(() => { reconcileBusyRef.current = false })
      }
      return
    }

    const staleRunning = unfinished.find(record => record.status === 'running')
    if (!agentRunning && staleRunning !== undefined) {
      reconcileBusyRef.current = true
      pendingAfterBatchIdRef.current = staleRunning.id
      void historyStore.put(transitionBatch(staleRunning, 'capturing-after'))
        .then(refreshHistory)
        .then(() => refreshPreview('正在恢复未结算的 PageCraft 批次…', 'Agent 已结束，正在捕获修改后页面。'))
        .finally(() => { reconcileBusyRef.current = false })
    }
  }, [agentRunning, history, historyStore, refreshHistory, refreshPreview, sessionSnapshot.queue])

  useEffect(() => {
    const listener = (event: MessageEvent<FeedbackMessage>) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      if (isScreenshotCaptureResult(event.data)) {
        const resolve = captureResolversRef.current.get(event.data.requestId)
        if (resolve !== undefined) {
          captureResolversRef.current.delete(event.data.requestId)
          resolve(event.data)
        }
        return
      }
      if (event.data?.type === 'dsh-frontend-feedback-ready') {
        postResponsiveContext()
        if (workspaceMode === 'presentation') {
          iframeRef.current?.contentWindow?.postMessage({
            type: 'dsh-frontend-feedback-request-deck-state',
          }, '*')
        }
        if (selection?.kind === 'area') {
          iframeRef.current?.contentWindow?.postMessage({
            type: 'dsh-frontend-feedback-restore-area',
            rect: selection.rect,
          }, '*')
        }
        const refreshNotice = refreshNoticeRef.current
        refreshNoticeRef.current = null
        const pendingBatchId = pendingAfterBatchIdRef.current
        if (pendingBatchId !== null) {
          pendingAfterBatchIdRef.current = null
          void (async () => {
            await new Promise(resolve => window.setTimeout(resolve, 180))
            const after = await captureForStage('after')
            const record = (await historyStore.list(storageId)).find(item => item.id === pendingBatchId)
            if (record !== undefined) {
              const completed = transitionBatch(record, after.error === undefined ? 'completed' : 'failed', {
                after,
                ...(after.error === undefined ? {} : { error: after.error }),
              })
              await historyStore.put(completed)
              await refreshHistory()
              setSelectedHistoryId(pendingBatchId)
              setStatus(after.error === undefined
                ? 'Agent 修改完成，已保存修改后快照，可打开“比较与历史”查看。'
                : `Agent 修改完成，但修改后截图失败：${after.error}`)
            }
          })()
          return
        }
        const pendingRollbackId = pendingRollbackBatchIdRef.current
        if (pendingRollbackId !== null) {
          pendingRollbackBatchIdRef.current = null
          void (async () => {
            await new Promise(resolve => window.setTimeout(resolve, 180))
            const rollback = await captureForStage('rollback')
            const record = (await historyStore.list(storageId)).find(item => item.id === pendingRollbackId)
            if (record !== undefined) {
              const unchanged = rollback.dataUrl !== undefined && rollback.dataUrl === record.after?.dataUrl
              const resultStatus = unchanged ? 'rollback-conflict' : rollback.error === undefined ? 'rolled-back' : 'failed'
              const next = transitionBatch(record, resultStatus, {
                rollback,
                ...(unchanged ? { error: '恢复后页面与修改后快照完全一致，请检查 Agent 是否报告了文件哈希冲突。' } : {}),
                ...(rollback.error === undefined ? {} : { error: rollback.error }),
              })
              await historyStore.put(next)
              await refreshHistory()
              setStatus(resultStatus === 'rolled-back'
                ? '恢复流程完成，已保存恢复后快照。'
                : next.error ?? '恢复流程未能安全完成。')
            }
          })()
          return
        }
        setStatus(refreshNotice ?? (workspaceMode === 'presentation'
          ? '预览已加载。若页面含有 PageCraft 幻灯片标记，左侧会自动列出各页。'
          : '预览已加载。可选择 DOM 元素，或拖动框选区域来新增内容。'))
        return
      }
      if (event.data?.type === 'dsh-frontend-feedback-deck-state') {
        if (workspaceMode !== 'presentation') return
        const discoveredSlides = resolvePresentationSlides(event.data.slides)
        setSlides(discoveredSlides)
        setActiveSlideId(typeof event.data.activeSlideId === 'string' ? event.data.activeSlideId : null)
        if (discoveredSlides.length > 0) {
          setStatus(`已识别 ${discoveredSlides.length} 张幻灯片，可从左侧切换并进行评注。`)
        }
        return
      }
      if (event.data?.type === 'dsh-frontend-feedback-error') {
        const status = typeof event.data.status === 'number' ? `HTTP ${event.data.status}：` : ''
        const message = typeof event.data.message === 'string' ? event.data.message : '未知错误'
        setSelectionMode(null)
        setStatus(`预览失败：${status}${message}`)
        return
      }
      if (event.data?.type === 'dsh-frontend-feedback-navigate' && typeof event.data.url === 'string') {
        navigatePreview(event.data.url, '正在打开页面中的链接…')
        return
      }
      if (event.data?.type === 'dsh-frontend-feedback-navigation-error') {
        const message = typeof event.data.message === 'string' ? event.data.message : '当前操作无法在预览中完成。'
        setStatus(message)
        return
      }
      if (event.data?.type === 'dsh-frontend-feedback-selection-error') {
        const message = typeof event.data.message === 'string' ? event.data.message : '框选失败，请重新拖动。'
        setStatus(message)
        return
      }
      if (event.data?.type === 'dsh-frontend-feedback-area-draft') {
        setSelection(current => current?.kind === 'area' ? null : current)
        const rect = event.data.rect
        if (event.data.active && rect && typeof rect.width === 'number' && typeof rect.height === 'number') {
          setStatus(`选区已保留（${Math.round(rect.width)} × ${Math.round(rect.height)}px）。可拖动蓝框或八个控制点继续调整，确认后才会采用坐标。`)
        } else if (event.data.active) {
          setStatus('正在创建选区；松开后选框会保留，可继续移动和缩放。')
        } else {
          setStatus('选区已取消，可重新拖动创建。')
        }
        return
      }
      if (event.data?.type !== 'dsh-frontend-feedback-selected') return
      if (!isFeedbackSelection(event.data.payload)) {
        setStatus('选中数据无法识别。请关闭页面评注、刷新 Harness 后重新打开；如果仍然出现，请重启 DSH 以同步插件 Host 与客户端版本。')
        return
      }
      setSelection(event.data.payload)
      if (event.data.payload.kind === 'area') setAreaOperation('insert')
      setComment('')
      setStatus(event.data.payload.kind === 'area'
        ? `已框选 ${event.data.payload.rect.width} × ${event.data.payload.rect.height}px 区域。请在右侧选择“新增内容 / 增加装饰 / 重新布局 / 加入交互”，再补充你想看到的结果。`
        : `已选择 ${event.data.payload.selector}。右侧已按元素类型准备修改建议；点击建议生成草稿后，可继续细化内容、视觉、布局和交互要求。`)
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [captureForStage, historyStore, navigatePreview, postResponsiveContext, refreshHistory, selection, storageId, workspaceMode])

  const openPreview = () => {
    navigatePreview(urlDraft)
  }

  const postAnnotatorMode = (mode: SelectionMode | null) => {
    iframeRef.current?.contentWindow?.postMessage({
      type: 'dsh-frontend-feedback-set-mode',
      mode,
    }, '*')
  }

  const clearAreaOverlay = () => {
    iframeRef.current?.contentWindow?.postMessage({
      type: 'dsh-frontend-feedback-clear-area',
    }, '*')
  }

  const setAnnotatorMode = (next: SelectionMode | null) => {
    setSelectionMode(next)
    setStatus(next === 'area'
      ? '在预览中拖动框选区域；黄色参考线表示对齐吸附。按住 Alt 自由框选，按住 Shift 锁定正方形。'
      : next === 'element'
        ? '在预览中悬停并点击已有 DOM 元素。'
        : '已回到浏览模式，可点击页面链接和表单。')
    postAnnotatorMode(next)
  }

  const queueCurrent = () => {
    if (selection === null || comment.trim().length === 0) return
    const screenshot = lastScreenshot === undefined ? undefined : { ...lastScreenshot, dataUrl: undefined }
    setQueued(items => [...items, commentFrom(
      selection,
      comment,
      areaOperation,
      annotationViewport(viewport),
      responsiveScope,
      screenshot,
    )])
    if (selection.kind === 'area') clearAreaOverlay()
    setSelection(null)
    setAreaOperation('insert')
    setComment('')
    setStatus('评注已加入队列，可继续选择元素或框选区域。')
  }

  const clearDraft = () => {
    setQueued([])
    setSelection(null)
    setSelectionMode(null)
    setAreaOperation('insert')
    setComment('')
    clearAreaOverlay()
    postAnnotatorMode(null)
    removeStoredValue(feedbackDraftStorageKey(storageId))
    setStatus('已清空自动保存的评注草稿。')
  }

  const selectPresentationSlide = (slideId: string) => {
    iframeRef.current?.contentWindow?.postMessage({
      type: 'dsh-frontend-feedback-select-slide',
      slideId,
    }, '*')
    setActiveSlideId(slideId)
  }

  const createPresentation = async (brief: PresentationBrief) => {
    if (sendFeedback === null) {
      setStatus('当前还没有会话，请先发送一条消息创建会话，再新建演示文稿。')
      return
    }
    setCreatingPresentation(true)
    try {
      await sendFeedback(buildPresentationCreationPrompt(brief))
      setShowPresentationBrief(false)
      setStatus('已把演示文稿需求发送给 Agent。完成后请在地址栏打开 Agent 提供的预览 URL。')
    } catch (error) {
      setStatus(`创建请求发送失败：${describeError(error)}`)
    } finally {
      setCreatingPresentation(false)
    }
  }

  const sendAll = async () => {
    const comments = [...queued]
    const screenshot = lastScreenshot === undefined ? undefined : { ...lastScreenshot, dataUrl: undefined }
    if (selection !== null && comment.trim().length > 0) comments.push(commentFrom(
      selection,
      comment,
      areaOperation,
      annotationViewport(viewport),
      responsiveScope,
      screenshot,
    ))
    if (comments.length === 0) return
    if (sendFeedback === null) {
      setStatus('当前还没有会话，无法发送到 Agent。先创建会话后再发送。')
      return
    }
    setSending(true)
    let batch: VisualBatchRecord | null = null
    try {
      batch = createVisualBatch({ sessionId: storageId, mode: workspaceMode, url: loadedUrl, annotations: comments })
      const before = await captureForStage('before')
      const enrichedComments: FeedbackComment[] = comments.map(item => {
        const fallbackScreenshot: ScreenshotContext = {
          kind: 'before',
          width: before.width ?? 1,
          height: before.height ?? 1,
          mimeType: before.mimeType === 'image/webp' ? 'image/webp' : 'image/png',
          capturedAt: new Date(before.capturedAt).toISOString(),
          ...(before.error === undefined ? {} : { error: before.error }),
        }
        if (item.kind === 'area') {
          return {
            ...item,
            viewport: { ...item.viewport, preset: item.viewport.preset ?? viewport.id },
            scope: item.scope ?? responsiveScope,
            screenshot: item.screenshot ?? fallbackScreenshot,
          }
        }
        const existingViewport = item.viewport
        return {
          ...item,
          viewport: existingViewport ?? annotationViewport(viewport),
          scope: item.scope ?? responsiveScope,
          screenshot: item.screenshot ?? fallbackScreenshot,
        }
      })
      batch = transitionBatch(batch, 'queued', { before, annotations: enrichedComments })
      await historyStore.put(batch)
      await refreshHistory()
      const dataUrl = lastScreenshot?.dataUrl ?? before.dataUrl
      const image = dataUrl === undefined ? undefined : promptImageFromDataUrl(dataUrl, `pagecraft-${batch.id}-before.webp`)
      const result = await sendFeedback(buildAnnotationPrompt(enrichedComments, { mode: workspaceMode, batchId: batch.id }), image)
      if (!agentRunning && activeBatchIdRef.current === null) activeBatchIdRef.current = batch.id
      setQueued([])
      setSelection(null)
      setAreaOperation('insert')
      setComment('')
      setLastScreenshot(undefined)
      setStatus(result.warning === undefined
        ? `已把 ${comments.length} 条评注作为批次 ${batch.id} 发送到当前会话${result.imageDelivered ? '，包含截图上下文' : ''}。`
        : `评注已发送，但截图已降级为仅保存在历史：${result.warning}`)
    } catch (error) {
      if (batch !== null) {
        try {
          const failed = transitionBatch(batch, 'failed', { error: describeError(error) })
          await historyStore.put(failed)
          await refreshHistory()
        } catch {
          // Keep the original send failure as the visible error.
        }
      }
      setStatus(`发送失败：${describeError(error)}`)
    } finally {
      setSending(false)
    }
  }

  const sendStudioOrder = async (kind: 'theme' | 'motion', buildPrompt: (batchId: string) => string) => {
    if (sendFeedback === null) {
      setStatus('当前还没有会话，无法发送 Studio 工单。')
      return
    }
    setStudioBusy(true)
    let batch: VisualBatchRecord | null = null
    try {
      batch = createVisualBatch({ sessionId: storageId, mode: workspaceMode, url: loadedUrl, annotations: [] })
      const before = await captureForStage('before')
      batch = transitionBatch(batch, 'queued', { before })
      await historyStore.put(batch)
      await refreshHistory()
      const image = before.dataUrl === undefined ? undefined : promptImageFromDataUrl(before.dataUrl, `pagecraft-${batch.id}-before.webp`)
      const result = await sendFeedback(buildPrompt(batch.id), image)
      if (!agentRunning && activeBatchIdRef.current === null) activeBatchIdRef.current = batch.id
      setShowStudio(false)
      setStatus(`${kind === 'theme' ? '主题' : '动效'}工单已发送${result.warning === undefined ? '' : `；截图降级：${result.warning}`}`)
    } catch (error) {
      if (batch !== null) {
        try { await historyStore.put(transitionBatch(batch, 'failed', { error: describeError(error) })) } catch {}
      }
      setStatus(`Studio 工单发送失败：${describeError(error)}`)
    } finally {
      setStudioBusy(false)
      await refreshHistory()
    }
  }

  const applyTheme = async (theme: ThemePresetId | 'extract-current', scope: 'current-page' | 'current-component' | 'design-system') => {
    await sendStudioOrder('theme', batchId => buildThemePrompt({ batchId, theme, scope, viewport: annotationViewport(viewport) }))
  }

  const applyMotion = async (preset: MotionPresetId, intensity: 'subtle' | 'balanced' | 'cinematic') => {
    await sendStudioOrder('motion', batchId => buildMotionPrompt({ batchId, preset, intensity, viewport: annotationViewport(viewport) }))
  }

  const rollbackBatch = async (record: VisualBatchRecord) => {
    if (sendFeedback === null) return
    setRollbackBusy(true)
    try {
      const hashes = Object.fromEntries((record.files ?? [])
        .filter(file => file.afterHash !== undefined)
        .map(file => [file.path, file.afterHash as string]))
      const prompt = buildRollbackPrompt({ batchId: record.id, expectedPostHashes: hashes })
      await historyStore.put(transitionBatch(record, 'rollback-pending'))
      await sendFeedback(prompt)
      activeRollbackBatchIdRef.current = record.id
      setShowHistory(false)
      setStatus(`已发送批次 ${record.id} 的安全恢复工单；Agent 会先核对文件哈希。`)
      await refreshHistory()
    } catch (error) {
      setStatus(`无法发送恢复工单：${describeError(error)}`)
    } finally {
      setRollbackBusy(false)
    }
  }

  return (
    <div style={styles.root} data-conversation-composer-overlay="">
      <div style={styles.toolbar}>
        <div style={styles.brand}>
          <span style={styles.brandDot} />
          <div>
            <strong style={styles.title}>PageCraft</strong>
            <span style={styles.subtitle}>{workspaceMode === 'presentation' ? '演示文稿 · 幻灯片评注' : '网页预览 · DOM 与区域评注'}</span>
          </div>
        </div>
        <div role="tablist" aria-label="PageCraft 工作模式" style={styles.workspaceModeGroup}>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'webpage'}
            onClick={() => onWorkspaceModeChange('webpage')}
            style={{ ...styles.workspaceModeButton, ...(workspaceMode === 'webpage' ? styles.workspaceModeButtonActive : {}) }}
          >网页</button>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'presentation'}
            onClick={() => onWorkspaceModeChange('presentation')}
            style={{ ...styles.workspaceModeButton, ...(workspaceMode === 'presentation' ? styles.workspaceModeButtonActive : {}) }}
          >演示文稿</button>
        </div>
        <div style={styles.addressBar}>
          <button
            type="button"
            aria-label="后退"
            title="后退"
            disabled={!canGoBack}
            onClick={() => moveInHistory(-1)}
            style={{ ...styles.iconButton, ...(!canGoBack ? styles.iconButtonDisabled : {}) }}
          >←</button>
          <button
            type="button"
            aria-label="前进"
            title="前进"
            disabled={!canGoForward}
            onClick={() => moveInHistory(1)}
            style={{ ...styles.iconButton, ...(!canGoForward ? styles.iconButtonDisabled : {}) }}
          >→</button>
          <input
            aria-label="预览地址"
            value={urlDraft}
            onChange={event => setUrlDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') openPreview() }}
            style={styles.input}
            placeholder="http://localhost:5173"
          />
          <button type="button" onClick={openPreview} style={styles.secondaryButton}>打开</button>
          {workspaceMode === 'presentation' ? (
            <button type="button" onClick={() => setShowPresentationBrief(true)} style={styles.createPresentationButton}>新建演示文稿</button>
          ) : null}
          <button
            type="button"
            aria-label="刷新"
            onClick={() => refreshPreview('正在强制刷新预览…', '预览已强制刷新并重新获取页面。')}
            style={styles.iconButton}
            title="刷新预览"
          >↻</button>
          <div style={styles.modeGroup}>
            <button
              type="button"
              title="点击已有 DOM 元素进行评注"
              onClick={() => setAnnotatorMode(selectionMode === 'element' ? null : 'element')}
              style={{ ...styles.modeButton, ...(selectionMode === 'element' ? styles.modeButtonActive : {}) }}
            >选择元素</button>
            <button
              type="button"
              title="拖动框选区域；Alt 关闭吸附，Shift 锁定正方形"
              onClick={() => setAnnotatorMode(selectionMode === 'area' ? null : 'area')}
              style={{ ...styles.modeButton, ...(selectionMode === 'area' ? styles.areaModeButtonActive : {}) }}
            >框选区域</button>
          </div>
          <button type="button" aria-label="关闭页面评注" title="关闭" onClick={onClose} style={styles.closeButton}>×</button>
        </div>
        {!hasSession ? <div style={styles.sessionHint}>先发一条消息后，右侧“发送给 Agent”才可提交。</div> : null}
      </div>

      <div style={styles.studioToolbarRow}>
        <BreakpointToolbar
          value={viewport}
          onChange={setViewport}
          onCapture={() => { void captureNow() }}
          captureBusy={captureBusy}
          onHistory={() => setShowHistory(true)}
          historyCount={history.length}
          onStudio={() => setShowStudio(true)}
        />
        <label style={styles.scopeField}>响应范围
          <select value={responsiveScope} onChange={event => setResponsiveScope(event.target.value as ResponsiveScope)} style={styles.scopeSelect}>
            <option value="current-breakpoint">仅当前断点</option>
            <option value="current-and-smaller">当前及更小断点</option>
            <option value="all-breakpoints">全部断点</option>
          </select>
        </label>
      </div>

      <div style={{ ...styles.workspace, ...(workspaceMode === 'presentation' ? styles.presentationWorkspace : {}) }}>
        {workspaceMode === 'presentation' ? (
          <SlideRail
            slides={slides}
            activeSlideId={activeSlideId}
            onCreate={() => setShowPresentationBrief(true)}
            onSelect={selectPresentationSlide}
          />
        ) : null}
        <div style={styles.previewShell}>
          <div style={{ ...styles.deviceFrame, width: viewport.width, height: viewport.height }}>
          <iframe
            ref={iframeRef}
            title="前端页面评注预览"
            src={previewFrame.src}
            sandbox={previewFrame.allowSameOrigin
              ? 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups'
              : 'allow-scripts allow-forms allow-modals allow-popups'}
            style={{ ...styles.iframe, width: viewport.width, height: viewport.height }}
            onLoad={() => {
              postResponsiveContext()
              if (selectionMode !== null) postAnnotatorMode(selectionMode)
              if (workspaceMode === 'presentation') {
                iframeRef.current?.contentWindow?.postMessage({
                  type: 'dsh-frontend-feedback-request-deck-state',
                }, '*')
              }
              if (selection?.kind === 'area') {
                iframeRef.current?.contentWindow?.postMessage({
                  type: 'dsh-frontend-feedback-restore-area',
                  rect: selection.rect,
                }, '*')
              }
            }}
          />
          </div>
        </div>

        <aside style={styles.sidebar}>
          <div style={styles.sidebarHeader}>
            <div>
              <strong>评注队列</strong>
              <span style={styles.count}>{queued.length}</span>
            </div>
            <div style={styles.sidebarHeaderActions}>
              {!isFeedbackDraftEmpty({ selection, areaOperation, comment, queued }) ? (
                <button type="button" onClick={clearDraft} style={styles.clearDraftButton}>清空草稿</button>
              ) : null}
              <span style={{ ...styles.statePill, ...(selectionMode !== null ? styles.statePillActive : {}) }}>
                {selectionMode === 'element' ? '元素选择' : selectionMode === 'area' ? '区域框选' : '浏览模式'}
              </span>
            </div>
          </div>

          {activeProgress !== null ? (
            <ProgressTimeline
              progress={activeProgress}
              onHistory={() => {
                setSelectedHistoryId(activeProgress.batchId)
                setShowHistory(true)
              }}
              onRefresh={() => refreshPreview('正在刷新最新页面…', '预览已刷新，可继续评注。')}
            />
          ) : null}

          <div style={styles.sidebarScroller}>
            <div style={styles.scrollArea}>
              {queued.map((item, index) => (
                <div key={`${item.kind === 'area' ? `area-${item.rect.x}-${item.rect.y}` : item.selector}-${index}`} style={styles.commentCard}>
                  <div style={styles.cardIndex}>#{index + 1}</div>
                  <div style={styles.cardBody}>
                    <strong style={styles.cardTitle}>{cardTitle(item)}</strong>
                    <span style={styles.cardComment}>{item.comment}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`删除第 ${index + 1} 条评注`}
                    onClick={() => setQueued(items => items.filter((_, itemIndex) => itemIndex !== index))}
                    style={styles.removeButton}
                  >×</button>
                </div>
              ))}
              {queued.length === 0 && selection === null ? (
                <div style={styles.emptyQueue}>
                  <span style={styles.emptyIcon}>⌁</span>
                  <strong>还没有评注</strong>
                  <span>{workspaceMode === 'presentation'
                    ? '从左侧选择一张幻灯片，再选择已有元素或框选需要新增内容的区域。'
                    : '选择已有元素，或在空白位置拖动框选需要新增内容的区域。'}</span>
                </div>
              ) : null}
            </div>

            {selection !== null ? (
              <div style={styles.composer}>
                <div style={styles.selectedMeta}>
                  <span style={{ ...styles.tag, ...(selection.kind === 'area' ? styles.areaTag : {}) }}>
                    {selection.kind === 'area' ? 'AREA' : selection.tagName}
                  </span>
                  <code style={styles.selector}>{selectionCode(selection)}</code>
                </div>
                {selectionSummary(selection) ? <p style={styles.selectedText}>{selectionSummary(selection)}</p> : null}
                {selection.sourceHints !== undefined ? (
                  <div style={styles.sourceHint}>
                    <span>源码定位</span>
                    <strong>{selection.sourceHints.file ?? selection.sourceHints.component ?? '候选组件'}</strong>
                    <em>{Math.round(selection.sourceHints.confidence * 100)}% 证据置信度</em>
                  </div>
                ) : null}
                {selection.kind === 'area' ? (
                  <div style={styles.operationField}>
                    <span style={styles.operationLabel}>新增内容如何影响当前布局</span>
                    <div role="group" aria-label="区域修改方式" style={styles.operationGroup}>
                      {AREA_OPERATIONS.map(option => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={areaOperation === option.value}
                          title={option.description}
                          onClick={() => setAreaOperation(option.value)}
                          style={{
                            ...styles.operationButton,
                            ...(areaOperation === option.value ? styles.operationButtonActive : {}),
                          }}
                        >{option.label}</button>
                      ))}
                    </div>
                    <span style={styles.operationHelp}>{AREA_OPERATIONS.find(option => option.value === areaOperation)?.description}</span>
                  </div>
                ) : null}
                <GuidanceEditor
                  selection={selection}
                  context={{
                    viewport: { id: viewport.id, label: viewport.label, width: viewport.width, height: viewport.height },
                    scope: responsiveScope,
                    ...(selection.kind === 'area' ? { areaOperation } : {}),
                  }}
                  value={comment}
                  onChange={setComment}
                  onQueue={queueCurrent}
                />
                <div style={styles.composerActions}>
                  <button
                    type="button"
                    onClick={() => {
                      if (selection.kind === 'area') clearAreaOverlay()
                      setSelection(null)
                      setAreaOperation('insert')
                      setComment('')
                    }}
                    style={styles.ghostButton}
                  >取消</button>
                  <button type="button" disabled={comment.trim().length === 0} onClick={queueCurrent} style={styles.primaryButton}>加入队列</button>
                </div>
              </div>
            ) : null}

            <div style={styles.footer}>
              <span style={styles.status}>{status}</span>
              <button
                type="button"
                disabled={sending || !hasSession || (queued.length === 0 && (selection === null || comment.trim().length === 0))}
                onClick={() => { void sendAll() }}
                style={styles.sendButton}
              >{sending ? '发送中…' : '发送给 Agent'}</button>
            </div>
          </div>
        </aside>
      </div>
      {showPresentationBrief ? (
        <PresentationBriefDialog
          submitting={creatingPresentation}
          onCancel={() => setShowPresentationBrief(false)}
          onSubmit={(brief) => { void createPresentation(brief) }}
        />
      ) : null}
      {showHistory ? (
        <VisualHistoryPanel
          records={history}
          selectedId={selectedHistoryId}
          persistent={historyStore.isPersistent}
          rollbackBusy={rollbackBusy}
          onSelect={setSelectedHistoryId}
          onDelete={id => { void historyStore.remove(id).then(refreshHistory) }}
          onRollback={record => { void rollbackBatch(record) }}
          onClose={() => setShowHistory(false)}
        />
      ) : null}
      {showStudio ? (
        <StudioDrawer
          busy={studioBusy}
          onClose={() => setShowStudio(false)}
          onApplyTheme={(theme, scope) => { void applyTheme(theme, scope) }}
          onApplyMotion={(preset, intensity) => { void applyMotion(preset, intensity) }}
        />
      ) : null}
    </div>
  )
}

function feedbackInjected(ctx: any, sessionId: string): FrontendFeedbackInjected {
  const session = typeof ctx.sessions?.binding === 'function'
    ? ctx.sessions.binding(sessionId)?.session
    : undefined
  return {
    sessionId,
    sessionActivity: session ?? null,
    sendFeedback: session === undefined ? null : async (text, image) => {
      const content = image === undefined
        ? [{ type: 'text', text }]
        : [{ type: 'image', mediaType: image.mediaType, data: image.data, name: image.name }, { type: 'text', text }]
      const result = await session.prompt(content, 'queue')
      if (result.ok) return { imageDelivered: image !== undefined }
      const message = result.error.message
      if (image === undefined || !/image|vision|unsupported|content|多模态|图片/i.test(message)) {
        throw new Error(message)
      }
      const fallback = await session.prompt([{ type: 'text', text }], 'queue')
      if (!fallback.ok) throw new Error(fallback.error.message)
      return { imageDelivered: false, warning: `当前模型或适配器不支持图像输入（${message}）` }
    },
  }
}

export function FrontendFeedbackLauncher(props: FrontendFeedbackInjected) {
  const [open, setOpen] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState<PageCraftMode>('webpage')

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <>
      <button
        type="button"
        aria-label="打开 PageCraft"
        title="打开 PageCraft"
        onClick={() => setOpen(true)}
        style={styles.launcherButton}
      >
        <span aria-hidden="true" style={styles.launcherIcon}>▣</span>
        <span>PageCraft</span>
      </button>
      {open ? createPortal(
        <div role="dialog" aria-modal="true" aria-label="PageCraft" style={styles.launcherOverlay}>
          <div style={styles.launcherPanel}>
            <FrontendFeedbackPanel
              key={`${props.sessionId}:${workspaceMode}`}
              {...props}
              workspaceMode={workspaceMode}
              onWorkspaceModeChange={setWorkspaceMode}
              onClose={() => setOpen(false)}
            />
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}

export function apply(ctx: any): void {
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'frontend-feedback',
    order: 30,
    label: () => 'PageCraft',
    inject: (sessionId: string): FrontendFeedbackInjected => feedbackInjected(ctx, sessionId),
  }, FrontendFeedbackLauncher))
}

const styles: Record<string, any> = {
  root: { position: 'relative', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', color: colors.text, background: '#0e1311', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  toolbar: { display: 'flex', gap: 18, alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, background: colors.panel, flexWrap: 'wrap' },
  brand: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 135 },
  brandDot: { width: 12, height: 12, borderRadius: 99, background: colors.accent, boxShadow: `0 0 18px ${colors.accent}` },
  title: { display: 'block', fontSize: 14, letterSpacing: '.02em' },
  subtitle: { display: 'block', marginTop: 3, color: colors.muted, fontSize: 11 },
  workspaceModeGroup: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: 3, border: `1px solid ${colors.border}`, borderRadius: 9, background: '#0a0f0d' },
  workspaceModeButton: { height: 30, padding: '0 11px', border: 0, borderRadius: 6, color: colors.muted, background: 'transparent', cursor: 'pointer', fontSize: 11, fontWeight: 700 },
  workspaceModeButtonActive: { color: '#102016', background: colors.accentStrong },
  addressBar: { display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 620px', justifyContent: 'flex-end' },
  input: { minWidth: 180, maxWidth: 620, flex: 1, height: 36, padding: '0 12px', border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: '#0a0f0d', outline: 'none' },
  secondaryButton: { height: 36, padding: '0 14px', border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: colors.panel2, cursor: 'pointer' },
  createPresentationButton: { height: 36, padding: '0 13px', border: `1px solid ${colors.accent}`, borderRadius: 8, color: '#102016', background: colors.accentStrong, cursor: 'pointer', fontWeight: 800, whiteSpace: 'nowrap' },
  iconButton: { width: 36, height: 36, border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: colors.panel2, cursor: 'pointer', fontSize: 18 },
  iconButtonDisabled: { opacity: .35, cursor: 'not-allowed' },
  modeGroup: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: 3, border: `1px solid ${colors.border}`, borderRadius: 10, background: '#0a0f0d' },
  modeButton: { height: 36, padding: '0 15px', border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: colors.panel2, cursor: 'pointer', fontWeight: 700 },
  modeButtonActive: { color: '#122217', borderColor: colors.accent, background: colors.accentStrong },
  areaModeButtonActive: { color: '#111d34', borderColor: '#8eb6ff', background: '#b9d0ff' },
  closeButton: { width: 36, height: 36, border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: '#2a211f', cursor: 'pointer', fontSize: 22, lineHeight: 1 },
  studioToolbarRow: { display: 'flex', alignItems: 'stretch', borderBottom: `1px solid ${colors.border}`, background: '#101613' },
  scopeField: { minWidth: 170, display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderLeft: `1px solid ${colors.border}`, color: colors.muted, fontSize: 10 },
  scopeSelect: { minWidth: 105, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '5px 7px', color: colors.text, background: colors.panel2, fontSize: 10 },
  workspace: {
    flex: 1,
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 340px)',
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  presentationWorkspace: { gridTemplateColumns: 'minmax(170px, 220px) minmax(0, 1fr) minmax(280px, 340px)' },
  previewShell: { minWidth: 0, minHeight: 0, overflow: 'auto', padding: 18, background: 'radial-gradient(circle at 50% 8%,#18221d,#090d0b 62%)' },
  deviceFrame: { margin: '0 auto', overflow: 'hidden', border: `1px solid ${colors.border}`, borderRadius: 10, background: 'white', boxShadow: '0 22px 70px rgba(0,0,0,.42)' },
  iframe: { display: 'block', border: 0, background: 'white' },
  sidebar: { minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${colors.border}`, background: colors.panel },
  sidebarHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 14px 12px', borderBottom: `1px solid ${colors.border}`, fontSize: 13 },
  sidebarHeaderActions: { display: 'flex', alignItems: 'center', gap: 7 },
  clearDraftButton: { padding: '4px 7px', border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.muted, background: 'transparent', cursor: 'pointer', fontSize: 10 },
  count: { display: 'inline-flex', marginLeft: 7, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 99, color: '#112117', background: colors.accent, fontSize: 11 },
  statePill: { padding: '5px 8px', borderRadius: 99, color: colors.muted, background: '#222b27', fontSize: 10 },
  statePillActive: { color: '#122217', background: colors.accentStrong },
  sidebarScroller: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowX: 'hidden', overflowY: 'scroll', overscrollBehavior: 'contain', scrollbarGutter: 'stable', scrollbarColor: `${colors.accent} ${colors.panel}` },
  scrollArea: { flex: '1 0 auto', minHeight: 0, padding: 12 },
  commentCard: { display: 'flex', gap: 9, padding: 10, marginBottom: 8, border: `1px solid ${colors.border}`, borderRadius: 9, background: colors.panel2 },
  cardIndex: { color: colors.accent, fontSize: 11, fontWeight: 800 },
  cardBody: { minWidth: 0, flex: 1 },
  cardTitle: { display: 'block', overflow: 'hidden', color: colors.text, fontSize: 11, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardComment: { display: 'block', marginTop: 5, color: colors.muted, fontSize: 12, lineHeight: 1.45 },
  removeButton: { alignSelf: 'flex-start', border: 0, color: colors.muted, background: 'transparent', cursor: 'pointer', fontSize: 18 },
  emptyQueue: { height: '100%', minHeight: 180, display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center', justifyContent: 'center', padding: 24, color: colors.muted, textAlign: 'center', fontSize: 12, lineHeight: 1.5 },
  emptyIcon: { color: colors.accent, fontSize: 30 },
  composer: { padding: 12, borderTop: `1px solid ${colors.border}`, background: colors.panel2 },
  selectedMeta: { display: 'flex', gap: 7, alignItems: 'center', minWidth: 0 },
  tag: { padding: '3px 6px', borderRadius: 5, color: '#112117', background: colors.accent, fontSize: 10, fontWeight: 800, textTransform: 'uppercase' },
  areaTag: { color: '#111d34', background: '#b9d0ff' },
  selector: { minWidth: 0, overflow: 'hidden', color: colors.muted, fontSize: 10, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  selectedText: { maxHeight: 42, overflow: 'hidden', margin: '9px 0', color: colors.muted, fontSize: 11, lineHeight: 1.45 },
  sourceHint: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 7, alignItems: 'center', margin: '8px 0', padding: 8, border: '1px solid #30463a', borderRadius: 7, color: '#9eb0a4', background: '#142019', fontSize: 10 },
  operationField: { display: 'flex', flexDirection: 'column', gap: 6, margin: '10px 0' },
  operationLabel: { color: colors.text, fontSize: 11, fontWeight: 700 },
  operationGroup: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 5 },
  operationButton: { height: 30, border: `1px solid ${colors.border}`, borderRadius: 7, color: colors.muted, background: '#0c1210', cursor: 'pointer', fontSize: 11 },
  operationButtonActive: { borderColor: '#8eb6ff', color: '#111d34', background: '#b9d0ff', fontWeight: 800 },
  operationHelp: { color: colors.muted, fontSize: 10, lineHeight: 1.4 },
  textarea: { width: '100%', minHeight: 84, resize: 'vertical', boxSizing: 'border-box', padding: 10, border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: '#0c1210', font: '12px/1.5 inherit', outline: 'none' },
  composerActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  ghostButton: { height: 32, padding: '0 11px', border: 0, color: colors.muted, background: 'transparent', cursor: 'pointer' },
  primaryButton: { height: 32, padding: '0 12px', border: 0, borderRadius: 7, color: '#102016', background: colors.accentStrong, cursor: 'pointer', fontWeight: 700 },
  footer: { padding: 12, borderTop: `1px solid ${colors.border}` },
  status: { display: 'block', minHeight: 32, color: colors.muted, fontSize: 10, lineHeight: 1.4 },
  sessionHint: { width: '100%', fontSize: 11, marginTop: 8, padding: '6px 10px', borderRadius: 6, color: colors.accentStrong, background: '#1a2b23', border: `1px solid ${colors.border}` },
  sendButton: { width: '100%', height: 38, marginTop: 8, border: `1px solid ${colors.accent}`, borderRadius: 8, color: '#102016', background: colors.accentStrong, cursor: 'pointer', fontWeight: 800 },
  launcherButton: { height: 30, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 9px', border: 0, borderRadius: 7, color: 'var(--dsw-alias-label-secondary, #c2cbc5)', background: 'transparent', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' },
  launcherIcon: { color: colors.accent, fontSize: 14, lineHeight: 1 },
  launcherOverlay: { position: 'fixed', inset: 0, zIndex: 10000, padding: 16, boxSizing: 'border-box', background: 'rgba(4, 7, 6, .72)', backdropFilter: 'blur(4px)' },
  launcherPanel: { width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', border: `1px solid ${colors.border}`, borderRadius: 14, background: '#0e1311', boxShadow: '0 24px 80px rgba(0, 0, 0, .55)' },
}
