import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  BarChart3, Check, Circle, CloudUpload, Download,
  ImageOff, ChevronLeft, Search, Database, FileArchive, X,
  Loader2
} from 'lucide-react'
import api, { type ImageItem, type Project } from '../api'

const COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#6366f1','#a855f7','#ec4899']

type Filter = 'all' | 'annotated' | 'unannotated'

interface Analytics {
  total_images: number
  annotated_images: number
  class_distribution: Record<string, number>
}

export default function ImageGallery() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const projectId = id ?? ''

  const [project, setProject] = useState<Project | null>(null)
  const [images, setImages] = useState<ImageItem[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadText, setUploadText] = useState('')
  const [uploadPct, setUploadPct] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [exportOpen, setExportOpen] = useState(false)
  const [exportName, setExportName] = useState('')
  const [exportVer, setExportVer] = useState('1.0.0')
  const [exporting, setExporting] = useState(false)

  const [summaryOpen, setSummaryOpen] = useState(false)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)

  useEffect(() => {
    if (!projectId) return
    api.get(`/projects/${projectId}`).then(r => {
      setProject(r.data)
      setExportName(r.data.name || 'Dataset')
    }).catch(() => {})
    loadImages()
  }, [projectId])

  const loadImages = useCallback(async () => {
    try {
      const r = await api.get(`/projects/${projectId}/images`)
      setImages(r.data)
    } catch { }
  }, [projectId])

  const filtered = images.filter(img => {
    if (filter === 'annotated' && !img.annotated) return false
    if (filter === 'unannotated' && img.annotated) return false
    if (search && !img.filename.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const arr = Array.from(files).filter(f => /\.(jpe?g|png|bmp|webp)$/i.test(f.name))
    if (arr.length === 0) { alert('Please select valid image files (JPEG, PNG, BMP, WEBP)'); return }
    setUploading(true)
    setUploadPct(0)
    const total = arr.length
    let done = 0
    for (let i = 0; i < arr.length; i++) {
      const fd = new FormData()
      fd.append('files', arr[i])
      setUploadText(`Uploading ${i + 1}/${total}: ${arr[i].name}`)
      setUploadPct(Math.round((i / total) * 100))
      try { await api.post(`/projects/${projectId}/images`, fd) } catch { }
      done++
    }
    setUploadPct(100)
    setUploadText(`Done — uploaded ${done} image${done !== 1 ? 's' : ''} successfully`)
    setTimeout(async () => {
      setUploading(false)
      setUploadText('')
      setUploadPct(0)
      await loadImages()
    }, 1200)
  }

  const openSummary = async () => {
    setSummaryOpen(true)
    setAnalyticsLoading(true)
    try {
      const r = await api.get(`/projects/${projectId}/analytics`)
      setAnalytics(r.data)
    } catch { setAnalytics(null) }
    finally { setAnalyticsLoading(false) }
  }

  const doSaveDataset = async () => {
    if (!exportName.trim() || !exportVer.trim()) { alert('Please enter a name and version'); return }
    setExporting(true)
    try {
      await api.post(`/projects/${projectId}/save-dataset?dataset_name=${encodeURIComponent(exportName)}&version=${encodeURIComponent(exportVer)}`)
      alert('Dataset version saved successfully!')
      setExportOpen(false)
    } catch (e: any) {
      alert('Failed: ' + (e?.response?.data?.detail ?? 'Unknown error'))
    } finally { setExporting(false) }
  }

  const downloadZip = () => {
    window.open(`/api/projects/${projectId}/export-zip`, '_blank')
    setExportOpen(false)
  }

  const filterBtn = (active: boolean) => ({
    padding: '4px 10px', fontSize: 11, border: 'none', cursor: 'pointer',
    borderRadius: 3, fontWeight: active ? 600 : 500, transition: 'all 0.15s',
    background: active ? 'var(--primary)' : 'transparent',
    color: active ? '#fff' : 'var(--text3)',
  } as React.CSSProperties)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)',
      width: '100%', overflow: 'hidden', background: 'var(--bg)' }}>

      <header style={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0,
        height: 42, background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '0 8px' }}>
        <button onClick={() => navigate(`/projects/${projectId}/workflow`)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
            height: 30, border: '1px solid var(--border)', borderRadius: 3,
            background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer',
            fontSize: 11, fontWeight: 500, marginRight: 4 }}>
          <ChevronLeft size={14} /> Back
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 10px' }} />
        <h1 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', margin: 0,
          maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project?.name ?? 'Loading...'} — Gallery
        </h1>
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 10px' }} />
        <div style={{ display: 'flex', background: 'var(--surface-3)', borderRadius: 3,
          padding: 2, border: '1px solid var(--border)' }}>
          {(['all', 'annotated', 'unannotated'] as Filter[]).map(f => (
            <button key={f} style={filterBtn(filter === f)} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 10px' }} />
        <div style={{ position: 'relative', width: 220 }}>
          <input type="text" placeholder="Search images..." value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', height: 28, padding: '0 8px 0 28px',
              border: '1px solid var(--border)', borderRadius: 3, fontSize: 11,
              background: 'var(--surface-2)', color: 'var(--text)', outline: 'none',
              boxSizing: 'border-box' as const }} />
          <Search size={11} style={{ position: 'absolute', left: 8, top: 9,
            color: 'var(--text3)', pointerEvents: 'none' as const }} />
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={openSummary}
            style={{ display: 'flex', alignItems: 'center', gap: 5, height: 30,
              padding: '0 10px', border: '1px solid var(--border)', borderRadius: 3,
              background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer', fontSize: 11 }}>
            <BarChart3 size={13} /> Summary
          </button>
          <button onClick={() => fileInputRef.current?.click()}
            style={{ display: 'flex', alignItems: 'center', gap: 5, height: 30,
              padding: '0 10px', border: '1px solid var(--border)', borderRadius: 3,
              background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer', fontSize: 11 }}>
            <CloudUpload size={13} /> Upload
          </button>
          <button onClick={() => { setExportOpen(true); setExportName(project?.name ?? 'Dataset') }}
            style={{ display: 'flex', alignItems: 'center', gap: 5, height: 30,
              padding: '0 10px', border: '1px solid var(--border)', borderRadius: 3,
              background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer', fontSize: 11 }}>
            <Download size={13} /> Export
          </button>
        </div>
      </header>

      <input ref={fileInputRef} type="file" multiple accept="image/*" style={{ display: 'none' }}
        onChange={e => uploadFiles(e.target.files)} />

      <main style={{ flex: 1, overflowY: 'auto', padding: 24, boxSizing: 'border-box' as const,
        position: 'relative' as const }}
        onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={e => { e.preventDefault(); setIsDragOver(false); uploadFiles(e.dataTransfer.files) }}>

        {isDragOver && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 50,
            background: 'rgba(205,103,44,0.12)', border: '2px dashed var(--primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 600, color: 'var(--primary)', pointerEvents: 'none' as const,
            borderRadius: 6, boxSizing: 'border-box' as const }}>
            Drop images here to upload
          </div>
        )}

        {uploading && (
          <div style={{ marginBottom: 16, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} />
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>{uploadText}</span>
            </div>
            <div style={{ background: 'var(--surface-3)', borderRadius: 99, height: 5, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: 'var(--primary)',
                width: `${uploadPct}%`, transition: 'width 0.15s' }} />
            </div>
          </div>
        )}

        {images.length === 0 && !uploading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', minHeight: 320, gap: 16, color: 'var(--text3)',
            border: '2px dashed var(--border)', borderRadius: 8, cursor: 'pointer',
            padding: 40, transition: 'all 0.15s', boxSizing: 'border-box' as const }}
            onClick={() => fileInputRef.current?.click()}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
            <CloudUpload size={48} style={{ color: 'var(--primary)' }} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
              No images in project
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text3)' }}>
              Drag and drop images here or click to browse
            </p>
            <span style={{ fontSize: 11, opacity: 0.5 }}>Supports JPEG, PNG, BMP, WEBP</span>
          </div>
        )}

        {images.length > 0 && filtered.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '60px 0', color: 'var(--text3)', gap: 12 }}>
            <ImageOff size={48} style={{ opacity: 0.5 }} />
            <p style={{ margin: 0, fontSize: 13 }}>No images match the selected filters</p>
          </div>
        )}

        {filtered.length > 0 && (
          <div style={{ display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
            {filtered.map(img => (
              <GalleryCard key={img.id} img={img} projectId={projectId}
                onClick={() => navigate(`/projects/${projectId}/annotate/${img.id}`)} />
            ))}
          </div>
        )}
      </main>

      {exportOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2100,
          background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 28, width: 420, maxWidth: '90vw',
            boxSizing: 'border-box' as const, color: 'var(--text)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Export Annotated Dataset</h3>
              <button onClick={() => setExportOpen(false)} style={{ background: 'transparent', border: 'none',
                color: 'var(--text3)', cursor: 'pointer', display: 'flex' }}><X size={16} /></button>
            </div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)',
              marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Dataset Name</label>
            <input type="text" value={exportName} onChange={e => setExportName(e.target.value)}
              style={{ width: '100%', height: 34, padding: '0 10px', background: 'var(--surface-2)',
                border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)',
                outline: 'none', fontSize: 13, boxSizing: 'border-box' as const, marginBottom: 14 }} />
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)',
              marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Version</label>
            <input type="text" value={exportVer} onChange={e => setExportVer(e.target.value)}
              style={{ width: '100%', height: 34, padding: '0 10px', background: 'var(--surface-2)',
                border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)',
                outline: 'none', fontSize: 13, boxSizing: 'border-box' as const, marginBottom: 4 }} />
            <span style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 20 }}>
              Increment (e.g. 1.0.1, 2.0.0) when exporting new splits.
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={doSaveDataset} disabled={exporting}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  height: 36, width: '100%', background: 'var(--primary)', color: '#fff',
                  border: 'none', borderRadius: 4, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                <Database size={14} /> {exporting ? 'Saving...' : 'Save to Datasets Table'}
              </button>
              <button onClick={downloadZip}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  height: 36, width: '100%', background: 'var(--surface-3)', color: 'var(--text)',
                  border: '1px solid var(--border)', borderRadius: 4, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                <FileArchive size={14} /> Download ZIP Archive
              </button>
            </div>
          </div>
        </div>
      )}

      {summaryOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2150,
          background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 24, width: 680, maxWidth: '92vw', maxHeight: '85vh',
            overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxSizing: 'border-box' as const, color: 'var(--text)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 8 }}>
                <BarChart3 size={16} style={{ color: 'var(--primary)' }} /> Project Data Summary
              </h3>
              <button onClick={() => setSummaryOpen(false)} style={{ background: 'transparent',
                border: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {analyticsLoading && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: 200, gap: 10, color: 'var(--text2)', flexDirection: 'column' }}>
                  <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} />
                  <span style={{ fontSize: 12 }}>Loading statistics...</span>
                </div>
              )}
              {!analyticsLoading && !analytics && (
                <div style={{ padding: '40px 0', textAlign: 'center' as const,
                  color: 'var(--text3)', fontSize: 12 }}>No statistics available.</div>
              )}
              {analytics && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px,1fr))', gap: 20 }}>
                  <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)',
                    padding: 16, borderRadius: 6, display: 'flex', flexDirection: 'column' }}>
                    <h4 style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', margin: '0 0 16px',
                      textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Labelling Status</h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20, justifyContent: 'space-around' }}>
                      <DonutChart pct={analytics.total_images > 0
                        ? Math.round((analytics.annotated_images / analytics.total_images) * 100) : 0} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 140 }}>
                        {[{ label: 'Labelled', val: analytics.annotated_images, color: '#22c55e' },
                          { label: 'Unlabelled', val: analytics.total_images - analytics.annotated_images, color: '#64748b' }
                        ].map(row => (
                          <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 2, background: row.color, display: 'inline-block' }} />
                            <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 500 }}>{row.label}:</span>
                            <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600, marginLeft: 'auto', fontFamily: 'monospace' }}>{row.val}</span>
                          </div>
                        ))}
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 10, height: 10, display: 'inline-block' }} />
                          <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500 }}>Total:</span>
                          <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600, marginLeft: 'auto', fontFamily: 'monospace' }}>{analytics.total_images}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)',
                    padding: 16, borderRadius: 6, display: 'flex', flexDirection: 'column' }}>
                    <h4 style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', margin: '0 0 12px',
                      textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Object Distribution</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: 140 }}>
                      {(() => {
                        const data = (project?.classes ?? []).map((cls, i) => ({
                          name: cls, count: analytics.class_distribution[cls] || 0,
                          color: COLORS[i % COLORS.length]
                        }))
                        const maxVal = Math.max(...data.map(d => d.count), 1)
                        return data.length === 0
                          ? <p style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center' as const }}>No classes defined.</p>
                          : data.map(item => (
                            <div key={item.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                                <span style={{ color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, display: 'inline-block' }} />
                                  {item.name}
                                </span>
                                <span style={{ fontWeight: 600, fontFamily: 'monospace', color: 'var(--text)' }}>{item.count}</span>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.06)', height: 6, borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ background: item.color, width: `${Math.round(item.count/maxVal*100)}%`,
                                  height: '100%', borderRadius: 3, transition: 'width 0.3s' }} />
                              </div>
                            </div>
                          ))
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function GalleryCard({ img, projectId, onClick }: { img: ImageItem; projectId: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ border: `1px solid ${hovered ? 'var(--primary)' : 'var(--border)'}`,
        borderRadius: 4, background: 'var(--surface-2)', padding: 8, cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 8, position: 'relative',
        transition: 'all 0.2s', transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered ? '0 4px 12px rgba(0,0,0,0.15)' : 'none', boxSizing: 'border-box' as const }}>
      <div style={{ width: '100%', height: 120, borderRadius: 3, overflow: 'hidden',
        background: 'var(--surface-3)', position: 'relative', border: '1px solid var(--border)' }}>
        <img src={`/api/projects/${projectId}/images/${img.id}/file`} alt={img.filename}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover',
            transition: 'transform 0.3s', transform: hovered ? 'scale(1.05)' : 'scale(1)' }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        <span style={{ position: 'absolute', top: 8, right: 8, padding: '3px 6px', borderRadius: 20,
          fontSize: 9, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3,
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          background: img.annotated ? '#22c55e' : 'var(--surface-3)',
          color: img.annotated ? '#fff' : 'var(--text3)',
          border: img.annotated ? 'none' : '1px solid var(--border)' }}>
          {img.annotated ? <><Check size={8} /> Annotated</> : <><Circle size={8} /> Unannotated</>}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text)', fontWeight: 500,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={img.filename}>
        {img.filename}
      </p>
    </div>
  )
}

function DonutChart({ pct }: { pct: number }) {
  return (
    <div style={{ width: 100, height: 100, position: 'relative',
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="90" height="90" viewBox="0 0 36 36"
        style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
        <circle cx="18" cy="18" r="15.915" fill="none" stroke="var(--surface-3)" strokeWidth="4" />
        <circle cx="18" cy="18" r="15.915" fill="none" stroke="#22c55e" strokeWidth="4"
          strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset="0"
          style={{ transition: 'stroke-dasharray 0.3s' }} />
      </svg>
      <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: 'var(--text)' }}>{pct}%</span>
        <span style={{ fontSize: 7, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Done</span>
      </div>
    </div>
  )
}
