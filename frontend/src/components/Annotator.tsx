import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, Save, Trash2, RotateCcw,
  MousePointer2, Square, Hexagon, Crosshair, Sparkles,
  ZoomIn, ZoomOut, Maximize2, Copy, Undo2, Redo2, Zap, Download
} from 'lucide-react'
import api, { type AnnData, type ImageItem, type Project, type ExternalModel } from '../api'

// ─── Constants ──────────────────────────────────────────────────────────────
const COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#6366f1','#a855f7','#ec4899']
const H = 7       // handle size in screen px
const SNAP_PX = 14 // polygon close-snap distance in screen px
const DOT_PX  = 8  // point dot radius in screen px

// ─── Shape types ───────────────────────────────────────────────────────────
type Tool = 'select' | 'bbox' | 'polygon' | 'point' | 'sam'

interface BBoxShape   { type: 'bbox';    class_id: number; x: number; y: number; w: number; h: number }
interface PolygonShape{ type: 'polygon'; class_id: number; pts: [number,number][] }
interface PointShape  { type: 'point';   class_id: number; x: number; y: number }
type Shape = BBoxShape | PolygonShape | PointShape

// ─── Drag state (stored in ref, not state, to avoid stale closures) ───────────
type Drag =
  | { kind: 'none' }
  | { kind: 'bbox-draw';   start: [number,number] }
  | { kind: 'sam-box';     start: [number,number] }
  | { kind: 'move-shape';  idx: number; mx0: number; my0: number; orig: Shape }
  | { kind: 'move-vertex'; idx: number; vi: number; mx0: number; my0: number; orig: PolygonShape }
  | { kind: 'bbox-handle'; idx: number; handle: string; mx0: number; my0: number; orig: BBoxShape }
  | { kind: 'pan';         cx0: number; cy0: number; px0: number; py0: number }

// ─── Helpers ───────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

function pointInPolygon(px: number, py: number, pts: [number,number][]) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]; const [xj, yj] = pts[j]
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Convert between API format and internal shape
function apiToShape(a: AnnData): Shape {
  if (a.shape_type === 'polygon') return { type: 'polygon', class_id: a.class_id, pts: a.points }
  if (a.shape_type === 'point')   return { type: 'point',   class_id: a.class_id, x: a.points[0]?.[0] ?? 0, y: a.points[0]?.[1] ?? 0 }
  return { type: 'bbox', class_id: a.class_id, x: a.x_center - a.width/2, y: a.y_center - a.height/2, w: a.width, h: a.height }
}

function shapeToApi(s: Shape): Omit<AnnData, 'id'> {
  if (s.type === 'polygon') {
    if (s.pts.length === 0) return { class_id: s.class_id, shape_type: 'polygon', x_center: 0, y_center: 0, width: 0, height: 0, points: [] }
    const xs = s.pts.map(p => p[0])
    const ys = s.pts.map(p => p[1])
    const x1 = Math.min(...xs), x2 = Math.max(...xs)
    const y1 = Math.min(...ys), y2 = Math.max(...ys)
    return {
      class_id: s.class_id,
      shape_type: 'polygon',
      x_center: (x1 + x2) / 2,
      y_center: (y1 + y2) / 2,
      width: x2 - x1,
      height: y2 - y1,
      points: s.pts
    }
  }
  if (s.type === 'point')   return { class_id: s.class_id, shape_type: 'point',   x_center: 0, y_center: 0, width: 0, height: 0, points: [[s.x, s.y]] }
  return { class_id: s.class_id, shape_type: 'bbox', x_center: s.x + s.w/2, y_center: s.y + s.h/2, width: s.w, height: s.h, points: [] }
}

// ─── Component ────────────────────────────���───────────────────────────────────
export default function Annotate() {
  const { id, imageId } = useParams<{ id: string; imageId: string }>()
  const projectId = Number(id)
  const navigate  = useNavigate()
  const isIframe = typeof window !== 'undefined' && window.self !== window.top;

  const [project, setProject]   = useState<Project | null>(null)
  const [images, setImages]     = useState<ImageItem[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [shapes, setShapes]     = useState<Shape[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [tool, setTool]         = useState<Tool>('bbox')

  const filteredTools = TOOLS.filter(t => {
    if (project?.task_type === 'detection') {
      return t.id !== 'polygon';
    }
    if (project?.task_type === 'segmentation') {
      return t.id !== 'bbox';
    }
    return true;
  })

  useEffect(() => {
    if (project) {
      setTool(project.task_type === 'segmentation' ? 'polygon' : 'bbox')
    }
  }, [project])

  const [samLoading, setSamLoading] = useState(false)
  const samBusyRef = useRef(false)
  // Active SAM refinement session: accumulates pos/neg points + an optional box
  // and updates one polygon shape in place. Cleared on Enter/Esc/tool change.
  const samSession = useRef<{ points: [number,number][]; labels: number[];
    box: [number,number,number,number] | null; idx: number } | null>(null)
  useEffect(() => { samSession.current = null }, [tool])
  const [activeClass, setActiveClass] = useState(0)
  const [zoom, setZoom]         = useState(1)
  const [pan, setPan]           = useState({ x: 0, y: 0 })
  const [saved, setSaved]       = useState(false)

  // In-progress polygon points + live mouse pos for preview
  const [polyPts, setPolyPts]   = useState<[number,number][]>([])
  const [mouse, setMouse]       = useState<[number,number] | null>(null)

  // Live bbox while drawing — must be STATE (not ref) so draw re-runs when it changes
  const [liveBbox, setLiveBbox] = useState<BBoxShape | null>(null)
  const drag          = useRef<Drag>({ kind: 'none' })
  const navigatingRef = useRef(false)
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef       = useRef<HTMLImageElement | null>(null)
  const spaceHeld    = useRef(false)

  // Keep latest state accessible in event handlers via refs
  const shapesRef   = useRef(shapes)
  const selectedRef = useRef(selected)
  const toolRef     = useRef(tool)
  const polyPtsRef  = useRef(polyPts)
  const zoomRef     = useRef(zoom)
  const panRef      = useRef(pan)
  useEffect(() => { shapesRef.current   = shapes   }, [shapes])
  useEffect(() => { selectedRef.current = selected }, [selected])
  useEffect(() => { toolRef.current     = tool     }, [tool])
  useEffect(() => { polyPtsRef.current  = polyPts  }, [polyPts])
  useEffect(() => { zoomRef.current     = zoom     }, [zoom])
  useEffect(() => { panRef.current      = pan      }, [pan])

  // ── Undo / Redo ───────────────────────────────────────────────────────────
  const historyRef = useRef<Shape[][]>([])
  const histIdxRef = useRef(-1)

  const snapshotHistory = useCallback((snap: Shape[]) => {
    historyRef.current = historyRef.current.slice(0, histIdxRef.current + 1)
    historyRef.current.push([...snap])
    histIdxRef.current = historyRef.current.length - 1
  }, [])

  const undo = useCallback(() => {
    if (histIdxRef.current > 0) {
      histIdxRef.current--
      setShapes([...historyRef.current[histIdxRef.current]])
      setSelected(null)
    }
  }, [])

  const redo = useCallback(() => {
    if (histIdxRef.current < historyRef.current.length - 1) {
      histIdxRef.current++
      setShapes([...historyRef.current[histIdxRef.current]])
      setSelected(null)
    }
  }, [])

  // ── Auto-annotate ─────────────────────────────────────────────────────────
  const [trainingRuns, setTrainingRuns] = useState<{id:number;model_base:string;status:string}[]>([])
  const [autoRunId,    setAutoRunId]    = useState('')
  const [autoConf,     setAutoConf]     = useState(0.25)
  const [autoLoading,    setAutoLoading]    = useState(false)
  const [autoMsg,        setAutoMsg]        = useState<{text:string;ok:boolean}|null>(null)
  const [externalModels, setExternalModels] = useState<ExternalModel[]>([])
  const [importing,      setImporting]      = useState(false)
  const [hfRepo,         setHfRepo]         = useState('')
  const [batchOnlyUnann, setBatchOnlyUnann] = useState(true)
  const [batchProgress,  setBatchProgress]  = useState<{done:number;total:number;labeled:number}|null>(null)
  const batchCancelRef = useRef(false)

  // ─── Load project + image list ────────��─────────────────────────────────
  // File upload state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingProgress, setUploadingProgress] = useState<number | null>(null)
  const [uploadingText, setUploadingText] = useState("")
  const [isDragOver, setIsDragOver] = useState(false)

  const triggerFileSelect = () => {
    fileInputRef.current?.click()
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files) {
      await uploadFiles(e.dataTransfer.files)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await uploadFiles(e.target.files)
    }
  }

  const uploadFiles = async (filesList: FileList) => {
    const filesArray = Array.from(filesList).filter(f =>
      /\.(jpe?g|png|bmp|webp)$/i.test(f.name)
    )
    if (filesArray.length === 0) {
      alert("Please select valid image files.")
      return
    }

    setUploadingProgress(0)
    const total = filesArray.length
    let doneCount = 0

    for (let i = 0; i < total; i++) {
      const formData = new FormData()
      formData.append('files', filesArray[i])

      try {
        setUploadingText(`Uploading ${i + 1}/${total}: ${filesArray[i].name}`)
        setUploadingProgress(Math.round((i / total) * 100))

        await api.post(`/projects/${projectId}/images`, formData)
        doneCount++
      } catch (err) {
        console.error("Upload error for file:", filesArray[i].name, err)
      }
    }

    setUploadingProgress(100)
    setUploadingText(`Finished: added ${doneCount} images`)
    setTimeout(async () => {
      setUploadingProgress(null)
      try {
        const iRes = await api.get(`/projects/${projectId}/images`)
        const imgs: ImageItem[] = iRes.data || []
        setImages(imgs)
        if (imgs.length > 0) {
          setCurrentIdx(0)
        }
      } catch (err) {
        console.error("Error refreshing images", err)
      }
    }, 1000)
  }

  useEffect(() => {
    Promise.all([
      api.get(`/projects/${projectId}`),
      api.get(`/projects/${projectId}/images`),
      api.get(`/pipelines?project_id=${projectId}`),
    ]).then(([pRes, iRes, rRes]) => {
      setProject(pRes.data)
      const imgs: ImageItem[] = iRes.data
      setImages(imgs)
      const idx = imgs.findIndex(i => i.id === Number(imageId))
      setCurrentIdx(idx >= 0 ? idx : 0)
      const doneRuns = (rRes.data as {id:string;pipeline_config?:any;status:string}[])
        .filter(r => r.status === 'completed' || r.status === 'success')
        .map(r => ({
          id: Number(r.id) || 1, // Keep number typing if required internally, otherwise fallback
          model_base: r.pipeline_config?.architecture || 'custom',
          status: r.status
        }))
      setTrainingRuns(doneRuns as any)
      setExternalModels([])
      if (doneRuns.length > 0) setAutoRunId(`run:${doneRuns[doneRuns.length - 1].id}`)
    }).catch(err => {
      console.error("Error loading project/images", err)
    })
  }, [projectId, imageId])

  const currentImage = images[currentIdx]

  // ─── Load annotations on image change ──────────────────────────────────
  useEffect(() => {
    if (!currentImage) return
    setSaved(false); setSelected(null); setPolyPts([]); setLiveBbox(null); samSession.current = null
    api.get(`/projects/${projectId}/images/${currentImage.id}/annotations`)
      .then(r => {
        const loaded = (r.data as AnnData[]).map(apiToShape)
        setShapes(loaded)
        historyRef.current = [[...loaded]]
        histIdxRef.current = 0
      })
  }, [currentImage?.id])

  // ─── Load image ─────────────────────────────────────────────────────────
  const fitToContainer = useCallback(() => {
    const canvas = canvasRef.current
    const cont   = containerRef.current
    if (!canvas || !cont || !imgRef.current) return
    const img    = imgRef.current
    const scale  = Math.min((cont.clientWidth - 4) / img.width, (cont.clientHeight - 4) / img.height, 1)
    canvas.width  = img.width  * scale
    canvas.height = img.height * scale
    setZoom(1); setPan({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    if (!currentImage) return
    const img = new Image()
    img.onload = () => { imgRef.current = img; fitToContainer() }
    img.src = `/api/projects/${projectId}/images/${currentImage.id}/file`
  }, [currentImage?.id])

  // ─── Draw canvas ───────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')!
    const cw  = canvas.width, ch = canvas.height

    ctx.clearRect(0, 0, cw, ch)
    ctx.save()
    ctx.translate(pan.x, pan.y)
    ctx.scale(zoom, zoom)
    ctx.drawImage(img, 0, 0, cw, ch)

    // ── Helper: canvas coords from normalized ──
    const cx = (nx: number) => nx * cw
    const cy = (ny: number) => ny * ch
    const hSz = H * 2 / zoom  // handle size in zoomed space

    // ── Draw all shapes ──
    const allShapes: Shape[] = liveBbox ? [...shapes, liveBbox] : shapes
    allShapes.forEach((s, i) => {
      const isSel = selected === i && tool === 'select'
      const color = COLORS[s.class_id % COLORS.length]
      ctx.strokeStyle = color
      ctx.lineWidth   = (isSel ? 2.5 : 1.8) / zoom

      if (s.type === 'bbox') {
        const px = cx(s.x), py = cy(s.y), pw = cx(s.w), ph = cy(s.h)
        ctx.fillStyle = color + '25'; ctx.fillRect(px, py, pw, ph)
        ctx.strokeRect(px, py, pw, ph)
        drawLabel(ctx, project?.classes?.[s.class_id] ?? `cls${s.class_id}`, color, cx(s.x), cy(s.y), zoom)
        if (isSel) drawBBoxHandles(ctx, s, cw, ch, zoom, color, hSz)
      }

      if (s.type === 'polygon') {
        if (s.pts.length < 2) return
        ctx.beginPath()
        ctx.moveTo(cx(s.pts[0][0]), cy(s.pts[0][1]))
        s.pts.slice(1).forEach(p => ctx.lineTo(cx(p[0]), cy(p[1])))
        ctx.closePath()
        ctx.fillStyle = color + '25'; ctx.fill()
        ctx.stroke()
        drawLabel(ctx, project?.classes?.[s.class_id] ?? `cls${s.class_id}`, color, cx(s.pts[0][0]), cy(s.pts[0][1]), zoom)
        if (isSel) s.pts.forEach(p => drawDot(ctx, cx(p[0]), cy(p[1]), H / zoom, '#fff', color))
      }

      if (s.type === 'point') {
        const r = DOT_PX / zoom
        ctx.beginPath(); ctx.arc(cx(s.x), cy(s.y), r, 0, Math.PI * 2)
        ctx.fillStyle = color + '80'; ctx.fill(); ctx.stroke()
        drawLabel(ctx, project?.classes?.[s.class_id] ?? `cls${s.class_id}`, color, cx(s.x) + r, cy(s.y) - r, zoom)
        if (isSel) drawDot(ctx, cx(s.x), cy(s.y), (H + 2) / zoom, 'transparent', '#fff')
      }
    })

    // ── Draw in-progress polygon ──
    if (polyPts.length > 0) {
      const color = COLORS[activeClass % COLORS.length]
      ctx.strokeStyle = color; ctx.lineWidth = 1.8 / zoom
      ctx.setLineDash([6 / zoom, 3 / zoom])
      ctx.beginPath()
      ctx.moveTo(cx(polyPts[0][0]), cy(polyPts[0][1]))
      polyPts.slice(1).forEach(p => ctx.lineTo(cx(p[0]), cy(p[1])))
      // Preview line to mouse
      if (mouse) ctx.lineTo(cx(mouse[0]), cy(mouse[1]))
      ctx.stroke()
      ctx.setLineDash([])

      // Placed vertex dots
      polyPts.forEach((p, vi) => {
        const isFirst = vi === 0
        // Snap ring on first point
        if (isFirst && mouse && willSnapClose(polyPts, mouse, cw, ch, zoom, pan)) {
          ctx.beginPath(); ctx.arc(cx(p[0]), cy(p[1]), (H + 4) / zoom, 0, Math.PI * 2)
          ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2 / zoom; ctx.stroke()
        }
        drawDot(ctx, cx(p[0]), cy(p[1]), H / zoom, isFirst ? color : '#fff', color)
      })
    }

    ctx.restore()
  }, [shapes, liveBbox, selected, tool, polyPts, mouse, activeClass, zoom, pan, project])

  useEffect(() => { draw() }, [draw])

  // ─── Coordinate conversion ──────────────────────────────────────────────
  const canvasPx = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect   = canvas.getBoundingClientRect()
    return {
      cx: (e.clientX - rect.left) * (canvas.width  / rect.width),
      cy: (e.clientY - rect.top)  * (canvas.height / rect.height),
    }
  }

  const toNorm = (e: React.MouseEvent<HTMLCanvasElement>): [number, number] => {
    const { cx, cy } = canvasPx(e)
    const canvas = canvasRef.current!
    return [
      (cx - pan.x) / (zoom * canvas.width),
      (cy - pan.y) / (zoom * canvas.height),
    ]
  }

  // ─── Hit testing ────────────────────────────────────────────────────────
  const hitShape = (nx: number, ny: number): number | null => {
    const ss = shapesRef.current
    for (let i = ss.length - 1; i >= 0; i--) {
      const s = ss[i]
      if (s.type === 'bbox')    { if (nx >= s.x && nx <= s.x+s.w && ny >= s.y && ny <= s.y+s.h) return i }
      if (s.type === 'polygon') { if (pointInPolygon(nx, ny, s.pts)) return i }
      if (s.type === 'point')   {
        const canvas = canvasRef.current!
        const r = DOT_PX / (zoomRef.current * canvas.width)
        if (Math.hypot(nx - s.x, ny - s.y) < r * 2) return i
      }
    }
    return null
  }

  const hitVertex = (s: PolygonShape, nx: number, ny: number): number => {
    const canvas = canvasRef.current!
    const thresh = H / (zoomRef.current * canvas.width) * 2
    return s.pts.findIndex(p => Math.hypot(nx - p[0], ny - p[1]) < thresh)
  }

  const hitBBoxHandle = (s: BBoxShape, nx: number, ny: number): string | null => {
    const canvas = canvasRef.current!
    const cw = canvas.width, ch = canvas.height
    const hx = H / (zoomRef.current * cw), hy = H / (zoomRef.current * ch)
    const handles: Record<string, [number, number]> = {
      tl:[s.x,s.y], tc:[s.x+s.w/2,s.y], tr:[s.x+s.w,s.y],
      ml:[s.x,s.y+s.h/2],               mr:[s.x+s.w,s.y+s.h/2],
      bl:[s.x,s.y+s.h], bc:[s.x+s.w/2,s.y+s.h], br:[s.x+s.w,s.y+s.h],
    }
    for (const [hid, [hpx, hpy]] of Object.entries(handles)) {
      if (Math.abs(nx - hpx) < hx * 1.6 && Math.abs(ny - hpy) < hy * 1.6) return hid
    }
    return null
  }

  // ─── Mouse events ────────────────────────────────────────────────────────
  // Run MobileSAM for the current session and add/replace its polygon in place
  const runSam = (sess: NonNullable<typeof samSession.current>) => {
    if (!currentImage) return
    samBusyRef.current = true
    setSamLoading(true)
    api.post(`/projects/${projectId}/images/${currentImage.id}/sam-segment`, {
      points: sess.points, labels: sess.labels, box: sess.box,
    })
      .then(r => {
        const pts = r.data.points as [number, number][]
        if (!pts || pts.length < 3) return
        const cur = shapesRef.current
        if (sess.idx >= 0 && sess.idx < cur.length && cur[sess.idx]?.type === 'polygon') {
          const ns = cur.map((s, i) =>
            i === sess.idx ? { type: 'polygon' as const, class_id: activeClass, pts } : s)
          setShapes(ns); snapshotHistory(ns)
        } else {
          const ns = [...cur, { type: 'polygon' as const, class_id: activeClass, pts }]
          setShapes(ns); snapshotHistory(ns)
          sess.idx = ns.length - 1
        }
      })
      .catch(() => { /* no object / model loading */ })
      .finally(() => { samBusyRef.current = false; setSamLoading(false) })
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { cx, cy } = canvasPx(e)
    const [nx, ny]   = toNorm(e)

    // Pan: middle-click or Space+LMB
    if (e.button === 1 || spaceHeld.current) {
      drag.current = { kind: 'pan', cx0: cx, cy0: cy, px0: panRef.current.x, py0: panRef.current.y }
      return
    }
    if (e.button !== 0) return

    const currentTool = toolRef.current

    // ── Polygon tool ──
    if (currentTool === 'polygon') {
      const pts = polyPtsRef.current
      if (pts.length >= 3 && willSnapClose(pts, [nx, ny], canvasRef.current!.width, canvasRef.current!.height, zoomRef.current, panRef.current)) {
        const newShapes = [...shapesRef.current, { type: 'polygon' as const, class_id: activeClass, pts: [...pts] }]
        setShapes(newShapes)
        snapshotHistory(newShapes)
        setPolyPts([])
      } else {
        setPolyPts(prev => [...prev, [nx, ny]])
      }
      return
    }

    // ── Point tool ──
    if (currentTool === 'point') {
      const newShapes = [...shapesRef.current, { type: 'point' as const, class_id: activeClass, x: nx, y: ny }]
      setShapes(newShapes)
      snapshotHistory(newShapes)
      return
    }

    // ── SAM click-to-segment (with refinement) ──
    if (currentTool === 'sam') {
      if (samBusyRef.current || !currentImage) return
      // Shift-click → negative point (carve away) on the current object
      if (e.shiftKey) {
        const s = samSession.current
        if (s) { s.points.push([nx, ny]); s.labels.push(0); runSam(s) }
        else { const ns = { points: [[nx, ny]] as [number,number][], labels: [1], box: null, idx: -1 }
               samSession.current = ns; runSam(ns) }
        return
      }
      // Plain press → start a drag; mouse-up decides click (point) vs box
      drag.current = { kind: 'sam-box', start: [nx, ny] }
      setLiveBbox(null)
      return
    }

    // ── BBox draw tool ──
    if (currentTool === 'bbox') {
      setSelected(null)
      drag.current = { kind: 'bbox-draw', start: [nx, ny] }
      setLiveBbox(null)
      return
    }

    // ── Select tool ──
    if (currentTool === 'select') {
      const sel = selectedRef.current
      // Check bbox handles first
      if (sel !== null && shapesRef.current[sel]?.type === 'bbox') {
        const hid = hitBBoxHandle(shapesRef.current[sel] as BBoxShape, nx, ny)
        if (hid) {
          drag.current = { kind: 'bbox-handle', idx: sel, handle: hid, mx0: nx, my0: ny, orig: { ...shapesRef.current[sel] as BBoxShape } }
          return
        }
      }
      // Check polygon vertices
      if (sel !== null && shapesRef.current[sel]?.type === 'polygon') {
        const vi = hitVertex(shapesRef.current[sel] as PolygonShape, nx, ny)
        if (vi >= 0) {
          drag.current = { kind: 'move-vertex', idx: sel, vi, mx0: nx, my0: ny, orig: { ...shapesRef.current[sel] as PolygonShape, pts: [...(shapesRef.current[sel] as PolygonShape).pts] } }
          return
        }
      }
      // Hit shape
      const i = hitShape(nx, ny)
      setSelected(i)
      if (i !== null) {
        drag.current = { kind: 'move-shape', idx: i, mx0: nx, my0: ny, orig: { ...shapesRef.current[i] } as Shape }
      } else {
        drag.current = { kind: 'none' }
      }
    }
  }

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { cx, cy } = canvasPx(e)
    const [nx, ny]   = toNorm(e)
    const d = drag.current

    // Update cursor
    if (canvasRef.current) canvasRef.current.style.cursor = computeCursor(e, nx, ny)

    // Update mouse for polygon preview
    setMouse([nx, ny])

    if (d.kind === 'pan') {
      setPan({ x: d.px0 + (cx - d.cx0), y: d.py0 + (cy - d.cy0) })
      return
    }
    if (d.kind === 'bbox-draw' || d.kind === 'sam-box') {
      const x = Math.min(d.start[0], nx), y = Math.min(d.start[1], ny)
      setLiveBbox({ type: 'bbox', class_id: activeClass, x, y, w: Math.abs(nx - d.start[0]), h: Math.abs(ny - d.start[1]) })
      return
    }
    if (d.kind === 'move-shape') {
      const dx = nx - d.mx0, dy = ny - d.my0
      setShapes(prev => prev.map((s, i) => {
        if (i !== d.idx) return s
        if (s.type === 'bbox')    return { ...s, x: clamp(d.orig.type === 'bbox' ? d.orig.x + dx : 0, 0, 1 - s.w), y: clamp(d.orig.type === 'bbox' ? d.orig.y + dy : 0, 0, 1 - s.h) }
        if (s.type === 'point')   return { ...s, x: clamp((d.orig as PointShape).x + dx, 0, 1), y: clamp((d.orig as PointShape).y + dy, 0, 1) }
        if (s.type === 'polygon') return { ...s, pts: (d.orig as PolygonShape).pts.map(p => [clamp(p[0]+dx,0,1), clamp(p[1]+dy,0,1)] as [number,number]) }
        return s
      }))
      return
    }
    if (d.kind === 'move-vertex') {
      setShapes(prev => prev.map((s, i) => {
        if (i !== d.idx || s.type !== 'polygon') return s
        const pts: [number,number][] = d.orig.pts.map((p, vi) =>
          vi === d.vi ? [clamp(p[0]+(nx-d.mx0),0,1), clamp(p[1]+(ny-d.my0),0,1)] : [...p] as [number,number]
        )
        return { ...s, pts }
      }))
      return
    }
    if (d.kind === 'bbox-handle') {
      setShapes(prev => prev.map((s, i) => {
        if (i !== d.idx || s.type !== 'bbox') return s
        return applyBboxHandle(d.orig, d.handle, nx - d.mx0, ny - d.my0)
      }))
    }
  }

  const onMouseUp = (e?: React.MouseEvent<HTMLCanvasElement>) => {
    const d = drag.current
    drag.current = { kind: 'none' }
    if (d.kind === 'bbox-draw' && liveBbox && liveBbox.w > 0.01 && liveBbox.h > 0.01) {
      const newShapes = [...shapesRef.current, liveBbox]
      setShapes(newShapes)
      snapshotHistory(newShapes)
    } else if (d.kind === 'sam-box') {
      // Big drag → box prompt (new object). Tiny drag → treat as a click point:
      // first click starts an object, later clicks add positive refinement points.
      const big = liveBbox && liveBbox.w > 0.02 && liveBbox.h > 0.02
      if (big && liveBbox) {
        const ns = { points: [] as [number,number][], labels: [] as number[],
          box: [liveBbox.x, liveBbox.y, liveBbox.x + liveBbox.w, liveBbox.y + liveBbox.h] as [number,number,number,number],
          idx: -1 }
        samSession.current = ns; runSam(ns)
      } else {
        const p = d.start
        const s = samSession.current
        if (s && !e?.shiftKey) { s.points.push(p); s.labels.push(1); runSam(s) }
        else { const ns = { points: [p], labels: [1], box: null, idx: -1 }
               samSession.current = ns; runSam(ns) }
      }
    } else if (d.kind === 'move-shape' || d.kind === 'move-vertex' || d.kind === 'bbox-handle') {
      snapshotHistory(shapesRef.current)
    }
    setLiveBbox(null)
  }

  // ─── Double-click to close polygon ──────────────────────────────────────
  const onDblClick = () => {
    if (toolRef.current === 'polygon' && polyPtsRef.current.length >= 3) {
      const newShapes = [...shapesRef.current, { type: 'polygon' as const, class_id: activeClass, pts: [...polyPtsRef.current] }]
      setShapes(newShapes)
      snapshotHistory(newShapes)
      setPolyPts([])
    }
  }

  // ──��� Scroll to zoom ─────────────────────────────────────────────────────
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const { cx, cy } = canvasPx(e)
    const factor  = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const newZoom = clamp(zoomRef.current * factor, 0.15, 15)
    setPan(p => ({ x: cx - (cx - p.x) * newZoom / zoomRef.current, y: cy - (cy - p.y) * newZoom / zoomRef.current }))
    setZoom(newZoom)
  }

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') { spaceHeld.current = true; e.preventDefault() }
      if (e.key === 'Escape') { setPolyPts([]); setLiveBbox(null); setSelected(null); samSession.current = null }
      // Enter finishes the current SAM object so the next click starts a fresh one
      if (e.key === 'Enter' && toolRef.current === 'sam') { samSession.current = null }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current !== null && document.activeElement?.tagName !== 'INPUT') {
        const newShapes = shapesRef.current.filter((_, i) => i !== selectedRef.current)
        setShapes(newShapes)
        snapshotHistory(newShapes)
        setSelected(null)
      }
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key === 'v' || e.key === '1') setTool('select')
        if (e.key === 'r' || e.key === '2') { setTool('bbox');    setPolyPts([]) }
        if (e.key === 'p' || e.key === '3') { setTool('polygon'); setPolyPts([]) }
        if (e.key === 'd' || e.key === '4') { setTool('point');   setPolyPts([]) }
        if (e.key === 's' || e.key === '5') { setTool('sam');     setPolyPts([]) }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedRef.current !== null) {
        e.preventDefault()
        const s = shapesRef.current[selectedRef.current]
        if (!s) return
        let dup: Shape
        if (s.type === 'bbox')    dup = { ...s, x: Math.min(s.x+0.02,1-s.w), y: Math.min(s.y+0.02,1-s.h) }
        else if (s.type === 'point') dup = { ...s, x: Math.min(s.x+0.02,1), y: Math.min(s.y+0.02,1) }
        else dup = { ...s, pts: s.pts.map(p => [Math.min(p[0]+0.02,1), Math.min(p[1]+0.02,1)] as [number,number]) }
        const newShapes = [...shapesRef.current, dup]
        setShapes(newShapes)
        snapshotHistory(newShapes)
      }
    }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceHeld.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup',   up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // ─── Cursor ─────────────────────────────────────────────────────────────
  const computeCursor = (_e: React.MouseEvent<HTMLCanvasElement>, nx: number, ny: number) => {
    if (spaceHeld.current || drag.current.kind === 'pan') return 'grab'
    if (tool === 'sam') return samLoading ? 'wait' : 'crosshair'
    if (tool === 'bbox' || tool === 'polygon' || tool === 'point') return 'crosshair'
    const sel = selected
    if (sel !== null) {
      const s = shapes[sel]
      if (s?.type === 'bbox') {
        const h = hitBBoxHandle(s, nx, ny)
        if (h) return HANDLE_CURSORS[h] ?? 'pointer'
      }
      if (s?.type === 'polygon') {
        const vi = hitVertex(s, nx, ny)
        if (vi >= 0) return 'crosshair'
      }
    }
    return hitShape(nx, ny) !== null ? 'move' : 'default'
  }

  // ─── Import external model ────────────────────────────────────────────────
  const importModel = async (file: File) => {
    setImporting(true)
    try {
      const form = new FormData()
      form.append('name', file.name.replace('.pt', ''))
      form.append('file', file)
      const res = await api.post('/models/external', form)
      setExternalModels(prev => [...prev, res.data])
      setAutoRunId(`ext:${res.data.id}`)
      setAutoMsg({ text: `Imported: ${res.data.name}`, ok: true })
    } catch {
      setAutoMsg({ text: 'Import failed — make sure it is a valid .pt file', ok: false })
    } finally {
      setImporting(false)
    }
  }

  // Import a HuggingFace model folder (config.json + weights + preprocessor)
  const importHfModel = async (files: FileList) => {
    const arr = Array.from(files)
    if (!arr.some(f => (f.name === 'config.json'))) {
      setAutoMsg({ text: 'Pick the model folder containing config.json', ok: false })
      return
    }
    setImporting(true)
    setAutoMsg({ text: 'Uploading model… (large files may take a while)', ok: true })
    try {
      const form = new FormData()
      // Folder name (from the first file's relative path) as the model name
      const rel = (arr[0] as any).webkitRelativePath as string || ''
      const folderName = rel.split('/')[0] || 'hf-model'
      form.append('name', folderName)
      arr.forEach(f => form.append('files', f, f.name))
      const res = await api.post('/models/external/hf', form)
      setExternalModels(prev => [...prev, res.data])
      setAutoRunId(`ext:${res.data.id}`)
      setAutoMsg({ text: `Imported ${res.data.name} (${res.data.task})`, ok: true })
    } catch (e: any) {
      setAutoMsg({ text: e?.response?.data?.detail ?? 'Import failed — must be an image classification or detection model', ok: false })
    } finally {
      setImporting(false)
    }
  }

  // Download a model straight from the HuggingFace Hub by repo id
  const importHfHub = async () => {
    const repo = hfRepo.trim()
    if (!repo) return
    setImporting(true)
    setAutoMsg({ text: `Downloading ${repo}… (first time can take a few minutes)`, ok: true })
    try {
      const form = new FormData()
      form.append('repo_id', repo)
      const res = await api.post('/models/external/hf-hub', form)
      setExternalModels(prev => [...prev, res.data])
      setAutoRunId(`ext:${res.data.id}`)
      setHfRepo('')
      setAutoMsg({ text: `Imported ${res.data.name} (${res.data.task})`, ok: true })
    } catch (e: any) {
      setAutoMsg({ text: e?.response?.data?.detail ?? 'Download failed — check the repo id and your connection', ok: false })
    } finally {
      setImporting(false)
    }
  }

  // ─── Auto-annotate ────────────────────────────────────────────────────────
  const autoAnnotate = async () => {
    if (!currentImage || !autoRunId) return
    setAutoLoading(true)
    setAutoMsg(null)
    const [kind, rawId] = autoRunId.split(':')
    const params: Record<string, unknown> = { conf: autoConf }
    if (kind === 'run') params.run_id = rawId
    else params.external_model_id = rawId
    try {
      const res = await api.post(
        `/projects/${projectId}/images/${currentImage.id}/auto-annotate`,
        null,
        { params }
      )
      const suggested = (res.data.annotations as AnnData[]).map(apiToShape)
      if (suggested.length > 0) {
        const merged = [...shapesRef.current, ...suggested]
        setShapes(merged)
        snapshotHistory(merged)
        setAutoMsg({ text: `+${suggested.length} annotation${suggested.length > 1 ? 's' : ''} added`, ok: true })
      } else {
        setAutoMsg({ text: 'No objects detected — try lowering the confidence threshold', ok: false })
      }
    } catch (err: unknown) {
      const msg = (err as {response?: {data?: {detail?: string}}})?.response?.data?.detail ?? 'Auto-annotate failed'
      setAutoMsg({ text: msg, ok: false })
    } finally {
      setAutoLoading(false)
    }
  }

  // ─── Auto-annotate every image (saves directly) ──────────────────────────
  const autoAnnotateAll = async () => {
    if (!autoRunId) return
    const targets = batchOnlyUnann ? images.filter(i => !i.annotated) : images
    if (targets.length === 0) {
      setAutoMsg({ text: 'Nothing to do — all images are already annotated', ok: false })
      return
    }
    if (!window.confirm(
      `Run the model on ${targets.length} image${targets.length > 1 ? 's' : ''} and save the results?` +
      (batchOnlyUnann ? '' : '\n\nThis OVERWRITES existing annotations on every image.'))) return

    await save()   // don't lose edits on the current image
    batchCancelRef.current = false
    setBatchProgress({ done: 0, total: targets.length, labeled: 0 })
    const [kind, rawId] = autoRunId.split(':')
    const params: Record<string, unknown> = { conf: autoConf }
    if (kind === 'run') params.run_id = rawId; else params.external_model_id = rawId

    let labeled = 0
    const annotatedIds = new Set<number>()
    for (let i = 0; i < targets.length; i++) {
      if (batchCancelRef.current) break
      const img = targets[i]
      try {
        const res = await api.post(`/projects/${projectId}/images/${img.id}/auto-annotate`, null, { params })
        const anns = res.data.annotations as AnnData[]
        if (anns.length > 0) {
          const apiAnns = anns.map(apiToShape).map(shapeToApi)
          await api.post(`/projects/${projectId}/images/${img.id}/annotations`, apiAnns)
          labeled++; annotatedIds.add(img.id)
        }
      } catch { /* skip failed image, keep going */ }
      setBatchProgress({ done: i + 1, total: targets.length, labeled })
    }
    // Reflect new annotated flags in the list
    if (annotatedIds.size > 0) {
      setImages(prev => prev.map(im => annotatedIds.has(im.id) ? { ...im, annotated: true } : im))
    }
    // Refresh the current image's shapes from the server (it may have been labeled)
    if (currentImage) {
      try {
        const r = await api.get(`/projects/${projectId}/images/${currentImage.id}/annotations`)
        const fresh = (r.data as AnnData[]).map(apiToShape)
        setShapes(fresh); snapshotHistory(fresh)
      } catch { /* ignore */ }
    }
    const cancelled = batchCancelRef.current
    setBatchProgress(null)
    setAutoMsg({ text: `${cancelled ? 'Stopped' : 'Done'} — labeled ${labeled} of ${targets.length} image${targets.length > 1 ? 's' : ''}`, ok: true })
  }

  const copyFromPrev = async () => {
    if (currentIdx === 0) return
    const prevImg = images[currentIdx - 1]
    if (!prevImg) return
    const res = await api.get(`/projects/${projectId}/images/${prevImg.id}/annotations`)
    const copied = (res.data as AnnData[]).map(apiToShape)
    if (copied.length > 0) {
      const merged = [...shapesRef.current, ...copied]
      setShapes(merged)
      snapshotHistory(merged)
    }
  }

  // ─── Save ─────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!currentImage) return
    await api.post(`/projects/${projectId}/images/${currentImage.id}/annotations`, shapes.map(shapeToApi))
    setSaved(true)
    setImages(prev => prev.map(i => i.id === currentImage.id ? { ...i, annotated: shapes.length > 0 } : i))
  }

  const goTo = async (nextIdx: number) => {
    if (navigatingRef.current) return
    navigatingRef.current = true
    try { await save(); setCurrentIdx(nextIdx) }
    finally { navigatingRef.current = false }
  }

  // ─── Shape label icons ─────────────────────────────────────────────────
  const shapeIcon = (s: Shape) => {
    if (s.type === 'bbox')    return <Square size={11} />
    if (s.type === 'polygon') return <Hexagon size={11} />
    return <Crosshair size={11} />
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  const [rightPanelOpen, setRightPanelOpen] = useState(true)

  // Compact toolbar button style
  const tbBtn = (active = false): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
    padding: '4px 8px', height: 30, borderRadius: 4,
    border: `1px solid ${active ? 'var(--annotator-accent)' : 'var(--annotator-border)'}`,
    background: active ? 'var(--annotator-accent-s)' : 'transparent',
    color: active ? 'var(--annotator-accent)' : 'var(--text2)', cursor: 'pointer',
    fontSize: 11, fontWeight: 500, transition: 'all 0.1s', whiteSpace: 'nowrap',
  })
  const tbIconBtn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 30, height: 30, borderRadius: 4,
    border: '1px solid var(--annotator-border)', background: 'transparent',
    color: 'var(--text2)', cursor: 'pointer', transition: 'all 0.1s',
  }
  const panelSection: React.CSSProperties = {
    padding: '10px 12px', borderBottom: '1px solid var(--annotator-border)',
  }
  const panelLabel: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
    color: 'var(--text3)', marginBottom: 8,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: isIframe ? '100vh' : 'calc(100vh - 48px)',
      width: '100%', overflow: 'hidden' }}>

      {/* ═══ Top toolbar ═══ */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0,
        height: 42, background: 'var(--surface)', borderBottom: '1px solid var(--annotator-border)',
        padding: '0 8px',
      }}>
        {/* Left: Back + filename + counter */}
        <button onClick={() => navigate(`/projects/${projectId}/images`)}
          style={{ ...tbIconBtn, border: 'none', marginRight: 4 }} title="Back to images">
          <ChevronLeft size={16} />
        </button>
        <h1 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', margin: 0,
          maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentImage?.filename}
        </h1>
        <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8, fontFamily: 'JetBrains Mono, monospace' }}>
          {currentIdx + 1}/{images.length}
        </span>

        {/* Separator */}
        <div style={{ width: 1, height: 20, background: 'var(--annotator-border)', margin: '0 10px' }} />

        {/* Tools — horizontal strip */}
        <div style={{ display: 'flex', gap: 2 }}>
          {filteredTools.map(t => (
            <button key={t.id} onClick={() => { setTool(t.id); setPolyPts([]) }}
              title={`${t.label}${t.hint ? ` (${t.hint})` : ''}`}
              style={tbBtn(tool === t.id)}>
              {t.icon}
              <span style={{ fontSize: 11 }}>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Separator */}
        <div style={{ width: 1, height: 20, background: 'var(--annotator-border)', margin: '0 10px' }} />

        {/* Zoom controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button onClick={() => setZoom(z => clamp(z / 1.3, 0.15, 15))} style={tbIconBtn} title="Zoom out">
            <ZoomOut size={14} />
          </button>
          <span style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'JetBrains Mono, monospace',
            width: 38, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => setZoom(z => clamp(z * 1.3, 0.15, 15))} style={tbIconBtn} title="Zoom in">
            <ZoomIn size={14} />
          </button>
          <button onClick={fitToContainer} style={tbIconBtn} title="Fit to screen">
            <Maximize2 size={14} />
          </button>
        </div>

        {/* Separator */}
        <div style={{ width: 1, height: 20, background: 'var(--annotator-border)', margin: '0 10px' }} />

        {/* Undo / Redo */}
        <div style={{ display: 'flex', gap: 2 }}>
          <button onClick={undo} title="Undo (Ctrl+Z)" style={tbIconBtn}><Undo2 size={14} /></button>
          <button onClick={redo} title="Redo (Ctrl+Y)" style={tbIconBtn}><Redo2 size={14} /></button>
          {currentIdx > 0 && (
            <button onClick={copyFromPrev} title="Copy from previous" style={{ ...tbIconBtn, width: 'auto', padding: '0 8px', gap: 4, fontSize: 11, color: 'var(--text2)' }}>
              <Copy size={12} /> Copy prev
            </button>
          )}
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--annotator-border)', margin: '0 10px' }} />
        <button
          onClick={triggerFileSelect}
          style={{ ...tbIconBtn, width: 'auto', padding: '0 8px', gap: 4, color: 'var(--text2)' }}
          title="Upload more images"
        >
          <Download size={14} />
          <span style={{ fontSize: 11 }}>Upload</span>
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Right: Nav + Save */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => goTo(currentIdx - 1)} disabled={currentIdx === 0}
            style={{ ...tbIconBtn, opacity: currentIdx === 0 ? 0.3 : 1 }} title="Previous image">
            <ChevronLeft size={14} />
          </button>
          <button onClick={() => goTo(currentIdx + 1)} disabled={currentIdx === images.length - 1}
            style={{ ...tbIconBtn, opacity: currentIdx === images.length - 1 ? 0.3 : 1 }} title="Next image">
            <ChevronRight size={14} />
          </button>

          <div style={{ width: 1, height: 20, background: 'var(--annotator-border)', margin: '0 6px' }} />

          <button onClick={save} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 14px', height: 30,
            borderRadius: 4, border: `1px solid ${saved ? 'var(--success)' : 'var(--annotator-accent)'}`,
            background: saved ? 'rgba(34,197,94,0.12)' : 'var(--annotator-accent)',
            color: saved ? 'var(--success)' : '#fff', cursor: 'pointer',
            fontSize: 12, fontWeight: 500, transition: 'all 0.12s',
          }}>
            <Save size={13} /> {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {/* ═══ Main area: canvas + right panel ═══ */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* ── Canvas area ── */}
        <div ref={containerRef} style={{
          flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0,
          position: 'relative', background: '#0c0c10',
        }}>
          {/* SAM overlay hint */}
          {tool === 'sam' && (
            <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
              zIndex: 5, padding: '5px 14px', borderRadius: 20, fontSize: 11,
              background: samLoading ? 'rgba(168,85,247,0.92)' : 'rgba(12,12,16,0.88)',
              color: '#fff', border: '1px solid rgba(168,85,247,0.4)',
              display: 'flex', alignItems: 'center', gap: 7, pointerEvents: 'none',
              backdropFilter: 'blur(8px)' }}>
              <Sparkles size={12} />
              {samLoading ? 'Segmenting…'
                : 'Click or drag box · click = add · Shift+click = remove · Enter = next'}
            </div>
          )}

          {/* Polygon in-progress hint */}
          {tool === 'polygon' && polyPts.length > 0 && (
            <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
              zIndex: 5, padding: '5px 14px', borderRadius: 20, fontSize: 11,
              background: 'rgba(12,12,16,0.88)', color: 'var(--annotator-accent)',
              border: '1px solid var(--annotator-accent)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
              <Hexagon size={12} />
              {polyPts.length} points — click start to close or double-click
            </div>
          )}

          {/* Canvas */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center',
            justifyContent: 'center', minHeight: 0 }}>
            {images.length === 0 ? (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={triggerFileSelect}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  border: '2px dashed var(--annotator-border)', borderRadius: 12, padding: '40px 30px', cursor: 'pointer',
                  background: isDragOver ? 'var(--annotator-accent-s)' : 'transparent',
                  borderColor: isDragOver ? 'var(--annotator-accent)' : 'var(--annotator-border)',
                  transition: 'all 0.2s', color: 'var(--text2)', textAlign: 'center', maxWidth: 400, width: '100%', margin: 20
                }}
              >
                <Download style={{ color: 'var(--annotator-accent)', marginBottom: 12, opacity: 0.8 }} size={48} />
                <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 4px 0' }}>No images in project</h3>
                <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>
                  Drag & drop image files here, or click to browse
                </p>
                <input
                  type="file"
                  ref={fileInputRef}
                  multiple
                  accept="image/*"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                {uploadingProgress !== null && (
                  <div style={{ marginTop: 16, width: '100%', maxWidth: 250 }}>
                    <div style={{ background: 'var(--surface3)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: 'var(--annotator-accent)', width: `${uploadingProgress}%`, transition: 'width 0.1s' }} />
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4, display: 'block', fontFamily: 'monospace' }}>
                      {uploadingText}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <canvas ref={canvasRef} style={{ display: 'block' }}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={() => { setMouse(null); onMouseUp() }}
                onWheel={onWheel}
                onDoubleClick={onDblClick}
                onContextMenu={e => e.preventDefault()}
              />
            )}
          </div>

          {/* Bottom status bar */}
          <div style={{
            flexShrink: 0, padding: '4px 12px', height: 28,
            borderTop: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', gap: 16,
            fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: 'JetBrains Mono, monospace',
            background: 'rgba(0,0,0,0.3)',
          }}>
            {[['1','Select'],['2','Rect'],['3','Poly'],['4','Point'],['5','SAM'],['Del','Del'],['⌘D','Dupe']].map(([k,v]) => (
              <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <kbd style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 3, padding: '0px 4px', fontSize: 9, lineHeight: '16px' }}>{k}</kbd>
                <span>{v}</span>
              </span>
            ))}
            <span style={{ marginLeft: 'auto', opacity: 0.7 }}>Scroll=Zoom · Space+Drag=Pan</span>
          </div>
        </div>

        {/* ── Right panel (collapsible) ── */}
        <div style={{
          width: rightPanelOpen ? 240 : 0, flexShrink: 0, overflow: 'hidden',
          transition: 'width 0.2s ease', borderLeft: rightPanelOpen ? '1px solid var(--annotator-border)' : 'none',
          background: 'var(--surface)', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ width: 240, height: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

            {/* Classes */}
            <div style={panelSection}>
              <p style={panelLabel}>Classes</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {project?.classes.map((c, i) => (
                  <button key={i} onClick={() => setActiveClass(i)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                      borderRadius: 4, border: `1px solid ${activeClass === i ? 'var(--annotator-accent)' : 'var(--annotator-border)'}`,
                      background: activeClass === i ? 'var(--annotator-accent-s)' : 'transparent',
                      color: activeClass === i ? 'var(--annotator-accent)' : 'var(--text2)',
                      cursor: 'pointer', fontSize: 12, textAlign: 'left', transition: 'all 0.1s', width: '100%' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, flexShrink: 0,
                      background: COLORS[i % COLORS.length] }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{c}</span>
                    {activeClass === i && <span style={{ fontSize: 9, opacity: 0.6 }}>●</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Shapes list */}
            <div style={{ ...panelSection, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <p style={{ ...panelLabel, marginBottom: 0 }}>Annotations ({shapes.length})</p>
                {shapes.length > 0 && (
                  <button onClick={() => { const n: Shape[] = []; setShapes(n); snapshotHistory(n); setSelected(null) }}
                    title="Clear all"
                    style={{ border: 'none', background: 'transparent', color: 'var(--text3)',
                      cursor: 'pointer', display: 'flex', padding: 2, borderRadius: 3 }}>
                    <RotateCcw size={11} />
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', flex: 1 }}>
                {shapes.map((s, i) => (
                  <div key={i} onClick={() => { setSelected(i); setTool('select') }}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
                      border: `1px solid ${selected === i ? 'var(--annotator-accent)' : 'transparent'}`,
                      background: selected === i ? 'var(--annotator-accent-t)' : 'transparent',
                      transition: 'all 0.08s' }}
                    onMouseEnter={e => { if (selected !== i) e.currentTarget.style.background = 'var(--surface2)' }}
                    onMouseLeave={e => { if (selected !== i) e.currentTarget.style.background = 'transparent' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                        background: COLORS[s.class_id % COLORS.length] }} />
                      <span style={{ fontSize: 11, color: 'var(--text3)', display: 'flex' }}>{shapeIcon(s)}</span>
                      <span style={{ fontSize: 11, color: 'var(--text2)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {project?.classes[s.class_id]}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, opacity: selected === i ? 1 : 0.5 }}>
                      <button onClick={e => { e.stopPropagation()
                        const sh = shapesRef.current[i]; if (!sh) return
                        let dup: Shape
                        if (sh.type === 'bbox')    dup = { ...sh, x: Math.min(sh.x+0.02,1-sh.w) }
                        else if (sh.type === 'point') dup = { ...sh, x: Math.min(sh.x+0.02,1) }
                        else dup = { ...sh, pts: sh.pts.map(p => [Math.min(p[0]+0.02,1), p[1]] as [number,number]) }
                        const ns = [...shapesRef.current, dup]
                        setShapes(ns); snapshotHistory(ns)
                      }} style={{ border: 'none', background: 'transparent',
                        color: 'var(--text3)', cursor: 'pointer', padding: 2, display: 'flex', borderRadius: 3 }}
                        title="Duplicate">
                        <Copy size={10} />
                      </button>
                      <button onClick={e => { e.stopPropagation()
                        const ns = shapesRef.current.filter((_,j)=>j!==i)
                        setShapes(ns); snapshotHistory(ns)
                        if(selectedRef.current===i) setSelected(null)
                      }} style={{ border: 'none', background: 'transparent',
                        color: 'var(--text3)', cursor: 'pointer', padding: 2, display: 'flex', borderRadius: 3 }}
                        title="Delete">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                ))}
                {shapes.length === 0 && (
                  <p style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', padding: '16px 0', opacity: 0.6 }}>
                    No annotations yet
                  </p>
                )}
              </div>
            </div>

            {/* Auto-annotate */}
            <div style={panelSection}>
              <p style={panelLabel}>Auto-Annotate</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <select value={autoRunId} onChange={e => setAutoRunId(e.target.value)}
                  disabled={trainingRuns.length === 0 && externalModels.length === 0}
                  style={{ width: '100%', padding: '5px 8px', background: 'var(--surface2)',
                    border: '1px solid var(--annotator-border)', borderRadius: 4, color: 'var(--text)',
                    fontSize: 11, fontFamily: 'inherit', outline: 'none',
                    cursor: trainingRuns.length === 0 && externalModels.length === 0 ? 'default' : 'pointer',
                    opacity: trainingRuns.length === 0 && externalModels.length === 0 ? 0.4 : 1 }}>
                  {trainingRuns.length === 0 && externalModels.length === 0 && (
                    <option value="">No models — import below</option>
                  )}
                  {trainingRuns.length > 0 && (
                    <optgroup label="Trained">
                      {trainingRuns.map(r => (
                        <option key={r.id} value={`run:${r.id}`}>#{r.id} {r.model_base}</option>
                      ))}
                    </optgroup>
                  )}
                  {externalModels.length > 0 && (
                    <optgroup label="Imported">
                      {externalModels.map(m => (
                        <option key={m.id} value={`ext:${m.id}`}>
                          {m.name}{(m as any).kind === 'hf' ? ` · HF` : ' · YOLO'}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>

                {/* Import buttons */}
                <div style={{ display: 'flex', gap: 4 }}>
                  <label style={{ flex: 1, cursor: importing ? 'wait' : 'pointer' }}>
                    <input type="file" accept=".pt" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) importModel(f); e.target.value = '' }} />
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                      padding: '4px 6px', background: 'var(--surface2)',
                      border: '1px solid var(--annotator-border)', borderRadius: 4, fontSize: 10,
                      color: 'var(--text2)', cursor: 'inherit' }}>
                      {importing ? '…' : <><Download size={10} /> .pt</>}
                    </span>
                  </label>
                  <label style={{ flex: 1, cursor: importing ? 'wait' : 'pointer' }}>
                    <input type="file" style={{ display: 'none' }}
                      ref={el => { if (el) { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', '') } }}
                      onChange={e => { if (e.target.files?.length) importHfModel(e.target.files); e.target.value = '' }} />
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                      padding: '4px 6px', background: 'var(--surface2)',
                      border: '1px solid var(--annotator-border)', borderRadius: 4, fontSize: 10,
                      color: 'var(--text2)', cursor: 'inherit' }}>
                      {importing ? '…' : <><Download size={10} /> HF</>}
                    </span>
                  </label>
                </div>

                {/* HF Hub import */}
                <div style={{ display: 'flex', gap: 4 }}>
                  <input value={hfRepo} onChange={e => setHfRepo(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !importing) importHfHub() }}
                    placeholder="owner/model (Hub)" disabled={importing}
                    style={{ flex: 1, minWidth: 0, padding: '4px 8px', background: 'var(--surface2)',
                      border: '1px solid var(--annotator-border)', borderRadius: 4, fontSize: 10,
                      color: 'var(--text)', outline: 'none' }} />
                  <button onClick={importHfHub} disabled={importing || !hfRepo.trim()}
                    style={{ padding: '4px 8px', background: 'var(--surface2)',
                      border: '1px solid var(--annotator-border)', borderRadius: 4, fontSize: 10,
                      color: 'var(--text2)', cursor: importing || !hfRepo.trim() ? 'default' : 'pointer',
                      opacity: importing || !hfRepo.trim() ? 0.5 : 1 }}>
                    <Download size={11} />
                  </button>
                </div>

                {/* Confidence slider */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 10, color: 'var(--text2)' }}>Confidence</span>
                    <span style={{ fontSize: 10, color: 'var(--text)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {Math.round(autoConf * 100)}%
                    </span>
                  </div>
                  <input type="range" min={0.05} max={0.95} step={0.05} value={autoConf}
                    onChange={e => setAutoConf(Number(e.target.value))}
                    style={{ width: '100%', cursor: 'pointer' }} />
                </div>

                {/* Action buttons */}
                {(() => {
                  const noModel = trainingRuns.length === 0 && externalModels.length === 0
                  const busy = autoLoading || batchProgress !== null
                  const targetCount = batchOnlyUnann ? images.filter(i => !i.annotated).length : images.length
                  return (
                    <>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={autoAnnotate} disabled={busy || !autoRunId || noModel}
                          title="Auto-annotate this image"
                          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: 4, padding: '5px 0', background: 'var(--annotator-accent)',
                            border: '1px solid var(--annotator-accent)', borderRadius: 4, color: '#fff',
                            fontSize: 11, fontFamily: 'inherit',
                            cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>
                          {autoLoading ? 'Running…' : <><Zap size={12} /> This</>}
                        </button>
                        <button onClick={autoAnnotateAll} disabled={busy || !autoRunId || noModel}
                          title="Auto-annotate all images"
                          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: 4, padding: '5px 0', background: 'var(--surface2)',
                            border: '1px solid var(--annotator-accent)', borderRadius: 4, color: 'var(--annotator-accent)',
                            fontSize: 11, fontFamily: 'inherit',
                            cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>
                          <Zap size={12} /> All ({targetCount})
                        </button>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5,
                        fontSize: 10, color: 'var(--text2)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={batchOnlyUnann}
                          disabled={busy}
                          onChange={e => setBatchOnlyUnann(e.target.checked)} />
                        Skip annotated
                      </label>
                      {batchProgress && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ background: 'var(--surface2)', borderRadius: 99, height: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', background: 'var(--annotator-accent)',
                              width: `${Math.round(batchProgress.done / batchProgress.total * 100)}%`,
                              transition: 'width 0.2s', borderRadius: 99 }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 10, color: 'var(--text2)' }}>
                              {batchProgress.done}/{batchProgress.total}
                            </span>
                            <button onClick={() => { batchCancelRef.current = true }}
                              style={{ fontSize: 9, padding: '1px 6px', background: 'transparent',
                                border: '1px solid var(--annotator-border)', borderRadius: 3,
                                color: 'var(--text2)', cursor: 'pointer' }}>Stop</button>
                          </div>
                        </div>
                      )}
                    </>
                  )
                })()}
                {autoMsg && (
                  <p style={{ fontSize: 10, margin: 0, lineHeight: 1.3,
                    color: autoMsg.ok ? 'var(--success)' : '#f97316' }}>
                    {autoMsg.text}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Panel toggle */}
        <button onClick={() => setRightPanelOpen(p => !p)}
          title={rightPanelOpen ? 'Collapse panel' : 'Expand panel'}
          style={{
            position: 'absolute', right: rightPanelOpen ? 240 : 0, top: 52,
            zIndex: 10, width: 20, height: 40, borderRadius: '4px 0 0 4px',
            border: '1px solid var(--annotator-border)', borderRight: 'none',
            background: 'var(--surface)', color: 'var(--text3)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'right 0.2s ease',
          }}>
          {rightPanelOpen ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </div>
    </div>
  )
}

// ─── Tool definitions ────────────────────────────────────────────────────────
const TOOLS: { id: Tool; label: string; hint?: string; icon: React.ReactNode }[] = [
  { id: 'select',  label: 'Select',   hint: '1', icon: <MousePointer2 size={16}/> },
  { id: 'bbox',    label: 'Rect',     hint: '2', icon: <Square size={16}/> },
  { id: 'polygon', label: 'Polygon',  hint: '3', icon: <Hexagon size={16}/> },
  { id: 'point',   label: 'Point',    hint: '4', icon: <Crosshair size={16}/> },
  { id: 'sam',     label: 'SAM',   hint: '5', icon: <Sparkles size={16}/> },
]

const HANDLE_CURSORS: Record<string, string> = {
  tl:'nwse-resize', tr:'nesw-resize', bl:'nesw-resize', br:'nwse-resize',
  tc:'ns-resize',   bc:'ns-resize',   ml:'ew-resize',   mr:'ew-resize',
}

// ─── Canvas drawing helpers ──────────────────────────────────────────────────
function drawLabel(ctx: CanvasRenderingContext2D, text: string, color: string, x: number, y: number, zoom: number) {
  ctx.font = `${12 / zoom}px system-ui`
  const tw = ctx.measureText(text).width
  ctx.fillStyle = color
  ctx.fillRect(x, y - 18 / zoom, tw + 8 / zoom, 18 / zoom)
  ctx.fillStyle = '#fff'
  ctx.fillText(text, x + 4 / zoom, y - 5 / zoom)
}

function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke: string) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle   = fill;   ctx.fill()
  ctx.strokeStyle = stroke; ctx.stroke()
}

function drawBBoxHandles(ctx: CanvasRenderingContext2D, s: BBoxShape, cw: number, ch: number, zoom: number, color: string, hSz: number) {
  const handles: [number,number][] = [
    [s.x,s.y], [s.x+s.w/2,s.y], [s.x+s.w,s.y],
    [s.x,s.y+s.h/2],             [s.x+s.w,s.y+s.h/2],
    [s.x,s.y+s.h], [s.x+s.w/2,s.y+s.h], [s.x+s.w,s.y+s.h],
  ]
  handles.forEach(([nx, ny]) => {
    ctx.fillStyle   = '#fff'
    ctx.fillRect(nx*cw - hSz/2, ny*ch - hSz/2, hSz, hSz)
    ctx.strokeStyle = color; ctx.lineWidth = 1.5 / zoom
    ctx.strokeRect(nx*cw - hSz/2, ny*ch - hSz/2, hSz, hSz)
  })
}

function applyBboxHandle(orig: BBoxShape, h: string, dx: number, dy: number): BBoxShape {
  let { x, y, w, h: bh } = orig
  if (h.includes('l')) { x += dx; w -= dx }
  if (h.includes('r')) { w += dx }
  if (h.includes('t')) { y += dy; bh -= dy }
  if (h.includes('b')) { bh += dy }
  return { ...orig, x: Math.max(0, Math.min(x, x+w)), y: Math.max(0, Math.min(y, y+bh)), w: Math.abs(w), h: Math.abs(bh) }
}

function willSnapClose(
  pts: [number,number][],
  mouse: [number,number],
  cw: number, ch: number,
  zoom: number,
  pan: { x: number; y: number }
): boolean {
  if (pts.length < 3) return false
  const [fpx, fpy] = pts[0]
  const screenFx = fpx * cw * zoom + pan.x
  const screenFy = fpy * ch * zoom + pan.y
  const screenMx = mouse[0] * cw * zoom + pan.x
  const screenMy = mouse[1] * ch * zoom + pan.y
  return Math.hypot(screenMx - screenFx, screenMy - screenFy) < SNAP_PX
}
