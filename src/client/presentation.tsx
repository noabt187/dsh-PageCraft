import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import {
  DEFAULT_PRESENTATION_DOCUMENT_BRIEF,
  PRESENTATION_JOB_PATH,
  PRESENTATION_PLAN_PATH,
  PRESENTATION_SOURCE_PATH,
  isPresentationRequestSettled,
  normalizePresentationJobSnapshot,
  normalizePresentationPlan,
} from '../presentation.ts'
import type {
  PresentationDocumentBrief,
  PresentationGenerationSlide,
  PresentationJobSnapshot,
  PresentationPlan,
  PresentationPlanSlide,
  PresentationSlideSummary,
  PresentationSourceSummary,
} from '../presentation.ts'

interface PresentationDocumentDialogProps {
  sessionId: string
  submitting: boolean
  onCancel(): void
  onRequestOutline(source: PresentationSourceSummary, brief: PresentationDocumentBrief): Promise<void>
  onRequestGeneration(source: PresentationSourceSummary): Promise<void>
  onPreviewReady(url: string): void
}

interface SlideRailProps {
  slides: readonly PresentationSlideSummary[]
  activeSlideId: string | null
  onCreate(): void
  onSelect(slideId: string): void
}

const styles: Record<string, CSSProperties> = {
  rail: { minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #2c3d34', background: '#121816' },
  railHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '13px 11px', borderBottom: '1px solid #2c3d34' },
  railTitle: { color: '#edf5ef', fontSize: 12 },
  addButton: { height: 28, padding: '0 9px', border: '1px solid #2c3d34', borderRadius: 7, color: '#102016', background: '#a9e2b7', cursor: 'pointer', fontSize: 11, fontWeight: 800 },
  railScroller: { flex: 1, minHeight: 0, overflowY: 'auto', padding: 9 },
  empty: { padding: '28px 10px', color: '#9aac9f', fontSize: 11, lineHeight: 1.55, textAlign: 'center' },
  slideButton: { width: '100%', display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', gap: 7, alignItems: 'center', marginBottom: 7, padding: '9px 8px', border: '1px solid #2c3d34', borderRadius: 8, color: '#c9d5cc', background: '#19211e', cursor: 'pointer', textAlign: 'left' },
  slideButtonActive: { borderColor: '#88c99a', color: '#edf5ef', background: '#23352b', boxShadow: '0 0 0 1px rgba(136, 201, 154, .18)' },
  slideNumber: { color: '#88c99a', fontSize: 10, fontWeight: 800 },
  slideTitle: { overflow: 'hidden', fontSize: 11, fontWeight: 700, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  overlay: { position: 'absolute', inset: 0, zIndex: 5, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(4, 7, 6, .82)', backdropFilter: 'blur(5px)' },
  dialog: { width: 'min(760px, 100%)', maxHeight: '100%', overflowY: 'auto', padding: 22, border: '1px solid #365045', borderRadius: 14, color: '#edf5ef', background: '#121816', boxShadow: '0 28px 90px rgba(0,0,0,.55)' },
  heading: { margin: 0, fontSize: 20 },
  intro: { margin: '8px 0 18px', color: '#9aac9f', fontSize: 12, lineHeight: 1.6 },
  form: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fullField: { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 6 },
  label: { color: '#c9d5cc', fontSize: 11, fontWeight: 700 },
  input: { width: '100%', height: 36, boxSizing: 'border-box', padding: '0 10px', border: '1px solid #2c3d34', borderRadius: 8, color: '#edf5ef', background: '#0a0f0d', outline: 'none' },
  textarea: { width: '100%', minHeight: 94, resize: 'vertical', boxSizing: 'border-box', padding: 10, border: '1px solid #2c3d34', borderRadius: 8, color: '#edf5ef', background: '#0a0f0d', font: '12px/1.55 inherit', outline: 'none' },
  uploadBox: { gridColumn: '1 / -1', display: 'grid', gap: 10, padding: 14, border: '1px dashed #466053', borderRadius: 10, background: '#0f1512' },
  fileRow: { display: 'flex', alignItems: 'center', gap: 10 },
  fileButton: { height: 34, padding: '0 13px', border: 0, borderRadius: 8, color: '#102016', background: '#a9e2b7', cursor: 'pointer', fontWeight: 800 },
  fileName: { minWidth: 0, flex: 1, overflow: 'hidden', color: '#c9d5cc', fontSize: 12, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  removeFile: { flex: 'none', height: 28, padding: '0 9px', border: '1px solid #5f3939', borderRadius: 7, color: '#e8aaaa', background: '#261717', cursor: 'pointer', fontSize: 11 },
  divider: { display: 'flex', alignItems: 'center', gap: 10, color: '#718079', fontSize: 10 },
  dividerLine: { height: 1, flex: 1, background: '#28362f' },
  infoBox: { padding: 12, border: '1px solid #2c3d34', borderRadius: 9, background: '#17201c', color: '#b8c8bd', fontSize: 12, lineHeight: 1.6 },
  warning: { marginTop: 7, color: '#e0bd7c', fontSize: 11 },
  error: { marginTop: 12, padding: 10, border: '1px solid #6c3737', borderRadius: 8, color: '#ffb6b6', background: '#2a1717', fontSize: 12, lineHeight: 1.5 },
  notice: { marginTop: 12, padding: 10, border: '1px solid #3e6150', borderRadius: 8, color: '#b9ddc3', background: '#14231b', fontSize: 12, lineHeight: 1.5 },
  actions: { display: 'flex', justifyContent: 'space-between', gap: 9, marginTop: 18 },
  actionGroup: { display: 'flex', justifyContent: 'flex-end', gap: 9 },
  cancel: { height: 34, padding: '0 13px', border: '1px solid #2c3d34', borderRadius: 8, color: '#c9d5cc', background: 'transparent', cursor: 'pointer' },
  submit: { height: 34, padding: '0 14px', border: 0, borderRadius: 8, color: '#102016', background: '#a9e2b7', cursor: 'pointer', fontWeight: 800 },
  disabled: { opacity: 0.48, cursor: 'not-allowed' },
  outlineHeader: { display: 'grid', gap: 10, marginBottom: 14 },
  outlineList: { display: 'grid', gap: 8 },
  outlineItem: { display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) auto', gap: 8, alignItems: 'start', padding: 9, border: '1px solid #2c3d34', borderRadius: 9, background: '#17201c' },
  outlineIndex: { display: 'grid', placeItems: 'center', width: 24, height: 24, borderRadius: 6, color: '#102016', background: '#88c99a', fontSize: 10, fontWeight: 900 },
  outlineFields: { display: 'grid', gap: 6 },
  smallInput: { width: '100%', height: 31, boxSizing: 'border-box', padding: '0 8px', border: '1px solid #34473e', borderRadius: 6, color: '#edf5ef', background: '#0d1310', outline: 'none', fontSize: 12 },
  smallTextarea: { width: '100%', minHeight: 48, resize: 'vertical', boxSizing: 'border-box', padding: 8, border: '1px solid #34473e', borderRadius: 6, color: '#b8c8bd', background: '#0d1310', outline: 'none', font: '11px/1.45 inherit' },
  itemActions: { display: 'grid', gridTemplateColumns: 'repeat(2, 26px)', gap: 4 },
  tinyButton: { width: 26, height: 26, padding: 0, border: '1px solid #34473e', borderRadius: 6, color: '#c9d5cc', background: '#111815', cursor: 'pointer' },
  removeButton: { gridColumn: '1 / -1', width: 56, height: 25, border: '1px solid #5f3939', borderRadius: 6, color: '#e8aaaa', background: '#261717', cursor: 'pointer', fontSize: 10 },
  addSlide: { height: 34, marginTop: 10, border: '1px dashed #466053', borderRadius: 8, color: '#a9e2b7', background: 'transparent', cursor: 'pointer', fontWeight: 700 },
  progressTrack: { height: 8, overflow: 'hidden', margin: '14px 0 18px', borderRadius: 999, background: '#26332d' },
  progressFill: { height: '100%', borderRadius: 999, background: '#88c99a', transition: 'width .25s ease' },
  progressList: { display: 'grid', gap: 7 },
  progressItem: { display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', gap: 8, alignItems: 'center', padding: '9px 10px', border: '1px solid #2c3d34', borderRadius: 8, background: '#17201c' },
  progressState: { fontSize: 11, color: '#9aac9f' },
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function responseJson(response: Response): Promise<unknown> {
  const value = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(responseErrorMessage(value, response.status))
  }
  return value
}

function responseErrorMessage(value: unknown, status: number): string {
  if (value === null || typeof value !== 'object' || !('error' in value)) {
    return `请求失败（HTTP ${status}）`
  }
  const error = value.error
  if (error === null || typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string') {
    return `请求失败（HTTP ${status}）`
  }
  return error.message
}

function jobStorageKey(sessionId: string): string {
  return `dsh-pagecraft.presentation-job:${sessionId}`
}

function persistedJobId(sessionId: string): string | null {
  try {
    return window.localStorage.getItem(jobStorageKey(sessionId))
  } catch {
    return null
  }
}

function persistJobId(sessionId: string, jobId: string | null): void {
  try {
    if (jobId === null) window.localStorage.removeItem(jobStorageKey(sessionId))
    else window.localStorage.setItem(jobStorageKey(sessionId), jobId)
  } catch {
    // Job files remain durable in the workspace even when browser storage is unavailable.
  }
}

function clonePlan(plan: PresentationPlan): PresentationPlan {
  return { ...plan, slides: plan.slides.map(slide => ({ ...slide, sourceRefs: [...slide.sourceRefs] })) }
}

function progressLabel(status: PresentationGenerationSlide['status']): string {
  if (status === 'completed') return '已完成'
  if (status === 'generating') return '生成中'
  if (status === 'failed') return '失败'
  return '等待'
}

function progressIcon(status: PresentationGenerationSlide['status']): string {
  if (status === 'completed') return '✓'
  if (status === 'generating') return '…'
  if (status === 'failed') return '!'
  return '○'
}

function withDisabledStyle(style: CSSProperties, disabled: boolean): CSSProperties {
  return disabled ? { ...style, ...styles.disabled } : style
}

export function SlideRail({ slides, activeSlideId, onCreate, onSelect }: SlideRailProps): ReactElement {
  return (
    <nav aria-label="幻灯片列表" style={styles.rail}>
      <div style={styles.railHeader}>
        <strong style={styles.railTitle}>幻灯片</strong>
        <button type="button" onClick={onCreate} style={styles.addButton}>＋ 新建</button>
      </div>
      <div style={styles.railScroller}>
        {slides.length === 0 ? (
          <div style={styles.empty}>上传文档并生成演示文稿后，这里会自动显示幻灯片列表。</div>
        ) : slides.map((slide) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => onSelect(slide.id)}
            style={{ ...styles.slideButton, ...(activeSlideId === slide.id ? styles.slideButtonActive : {}) }}
          >
            <span style={styles.slideNumber}>{slide.index + 1}</span>
            <span style={styles.slideTitle}>{slide.title || `幻灯片 ${slide.index + 1}`}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

export function PresentationDocumentDialog({
  sessionId,
  submitting,
  onCancel,
  onRequestOutline,
  onRequestGeneration,
  onPreviewReady,
}: PresentationDocumentDialogProps): ReactElement {
  const [brief, setBrief] = useState<PresentationDocumentBrief>({ ...DEFAULT_PRESENTATION_DOCUMENT_BRIEF })
  const [file, setFile] = useState<File | null>(null)
  const [pastedText, setPastedText] = useState('')
  const [snapshot, setSnapshot] = useState<PresentationJobSnapshot | null>(null)
  const [plan, setPlan] = useState<PresentationPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [sourceProcessing, setSourceProcessing] = useState(false)
  const [sourceCancellationRequested, setSourceCancellationRequested] = useState(false)
  const [requestedPhase, setRequestedPhase] = useState<'planning' | 'generating' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const previewOpenedRef = useRef<string | null>(null)
  const planLoadedForJobRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadAbortControllerRef = useRef<AbortController | null>(null)
  const generationSubmissionRef = useRef(false)

  function updateBrief<K extends keyof PresentationDocumentBrief>(key: K, value: PresentationDocumentBrief[K]): void {
    setBrief(current => ({ ...current, [key]: value }))
  }

  async function loadJob(jobId: string): Promise<PresentationJobSnapshot> {
    const query = new URLSearchParams({ sessionId, jobId })
    const value = await responseJson(await fetch(`${PRESENTATION_JOB_PATH}?${query}`, { cache: 'no-store' }))
    const next = normalizePresentationJobSnapshot(value)
    if (next === null) throw new Error('服务器返回了无法识别的演示任务状态')
    setSnapshot(next)
    if (next.plan !== undefined && planLoadedForJobRef.current !== next.jobId) {
      planLoadedForJobRef.current = next.jobId
      setPlan(clonePlan(next.plan))
    }
    if (next.previewUrl !== undefined && previewOpenedRef.current !== next.previewUrl) {
      previewOpenedRef.current = next.previewUrl
      onPreviewReady(next.previewUrl)
    }
    return next
  }

  useEffect(() => {
    const jobId = persistedJobId(sessionId)
    if (jobId === null) return
    void loadJob(jobId).catch((loadError) => {
      persistJobId(sessionId, null)
      setError(`恢复上次任务失败：${describeError(loadError)}`)
    })
  }, [sessionId])

  useEffect(() => {
    if (snapshot === null) return
    const waitingForOutline = requestedPhase === 'planning' && snapshot.phase === 'source_ready'
    const waitingForGeneration = requestedPhase === 'generating' && snapshot.phase === 'outline_ready'
    const active = snapshot.phase === 'planning' || snapshot.phase === 'generating' || waitingForOutline || waitingForGeneration
    if (!active) return
    const timer = window.setInterval(() => {
      void loadJob(snapshot.jobId).then((next) => {
        if (requestedPhase !== null && isPresentationRequestSettled(requestedPhase, next.phase)) {
          setRequestedPhase(null)
        }
      }).catch(pollError => setError(`读取生成进度失败：${describeError(pollError)}`))
    }, 1600)
    return () => window.clearInterval(timer)
  }, [requestedPhase, snapshot?.jobId, snapshot?.phase])

  useEffect(() => {
    return () => uploadAbortControllerRef.current?.abort()
  }, [])

  const sourceReady = file !== null || pastedText.trim().length > 0
  const showPlanning = snapshot !== null
    && plan === null
    && (requestedPhase === 'planning' || snapshot.phase === 'planning' || snapshot.phase === 'source_ready')
  const showProgress = snapshot !== null
    && (requestedPhase === 'generating' || snapshot.phase === 'generating' || snapshot.phase === 'ready' || snapshot.phase === 'failed')
  const completed = snapshot?.slides.filter(slide => slide.status === 'completed').length ?? 0
  const total = snapshot?.slides.length ?? 0
  const progress = total === 0 ? 0 : Math.round(completed / total * 100)

  function reset(): void {
    persistJobId(sessionId, null)
    planLoadedForJobRef.current = null
    previewOpenedRef.current = null
    setSnapshot(null)
    setPlan(null)
    setFile(null)
    if (fileInputRef.current !== null) fileInputRef.current.value = ''
    setPastedText('')
    setRequestedPhase(null)
    setError('')
    setNotice('')
  }

  function removeSelectedFile(): void {
    setFile(null)
    if (fileInputRef.current !== null) fileInputRef.current.value = ''
    setError('')
    setNotice('')
  }

  function cancelSourceProcessing(): void {
    if (uploadAbortControllerRef.current === null) return
    setSourceCancellationRequested(true)
    setNotice('正在取消文件上传和解析…')
    uploadAbortControllerRef.current.abort()
  }

  async function uploadAndPlan(): Promise<void> {
    if (!sourceReady) return
    const controller = new AbortController()
    uploadAbortControllerRef.current = controller
    setBusy(true)
    setSourceProcessing(true)
    setSourceCancellationRequested(false)
    setError('')
    setNotice('')
    try {
      const body = file ?? new Blob([pastedText.trim()], { type: 'text/markdown;charset=utf-8' })
      const filename = file?.name ?? 'pasted-content.md'
      const query = new URLSearchParams({ sessionId, filename })
      const value = await responseJson(await fetch(`${PRESENTATION_SOURCE_PATH}?${query}`, {
        method: 'POST',
        headers: { 'content-type': file?.type || body.type || 'application/octet-stream' },
        body,
        signal: controller.signal,
      }))
      const next = normalizePresentationJobSnapshot(value)
      if (next === null) throw new Error('服务器返回了无法识别的文档解析结果')
      uploadAbortControllerRef.current = null
      setSourceProcessing(false)
      persistJobId(sessionId, next.jobId)
      setSnapshot(next)
      setRequestedPhase('planning')
      await onRequestOutline(next.source, brief)
    } catch (uploadError) {
      setRequestedPhase(null)
      if (controller.signal.aborted || isAbortError(uploadError)) {
        setNotice('已取消文件上传和解析，可以调整资料后重新开始。')
      } else {
        setError(describeError(uploadError))
      }
    } finally {
      if (uploadAbortControllerRef.current === controller) uploadAbortControllerRef.current = null
      setSourceProcessing(false)
      setSourceCancellationRequested(false)
      setBusy(false)
    }
  }

  async function continuePlanning(): Promise<void> {
    if (snapshot === null) return
    setBusy(true)
    setError('')
    setRequestedPhase('planning')
    try {
      await onRequestOutline(snapshot.source, brief)
    } catch (planningError) {
      setRequestedPhase(null)
      setError(describeError(planningError))
    } finally {
      setBusy(false)
    }
  }

  function updateSlide(index: number, changes: Partial<PresentationPlanSlide>): void {
    setPlan(current => {
      if (current === null) return null
      return {
        ...current,
        slides: current.slides.map((slide, slideIndex) => {
          return slideIndex === index ? { ...slide, ...changes } : slide
        }),
      }
    })
  }

  function moveSlide(index: number, direction: -1 | 1): void {
    setPlan(current => {
      if (current === null) return null
      const target = index + direction
      if (target < 0 || target >= current.slides.length) return current
      const slides = [...current.slides]
      const [slide] = slides.splice(index, 1)
      slides.splice(target, 0, slide)
      return { ...current, slides }
    })
  }

  function addSlide(): void {
    setPlan(current => {
      if (current === null || current.slides.length >= 30) return current
      let ordinal = current.slides.length + 1
      let id = `slide-${String(ordinal).padStart(2, '0')}`
      while (current.slides.some(slide => slide.id === id)) {
        ordinal += 1
        id = `slide-${String(ordinal).padStart(2, '0')}`
      }
      return {
        ...current,
        slides: [...current.slides, { id, title: '新增页面', purpose: '', takeaway: '', sourceRefs: [] }],
      }
    })
  }

  async function saveAndGenerate(): Promise<void> {
    if (snapshot === null || plan === null || generationSubmissionRef.current) return
    const normalized = normalizePresentationPlan(plan)
    if (normalized === null) {
      setError('目录至少需要 3 页，并且标题不能为空。')
      return
    }
    generationSubmissionRef.current = true
    setBusy(true)
    setRequestedPhase('generating')
    setError('')
    try {
      const query = new URLSearchParams({ sessionId, jobId: snapshot.jobId })
      const value = await responseJson(await fetch(`${PRESENTATION_PLAN_PATH}?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(normalized),
      }))
      const saved = normalizePresentationJobSnapshot(value)
      if (saved === null) throw new Error('服务器没有正确保存目录')
      setSnapshot(saved)
      setPlan(clonePlan(normalized))
      await onRequestGeneration(saved.source)
    } catch (generationError) {
      setRequestedPhase(null)
      setError(describeError(generationError))
    } finally {
      generationSubmissionRef.current = false
      setBusy(false)
    }
  }

  const effectiveBusy = busy || submitting

  function updatePlanTitle(title: string): void {
    setPlan(current => {
      if (current === null) return null
      return { ...current, title }
    })
  }

  function removeSlide(index: number): void {
    setPlan(current => {
      if (current === null) return null
      return { ...current, slides: current.slides.filter((_, slideIndex) => slideIndex !== index) }
    })
  }

  function generationMessage(): string {
    if (snapshot?.phase === 'ready') return '演示文稿已经生成完成，可关闭窗口后继续逐页评注。'
    if (snapshot?.phase === 'failed') return `生成失败：${snapshot.error ?? 'Agent 没有提供错误信息'}`
    return 'Agent 正在创建统一主题并分批生成页面。已完成的页面会立即写入演示数据。'
  }

  function generationSlides(): PresentationGenerationSlide[] {
    if (snapshot === null) return []
    if (snapshot.slides.length > 0) return snapshot.slides
    if (snapshot.plan === undefined) return []
    return snapshot.plan.slides.map(slide => ({ id: slide.id, title: slide.title, status: 'pending' }))
  }

  function renderDialogContent(): ReactNode {
    if (snapshot === null) {
      return (
        <div style={styles.form}>
          <div style={styles.uploadBox}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.md,.markdown,.txt"
              hidden
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null
                setFile(next)
                if (next !== null) setPastedText('')
                setError('')
                setNotice('')
              }}
            />
            <div style={styles.fileRow}>
              <button type="button" disabled={sourceProcessing} onClick={() => fileInputRef.current?.click()} style={withDisabledStyle(styles.fileButton, sourceProcessing)}>选择文件</button>
              <span style={styles.fileName}>{file === null ? '支持 PDF、DOCX、Markdown、TXT，最大 25 MB' : `${file.name} · ${formatFileSize(file.size)}`}</span>
              {file !== null ? (
                <button type="button" disabled={sourceProcessing} onClick={removeSelectedFile} style={withDisabledStyle(styles.removeFile, sourceProcessing)} aria-label={`移除 ${file.name}`}>移除</button>
              ) : null}
            </div>
            <div style={styles.divider}><span style={styles.dividerLine} /><span>或者直接粘贴文字</span><span style={styles.dividerLine} /></div>
            <textarea
              value={pastedText}
              disabled={file !== null || sourceProcessing}
              onChange={(event) => {
                setPastedText(event.target.value)
                setError('')
                setNotice('')
              }}
              style={withDisabledStyle(styles.textarea, file !== null || sourceProcessing)}
              placeholder="粘贴文章、报告、需求说明或其他资料……"
            />
          </div>
          <label style={styles.field}>
            <span style={styles.label}>观众</span>
            <input value={brief.audience} onChange={event => updateBrief('audience', event.target.value)} style={styles.input} placeholder="例如：投资人、客户、团队成员" />
          </label>
          <label style={styles.field}>
            <span style={styles.label}>目标页数</span>
            <input type="number" min={3} max={30} value={brief.slideCount} onChange={event => updateBrief('slideCount', Number(event.target.value))} style={styles.input} />
          </label>
          <label style={styles.fullField}>
            <span style={styles.label}>演讲目标</span>
            <input value={brief.goal} onChange={event => updateBrief('goal', event.target.value)} style={styles.input} placeholder="例如：完整介绍报告并突出关键结论" />
          </label>
          <label style={styles.fullField}>
            <span style={styles.label}>补充要求</span>
            <textarea value={brief.requirements} onChange={event => updateBrief('requirements', event.target.value)} style={styles.textarea} placeholder="例如：面向非技术观众，数据结论必须保留，详细内容放到备注或附录……" />
          </label>
        </div>
      )
    }

    if (showPlanning) {
      return (
        <div>
          <div style={styles.infoBox}>
            <strong>{snapshot.source.originalName}</strong><br />
            已提取 {snapshot.source.textCharacters.toLocaleString()} 个字符并保存到 <code>{snapshot.source.sourcePath}</code>。
            {snapshot.source.warnings.map((warning, index) => <div key={index} style={styles.warning}>注意：{warning}</div>)}
          </div>
          <div style={{ ...styles.empty, padding: '48px 12px' }}>
            <strong style={{ color: '#edf5ef' }}>Agent 正在阅读文档并规划目录…</strong><br />
            这里只生成目录，不会立即创建页面。目录完成后可以调整顺序和标题。
          </div>
        </div>
      )
    }

    if (plan !== null && !showProgress) {
      return (
        <div>
          <div style={styles.outlineHeader}>
            <label style={styles.field}>
              <span style={styles.label}>演示文稿标题</span>
              <input value={plan.title} onChange={event => updatePlanTitle(event.target.value)} style={styles.input} />
            </label>
            <div style={styles.infoBox}>当前目录共 {plan.slides.length} 页。可以调整顺序、修改页面标题和讲述目的，确认后才开始生成。</div>
          </div>
          <div style={styles.outlineList}>
            {plan.slides.map((slide, index) => {
              const firstSlide = index === 0
              const lastSlide = index === plan.slides.length - 1
              const minimumSlideCount = plan.slides.length <= 3
              return (
                <div key={slide.id} style={styles.outlineItem}>
                  <span style={styles.outlineIndex}>{index + 1}</span>
                  <div style={styles.outlineFields}>
                    <input value={slide.title} onChange={event => updateSlide(index, { title: event.target.value })} style={styles.smallInput} aria-label={`第 ${index + 1} 页标题`} />
                    <textarea value={slide.purpose} onChange={event => updateSlide(index, { purpose: event.target.value })} style={styles.smallTextarea} aria-label={`第 ${index + 1} 页讲述目的`} placeholder="这页需要讲清楚什么" />
                  </div>
                  <div style={styles.itemActions}>
                    <button type="button" disabled={firstSlide} onClick={() => moveSlide(index, -1)} style={withDisabledStyle(styles.tinyButton, firstSlide)} title="上移">↑</button>
                    <button type="button" disabled={lastSlide} onClick={() => moveSlide(index, 1)} style={withDisabledStyle(styles.tinyButton, lastSlide)} title="下移">↓</button>
                    <button type="button" disabled={minimumSlideCount} onClick={() => removeSlide(index)} style={withDisabledStyle(styles.removeButton, minimumSlideCount)}>删除</button>
                  </div>
                </div>
              )
            })}
          </div>
          <button type="button" disabled={plan.slides.length >= 30} onClick={addSlide} style={withDisabledStyle(styles.addSlide, plan.slides.length >= 30)}>＋ 增加一页</button>
        </div>
      )
    }

    return (
      <div>
        <div style={styles.infoBox}>
          <strong>{snapshot.plan?.title ?? snapshot.source.originalName}</strong><br />
          {generationMessage()}
        </div>
        <div style={styles.progressTrack}><div style={{ ...styles.progressFill, width: `${progress}%` }} /></div>
        <div style={styles.progressList}>
          {generationSlides().map((slide, index) => (
            <div key={slide.id} style={styles.progressItem}>
              <span>{progressIcon(slide.status)}</span>
              <span>{index + 1}. {slide.title}</span>
              <span style={styles.progressState}>{progressLabel(slide.status)}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  function renderPrimaryAction(): ReactNode {
    if (snapshot === null) {
      if (sourceProcessing) {
        return (
          <button type="button" disabled={sourceCancellationRequested} onClick={cancelSourceProcessing} style={withDisabledStyle(styles.cancel, sourceCancellationRequested)}>
            {sourceCancellationRequested ? '正在取消…' : '取消处理'}
          </button>
        )
      }
      const disabled = effectiveBusy || !sourceReady
      return (
        <button type="button" disabled={disabled} onClick={() => { void uploadAndPlan() }} style={withDisabledStyle(styles.submit, disabled)}>
          {effectiveBusy ? '正在处理…' : '解析并生成目录'}
        </button>
      )
    }
    if (showPlanning && requestedPhase === null && snapshot.phase === 'source_ready') {
      return (
        <button type="button" disabled={effectiveBusy} onClick={() => { void continuePlanning() }} style={withDisabledStyle(styles.submit, effectiveBusy)}>
          {effectiveBusy ? '正在发送…' : '继续生成目录'}
        </button>
      )
    }
    if (plan !== null && !showProgress) {
      return (
        <button type="button" disabled={effectiveBusy} onClick={() => { void saveAndGenerate() }} style={withDisabledStyle(styles.submit, effectiveBusy)}>
          {effectiveBusy ? '正在发送…' : '确认目录并开始生成'}
        </button>
      )
    }
    if (snapshot.previewUrl !== undefined) {
      return <button type="button" onClick={() => onPreviewReady(snapshot.previewUrl!)} style={styles.submit}>打开预览</button>
    }
    return null
  }

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label="从文档生成演示文稿">
      <div style={styles.dialog}>
        <h2 style={styles.heading}>从文档生成演示文稿</h2>
        <p style={styles.intro}>PageCraft 先提取文档、让 Agent 生成可调整的目录；确认目录后，再按 2～3 页一批逐步生成并显示进度。</p>

        {renderDialogContent()}

        {error ? <div role="alert" style={styles.error}>{error}</div> : null}
        {notice ? <div role="status" style={styles.notice}>{notice}</div> : null}

        <div style={styles.actions}>
          <div>
            {snapshot !== null && snapshot.phase !== 'generating' && (!showPlanning || requestedPhase === null) ? (
              <button type="button" disabled={effectiveBusy} onClick={reset} style={withDisabledStyle(styles.cancel, effectiveBusy)}>换一个文件</button>
            ) : null}
          </div>
          <div style={styles.actionGroup}>
            <button type="button" disabled={effectiveBusy} onClick={onCancel} style={withDisabledStyle(styles.cancel, effectiveBusy)}>{snapshot?.phase === 'ready' ? '完成' : '关闭'}</button>
            {renderPrimaryAction()}
          </div>
        </div>
      </div>
    </div>
  )
}
