import { useState } from 'react'
import { formatElapsed, progressStepState } from '../progress.ts'
import type { BatchProgress, BatchProgressStage } from '../progress.ts'

interface ProgressTimelineProps {
  progress: BatchProgress
  onHistory(): void
  onRefresh(): void
}

const STEPS: readonly { stage: BatchProgressStage; label: string }[] = [
  { stage: 'preparing', label: '准备上下文' },
  { stage: 'queued', label: '进入队列' },
  { stage: 'locating', label: '定位源码' },
  { stage: 'editing', label: '执行修改' },
  { stage: 'verifying', label: '验证结果' },
  { stage: 'completed', label: '完成同步' },
]

function outcomeLabel(progress: BatchProgress): string | null {
  if (progress.outcome === 'changed') return '已检测到视觉变化'
  if (progress.outcome === 'unchanged') return '未检测到视觉变化'
  if (progress.outcome === 'unverified') return '视觉结果未验证'
  return null
}

export function ProgressTimeline({ progress, onHistory, onRefresh }: ProgressTimelineProps) {
  const [collapsed, setCollapsed] = useState(false)
  const terminal = progress.stage === 'completed' || progress.stage === 'failed'
  const longRunning = !terminal && progress.elapsedMs >= 60_000
  const timelineStage: BatchProgressStage = progress.stage === 'thinking'
    ? 'queued'
    : progress.stage === 'checkpointing'
      ? 'locating'
      : progress.stage === 'finalizing'
        ? 'verifying'
        : progress.stage
  return (
    <section aria-label="PageCraft 任务进度" style={styles.panel}>
      <style>{`@keyframes pagecraftPulse{0%,100%{opacity:.55;transform:scale(.88)}50%{opacity:1;transform:scale(1)}}@media(prefers-reduced-motion:reduce){[data-pagecraft-progress-pulse]{animation:none!important}}`}</style>
      <header style={styles.header}>
        <div style={styles.heading}>
          <span data-pagecraft-progress-pulse="" style={{ ...styles.pulse, ...(terminal ? styles.pulseDone : {}) }} aria-hidden="true" />
          <div>
            <strong style={styles.title}>{progress.label}</strong>
            <span style={styles.meta}>#{progress.batchId.slice(0, 8)} · {progress.annotationCount} 条评注 · {formatElapsed(progress.elapsedMs)}</span>
          </div>
        </div>
        <button type="button" onClick={() => setCollapsed(value => !value)} style={styles.collapse}>
          {collapsed ? '展开' : '收起'}
        </button>
      </header>
      <div aria-live="polite" style={styles.currentAction}>{progress.detail}</div>
      {collapsed ? null : (
        <>
          <ol style={styles.timeline}>
            {STEPS.map((step, index) => {
              const state = progressStepState(step.stage, timelineStage)
              return (
                <li key={step.stage} aria-current={state === 'current' ? 'step' : undefined} style={styles.step}>
                  <span style={{
                    ...styles.node,
                    ...(state === 'done' ? styles.nodeDone : {}),
                    ...(state === 'current' ? styles.nodeCurrent : {}),
                  }}>{state === 'done' ? '✓' : index + 1}</span>
                  <span style={{ ...styles.stepLabel, ...(state === 'upcoming' ? styles.stepUpcoming : {}) }}>{step.label}</span>
                </li>
              )
            })}
          </ol>
          {progress.queueAhead > 0 ? <div style={styles.notice}>前面还有 {progress.queueAhead} 个 DSH 任务，PageCraft 会自动继续跟踪。</div> : null}
          {longRunning ? <div style={styles.notice}>任务仍在运行。你可以关闭 PageCraft 继续工作，重新打开后会恢复进度。</div> : null}
          {outcomeLabel(progress) !== null ? <div style={styles.outcome}>{outcomeLabel(progress)}</div> : null}
          {progress.stage === 'failed' ? <div role="alert" style={styles.error}>{progress.error ?? progress.detail}</div> : null}
          <div style={styles.actions}>
            <button type="button" onClick={onHistory} style={styles.secondary}>查看比较与历史</button>
            {terminal ? <button type="button" onClick={onRefresh} style={styles.primary}>刷新预览</button> : null}
          </div>
        </>
      )}
    </section>
  )
}

const styles: Record<string, any> = {
  panel: { margin: '10px 10px 0', border: '1px solid #355443', borderRadius: 11, overflow: 'hidden', background: 'linear-gradient(145deg,#17241d,#121916)', boxShadow: '0 10px 28px rgba(0,0,0,.16)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '11px 11px 8px' },
  heading: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 9 },
  pulse: { flex: '0 0 auto', width: 9, height: 9, borderRadius: 99, background: '#9ee7b2', boxShadow: '0 0 0 4px rgba(158,231,178,.11),0 0 16px rgba(158,231,178,.55)', animation: 'pagecraftPulse 1.8s ease-in-out infinite' },
  pulseDone: { background: '#88c99a', animation: 'none' },
  title: { display: 'block', color: '#edf5ef', fontSize: 12 },
  meta: { display: 'block', marginTop: 3, color: '#8fa097', fontSize: 9 },
  collapse: { border: 0, color: '#9eb0a4', background: 'transparent', cursor: 'pointer', fontSize: 10 },
  currentAction: { margin: '0 10px 9px', padding: '8px 9px', borderRadius: 7, color: '#cce8d4', background: '#0d1511', fontSize: 10, lineHeight: 1.45, overflowWrap: 'anywhere' },
  timeline: { listStyle: 'none', display: 'grid', gap: 7, margin: 0, padding: '3px 12px 10px' },
  step: { position: 'relative', display: 'flex', alignItems: 'center', gap: 8, minHeight: 20 },
  node: { width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', border: '1px solid #3a4a41', borderRadius: 99, color: '#718079', background: '#111714', fontSize: 9 },
  nodeDone: { borderColor: '#5e9870', color: '#122117', background: '#88c99a' },
  nodeCurrent: { borderColor: '#a9e2b7', color: '#dff8e5', background: '#24412f', boxShadow: '0 0 0 3px rgba(136,201,154,.11)' },
  stepLabel: { color: '#c9d6cd', fontSize: 10 },
  stepUpcoming: { color: '#68776e' },
  notice: { margin: '0 10px 8px', padding: '7px 8px', border: '1px solid #4b452b', borderRadius: 7, color: '#e2cf95', background: '#282416', fontSize: 9, lineHeight: 1.45 },
  outcome: { margin: '0 10px 8px', color: '#b9ebc6', fontSize: 10, fontWeight: 700 },
  error: { margin: '0 10px 8px', padding: 8, borderRadius: 7, color: '#f0b7ac', background: '#2b1a17', fontSize: 9, lineHeight: 1.45 },
  actions: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 7, padding: '0 10px 10px' },
  secondary: { minHeight: 32, border: '1px solid #34463c', borderRadius: 7, color: '#cbd8d0', background: '#18211d', cursor: 'pointer', fontSize: 10 },
  primary: { minHeight: 32, border: 0, borderRadius: 7, color: '#102016', background: '#a9e2b7', cursor: 'pointer', fontSize: 10, fontWeight: 700 },
}
