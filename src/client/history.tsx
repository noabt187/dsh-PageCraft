import { useMemo, useState } from 'react'
import type { VisualBatchRecord, VisualSnapshot } from '../history.ts'

interface VisualHistoryPanelProps {
  records: readonly VisualBatchRecord[]
  selectedId: string | null
  persistent: boolean
  rollbackBusy: boolean
  onSelect(id: string): void
  onDelete(id: string): void
  onRollback(record: VisualBatchRecord): void
  onClose(): void
}

const statusLabel: Record<VisualBatchRecord['status'], string> = {
  'capturing-before': '保存修改前',
  queued: '等待 Agent',
  running: '正在修改',
  'capturing-after': '保存修改后',
  completed: '可比较',
  failed: '执行失败',
  'rollback-pending': '正在恢复',
  'rolled-back': '已恢复',
  'rollback-conflict': '恢复冲突',
}

function SnapshotPane({ snapshot, label }: { snapshot?: VisualSnapshot; label: string }) {
  return (
    <div style={styles.snapshotPane}>
      <div style={styles.snapshotLabel}>{label}</div>
      {snapshot?.dataUrl !== undefined ? (
        <img src={snapshot.dataUrl} alt={`${label}页面快照`} style={styles.snapshotImage} />
      ) : (
        <div style={styles.snapshotEmpty}>
          <strong>没有可显示的截图</strong>
          <span>{snapshot?.error ?? '该批次尚未完成此阶段的捕获。'}</span>
        </div>
      )}
    </div>
  )
}

function Comparison({ record }: { record: VisualBatchRecord }) {
  const [position, setPosition] = useState(50)
  const canSlide = record.before?.dataUrl !== undefined && record.after?.dataUrl !== undefined
  return (
    <div style={styles.comparison}>
      <div style={styles.compareToolbar}>
        <div>
          <strong>修改前后</strong>
          <span style={styles.compareMeta}>{record.url}</span>
        </div>
        {canSlide ? (
          <label style={styles.sliderLabel}>
            分割位置
            <input
              aria-label="修改前后分割位置"
              type="range"
              min="5"
              max="95"
              value={position}
              onChange={event => setPosition(Number(event.target.value))}
            />
          </label>
        ) : null}
      </div>
      {canSlide ? (
        <div style={styles.sliderStage}>
          <img src={record.after?.dataUrl} alt="修改后页面" style={styles.sliderImage} />
          <div style={{ ...styles.beforeClip, width: `${position}%` }}>
            <img src={record.before?.dataUrl} alt="修改前页面" style={styles.sliderImage} />
          </div>
          <div style={{ ...styles.divider, left: `${position}%` }} />
          <span style={{ ...styles.imageBadge, left: 12 }}>修改前</span>
          <span style={{ ...styles.imageBadge, right: 12 }}>修改后</span>
        </div>
      ) : (
        <div style={styles.sideBySide}>
          <SnapshotPane snapshot={record.before} label="修改前" />
          <SnapshotPane snapshot={record.after} label="修改后" />
        </div>
      )}
      <div style={styles.annotationSummary}>
        <span>{record.annotations.length} 条评注</span>
        <span>{record.before?.viewport.preset ?? '未知断点'}</span>
        <span>{new Date(record.updatedAt).toLocaleString()}</span>
      </div>
    </div>
  )
}

export function VisualHistoryPanel({
  records,
  selectedId,
  persistent,
  rollbackBusy,
  onSelect,
  onDelete,
  onRollback,
  onClose,
}: VisualHistoryPanelProps) {
  const selected = useMemo(
    () => records.find(record => record.id === selectedId) ?? records[0],
    [records, selectedId],
  )
  return (
    <div role="dialog" aria-modal="true" aria-label="PageCraft 视觉历史" style={styles.overlay}>
      <div style={styles.panel}>
        <header style={styles.header}>
          <div><strong style={styles.title}>视觉历史</strong><span style={styles.subtitle}>比较每个评注批次，必要时安全恢复</span></div>
          <button type="button" onClick={onClose} aria-label="关闭视觉历史" style={styles.close}>×</button>
        </header>
        {!persistent ? <div style={styles.warning}>IndexedDB 不可用：当前历史只保存在本次会话内。</div> : null}
        <div style={styles.body}>
          <aside style={styles.rail}>
            {records.length === 0 ? <div style={styles.emptyHistory}>发送第一批页面评注后，这里会保存修改前后记录。</div> : null}
            {records.map(record => (
              <button
                type="button"
                key={record.id}
                onClick={() => onSelect(record.id)}
                style={{ ...styles.historyItem, ...(selected?.id === record.id ? styles.historyItemActive : {}) }}
              >
                <span style={styles.historyTop}><strong>{record.annotations.length} 条评注</strong><em>{statusLabel[record.status]}</em></span>
                <span style={styles.historyUrl}>{record.url}</span>
                <span style={styles.historyTime}>{new Date(record.createdAt).toLocaleString()}</span>
              </button>
            ))}
          </aside>
          <main style={styles.main}>
            {selected === undefined ? (
              <div style={styles.noSelection}>暂无可比较的批次</div>
            ) : (
              <>
                <Comparison key={selected.id} record={selected} />
                <div style={styles.actions}>
                  <button type="button" onClick={() => onDelete(selected.id)} style={styles.deleteButton}>删除记录</button>
                  <button
                    type="button"
                    disabled={rollbackBusy || !['completed', 'failed', 'rollback-conflict'].includes(selected.status)}
                    onClick={() => onRollback(selected)}
                    style={{ ...styles.rollbackButton, ...(rollbackBusy ? styles.disabled : {}) }}
                  >{rollbackBusy ? '正在发送恢复工单…' : '恢复此批次'}</button>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, any> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 100001, display: 'grid', placeItems: 'center', background: 'rgba(5, 8, 7, .76)', backdropFilter: 'blur(10px)', padding: 24 },
  panel: { width: 'min(1180px, 96vw)', height: 'min(760px, 92vh)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #304138', borderRadius: 18, background: '#101513', color: '#edf5ef', boxShadow: '0 30px 90px rgba(0,0,0,.5)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '17px 20px', borderBottom: '1px solid #29372f' },
  title: { display: 'block', fontSize: 18 },
  subtitle: { display: 'block', color: '#95a79b', fontSize: 12, marginTop: 3 },
  close: { border: 0, color: '#d8e4dc', background: 'transparent', fontSize: 25, cursor: 'pointer' },
  warning: { padding: '8px 18px', background: '#493b20', color: '#f7dfa3', fontSize: 12 },
  body: { minHeight: 0, flex: 1, display: 'grid', gridTemplateColumns: '270px 1fr' },
  rail: { overflow: 'auto', borderRight: '1px solid #29372f', background: '#131a17', padding: 10 },
  historyItem: { width: '100%', display: 'grid', gap: 6, textAlign: 'left', padding: 12, marginBottom: 8, border: '1px solid transparent', borderRadius: 10, background: '#19211e', color: '#e4ede7', cursor: 'pointer' },
  historyItemActive: { borderColor: '#75b68a', background: '#203128' },
  historyTop: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 },
  historyUrl: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#aab8af', fontSize: 11 },
  historyTime: { color: '#77877d', fontSize: 10 },
  emptyHistory: { color: '#8fa097', fontSize: 12, lineHeight: 1.6, padding: 18 },
  main: { minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 16 },
  comparison: { minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 12 },
  compareToolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  compareMeta: { display: 'block', color: '#8fa097', maxWidth: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, marginTop: 3 },
  sliderLabel: { display: 'flex', alignItems: 'center', gap: 8, color: '#a7b5ac', fontSize: 11 },
  sliderStage: { position: 'relative', minHeight: 0, flex: 1, overflow: 'hidden', border: '1px solid #35463c', borderRadius: 12, background: '#202622' },
  sliderImage: { width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#eef0ec' },
  beforeClip: { position: 'absolute', inset: '0 auto 0 0', overflow: 'hidden', borderRight: '2px solid #b5ebc4' },
  divider: { position: 'absolute', top: 0, bottom: 0, width: 2, background: '#b5ebc4', transform: 'translateX(-1px)', boxShadow: '0 0 0 1px rgba(0,0,0,.2)' },
  imageBadge: { position: 'absolute', top: 12, padding: '5px 8px', borderRadius: 14, color: '#eaffef', background: 'rgba(15,25,19,.82)', fontSize: 10 },
  sideBySide: { minHeight: 0, flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  snapshotPane: { minWidth: 0, minHeight: 260, position: 'relative', display: 'grid', placeItems: 'center', overflow: 'hidden', border: '1px solid #35463c', borderRadius: 12, background: '#202622' },
  snapshotLabel: { position: 'absolute', top: 10, left: 10, zIndex: 1, padding: '5px 8px', borderRadius: 14, background: 'rgba(15,25,19,.82)', fontSize: 10 },
  snapshotImage: { width: '100%', height: '100%', objectFit: 'contain', background: '#eef0ec' },
  snapshotEmpty: { display: 'grid', gap: 6, maxWidth: 260, padding: 24, textAlign: 'center', color: '#86968d', fontSize: 12 },
  annotationSummary: { display: 'flex', gap: 8, color: '#9bac9f', fontSize: 11 },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  deleteButton: { border: '1px solid #493834', borderRadius: 8, padding: '9px 12px', color: '#e5bbb1', background: '#211917', cursor: 'pointer' },
  rollbackButton: { border: 0, borderRadius: 8, padding: '9px 14px', color: '#122218', background: '#a6dfb5', fontWeight: 700, cursor: 'pointer' },
  disabled: { opacity: .5, cursor: 'not-allowed' },
  noSelection: { margin: 'auto', color: '#899990' },
}
