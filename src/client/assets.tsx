import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, ReactElement } from 'react'
import {
  PRESENTATION_ASSETS_PATH,
  PRESENTATION_ASSET_BINDING_PATH,
  PRESENTATION_ASSET_PATH,
} from '../presentation.ts'
import type {
  PresentationAsset,
  PresentationAssetFit,
  PresentationAssetManifest,
  PresentationImageSlotSelection,
} from '../presentation.ts'

interface AssetLibraryDialogProps {
  sessionId: string
  jobId: string
  manifest: PresentationAssetManifest
  selectedSlot: PresentationImageSlotSelection | null
  onClose(): void
  onManifestChange(manifest: PresentationAssetManifest): void
}

interface ApiErrorBody {
  error?: { message?: string }
}

export function emptyPresentationAssetManifest(): PresentationAssetManifest {
  return { assets: [], bindings: [], updatedAt: new Date(0).toISOString() }
}

function queryFor(sessionId: string, jobId: string): URLSearchParams {
  return new URLSearchParams({ sessionId, jobId })
}

async function responseJson(response: Response): Promise<PresentationAssetManifest> {
  const value = await response.json() as PresentationAssetManifest & ApiErrorBody
  if (!response.ok) throw new Error(value.error?.message ?? `请求失败（HTTP ${response.status}）`)
  return value
}

export function presentationAssetUrl(sessionId: string, jobId: string, assetId: string): string {
  const query = queryFor(sessionId, jobId)
  query.set('assetId', assetId)
  return `${window.location.origin}${PRESENTATION_ASSET_PATH}?${query}`
}

export async function loadPresentationAssets(sessionId: string, jobId: string): Promise<PresentationAssetManifest> {
  const query = queryFor(sessionId, jobId)
  return responseJson(await fetch(`${PRESENTATION_ASSETS_PATH}?${query}`, { cache: 'no-store' }))
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function useCount(manifest: PresentationAssetManifest, assetId: string): number {
  return manifest.bindings.filter(binding => binding.assetId === assetId).length
}

export function AssetLibraryDialog({
  sessionId,
  jobId,
  manifest,
  selectedSlot,
  onClose,
  onManifestChange,
}: AssetLibraryDialogProps): ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadControllerRef = useRef<AbortController | null>(null)
  const slotBinding = selectedSlot === null
    ? undefined
    : manifest.bindings.find(binding => binding.slotId === selectedSlot.slotId)
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(slotBinding?.assetId ?? null)
  const [fit, setFit] = useState<PresentationAssetFit>(slotBinding?.fit ?? 'cover')
  const [focalX, setFocalX] = useState(slotBinding?.focalPoint.x ?? 0.5)
  const [focalY, setFocalY] = useState(slotBinding?.focalPoint.y ?? 0.5)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selectedAsset = manifest.assets.find(asset => asset.id === selectedAssetId)

  useEffect(() => {
    setSelectedAssetId(slotBinding?.assetId ?? null)
    setFit(slotBinding?.fit ?? 'cover')
    setFocalX(slotBinding?.focalPoint.x ?? 0.5)
    setFocalY(slotBinding?.focalPoint.y ?? 0.5)
  }, [selectedSlot?.slotId, slotBinding?.assetId, slotBinding?.fit, slotBinding?.focalPoint.x, slotBinding?.focalPoint.y])

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    const controller = new AbortController()
    uploadControllerRef.current = controller
    setUploading(true)
    setError('')
    try {
      let nextManifest = manifest
      for (const file of files) {
        const query = queryFor(sessionId, jobId)
        query.set('filename', file.name)
        nextManifest = await responseJson(await fetch(`${PRESENTATION_ASSETS_PATH}?${query}`, {
          method: 'POST',
          body: file,
          signal: controller.signal,
        }))
        onManifestChange(nextManifest)
      }
      if (selectedSlot !== null && selectedAssetId === null) {
        const newest = nextManifest.assets.at(-1)
        if (newest !== undefined) setSelectedAssetId(newest.id)
      }
    } catch (uploadError) {
      setError(controller.signal.aborted ? '已取消图片上传。' : uploadError instanceof Error ? uploadError.message : String(uploadError))
    } finally {
      uploadControllerRef.current = null
      setUploading(false)
    }
  }

  async function refresh(): Promise<void> {
    setError('')
    try {
      onManifestChange(await loadPresentationAssets(sessionId, jobId))
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
    }
  }

  async function saveBinding(assetId: string | null): Promise<void> {
    if (selectedSlot === null) return
    setSaving(true)
    setError('')
    try {
      const query = queryFor(sessionId, jobId)
      const next = await responseJson(await fetch(`${PRESENTATION_ASSET_BINDING_PATH}?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: selectedSlot.slotId,
          assetId,
          fit,
          focalPoint: { x: focalX, y: focalY },
        }),
      }))
      onManifestChange(next)
      if (assetId === null) setSelectedAssetId(null)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function deleteAsset(asset: PresentationAsset): Promise<void> {
    if (!window.confirm(`确定删除图片“${asset.name}”吗？此操作不会删除正在使用的图片。`)) return
    setError('')
    try {
      const query = queryFor(sessionId, jobId)
      query.set('assetId', asset.id)
      const next = await responseJson(await fetch(`${PRESENTATION_ASSET_PATH}?${query}`, { method: 'DELETE' }))
      onManifestChange(next)
      if (selectedAssetId === asset.id) setSelectedAssetId(null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="演示文稿素材库" style={assetStyles.overlay}>
      <div style={assetStyles.dialog}>
        <header style={assetStyles.header}>
          <div>
            <strong style={assetStyles.title}>图片素材库</strong>
            <span style={assetStyles.subtitle}>上传一次，可在多张幻灯片中复用；替换图片不会调用 Agent。</span>
          </div>
          <div style={assetStyles.headerActions}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={event => { void uploadFiles(event) }}
            />
            {uploading ? (
              <button type="button" onClick={() => uploadControllerRef.current?.abort()} style={assetStyles.dangerButton}>取消上传</button>
            ) : (
              <button type="button" onClick={() => fileInputRef.current?.click()} style={assetStyles.primaryButton}>上传图片</button>
            )}
            <button type="button" onClick={() => { void refresh() }} style={assetStyles.secondaryButton}>刷新</button>
            <button type="button" aria-label="关闭素材库" onClick={onClose} style={assetStyles.closeButton}>×</button>
          </div>
        </header>

        {selectedSlot !== null ? (
          <div style={assetStyles.slotBanner}>
            <div>
              <strong>正在设置：{selectedSlot.label || selectedSlot.slotId}</strong>
              <span>{selectedSlot.slideId === undefined ? '' : `幻灯片 ${selectedSlot.slideId} · `}点击下方图片，再调整填充方式和焦点。</span>
            </div>
            {slotBinding !== undefined ? <span style={assetStyles.usedPill}>已有图片</span> : <span style={assetStyles.emptyPill}>空槽位</span>}
          </div>
        ) : (
          <div style={assetStyles.libraryBanner}>当前是素材管理模式。在预览中点击带有“图片槽位”的区域，可以直接选择并替换图片。</div>
        )}

        {error.length > 0 ? <div role="alert" style={assetStyles.error}>{error}</div> : null}

        <div style={assetStyles.body}>
          <section style={assetStyles.gridSection}>
            {manifest.assets.length === 0 ? (
              <button type="button" onClick={() => fileInputRef.current?.click()} style={assetStyles.emptyState}>
                <strong>还没有图片素材</strong>
                <span>上传 PNG、JPEG、WebP 或 GIF；单张默认不超过 20 MB。</span>
              </button>
            ) : (
              <div style={assetStyles.grid}>
                {manifest.assets.map((asset) => {
                  const count = useCount(manifest, asset.id)
                  const active = selectedAssetId === asset.id
                  return (
                    <article key={asset.id} style={{ ...assetStyles.card, ...(active ? assetStyles.cardActive : {}) }}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSelectedAssetId(asset.id)}
                        style={assetStyles.thumbnailButton}
                      >
                        <img src={presentationAssetUrl(sessionId, jobId, asset.id)} alt={asset.name} style={assetStyles.thumbnail} />
                      </button>
                      <div style={assetStyles.cardInfo}>
                        <strong title={asset.name} style={assetStyles.assetName}>{asset.name}</strong>
                        <span>{asset.width} × {asset.height} · {fileSize(asset.bytes)}</span>
                        <div style={assetStyles.cardFooter}>
                          <span>{count > 0 ? `${count} 个槽位使用` : '未使用'}</span>
                          <button
                            type="button"
                            disabled={count > 0}
                            title={count > 0 ? '请先从所有图片槽位中移除' : '删除素材'}
                            onClick={() => { void deleteAsset(asset) }}
                            style={{ ...assetStyles.deleteButton, ...(count > 0 ? assetStyles.disabledButton : {}) }}
                          >删除</button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          {selectedSlot !== null ? (
            <aside style={assetStyles.inspector}>
              <strong style={assetStyles.inspectorTitle}>槽位显示设置</strong>
              <span style={assetStyles.inspectorHelp}>这些调整立即写入素材清单，刷新或重启后仍会恢复。</span>
              <div style={assetStyles.cropPreview}>
                {selectedAsset === undefined ? (
                  <span>先从左侧选择一张图片</span>
                ) : (
                  <img
                    src={presentationAssetUrl(sessionId, jobId, selectedAsset.id)}
                    alt="当前裁剪预览"
                    style={{ ...assetStyles.cropPreviewImage, objectFit: fit, objectPosition: `${focalX * 100}% ${focalY * 100}%` }}
                  />
                )}
              </div>
              <div style={assetStyles.segmented}>
                <button type="button" onClick={() => setFit('cover')} style={{ ...assetStyles.segmentButton, ...(fit === 'cover' ? assetStyles.segmentActive : {}) }}>铺满裁剪</button>
                <button type="button" onClick={() => setFit('contain')} style={{ ...assetStyles.segmentButton, ...(fit === 'contain' ? assetStyles.segmentActive : {}) }}>完整显示</button>
              </div>
              <label style={assetStyles.rangeLabel}>
                <span>水平焦点 <output>{Math.round(focalX * 100)}%</output></span>
                <input type="range" min="0" max="1" step="0.01" value={focalX} onChange={event => setFocalX(Number(event.target.value))} />
              </label>
              <label style={assetStyles.rangeLabel}>
                <span>垂直焦点 <output>{Math.round(focalY * 100)}%</output></span>
                <input type="range" min="0" max="1" step="0.01" value={focalY} onChange={event => setFocalY(Number(event.target.value))} />
              </label>
              <div style={assetStyles.inspectorActions}>
                {slotBinding !== undefined ? (
                  <button type="button" disabled={saving} onClick={() => { void saveBinding(null) }} style={assetStyles.dangerButton}>移除当前图片</button>
                ) : null}
                <button
                  type="button"
                  disabled={saving || selectedAssetId === null}
                  onClick={() => { void saveBinding(selectedAssetId) }}
                  style={{ ...assetStyles.primaryButton, ...(selectedAssetId === null ? assetStyles.disabledButton : {}) }}
                >{saving ? '保存中…' : slotBinding === undefined ? '应用到槽位' : '替换并应用'}</button>
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const assetStyles: Record<string, CSSProperties> = {
  overlay: { position: 'absolute', inset: 0, zIndex: 50, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(5, 9, 7, .72)', backdropFilter: 'blur(8px)' },
  dialog: { width: 'min(1120px, 96vw)', maxHeight: 'min(780px, 92vh)', display: 'flex', flexDirection: 'column', overflow: 'hidden', color: '#17231b', background: '#f6f8f7', border: '1px solid #cbd8cf', borderRadius: 18, boxShadow: '0 28px 90px rgba(0,0,0,.38)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, padding: '18px 20px', borderBottom: '1px solid #dce5df', background: '#ffffff' },
  title: { display: 'block', fontSize: 19 },
  subtitle: { display: 'block', marginTop: 4, color: '#627168', fontSize: 12 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8 },
  primaryButton: { minHeight: 36, padding: '0 14px', border: '1px solid #6aa77a', borderRadius: 8, color: '#102016', background: '#a9e2b7', cursor: 'pointer', fontWeight: 800 },
  secondaryButton: { minHeight: 36, padding: '0 13px', border: '1px solid #b8c9be', borderRadius: 8, color: '#304239', background: '#fff', cursor: 'pointer' },
  dangerButton: { minHeight: 34, padding: '0 12px', border: '1px solid #d7aaa6', borderRadius: 8, color: '#8e3e38', background: '#fff3f2', cursor: 'pointer', fontWeight: 700 },
  closeButton: { width: 36, height: 36, border: '1px solid #cbd8cf', borderRadius: 8, color: '#3c4d43', background: '#fff', cursor: 'pointer', fontSize: 22 },
  slotBanner: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px', color: '#24452f', background: '#e5f4e9', borderBottom: '1px solid #c6dfcd' },
  libraryBanner: { padding: '11px 20px', color: '#52635a', background: '#eef2ef', borderBottom: '1px solid #dce5df', fontSize: 12 },
  usedPill: { padding: '4px 8px', borderRadius: 99, color: '#235631', background: '#c9e9d1', fontSize: 11, fontWeight: 800 },
  emptyPill: { padding: '4px 8px', borderRadius: 99, color: '#735c25', background: '#f3e8bf', fontSize: 11, fontWeight: 800 },
  error: { margin: '12px 20px 0', padding: '10px 12px', border: '1px solid #dfaaa6', borderRadius: 8, color: '#8e3e38', background: '#fff2f1', fontSize: 12 },
  body: { minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 300px)', overflow: 'hidden' },
  gridSection: { minHeight: 360, overflowY: 'auto', padding: 20 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 },
  card: { overflow: 'hidden', border: '2px solid transparent', borderRadius: 12, background: '#fff', boxShadow: '0 4px 16px rgba(38, 70, 48, .08)' },
  cardActive: { borderColor: '#6aa77a', boxShadow: '0 0 0 3px rgba(106,167,122,.14)' },
  thumbnailButton: { width: '100%', height: 128, display: 'block', padding: 0, border: 0, background: '#e7ece9', cursor: 'pointer' },
  thumbnail: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  cardInfo: { display: 'grid', gap: 5, padding: 10, color: '#6a786f', fontSize: 11 },
  assetName: { overflow: 'hidden', color: '#25362c', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 },
  cardFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  deleteButton: { padding: 0, border: 0, color: '#9a4943', background: 'transparent', cursor: 'pointer', fontSize: 11 },
  disabledButton: { opacity: .45, cursor: 'not-allowed' },
  emptyState: { minHeight: 300, width: '100%', display: 'grid', placeContent: 'center', gap: 8, border: '2px dashed #b8c9be', borderRadius: 14, color: '#5b6d62', background: '#fff', cursor: 'pointer', textAlign: 'center' },
  inspector: { minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16, padding: 20, borderLeft: '1px solid #dce5df', background: '#fff' },
  inspectorTitle: { fontSize: 15 },
  inspectorHelp: { color: '#6a786f', fontSize: 12, lineHeight: 1.6 },
  cropPreview: { aspectRatio: '16 / 9', display: 'grid', placeItems: 'center', overflow: 'hidden', border: '1px solid #cbd8cf', borderRadius: 9, color: '#78877e', background: '#edf2ee', fontSize: 11 },
  cropPreviewImage: { width: '100%', height: '100%', display: 'block' },
  segmented: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: 4, borderRadius: 9, background: '#edf2ee' },
  segmentButton: { height: 34, border: 0, borderRadius: 7, color: '#617168', background: 'transparent', cursor: 'pointer' },
  segmentActive: { color: '#173d24', background: '#fff', boxShadow: '0 2px 8px rgba(40,70,49,.12)', fontWeight: 800 },
  rangeLabel: { display: 'grid', gap: 7, color: '#3e5046', fontSize: 12 },
  inspectorActions: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto' },
}
