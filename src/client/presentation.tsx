import { useState } from 'react'
import { DEFAULT_PRESENTATION_BRIEF } from '../presentation.ts'
import type { PresentationBrief, PresentationSlideSummary } from '../presentation.ts'

interface PresentationBriefDialogProps {
  submitting: boolean
  onCancel(): void
  onSubmit(brief: PresentationBrief): void
}

interface SlideRailProps {
  slides: readonly PresentationSlideSummary[]
  activeSlideId: string | null
  onCreate(): void
  onSelect(slideId: string): void
}

const styles: Record<string, any> = {
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
  dialog: { width: 'min(620px, 100%)', maxHeight: '100%', overflowY: 'auto', padding: 22, border: '1px solid #365045', borderRadius: 14, color: '#edf5ef', background: '#121816', boxShadow: '0 28px 90px rgba(0,0,0,.55)' },
  heading: { margin: 0, fontSize: 20 },
  intro: { margin: '8px 0 18px', color: '#9aac9f', fontSize: 12, lineHeight: 1.6 },
  form: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fullField: { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 6 },
  label: { color: '#c9d5cc', fontSize: 11, fontWeight: 700 },
  input: { width: '100%', height: 36, boxSizing: 'border-box', padding: '0 10px', border: '1px solid #2c3d34', borderRadius: 8, color: '#edf5ef', background: '#0a0f0d', outline: 'none' },
  textarea: { width: '100%', minHeight: 88, resize: 'vertical', boxSizing: 'border-box', padding: 10, border: '1px solid #2c3d34', borderRadius: 8, color: '#edf5ef', background: '#0a0f0d', font: '12px/1.5 inherit', outline: 'none' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 18 },
  cancel: { height: 34, padding: '0 13px', border: '1px solid #2c3d34', borderRadius: 8, color: '#c9d5cc', background: 'transparent', cursor: 'pointer' },
  submit: { height: 34, padding: '0 14px', border: 0, borderRadius: 8, color: '#102016', background: '#a9e2b7', cursor: 'pointer', fontWeight: 800 },
}

export function SlideRail({ slides, activeSlideId, onCreate, onSelect }: SlideRailProps) {
  return (
    <nav aria-label="幻灯片列表" style={styles.rail}>
      <div style={styles.railHeader}>
        <strong style={styles.railTitle}>幻灯片</strong>
        <button type="button" onClick={onCreate} style={styles.addButton}>＋ 新建</button>
      </div>
      <div style={styles.railScroller}>
        {slides.length === 0 ? (
          <div style={styles.empty}>打开带有 PageCraft 标记的演示文稿后，这里会自动显示幻灯片列表。</div>
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

export function PresentationBriefDialog({ submitting, onCancel, onSubmit }: PresentationBriefDialogProps) {
  const [brief, setBrief] = useState<PresentationBrief>({ ...DEFAULT_PRESENTATION_BRIEF })
  const update = <K extends keyof PresentationBrief>(key: K, value: PresentationBrief[K]) => {
    setBrief(current => ({ ...current, [key]: value }))
  }
  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label="新建演示文稿">
      <div style={styles.dialog}>
        <h2 style={styles.heading}>新建演示文稿</h2>
        <p style={styles.intro}>填写最基本的内容。Agent 会使用 presentation-builder Skill 在当前工作区创建可预览、可框选和可继续修改的 HTML/React 幻灯片。</p>
        <div style={styles.form}>
          <label style={styles.fullField}>
            <span style={styles.label}>标题 *</span>
            <input autoFocus value={brief.title} onChange={event => update('title', event.target.value)} style={styles.input} placeholder="例如：PageCraft 产品介绍" />
          </label>
          <label style={styles.field}>
            <span style={styles.label}>观众</span>
            <input value={brief.audience} onChange={event => update('audience', event.target.value)} style={styles.input} placeholder="例如：开发者、投资人" />
          </label>
          <label style={styles.field}>
            <span style={styles.label}>页数</span>
            <input type="number" min={3} max={30} value={brief.slideCount} onChange={event => update('slideCount', Number(event.target.value))} style={styles.input} />
          </label>
          <label style={styles.field}>
            <span style={styles.label}>演讲目标</span>
            <input value={brief.goal} onChange={event => update('goal', event.target.value)} style={styles.input} placeholder="例如：介绍产品并推动试用" />
          </label>
          <label style={styles.field}>
            <span style={styles.label}>视觉风格</span>
            <select value={brief.style} onChange={event => update('style', event.target.value)} style={styles.input}>
              <option value="editorial">杂志编辑风</option>
              <option value="business">商务简洁</option>
              <option value="technology">科技发布会</option>
              <option value="academic">学术报告</option>
              <option value="minimal">高级极简</option>
            </select>
          </label>
          <label style={styles.field}>
            <span style={styles.label}>颜色模式</span>
            <select value={brief.colorMode} onChange={event => update('colorMode', event.target.value as PresentationBrief['colorMode'])} style={styles.input}>
              <option value="light">浅色（默认）</option>
              <option value="inherit">继承当前项目</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <label style={styles.fullField}>
            <span style={styles.label}>补充要求</span>
            <textarea value={brief.requirements} onChange={event => update('requirements', event.target.value)} style={styles.textarea} placeholder="需要包含哪些内容、品牌颜色、已有资料位置等……" />
          </label>
        </div>
        <div style={styles.actions}>
          <button type="button" disabled={submitting} onClick={onCancel} style={styles.cancel}>取消</button>
          <button type="button" disabled={submitting || brief.title.trim().length === 0} onClick={() => onSubmit(brief)} style={styles.submit}>{submitting ? '正在发送…' : '交给 Agent 创建'}</button>
        </div>
      </div>
    </div>
  )
}
