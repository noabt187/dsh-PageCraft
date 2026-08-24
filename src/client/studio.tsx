import { useState } from 'react'
import { MOTION_PRESETS, THEME_PRESETS } from '../studio.ts'
import type { MotionPresetId, ThemePresetId } from '../studio.ts'

export interface ViewportPreset {
  id: 'desktop' | 'laptop' | 'tablet' | 'mobile' | 'custom'
  label: string
  width: number
  height: number
  devicePixelRatio: number
}

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900, devicePixelRatio: 1 },
  { id: 'laptop', label: 'Laptop', width: 1280, height: 800, devicePixelRatio: 1 },
  { id: 'tablet', label: 'Tablet', width: 768, height: 1024, devicePixelRatio: 2 },
  { id: 'mobile', label: 'Mobile', width: 390, height: 844, devicePixelRatio: 2 },
] as const

interface BreakpointToolbarProps {
  value: ViewportPreset
  onChange(value: ViewportPreset): void
  onCapture(): void
  captureBusy: boolean
  onHistory(): void
  historyCount: number
  onStudio(): void
}

export function BreakpointToolbar({ value, onChange, onCapture, captureBusy, onHistory, historyCount, onStudio }: BreakpointToolbarProps) {
  const [customOpen, setCustomOpen] = useState(false)
  const [customWidth, setCustomWidth] = useState(value.width)
  const [customHeight, setCustomHeight] = useState(value.height)
  const commitCustom = () => {
    const width = Math.min(7680, Math.max(240, Math.round(customWidth)))
    const height = Math.min(7680, Math.max(240, Math.round(customHeight)))
    onChange({ id: 'custom', label: 'Custom', width, height, devicePixelRatio: 1 })
    setCustomOpen(false)
  }
  return (
    <div style={styles.breakpointBar}>
      <div role="group" aria-label="响应式预览断点" style={styles.breakpointGroup}>
        {VIEWPORT_PRESETS.map(preset => (
          <button
            type="button"
            key={preset.id}
            aria-pressed={value.id === preset.id}
            title={`${preset.width} × ${preset.height}`}
            onClick={() => onChange(preset)}
            style={{ ...styles.breakpointButton, ...(value.id === preset.id ? styles.breakpointButtonActive : {}) }}
          >{preset.label}</button>
        ))}
        <button
          type="button"
          aria-pressed={value.id === 'custom'}
          onClick={() => setCustomOpen(current => !current)}
          style={{ ...styles.breakpointButton, ...(value.id === 'custom' ? styles.breakpointButtonActive : {}) }}
        >{value.id === 'custom' ? `${value.width}×${value.height}` : 'Custom'}</button>
      </div>
      {customOpen ? (
        <div style={styles.customPopover}>
          <label>宽<input type="number" min="240" max="7680" value={customWidth} onChange={event => setCustomWidth(Number(event.target.value))} style={styles.numberInput} /></label>
          <label>高<input type="number" min="240" max="7680" value={customHeight} onChange={event => setCustomHeight(Number(event.target.value))} style={styles.numberInput} /></label>
          <button type="button" onClick={commitCustom} style={styles.compactPrimary}>应用</button>
        </div>
      ) : null}
      <span style={styles.viewportReadout}>{value.width} × {value.height}</span>
      <button type="button" onClick={onCapture} disabled={captureBusy} style={styles.toolButton}>{captureBusy ? '捕获中…' : '截图'}</button>
      <button type="button" onClick={onHistory} style={styles.toolButton}>比较与历史{historyCount > 0 ? ` · ${historyCount}` : ''}</button>
      <button type="button" onClick={onStudio} style={styles.studioButton}>主题与动效</button>
    </div>
  )
}

interface StudioDrawerProps {
  busy: boolean
  onClose(): void
  onApplyTheme(theme: ThemePresetId | 'extract-current', scope: 'current-page' | 'current-component' | 'design-system'): void
  onApplyMotion(preset: MotionPresetId, intensity: 'subtle' | 'balanced' | 'cinematic'): void
}

export function StudioDrawer({ busy, onClose, onApplyTheme, onApplyMotion }: StudioDrawerProps) {
  const [tab, setTab] = useState<'theme' | 'motion'>('theme')
  const [scope, setScope] = useState<'current-page' | 'current-component' | 'design-system'>('current-page')
  const [intensity, setIntensity] = useState<'subtle' | 'balanced' | 'cinematic'>('balanced')
  return (
    <div role="dialog" aria-modal="true" aria-label="主题与电影化动效" style={styles.drawerOverlay}>
      <aside style={styles.drawer}>
        <header style={styles.drawerHeader}>
          <div><strong style={styles.drawerTitle}>PageCraft Studio</strong><span style={styles.drawerSubtitle}>把视觉方向转换成可维护的源码改动</span></div>
          <button type="button" onClick={onClose} aria-label="关闭主题与动效" style={styles.drawerClose}>×</button>
        </header>
        <div role="tablist" style={styles.tabs}>
          <button type="button" role="tab" aria-selected={tab === 'theme'} onClick={() => setTab('theme')} style={{ ...styles.tab, ...(tab === 'theme' ? styles.tabActive : {}) }}>主题中心</button>
          <button type="button" role="tab" aria-selected={tab === 'motion'} onClick={() => setTab('motion')} style={{ ...styles.tab, ...(tab === 'motion' ? styles.tabActive : {}) }}>电影化动效</button>
        </div>
        <div style={styles.drawerBody}>
          {tab === 'theme' ? (
            <>
              <label style={styles.selectLabel}>应用范围
                <select value={scope} onChange={event => setScope(event.target.value as typeof scope)} style={styles.select}>
                  <option value="current-page">当前页面</option>
                  <option value="current-component">当前组件</option>
                  <option value="design-system">整个设计系统</option>
                </select>
              </label>
              {[...THEME_PRESETS, {
                id: 'extract-current' as const,
                name: '提取当前主题',
                description: '分析现有页面，整理为可复用设计令牌。',
                tokens: { color: '从当前页面提取', typography: '从当前页面提取', spacing: '', radius: '', shadow: '', imagery: '', motion: '' },
              }].map(theme => (
                <article key={theme.id} style={styles.presetCard}>
                  <div style={styles.presetSwatch} data-theme={theme.id} />
                  <div style={styles.presetBody}><strong>{theme.name}</strong><span>{theme.description}</span><small>{theme.tokens.color} · {theme.tokens.typography}</small></div>
                  <button type="button" disabled={busy} onClick={() => onApplyTheme(theme.id, scope)} style={styles.applyButton}>应用</button>
                </article>
              ))}
            </>
          ) : (
            <>
              <label style={styles.selectLabel}>强度
                <select value={intensity} onChange={event => setIntensity(event.target.value as typeof intensity)} style={styles.select}>
                  <option value="subtle">克制</option>
                  <option value="balanced">平衡</option>
                  <option value="cinematic">电影化</option>
                </select>
              </label>
              <div style={styles.motionGrid}>
                {MOTION_PRESETS.map(preset => (
                  <article key={preset.id} style={styles.motionCard}>
                    <div style={styles.motionIcon}>◫</div>
                    <strong>{preset.name}</strong>
                    <span>{preset.description}</span>
                    <small>移动端：{preset.mobileFallback}</small>
                    <button type="button" disabled={busy} onClick={() => onApplyMotion(preset.id, intensity)} style={styles.applyButton}>生成工单</button>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

const styles: Record<string, any> = {
  breakpointBar: { position: 'relative', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: '1px solid #27372f', background: '#101613', color: '#dfe9e2', overflowX: 'auto' },
  breakpointGroup: { display: 'flex', gap: 3, padding: 3, border: '1px solid #2b3b32', borderRadius: 8, background: '#171f1b' },
  breakpointButton: { border: 0, borderRadius: 5, padding: '5px 8px', color: '#91a297', background: 'transparent', fontSize: 10, cursor: 'pointer' },
  breakpointButtonActive: { color: '#16301e', background: '#a8dfb6', fontWeight: 700 },
  viewportReadout: { color: '#7f9286', fontSize: 10, whiteSpace: 'nowrap' },
  toolButton: { border: '1px solid #32453a', borderRadius: 7, padding: '6px 9px', color: '#bdd0c3', background: '#18211d', fontSize: 10, whiteSpace: 'nowrap', cursor: 'pointer' },
  studioButton: { border: 0, borderRadius: 7, padding: '6px 10px', color: '#102218', background: '#a7dfb6', fontWeight: 700, fontSize: 10, whiteSpace: 'nowrap', cursor: 'pointer' },
  customPopover: { position: 'absolute', top: 44, left: 350, zIndex: 20, display: 'flex', gap: 7, alignItems: 'end', padding: 10, border: '1px solid #385044', borderRadius: 10, background: '#17201c', boxShadow: '0 14px 36px rgba(0,0,0,.38)' },
  numberInput: { display: 'block', width: 76, marginTop: 4, padding: 5, border: '1px solid #36483e', borderRadius: 5, color: '#e8f0ea', background: '#0e1411' },
  compactPrimary: { border: 0, borderRadius: 6, padding: '7px 9px', background: '#a7dfb6', color: '#102218', fontWeight: 700 },
  drawerOverlay: { position: 'fixed', inset: 0, zIndex: 100002, display: 'flex', justifyContent: 'flex-end', background: 'rgba(5,8,7,.58)', backdropFilter: 'blur(5px)' },
  drawer: { width: 'min(520px, 94vw)', height: '100%', display: 'flex', flexDirection: 'column', color: '#eaf2ed', background: '#111714', borderLeft: '1px solid #304238', boxShadow: '-24px 0 70px rgba(0,0,0,.35)' },
  drawerHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px', borderBottom: '1px solid #29382f' },
  drawerTitle: { display: 'block', fontSize: 18 },
  drawerSubtitle: { display: 'block', marginTop: 3, color: '#91a298', fontSize: 11 },
  drawerClose: { border: 0, color: '#d8e3dc', background: 'transparent', fontSize: 24, cursor: 'pointer' },
  tabs: { display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '10px 20px 0' },
  tab: { border: 0, borderBottom: '2px solid #2c3a32', padding: '10px', color: '#87988e', background: 'transparent', cursor: 'pointer' },
  tabActive: { borderBottomColor: '#9ed7ad', color: '#dff2e5', fontWeight: 700 },
  drawerBody: { minHeight: 0, overflow: 'auto', display: 'grid', alignContent: 'start', gap: 10, padding: 20 },
  selectLabel: { display: 'grid', gap: 6, color: '#9bac9f', fontSize: 11, marginBottom: 6 },
  select: { border: '1px solid #34463c', borderRadius: 7, padding: 8, color: '#e6eee9', background: '#18201c' },
  presetCard: { display: 'grid', gridTemplateColumns: '54px 1fr auto', gap: 12, alignItems: 'center', padding: 12, border: '1px solid #2e3e35', borderRadius: 11, background: '#171f1b' },
  presetSwatch: { width: 54, height: 54, borderRadius: 8, background: 'linear-gradient(135deg,#f1eee4 0 48%,#1c2a22 48% 72%,#b1d5bb 72%)' },
  presetBody: { minWidth: 0, display: 'grid', gap: 4, fontSize: 12 },
  applyButton: { border: '1px solid #466250', borderRadius: 7, padding: '7px 9px', color: '#d9f1df', background: '#203027', fontSize: 10, cursor: 'pointer' },
  motionGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  motionCard: { display: 'grid', gap: 7, padding: 13, border: '1px solid #2e3e35', borderRadius: 11, background: '#171f1b', fontSize: 11 },
  motionIcon: { width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 9, color: '#d9eedf', background: 'radial-gradient(circle at 65% 30%,#72578d,#25382d 64%,#18211d)' },
}
