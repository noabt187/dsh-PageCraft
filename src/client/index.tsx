import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  buildAnnotationPrompt,
  currentPreviewUrl,
  isFeedbackSelection,
  movePreviewNavigation,
  normalizePreviewUrl,
  previewHistoryStorageKey,
  previewUrlStorageKey,
  pushPreviewNavigation,
  resolvePersistedPreviewNavigation,
  resolvePersistedPreviewUrl,
  resolvePreviewFrameLocation,
} from '../shared.ts'
import type { FeedbackComment, FeedbackSelection, PreviewNavigationState } from '../shared.ts'

export const inject = ['slots', 'sessions']

interface FrontendFeedbackInjected {
  sessionId: string
  sendFeedback(text: string): Promise<void>
  hasSession: boolean
}

interface FrontendFeedbackViewProps extends FrontendFeedbackInjected {
  onClose?: () => void
}

interface FeedbackMessage {
  type?: string
  active?: unknown
  mode?: unknown
  payload?: unknown
  url?: unknown
  message?: unknown
  status?: unknown
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

type SelectionMode = 'element' | 'area'

function commentFrom(selection: FeedbackSelection, comment: string): FeedbackComment {
  return { ...selection, comment: comment.trim() } as FeedbackComment
}

function cardTitle(item: FeedbackSelection): string {
  if (item.kind === 'area') {
    return `区域 ${item.rect.width} × ${item.rect.height} · (${item.rect.x}, ${item.rect.y})`
  }
  const text = item.text.trim()
  return text.length > 0 ? `${item.selector} · ${text.slice(0, 42)}` : item.selector
}

function selectionCode(item: FeedbackSelection): string {
  if (item.kind !== 'area') return item.selector
  const { topLeft, topRight, bottomRight, bottomLeft } = item.corners
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

function readPersistedPreviewNavigation(sessionId: string): PreviewNavigationState {
  return resolvePersistedPreviewNavigation(
    readStoredValue(previewHistoryStorageKey(sessionId)),
    resolvePersistedPreviewUrl(readStoredValue(previewUrlStorageKey(sessionId))),
  )
}

function persistPreviewNavigation(sessionId: string, navigation: PreviewNavigationState): void {
  writeStoredValue(previewHistoryStorageKey(sessionId), JSON.stringify(navigation))
  writeStoredValue(previewUrlStorageKey(sessionId), currentPreviewUrl(navigation))
}

export function FrontendFeedbackView({ sessionId, sendFeedback, hasSession, onClose }: FrontendFeedbackViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previousSessionIdRef = useRef(sessionId)
  const initialNavigation = useMemo(() => readPersistedPreviewNavigation(sessionId), [sessionId])
  const navigationRef = useRef(initialNavigation)
  const initialPreviewUrl = currentPreviewUrl(initialNavigation)
  const [urlDraft, setUrlDraft] = useState(initialPreviewUrl)
  const [navigation, setNavigation] = useState(initialNavigation)
  const [revision, setRevision] = useState(0)
  const [selectionMode, setSelectionMode] = useState<SelectionMode | null>(null)
  const [selection, setSelection] = useState<FeedbackSelection | null>(null)
  const [comment, setComment] = useState('')
  const [queued, setQueued] = useState<FeedbackComment[]>([])
  const [status, setStatus] = useState(
    hasSession
      ? '打开页面后，可选择已有 DOM 元素，也可以框选空白区域新增内容。'
      : '当前是空白会话，页面预览和评注可先行使用；若要发送给 Agent，请先发起一条消息创建会话。',
  )
  const [sending, setSending] = useState(false)
  const loadedUrl = currentPreviewUrl(navigation)
  const canGoBack = navigation.index > 0
  const canGoForward = navigation.index < navigation.entries.length - 1

  const previewFrame = useMemo(() => {
    return resolvePreviewFrameLocation(loadedUrl, window.location.href, revision)
  }, [loadedUrl, revision])

  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) return
    previousSessionIdRef.current = sessionId
    const restoredNavigation = readPersistedPreviewNavigation(sessionId)
    const restoredUrl = currentPreviewUrl(restoredNavigation)
    navigationRef.current = restoredNavigation
    setUrlDraft(restoredUrl)
    setNavigation(restoredNavigation)
    setRevision(0)
    setSelection(null)
    setSelectionMode(null)
    setComment('')
    setQueued([])
    setStatus('正在恢复该会话上次打开的预览…')
  }, [sessionId])

  const commitNavigation = useCallback((next: PreviewNavigationState, nextStatus: string) => {
    navigationRef.current = next
    persistPreviewNavigation(sessionId, next)
    setNavigation(next)
    setUrlDraft(currentPreviewUrl(next))
    setRevision(value => value + 1)
    setSelection(null)
    setSelectionMode(null)
    setStatus(nextStatus)
  }, [sessionId])

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

  useEffect(() => {
    const listener = (event: MessageEvent<FeedbackMessage>) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      if (event.data?.type === 'dsh-frontend-feedback-active') {
        const nextMode = event.data.mode === 'element' || event.data.mode === 'area'
          ? event.data.mode
          : null
        setSelectionMode(Boolean(event.data.active) ? nextMode : null)
        return
      }
      if (event.data?.type === 'dsh-frontend-feedback-ready') {
        setStatus('预览已加载。可选择 DOM 元素，或拖动框选区域来新增内容。')
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
      if (event.data?.type !== 'dsh-frontend-feedback-selected' || !isFeedbackSelection(event.data.payload)) return
      setSelection(event.data.payload)
      setComment('')
      setStatus(event.data.payload.kind === 'area'
        ? `已框选 ${event.data.payload.rect.width} × ${event.data.payload.rect.height}px 区域，并记录四个顶点。`
        : `已选择 ${event.data.payload.selector}`)
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [navigatePreview])

  const openPreview = () => {
    navigatePreview(urlDraft)
  }

  const setAnnotatorMode = (next: SelectionMode | null) => {
    setSelectionMode(next)
    setStatus(next === 'area'
      ? '在预览中拖动框选区域；黄色参考线表示对齐吸附。按住 Alt 自由框选，按住 Shift 锁定正方形。'
      : next === 'element'
        ? '在预览中悬停并点击已有 DOM 元素。'
        : '已回到浏览模式，可点击页面链接和表单。')
    iframeRef.current?.contentWindow?.postMessage({
      type: 'dsh-frontend-feedback-set-mode',
      mode: next,
    }, '*')
  }

  const queueCurrent = () => {
    if (selection === null || comment.trim().length === 0) return
    setQueued(items => [...items, commentFrom(selection, comment)])
    setSelection(null)
    setComment('')
    setStatus('评注已加入队列，可继续选择元素或框选区域。')
  }

  const sendAll = async () => {
    const comments = [...queued]
    if (selection !== null && comment.trim().length > 0) comments.push(commentFrom(selection, comment))
    if (comments.length === 0) return
    if (!hasSession) {
      setStatus('当前还没有会话，无法发送到 Agent。先创建会话后再发送。')
      return
    }
    setSending(true)
    try {
      await sendFeedback(buildAnnotationPrompt(comments))
      setQueued([])
      setSelection(null)
      setComment('')
      setStatus(`已把 ${comments.length} 条评注发送到当前会话。`)
    } catch (error) {
      setStatus(`发送失败：${describeError(error)}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={styles.root} data-conversation-composer-overlay="">
      <div style={styles.toolbar}>
        <div style={styles.brand}>
          <span style={styles.brandDot} />
          <div>
            <strong style={styles.title}>Frontend Feedback</strong>
            <span style={styles.subtitle}>预览 · DOM 选择 · 区域框选 · 精准微调</span>
          </div>
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
          <button type="button" aria-label="刷新" onClick={() => setRevision(value => value + 1)} style={styles.iconButton} title="刷新预览">↻</button>
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
          {onClose !== undefined ? (
            <button type="button" aria-label="关闭页面评注" title="关闭" onClick={onClose} style={styles.closeButton}>×</button>
          ) : null}
        </div>
        {!hasSession ? <div style={styles.sessionHint}>先发一条消息后，右侧“发送给 Agent”才可提交。</div> : null}
      </div>

      <div style={styles.workspace}>
        <div style={styles.previewShell}>
          <iframe
            ref={iframeRef}
            title="前端页面评注预览"
            src={previewFrame.src}
            sandbox={previewFrame.allowSameOrigin
              ? 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups'
              : 'allow-scripts allow-forms allow-modals allow-popups'}
            style={styles.iframe}
            onLoad={() => {
              if (selectionMode !== null) setAnnotatorMode(selectionMode)
            }}
          />
        </div>

        <aside style={styles.sidebar}>
          <div style={styles.sidebarHeader}>
            <div>
              <strong>评注队列</strong>
              <span style={styles.count}>{queued.length}</span>
            </div>
            <span style={{ ...styles.statePill, ...(selectionMode !== null ? styles.statePillActive : {}) }}>
              {selectionMode === 'element' ? '元素选择' : selectionMode === 'area' ? '区域框选' : '浏览模式'}
            </span>
          </div>

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
                  <span>选择已有元素，或在空白位置拖动框选需要新增内容的区域。</span>
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
                <textarea
                  autoFocus
                  value={comment}
                  onChange={event => setComment(event.target.value)}
                  onKeyDown={event => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') queueCurrent()
                  }}
                  placeholder={selection.kind === 'area'
                    ? '说明希望在这个区域新增什么，例如“新增一个统计卡片，与左侧卡片顶边对齐”…'
                    : '说明希望怎样修改这个元素…'}
                  style={styles.textarea}
                />
                <div style={styles.composerActions}>
                  <button type="button" onClick={() => setSelection(null)} style={styles.ghostButton}>取消</button>
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
    </div>
  )
}

function feedbackInjected(ctx: any, sessionId: string): FrontendFeedbackInjected {
  const sessionBinding = typeof ctx.sessions?.binding === 'function'
    ? ctx.sessions.binding(sessionId)
    : undefined
  const session = sessionBinding?.session
  if (session === undefined) {
    return {
      sessionId,
      hasSession: false,
      sendFeedback: async () => {
        throw new Error('当前状态未关联会话。请先发送一条消息创建会话后再使用。')
      },
    }
  }
  return {
    sessionId,
    hasSession: true,
    sendFeedback: async (text) => {
      const result = await session.prompt([{ type: 'text', text }], 'queue')
      if (!result.ok) throw new Error(result.error.message)
    },
  }
}

export function FrontendFeedbackLauncher(props: FrontendFeedbackInjected) {
  const [open, setOpen] = useState(false)

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
        aria-label="打开页面评注"
        title="打开页面评注"
        onClick={() => setOpen(true)}
        style={styles.launcherButton}
      >
        <span aria-hidden="true" style={styles.launcherIcon}>▣</span>
        <span>页面评注</span>
      </button>
      {open ? createPortal(
        <div role="dialog" aria-modal="true" aria-label="页面评注" style={styles.launcherOverlay}>
          <div style={styles.launcherPanel}>
            <FrontendFeedbackView {...props} onClose={() => setOpen(false)} />
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}

export function apply(ctx: any): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'frontend-feedback',
    order: 20,
    label: () => '页面评注',
    inject: (sessionId: string): FrontendFeedbackInjected => feedbackInjected(ctx, sessionId),
  }, FrontendFeedbackView))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'frontend-feedback-launcher',
    order: 30,
    label: () => '页面评注',
    inject: (sessionId: string): FrontendFeedbackInjected => feedbackInjected(ctx, sessionId),
  }, FrontendFeedbackLauncher))
}

const styles: Record<string, any> = {
  root: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', color: colors.text, background: '#0e1311', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  toolbar: { display: 'flex', gap: 18, alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, background: colors.panel, flexWrap: 'wrap' },
  brand: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 210 },
  brandDot: { width: 12, height: 12, borderRadius: 99, background: colors.accent, boxShadow: `0 0 18px ${colors.accent}` },
  title: { display: 'block', fontSize: 14, letterSpacing: '.02em' },
  subtitle: { display: 'block', marginTop: 3, color: colors.muted, fontSize: 11 },
  addressBar: { display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 520px', justifyContent: 'flex-end' },
  input: { minWidth: 180, maxWidth: 620, flex: 1, height: 36, padding: '0 12px', border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: '#0a0f0d', outline: 'none' },
  secondaryButton: { height: 36, padding: '0 14px', border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: colors.panel2, cursor: 'pointer' },
  iconButton: { width: 36, height: 36, border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: colors.panel2, cursor: 'pointer', fontSize: 18 },
  iconButtonDisabled: { opacity: .35, cursor: 'not-allowed' },
  modeGroup: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: 3, border: `1px solid ${colors.border}`, borderRadius: 10, background: '#0a0f0d' },
  modeButton: { height: 36, padding: '0 15px', border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: colors.panel2, cursor: 'pointer', fontWeight: 700 },
  modeButtonActive: { color: '#122217', borderColor: colors.accent, background: colors.accentStrong },
  areaModeButtonActive: { color: '#111d34', borderColor: '#8eb6ff', background: '#b9d0ff' },
  closeButton: { width: 36, height: 36, border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: '#2a211f', cursor: 'pointer', fontSize: 22, lineHeight: 1 },
  workspace: {
    flex: 1,
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 340px)',
    boxSizing: 'border-box',
    overflow: 'hidden',
    // ConversationRoot publishes the live height of its floating task/composer
    // seat. Reserve the same clearance for both preview and sidebar content.
    paddingBottom: 'calc(var(--dsh-composer-height, 152px) + 16px)',
  },
  previewShell: { minWidth: 0, minHeight: 0, padding: 12, background: '#090d0b' },
  iframe: { display: 'block', width: '100%', height: '100%', border: `1px solid ${colors.border}`, borderRadius: 10, background: 'white' },
  sidebar: { minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${colors.border}`, background: colors.panel },
  sidebarHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 14px 12px', borderBottom: `1px solid ${colors.border}`, fontSize: 13 },
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
