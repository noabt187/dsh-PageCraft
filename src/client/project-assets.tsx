import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { PresentationImageSlotSelection } from '../presentation.ts'
import {
  PRESENTATION_WORKSPACE_ASSET_PATH,
  PRESENTATION_WORKSPACE_BIND_ASSET_PATH,
  PRESENTATION_WORKSPACE_FILE_PATH,
  PRESENTATION_WORKSPACE_PATH,
} from '../presentation-workspace.ts'
import type {
  PresentationProjectAsset,
  PresentationProjectAssetList,
  PresentationWorkspaceFile,
  PresentationWorkspaceSummary,
} from '../presentation-workspace.ts'

interface ProjectAssetLibraryDialogProps {
  sessionId: string
  selectedSlot: PresentationImageSlotSelection | null
  onClose(): void
  onRefresh(): void
}

interface ApiErrorBody {
  error?: { message?: string }
}

async function readJson<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => null) as T & ApiErrorBody | null
  if (!response.ok) throw new Error(value?.error?.message ?? `请求失败（HTTP ${response.status}）`)
  return value as T
}

function query(sessionId: string, values: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({ sessionId, ...values })
}

function assetPreviewUrl(sessionId: string, path: string): string {
  return `${PRESENTATION_WORKSPACE_ASSET_PATH}?${query(sessionId, { path })}`
}

function describeBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ProjectAssetLibraryDialog({
  sessionId,
  selectedSlot,
  onClose,
  onRefresh,
}: ProjectAssetLibraryDialogProps): ReactElement {
  const [summary, setSummary] = useState<PresentationWorkspaceSummary | null>(null)
  const [assets, setAssets] = useState<PresentationProjectAsset[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fit, setFit] = useState<'cover' | 'contain'>('cover')
  const [focalPoint, setFocalPoint] = useState({ x: 0.5, y: 0.5 })
  const [status, setStatus] = useState('正在读取项目图片…')
  const [busy, setBusy] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const selectedAsset = assets.find(asset => asset.path === selectedPath) ?? null

  async function load(): Promise<void> {
    setBusy(true)
    try {
      const nextSummary = await readJson<PresentationWorkspaceSummary>(await fetch(
        `${PRESENTATION_WORKSPACE_PATH}?${query(sessionId)}`,
        { cache: 'no-store' },
      ))
      setSummary(nextSummary)
      if (!nextSummary.available) {
        setStatus(nextSummary.reason ?? '当前 PPT 尚未启用可持久化的项目图片。')
        return
      }
      const list = await readJson<PresentationProjectAssetList>(await fetch(
        `${PRESENTATION_WORKSPACE_ASSET_PATH}?${query(sessionId)}`,
        { cache: 'no-store' },
      ))
      setAssets(list.assets)
      setSelectedPath(current => current !== null && list.assets.some(asset => asset.path === current)
        ? current
        : list.assets[0]?.path ?? null)
      setStatus(list.assets.length === 0 ? '项目图片目录还是空的，可先上传图片。' : `已读取 ${list.assets.length} 张项目图片。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void load() }, [sessionId])

  async function upload(files: FileList | null): Promise<void> {
    if (files === null || files.length === 0) return
    setBusy(true)
    try {
      let list: PresentationProjectAssetList = { assets }
      for (const file of Array.from(files)) {
        list = await readJson<PresentationProjectAssetList>(await fetch(
          `${PRESENTATION_WORKSPACE_ASSET_PATH}?${query(sessionId, { filename: file.name })}`,
          { method: 'POST', body: file },
        ))
      }
      setAssets(list.assets)
      setSelectedPath(list.assets.at(-1)?.path ?? null)
      setStatus(`已把 ${files.length} 张图片写入项目源码目录。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      if (uploadRef.current !== null) uploadRef.current.value = ''
      setBusy(false)
    }
  }

  async function bindSelected(): Promise<void> {
    if (selectedAsset === null || selectedSlot?.imageKey === undefined || summary?.manifest === undefined) return
    setBusy(true)
    try {
      const deck = await readJson<PresentationWorkspaceFile>(await fetch(
        `${PRESENTATION_WORKSPACE_FILE_PATH}?${query(sessionId, { path: summary.manifest.deck })}`,
        { cache: 'no-store' },
      ))
      const result = await readJson<{ file: PresentationWorkspaceFile; assets: PresentationProjectAsset[] }>(await fetch(
        `${PRESENTATION_WORKSPACE_BIND_ASSET_PATH}?${query(sessionId)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            imageKey: selectedSlot.imageKey,
            assetPath: selectedAsset.path,
            alt: selectedSlot.label ?? selectedAsset.name,
            fit,
            focalPoint,
            baseHash: deck.hash,
          }),
        },
      ))
      setAssets(result.assets)
      setStatus('图片引用已写入 deck.json，正在刷新项目预览。')
      window.setTimeout(onRefresh, 450)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function removeSelected(): Promise<void> {
    if (selectedAsset === null || !window.confirm(`从项目中删除 ${selectedAsset.name} 吗？`)) return
    setBusy(true)
    try {
      const list = await readJson<PresentationProjectAssetList>(await fetch(
        `${PRESENTATION_WORKSPACE_ASSET_PATH}?${query(sessionId)}`,
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: selectedAsset.path }),
        },
      ))
      setAssets(list.assets)
      setSelectedPath(list.assets[0]?.path ?? null)
      setStatus('图片已从项目源码目录删除。')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const canBind = selectedAsset !== null && selectedSlot?.imageKey !== undefined && summary?.available === true

  return (
    <div role="dialog" aria-modal="true" aria-label="项目图片管理" style={projectAssetStyles.overlay}>
      <div style={projectAssetStyles.dialog}>
        <header style={projectAssetStyles.header}>
          <div><strong style={projectAssetStyles.title}>项目图片</strong><span style={projectAssetStyles.subtitle}>图片会保存到 PPT 项目目录，浏览器直接打开也能显示</span></div>
          <button type="button" onClick={onClose} style={projectAssetStyles.closeButton}>×</button>
        </header>

        {selectedSlot !== null ? (
          <div style={projectAssetStyles.slotNotice}>
            当前槽位：<strong>{selectedSlot.label ?? selectedSlot.slotId}</strong>
            {selectedSlot.imageKey === undefined ? <span> · 旧槽位缺少源码键，只能使用旧版临时绑定</span> : null}
          </div>
        ) : null}

        <div style={projectAssetStyles.body}>
          <aside style={projectAssetStyles.assetGrid}>
            {assets.map(asset => (
              <button
                key={asset.path}
                type="button"
                onClick={() => setSelectedPath(asset.path)}
                style={{ ...projectAssetStyles.assetCard, ...(selectedPath === asset.path ? projectAssetStyles.assetCardActive : {}) }}
              >
                <img src={assetPreviewUrl(sessionId, asset.path)} alt={asset.name} style={projectAssetStyles.thumbnail} />
                <strong style={projectAssetStyles.assetName}>{asset.name}</strong>
                <span style={projectAssetStyles.assetMeta}>{asset.width}×{asset.height} · {describeBytes(asset.bytes)}</span>
                {asset.references.length > 0 ? <span style={projectAssetStyles.reference}>用于 {asset.references.join('、')}</span> : null}
              </button>
            ))}
            {assets.length === 0 ? <div style={projectAssetStyles.empty}>还没有项目图片</div> : null}
          </aside>

          <section style={projectAssetStyles.inspector}>
            {selectedAsset === null ? <div style={projectAssetStyles.empty}>上传或选择一张图片</div> : (
              <>
                <div style={projectAssetStyles.previewBox}>
                  <img
                    src={assetPreviewUrl(sessionId, selectedAsset.path)}
                    alt={selectedAsset.name}
                    style={{ ...projectAssetStyles.previewImage, objectFit: fit, objectPosition: `${focalPoint.x * 100}% ${focalPoint.y * 100}%` }}
                  />
                </div>
                <label style={projectAssetStyles.field}>适配方式
                  <select value={fit} onChange={event => setFit(event.target.value === 'contain' ? 'contain' : 'cover')} style={projectAssetStyles.select}>
                    <option value="cover">铺满槽位</option><option value="contain">完整显示</option>
                  </select>
                </label>
                <label style={projectAssetStyles.field}>水平焦点
                  <input type="range" min="0" max="1" step="0.01" value={focalPoint.x} onChange={event => setFocalPoint(point => ({ ...point, x: Number(event.target.value) }))} />
                </label>
                <label style={projectAssetStyles.field}>垂直焦点
                  <input type="range" min="0" max="1" step="0.01" value={focalPoint.y} onChange={event => setFocalPoint(point => ({ ...point, y: Number(event.target.value) }))} />
                </label>
                <button type="button" disabled={selectedAsset.references.length > 0 || busy} onClick={() => { void removeSelected() }} style={projectAssetStyles.deleteButton}>删除未使用图片</button>
              </>
            )}
          </section>
        </div>

        <footer style={projectAssetStyles.footer}>
          <span style={projectAssetStyles.status}>{status}</span>
          <input ref={uploadRef} hidden multiple type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { void upload(event.target.files) }} />
          <button type="button" disabled={busy || summary?.available !== true} onClick={() => uploadRef.current?.click()} style={projectAssetStyles.secondaryButton}>上传到项目</button>
          <button type="button" disabled={!canBind || busy} onClick={() => { void bindSelected() }} style={projectAssetStyles.primaryButton}>{busy ? '处理中…' : selectedSlot === null ? '选择一个图片槽位' : '替换此槽位'}</button>
        </footer>
      </div>
    </div>
  )
}

const projectAssetStyles: Record<string, CSSProperties> = {
  overlay: { position: 'absolute', inset: 0, zIndex: 50, display: 'grid', placeItems: 'center', padding: 22, background: 'rgba(3,8,6,.78)', backdropFilter: 'blur(5px)' },
  dialog: { width: 'min(980px, 94vw)', height: 'min(720px, 88vh)', display: 'grid', gridTemplateRows: 'auto auto minmax(0,1fr) auto', overflow: 'hidden', border: '1px solid #355044', borderRadius: 14, color: '#edf5ef', background: '#111916', boxShadow: '0 24px 80px rgba(0,0,0,.55)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px', borderBottom: '1px solid #2b3d34' },
  title: { display: 'block', fontSize: 16 },
  subtitle: { display: 'block', marginTop: 3, color: '#96a99c', fontSize: 11 },
  closeButton: { width: 32, height: 32, border: 0, borderRadius: 8, color: '#d6e6da', background: '#26362f', cursor: 'pointer', fontSize: 20 },
  slotNotice: { padding: '9px 18px', borderBottom: '1px solid #2b3d34', color: '#b8cabd', background: '#17221d', fontSize: 12 },
  body: { minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 310px' },
  assetGrid: { minHeight: 0, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', alignContent: 'start', gap: 10, padding: 14 },
  assetCard: { minWidth: 0, display: 'grid', gap: 5, padding: 8, textAlign: 'left', border: '1px solid #2b3d34', borderRadius: 9, color: '#dfeae2', background: '#121b17', cursor: 'pointer' },
  assetCardActive: { borderColor: '#8fd1a1', boxShadow: '0 0 0 1px #8fd1a1 inset', background: '#17271f' },
  thumbnail: { width: '100%', aspectRatio: '16/10', objectFit: 'cover', borderRadius: 6, background: '#080d0b' },
  assetName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 },
  assetMeta: { color: '#8ea095', fontSize: 10 },
  reference: { color: '#9ed7ad', fontSize: 10 },
  inspector: { minHeight: 0, overflowY: 'auto', display: 'grid', alignContent: 'start', gap: 13, padding: 15, borderLeft: '1px solid #2b3d34', background: '#0d1411' },
  previewBox: { aspectRatio: '16/10', overflow: 'hidden', border: '1px solid #31473c', borderRadius: 9, background: '#060a08' },
  previewImage: { width: '100%', height: '100%', display: 'block' },
  field: { display: 'grid', gap: 6, color: '#a9bbb0', fontSize: 11 },
  select: { height: 34, padding: '0 8px', border: '1px solid #344a3e', borderRadius: 7, color: '#e8f1eb', background: '#101915' },
  empty: { gridColumn: '1/-1', display: 'grid', placeItems: 'center', minHeight: 150, color: '#829489', fontSize: 12 },
  deleteButton: { height: 34, border: '1px solid #69413f', borderRadius: 7, color: '#efb8b3', background: '#291817', cursor: 'pointer' },
  footer: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', alignItems: 'center', gap: 10, padding: '12px 15px', borderTop: '1px solid #2b3d34' },
  status: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#9dafA3', fontSize: 11 },
  secondaryButton: { height: 36, padding: '0 13px', border: '1px solid #395244', borderRadius: 8, color: '#dce8df', background: '#17221d', cursor: 'pointer' },
  primaryButton: { height: 36, padding: '0 16px', border: 0, borderRadius: 8, color: '#102016', background: '#a9e2b7', cursor: 'pointer', fontWeight: 800 },
}
