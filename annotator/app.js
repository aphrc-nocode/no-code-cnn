// ===== Visual Dataset Annotator JavaScript logic =====

// Parse URL Parameters
const urlParams = new URLSearchParams(window.location.search);
const projectId = urlParams.get('project_id');
const imageIdParam = urlParams.get('image_id');

// State Variables
let project = null;
let images = [];
let currentIdx = 0;
let shapes = [];
let selectedIndex = null;
let tool = 'bbox'; // select | bbox | polygon
let activeClass = 0;
let zoom = 1;
let pan = { x: 0, y: 0 };
let isSaved = true;

// Drawing state
let polyPts = []; // In-progress polygon vertices [ [nx, ny], ... ]
let mousePos = null; // Live normalized mouse position [ nx, ny ]
let liveBbox = null; // Live bounding box being drawn
let samSession = null;
let samLoading = false; // Live bounding box being drawn

// Undo / Redo stacks
let historyStack = [];
let historyIndex = -1;

// Drag state
let drag = { kind: 'none' };
let spaceHeld = false;

// DOM Elements
const imageNameEl = document.getElementById('imageName');
const imageCounterEl = document.getElementById('imageCounter');
const classListEl = document.getElementById('classList');
const annotationsContainerEl = document.getElementById('annotationsContainer');
const annCountEl = document.getElementById('annCount');
const clearAllAnnotationsBtn = document.getElementById('clearAllAnnotations');
const saveBtn = document.getElementById('saveBtn');
const saveBtnText = document.getElementById('saveBtnText');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const copyPrevBtn = document.getElementById('copyPrevBtn');
const prevImageBtn = document.getElementById('prevImage');
const nextImageBtn = document.getElementById('nextImage');

// Canvas
const canvas = document.getElementById('annotationCanvas');
const ctx = canvas.getContext('2d');
const canvasWrapper = document.getElementById('canvasWrapper');

// Overlays & Hints
const polyHintEl = document.getElementById('polyHint');
const polyHintTextEl = document.getElementById('polyHintText');
const classifHintEl = document.getElementById('classifHint');
const classificationSelectorSection = document.getElementById('classificationSelectorSection');
const imageClassSelectorEl = document.getElementById('imageClassSelector');
const annotationsListSection = document.getElementById('annotationsListSection');
const toolsContainer = document.getElementById('toolsContainer');

// Drawing Mode Tool buttons
const toolSelectBtn = document.getElementById('toolSelect');
const toolBBoxBtn = document.getElementById('toolBBox');
const toolPolygonBtn = document.getElementById('toolPolygon');
const toolPointBtn = document.getElementById('toolPoint');
const toolSamBtn = document.getElementById('toolSam');
const toolPanBtn = document.getElementById('toolPan');

// Sidebar toggle
const sidebarPanel = document.getElementById('sidebarPanel');
const panelToggleBtn = document.getElementById('panelToggleBtn');

// Upload Overlay
const uploadOverlay = document.getElementById('uploadOverlay');
const uploadBox = document.getElementById('uploadBox');
const fileInput = document.getElementById('fileInput');
const uploadProgressContainer = document.getElementById('uploadProgressContainer');
const uploadProgressFill = document.getElementById('uploadProgressFill');
const uploadProgressText = document.getElementById('uploadProgressText');

// Gallery & Views Selectors
let currentView = 'gallery'; // 'gallery' or 'editor'
let galleryFilter = 'all'; // 'all', 'annotated', 'unannotated'

const galleryView = document.getElementById('galleryView');
const editorView = document.getElementById('editorView');
const galleryGrid = document.getElementById('galleryGrid');
const galleryEmptyState = document.getElementById('galleryEmptyState');
const gallerySearchInput = document.getElementById('gallerySearchInput');
const galleryProjectTitle = document.getElementById('galleryProjectTitle');

const filterAllBtn = document.getElementById('filterAllBtn');
const filterAnnotatedBtn = document.getElementById('filterAnnotatedBtn');
const filterUnannotatedBtn = document.getElementById('filterUnannotatedBtn');

const galleryBackToWorkflowBtn = document.getElementById('galleryBackToWorkflow');
const editorBackToGalleryBtn = document.getElementById('editorBackToGallery');
const galleryUploadBtn = document.getElementById('galleryUploadBtn');
const galleryExportBtn = document.getElementById('galleryExportBtn');

// Export Modal Selectors
const exportBtn = document.getElementById('exportBtn');
const exportDatasetOverlay = document.getElementById('exportDatasetOverlay');
const closeExportOverlayBtn = document.getElementById('closeExportOverlayBtn');
const exportDatasetNameInput = document.getElementById('exportDatasetNameInput');
const exportDatasetVersionInput = document.getElementById('exportDatasetVersionInput');
const saveToDatasetsBtn = document.getElementById('saveToDatasetsBtn');
const downloadZipBtn = document.getElementById('downloadZipBtn');

// Image object cached
let currentImg = null;

// Constants
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#a855f7', '#ec4899'];
function getClassColor(classIdx) {
  if (!project || !project.classes) return COLORS[classIdx % COLORS.length];
  const className = project.classes[classIdx];
  if (project.class_colors && project.class_colors[className]) {
    return project.class_colors[className];
  }
  return COLORS[classIdx % COLORS.length];
}
const H = 7;        // handle size in canvas coordinates (draw size)
const SNAP_PX = 14;  // snap distance in screen px
const HANDLE_CURSORS = {
  tl: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', br: 'nwse-resize',
  tc: 'ns-resize',   bc: 'ns-resize',   ml: 'ew-resize',   mr: 'ew-resize'
};

const projectSelectorOverlay = document.getElementById('projectSelectorOverlay');
const projectSelectDropdown = document.getElementById('projectSelectDropdown');
const confirmProjectBtn = document.getElementById('confirmProjectBtn');

// ─── Initializing & Routing ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!projectId) {
    // Hide main uploader overlay if it was default-displayed
    uploadOverlay.classList.remove('active');
    
    // Show select project selector overlay
    showProjectSelector();
    return;
  }
  
  // Hide project selector overlay if active
  projectSelectorOverlay.style.display = 'none';

  // Setup Sidebar collapse handler
  panelToggleBtn.addEventListener('click', () => {
    const isCollapsed = sidebarPanel.classList.toggle('collapsed');
    panelToggleBtn.classList.toggle('collapsed');
    const container = document.getElementById('panelToggleIconContainer');
    if (isCollapsed) {
      container.innerHTML = '<i data-lucide="chevron-left"></i>';
    } else {
      container.innerHTML = '<i data-lucide="chevron-right"></i>';
    }
    lucide.createIcons();
  });

  // Setup Event Listeners
  setupCanvasEvents();
  setupUIEvents();
  setupKeyboardShortcuts();

  // Handle window resizing
  window.addEventListener('resize', () => {
    if (currentImg) {
      fitToContainer();
      draw();
    }
  });

  // Load project metadata and then images list
  await loadProject();
});

// Load project info
async function loadProject() {
  try {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) throw new Error("Failed to load project details");
    project = await res.json();
    
    // Set document title
    document.title = `Annotator - ${project.name}`;
    
    // Default class label mapping
    if (!project.classes || project.classes.length === 0) {
      project.classes = ['class0'];
      // Save it back to project manager so classes can be persisted
      await saveProjectClasses(project.classes);
    }
    
    // Filter tools and UI layout based on task type and annotation type
    const task = project.task_type || '';
    const annType = project.annotation_type || 'bbox';

    // Show/hide tool buttons based on configuration
    toolBBoxBtn.style.display = (task === 'object_detection' && annType === 'bbox') ? 'inline-block' : 'none';
    toolPointBtn.style.display = (task === 'object_detection' && annType === 'point') ? 'inline-block' : 'none';
    toolPolygonBtn.style.display = (task === 'image_segmentation') ? 'inline-block' : 'none';
    toolSamBtn.style.display = (task === 'image_segmentation') ? 'inline-block' : 'none';

    if (task === 'image_classification') {
      // Classification configuration
      tool = 'select'; // no shapes drawn
      toolsContainer.style.display = 'none';
      annotationsListSection.style.display = 'none';
      classificationSelectorSection.style.display = 'block';
      classifHintEl.style.display = 'flex';
      
      // Update Legend Shortcuts for classification
      document.getElementById('shortcutsLegend').innerHTML = `
        <kbd>Space+Drag</kbd> Pan · 
        <kbd>Scroll</kbd> Zoom ·
        Click sidebar classes to label image.
      `;
    } else {
      toolsContainer.style.display = 'flex';
      annotationsListSection.style.display = 'flex';
      classificationSelectorSection.style.display = 'none';
      classifHintEl.style.display = 'none';

      // Set default active tool
      if (task === 'object_detection') {
        tool = (annType === 'point') ? 'point' : 'bbox';
      } else if (task === 'image_segmentation') {
        tool = 'polygon';
      } else {
        tool = 'select';
      }
      updateToolButtons();
    }

    renderClasses();
    await loadImages();
  } catch (err) {
    console.error(err);
    imageNameEl.textContent = "Error loading project.";
  }
}

async function saveProjectClasses(classesList) {
  try {
    await fetch(`/api/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...project,
        classes: classesList
      })
    });
  } catch (err) {
    console.error("Failed to save default project classes:", err);
  }
}

// Load project images list
async function loadImages() {
  try {
    const res = await fetch(`/api/projects/${projectId}/images`);
    if (!res.ok) throw new Error("Failed to load images");
    images = await res.json();

    if (galleryProjectTitle && project) {
      galleryProjectTitle.textContent = `${project.name} Gallery`;
    }

    if (images.length === 0) {
      // Show upload overlay
      uploadOverlay.classList.add('active');
      imageNameEl.textContent = `No images in ${project.name}`;
      imageCounterEl.textContent = "0/0";
      return;
    } else {
      uploadOverlay.classList.remove('active');
    }

    // Determine starting index
    if (imageIdParam) {
      const idx = images.findIndex(img => img.id == imageIdParam);
      currentIdx = idx >= 0 ? idx : 0;
    } else {
      currentIdx = 0;
    }

    // Toggle copyPrevBtn visibility
    if (currentIdx > 0) {
      copyPrevBtn.style.display = 'flex';
    } else {
      copyPrevBtn.style.display = 'none';
    }

    await loadImageIndex(currentIdx);
    
    // Switch views depending on parameters
    if (imageIdParam) {
      switchView('editor');
    } else {
      switchView('gallery');
    }
  } catch (err) {
    console.error(err);
    imageNameEl.textContent = "Error loading images list.";
  }
}

// Load a specific image and its annotations
async function loadImageIndex(idx) {
  currentIdx = idx;
  const currentImage = images[currentIdx];
  if (!currentImage) return;

  // Toggle prev/next image button disabled status
  prevImageBtn.disabled = currentIdx === 0;
  nextImageBtn.disabled = currentIdx === images.length - 1;
  copyPrevBtn.style.display = currentIdx > 0 ? 'flex' : 'none';

  imageNameEl.textContent = currentImage.original_name;
  imageCounterEl.textContent = `${currentIdx + 1}/${images.length}`;

  // Reset drawing states
  selectedIndex = null;
  polyPts = [];
  liveBbox = null;
  mousePos = null;
  samSession = null;
  samLoading = false;
  polyHintEl.style.display = 'none';
  setSavedStatus(true);

  // Load image annotations
  try {
    const res = await fetch(`/api/projects/${projectId}/images/${currentImage.id}/annotations`);
    if (res.ok) {
      const apiAnns = await res.json();
      shapes = apiAnns.map(apiToShape);
      
      // Update classification selections in UI
      if (project.task_type === 'image_classification') {
        updateClassificationSidebar();
      }
      
      // Set undo history
      historyStack = [ JSON.parse(JSON.stringify(shapes)) ];
      historyIndex = 0;
      updateUndoRedoButtons();
    } else {
      shapes = [];
      historyStack = [[]];
      historyIndex = 0;
    }
  } catch (err) {
    console.error("Failed to load annotations:", err);
    shapes = [];
  }

  // Load Image file
  currentImg = new Image();
  currentImg.onload = () => {
    fitToContainer();
    draw();
  };
  currentImg.src = `/api/projects/${projectId}/images/${currentImage.id}/file`;
  
  renderAnnotationsList();
}

// ─── Format Converters ────────────────────────────────────────────────────────
function apiToShape(a) {
  if (a.shape_type === 'polygon') {
    return { type: 'polygon', class_id: a.class_id, pts: a.points };
  }
  if (a.shape_type === 'point') {
    return { type: 'point', class_id: a.class_id, x: a.points[0]?.[0] ?? 0, y: a.points[0]?.[1] ?? 0 };
  }
  if (a.shape_type === 'classification') {
    return { type: 'classification', class_id: a.class_id };
  }
  // BBox fallback
  return {
    type: 'bbox',
    class_id: a.class_id,
    x: a.x_center - a.width / 2,
    y: a.y_center - a.height / 2,
    w: a.width,
    h: a.height
  };
}

function shapeToApi(s) {
  if (s.type === 'polygon') {
    if (s.pts.length === 0) {
      return { class_id: s.class_id, shape_type: 'polygon', x_center: 0, y_center: 0, width: 0, height: 0, points: [] };
    }
    const xs = s.pts.map(p => p[0]);
    const ys = s.pts.map(p => p[1]);
    const x1 = Math.min(...xs), x2 = Math.max(...xs);
    const y1 = Math.min(...ys), y2 = Math.max(...ys);
    return {
      class_id: s.class_id,
      shape_type: 'polygon',
      x_center: (x1 + x2) / 2,
      y_center: (y1 + y2) / 2,
      width: x2 - x1,
      height: y2 - y1,
      points: s.pts
    };
  }
  if (s.type === 'point') {
    return { class_id: s.class_id, shape_type: 'point', x_center: 0, y_center: 0, width: 0, height: 0, points: [[s.x, s.y]] };
  }
  if (s.type === 'classification') {
    return { class_id: s.class_id, shape_type: 'classification', x_center: 0, y_center: 0, width: 0, height: 0, points: [] };
  }
  // BBox fallback
  return {
    class_id: s.class_id,
    shape_type: 'bbox',
    x_center: s.x + s.w / 2,
    y_center: s.y + s.h / 2,
    width: s.w,
    height: s.h,
    points: []
  };
}

// ─── Undo / Redo History ─────────────────────────────────────────────────────
function snapshotHistory() {
  historyStack = historyStack.slice(0, historyIndex + 1);
  historyStack.push(JSON.parse(JSON.stringify(shapes)));
  historyIndex = historyStack.length - 1;
  updateUndoRedoButtons();
  setSavedStatus(false);
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    shapes = JSON.parse(JSON.stringify(historyStack[historyIndex]));
    selectedIndex = null;
    draw();
    renderAnnotationsList();
    updateUndoRedoButtons();
    setSavedStatus(false);
  }
}

function redo() {
  if (historyIndex < historyStack.length - 1) {
    historyIndex++;
    shapes = JSON.parse(JSON.stringify(historyStack[historyIndex]));
    selectedIndex = null;
    draw();
    renderAnnotationsList();
    updateUndoRedoButtons();
    setSavedStatus(false);
  }
}

function updateUndoRedoButtons() {
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= historyStack.length - 1;
}

function setSavedStatus(saved) {
  isSaved = saved;
  const container = document.getElementById('saveIconContainer');
  if (isSaved) {
    saveBtn.classList.add('saved');
    saveBtnText.textContent = "Saved";
    container.innerHTML = '<i data-lucide="check"></i>';
  } else {
    saveBtn.classList.remove('saved');
    saveBtnText.textContent = "Save";
    container.innerHTML = '<i data-lucide="save"></i>';
  }
  lucide.createIcons();
}

// ─── Canvas Positioning & Coordinate Conversion ──────────────────────────────
function fitToContainer() {
  if (!currentImg) return;
  const cw = canvasWrapper.clientWidth;
  const ch = canvasWrapper.clientHeight;
  const scale = Math.min((cw - 40) / currentImg.width, (ch - 40) / currentImg.height);
  
  canvas.width = currentImg.width * scale;
  canvas.height = currentImg.height * scale;
  zoom = 1;
  pan = { x: 0, y: 0 };
}

// Get raw canvas local pixels from Client Mouse event
function getCanvasPx(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    cx: (e.clientX - rect.left) * (canvas.width / rect.width),
    cy: (e.clientY - rect.top) * (canvas.height / rect.height)
  };
}

// Convert local client position to normalized coordinates [0..1]
function toNorm(e) {
  const { cx, cy } = getCanvasPx(e);
  return [
    (cx - pan.x) / (zoom * canvas.width),
    (cy - pan.y) / (zoom * canvas.height)
  ];
}

// Clamp coordinate
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Check if shape contains point
function hitShape(nx, ny) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.type === 'bbox') {
      if (nx >= s.x && nx <= s.x + s.w && ny >= s.y && ny <= s.y + s.h) {
        return i;
      }
    } else if (s.type === 'point') {
      const hx = 8 / (zoom * canvas.width) * 1.5;
      const hy = 8 / (zoom * canvas.height) * 1.5;
      if (Math.abs(nx - s.x) < hx && Math.abs(ny - s.y) < hy) {
        return i;
      }
    } else if (s.type === 'polygon') {
      if (pointInPolygon(nx, ny, s.pts)) {
        return i;
      }
    }
  }
  return null;
}

// Raycasting Point-in-polygon algorithm
function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Check polygon vertex handle clicks
function hitVertex(s, nx, ny) {
  const thresh = H / (zoom * canvas.width) * 2;
  return s.pts.findIndex(p => Math.hypot(nx - p[0], ny - p[1]) < thresh);
}

// Check Bbox handle clicks (8 points)
function hitBBoxHandle(s, nx, ny) {
  const hx = H / (zoom * canvas.width) * 1.6;
  const hy = H / (zoom * canvas.height) * 1.6;
  const handles = {
    tl: [s.x, s.y],
    tc: [s.x + s.w / 2, s.y],
    tr: [s.x + s.w, s.y],
    ml: [s.x, s.y + s.h / 2],
    mr: [s.x + s.w, s.y + s.h / 2],
    bl: [s.x, s.y + s.h],
    bc: [s.x + s.w / 2, s.y + s.h],
    br: [s.x + s.w, s.y + s.h]
  };
  for (const [hid, [hpx, hpy]] of Object.entries(handles)) {
    if (Math.abs(nx - hpx) < hx && Math.abs(ny - hpy) < hy) {
      return hid;
    }
  }
  return null;
}

// ─── Rendering Loop ──────────────────────────────────────────────────────────
function draw() {
  if (!currentImg) return;
  const cw = canvas.width;
  const ch = canvas.height;

  // Clear
  ctx.clearRect(0, 0, cw, ch);
  ctx.save();
  ctx.translate(pan.x, pan.y);
  ctx.scale(zoom, zoom);
  
  // Draw base image
  ctx.drawImage(currentImg, 0, 0, cw, ch);

  const cx = nx => nx * cw;
  const cy = ny => ny * ch;
  const hSz = H * 2 / zoom;

  // Draw saved shapes
  const allShapes = liveBbox ? [...shapes, liveBbox] : shapes;
  allShapes.forEach((s, idx) => {
    if (s.type === 'classification') return; // Image label: no shapes on screen
    
    const isSelected = selectedIndex === idx && tool === 'select';
    const color = getClassColor(s.class_id);
    
    ctx.strokeStyle = color;
    ctx.lineWidth = (isSelected ? 2.5 : 1.8) / zoom;

    if (s.type === 'bbox') {
      const px = cx(s.x);
      const py = cy(s.y);
      const pw = cx(s.w);
      const ph = cy(s.h);
      
      ctx.fillStyle = color + '25';
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeRect(px, py, pw, ph);
      
      // Draw tag text overlay
      drawLabelText(project.classes[s.class_id] || `cls${s.class_id}`, color, px, py, zoom);
      
      // Draw handles if selected
      if (isSelected) {
        drawBBoxHandles(s, cw, ch, zoom, color, hSz);
      }
    } else if (s.type === 'polygon') {
      if (s.pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(cx(s.pts[0][0]), cy(s.pts[0][1]));
      s.pts.slice(1).forEach(p => ctx.lineTo(cx(p[0]), cy(p[1])));
      ctx.closePath();
      
      ctx.fillStyle = color + '25';
      ctx.fill();
      ctx.stroke();

      drawLabelText(project.classes[s.class_id] || `cls${s.class_id}`, color, cx(s.pts[0][0]), cy(s.pts[0][1]), zoom);

      // Draw handles on vertices if selected
      if (isSelected) {
        s.pts.forEach(p => drawDot(cx(p[0]), cy(p[1]), H / zoom, '#ffffff', color));
      }
    } else if (s.type === 'point') {
      const r = 8 / zoom;
      ctx.fillStyle = color + '80';
      ctx.beginPath();
      ctx.arc(cx(s.x), cy(s.y), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      drawLabelText(project.classes[s.class_id] || `cls${s.class_id}`, color, cx(s.x) + r, cy(s.y) - r, zoom);

      if (isSelected) {
        drawDot(cx(s.x), cy(s.y), (H + 2) / zoom, 'transparent', '#ffffff');
      }
    }
  });

  // Draw SAM session query prompts
  if (tool === 'sam' && samSession) {
    if (samSession.box) {
      const [bx1, by1, bx2, by2] = samSession.box;
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2 / zoom;
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      ctx.strokeRect(cx(bx1), cy(by1), cx(bx2 - bx1), cy(by2 - by1));
      ctx.setLineDash([]);
    }
    if (Array.isArray(samSession.points)) {
      samSession.points.forEach((pt, idx) => {
        if (!pt || pt.length < 2) return;
        const [px, py] = pt;
        const isPositive = samSession.labels && samSession.labels[idx] === 1;
        const ptColor = isPositive ? '#22c55e' : '#ef4444';
        drawDot(cx(px), cy(py), 6 / zoom, ptColor, '#ffffff');
        
        // Draw crosshair ring
        ctx.beginPath();
        ctx.arc(cx(px), cy(py), 10 / zoom, 0, Math.PI * 2);
        ctx.strokeStyle = ptColor;
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();
      });
    }
  }

  // Draw in-progress polygon
  if (polyPts.length > 0) {
    const color = getClassColor(activeClass);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8 / zoom;
    ctx.setLineDash([6 / zoom, 3 / zoom]);
    ctx.beginPath();
    ctx.moveTo(cx(polyPts[0][0]), cy(polyPts[0][1]));
    polyPts.slice(1).forEach(p => ctx.lineTo(cx(p[0]), cy(p[1])));
    
    // Live preview segment to mouse
    if (mousePos) {
      ctx.lineTo(cx(mousePos[0]), cy(mousePos[1]));
    }
    ctx.stroke();
    ctx.setLineDash([]); // clear dash

    // Draw vertex dots
    polyPts.forEach((p, vi) => {
      const isFirst = vi === 0;
      if (isFirst && mousePos && willSnapClose(polyPts, mousePos, cw, ch, zoom, pan)) {
        // Snap highlight circle on first point
        ctx.beginPath();
        ctx.arc(cx(p[0]), cy(p[1]), (H + 4) / zoom, 0, Math.PI * 2);
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();
      }
      drawDot(cx(p[0]), cy(p[1]), H / zoom, isFirst ? color : '#ffffff', color);
    });
  }

  // Draw crosshair guide lines only when hovering (i.e. no active dragging/drawing and no polyPts)
  if (mousePos && (tool === 'bbox' || tool === 'polygon' || tool === 'point' || tool === 'sam') && drag.kind === 'none' && polyPts.length === 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'difference';
    ctx.beginPath();
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2 / zoom;
    
    const mx = cx(mousePos[0]);
    const my = cy(mousePos[1]);
    
    // Vertical line
    ctx.moveTo(mx, 0);
    ctx.lineTo(mx, ch);
    
    // Horizontal line
    ctx.moveTo(0, my);
    ctx.lineTo(cw, my);
    
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

function drawLabelText(text, color, x, y, z) {
  ctx.font = `${12 / z}px system-ui, -apple-system, sans-serif`;
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = color;
  ctx.fillRect(x, y - 18 / z, tw + 8 / z, 18 / z);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x + 4 / z, y - 5 / z);
}

function drawDot(x, y, r, fill, stroke) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawBBoxHandles(s, cw, ch, z, color, hSz) {
  const handles = [
    [s.x, s.y], [s.x + s.w/2, s.y], [s.x + s.w, s.y],
    [s.x, s.y + s.h/2],             [s.x + s.w, s.y + s.h/2],
    [s.x, s.y + s.h], [s.x + s.w/2, s.y + s.h], [s.x + s.w, s.y + s.h]
  ];
  handles.forEach(([nx, ny]) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(nx * cw - hSz / 2, ny * ch - hSz / 2, hSz, hSz);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 / z;
    ctx.strokeRect(nx * cw - hSz / 2, ny * ch - hSz / 2, hSz, hSz);
  });
}

function willSnapClose(pts, mouse, cw, ch, z, p) {
  if (pts.length < 3) return false;
  const [fpx, fpy] = pts[0];
  const screenFx = fpx * cw * z + p.x;
  const screenFy = fpy * ch * z + p.y;
  const screenMx = mouse[0] * cw * z + p.x;
  const screenMy = mouse[1] * ch * z + p.y;
  return Math.hypot(screenMx - screenFx, screenMy - screenFy) < SNAP_PX;
}

// ─── Canvas Interaction Events ───────────────────────────────────────────────
function setupCanvasEvents() {
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', () => {
    mousePos = null;
    if (drag.kind !== 'none') onMouseUp();
    draw();
  });
  // canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

function onMouseDown(e) {
  const { cx, cy } = getCanvasPx(e);
  const [nx, ny] = toNorm(e);
  console.log("onMouseDown: button =", e.button, "tool =", tool, "nx =", nx, "ny =", ny);

  // Pan action (Space + left click, middle click, right click, or Pan tool active)
  if (e.button === 1 || e.button === 2 || spaceHeld || tool === 'pan') {
    drag = {
      kind: 'pan',
      cx0: cx,
      cy0: cy,
      px0: pan.x,
      py0: pan.y
    };
    return;
  }
  if (e.button !== 0) return;

  // Polygon tool logic
  if (tool === 'polygon') {
    if (polyPts.length >= 3 && willSnapClose(polyPts, [nx, ny], canvas.width, canvas.height, zoom, pan)) {
      // Close polygon path
      shapes.push({
        type: 'polygon',
        class_id: activeClass,
        pts: [...polyPts]
      });
      polyPts = [];
      polyHintEl.style.display = 'none';
      snapshotHistory();
      renderAnnotationsList();
    } else {
      polyPts.push([nx, ny]);
      polyHintEl.style.display = 'flex';
      polyHintTextEl.textContent = `${polyPts.length} points - click first vertex to close path or double click`;
    }
    draw();
    return;
  }

  // Point tool logic
  if (tool === 'point') {
    shapes.push({
      type: 'point',
      class_id: activeClass,
      x: nx,
      y: ny
    });
    snapshotHistory();
    renderAnnotationsList();
    draw();
    return;
  }

  // SAM tool logic
  if (tool === 'sam') {
    const currentImage = images[currentIdx];
    if (samLoading || !currentImage) return;
    
    // Shift-click -> negative point click refinement
    if (e.shiftKey) {
      if (samSession) {
        samSession.points.push([nx, ny]);
        samSession.labels.push(0);
        runSam(samSession);
      } else {
        const ns = { points: [[nx, ny]], labels: [0], box: null, idx: -1 };
        samSession = ns;
        runSam(ns);
      }
      return;
    }
    
    // Regular left-click initiates bounding box drag or positive point selection
    drag = {
      kind: 'sam-box',
      start: [nx, ny]
    };
    liveBbox = null;
    return;
  }

  // BBox Drawing tool logic
  if (tool === 'bbox') {
    selectedIndex = null;
    drag = {
      kind: 'bbox-draw',
      start: [nx, ny]
    };
    liveBbox = null;
    return;
  }

  // Select tool interaction logic
  if (tool === 'select') {
    if (selectedIndex !== null) {
      const s = shapes[selectedIndex];
      // Check Bbox handle clicks
      if (s.type === 'bbox') {
        const hid = hitBBoxHandle(s, nx, ny);
        if (hid) {
          drag = {
            kind: 'bbox-handle',
            idx: selectedIndex,
            handle: hid,
            mx0: nx,
            my0: ny,
            orig: { ...s }
          };
          return;
        }
      }
      // Check Polygon vertex clicks
      if (s.type === 'polygon') {
        const vi = hitVertex(s, nx, ny);
        if (vi >= 0) {
          drag = {
            kind: 'move-vertex',
            idx: selectedIndex,
            vi,
            mx0: nx,
            my0: ny,
            orig: { ...s, pts: s.pts.map(p => [...p]) }
          };
          return;
        }
      }
    }

    // Try hit shape
    const hitIdx = hitShape(nx, ny);
    selectAnnotation(hitIdx);
    if (hitIdx !== null) {
      drag = {
        kind: 'move-shape',
        idx: hitIdx,
        mx0: nx,
        my0: ny,
        orig: shapes[hitIdx].type === 'polygon' 
          ? { ...shapes[hitIdx], pts: shapes[hitIdx].pts.map(p => [...p]) }
          : { ...shapes[hitIdx] }
      };
    } else {
      drag = { kind: 'none' };
    }
    draw();
  }
}

function onMouseMove(e) {
  const { cx, cy } = getCanvasPx(e);
  const [nx, ny] = toNorm(e);
  mousePos = [nx, ny];

  // Update cursor shapes depending on hover target
  if (canvas) canvas.style.cursor = computeCursor(e, nx, ny);

  if (drag.kind === 'pan') {
    pan = {
      x: drag.px0 + (cx - drag.cx0),
      y: drag.py0 + (cy - drag.cy0)
    };
    draw();
    return;
  }

  if (drag.kind === 'bbox-draw') {
    const x = Math.min(drag.start[0], nx);
    const y = Math.min(drag.start[1], ny);
    liveBbox = {
      type: 'bbox',
      class_id: activeClass,
      x,
      y,
      w: Math.abs(nx - drag.start[0]),
      h: Math.abs(ny - drag.start[1])
    };
    draw();
    return;
  }

  if (drag.kind === 'move-shape') {
    const dx = nx - drag.mx0;
    const dy = ny - drag.my0;
    const s = shapes[drag.idx];
    
    if (s.type === 'bbox') {
      s.x = clamp(drag.orig.x + dx, 0, 1 - s.w);
      s.y = clamp(drag.orig.y + dy, 0, 1 - s.h);
    } else if (s.type === 'point') {
      s.x = clamp(drag.orig.x + dx, 0, 1);
      s.y = clamp(drag.orig.y + dy, 0, 1);
    } else if (s.type === 'polygon') {
      s.pts = drag.orig.pts.map(p => [
        clamp(p[0] + dx, 0, 1),
        clamp(p[1] + dy, 0, 1)
      ]);
    }
    draw();
    return;
  }

  if (drag.kind === 'sam-box') {
    const x = Math.min(drag.start[0], nx);
    const y = Math.min(drag.start[1], ny);
    liveBbox = {
      type: 'bbox',
      class_id: activeClass,
      x,
      y,
      w: Math.abs(nx - drag.start[0]),
      h: Math.abs(ny - drag.start[1])
    };
    draw();
    return;
  }

  if (drag.kind === 'move-vertex') {
    const dx = nx - drag.mx0;
    const dy = ny - drag.my0;
    const s = shapes[drag.idx];
    s.pts[drag.vi] = [
      clamp(drag.orig.pts[drag.vi][0] + dx, 0, 1),
      clamp(drag.orig.pts[drag.vi][1] + dy, 0, 1)
    ];
    draw();
    return;
  }

  if (drag.kind === 'bbox-handle') {
    const dx = nx - drag.mx0;
    const dy = ny - drag.my0;
    shapes[drag.idx] = resizeBBox(drag.orig, drag.handle, dx, dy);
    draw();
    return;
  }

  // Redraw canvas during hover to position guidelines dynamically
  if (drag.kind === 'none' && (tool === 'bbox' || tool === 'polygon' || tool === 'point' || tool === 'sam')) {
    draw();
  }
}

function onMouseUp() {
  const prevDrag = { ...drag };
  const prevKind = drag.kind;
  drag = { kind: 'none' };
  
  if (prevKind === 'bbox-draw' && liveBbox && liveBbox.w > 0.01 && liveBbox.h > 0.01) {
    shapes.push(liveBbox);
    selectedIndex = shapes.length - 1;
    snapshotHistory();
    renderAnnotationsList();
  } else if (prevKind === 'sam-box') {
    const isDrag = liveBbox && liveBbox.w > 0.02 && liveBbox.h > 0.02;
    if (isDrag && liveBbox) {
      // Bounding box query
      const ns = {
        points: [],
        labels: [],
        box: [liveBbox.x, liveBbox.y, liveBbox.x + liveBbox.w, liveBbox.y + liveBbox.h],
        idx: samSession ? samSession.idx : -1
      };
      samSession = ns;
      runSam(ns);
    } else {
      // Single positive point click query
      const p = prevDrag.start;
      if (samSession) {
        samSession.points.push(p);
        samSession.labels.push(1);
        runSam(samSession);
      } else {
        const ns = { points: [p], labels: [1], box: null, idx: -1 };
        samSession = ns;
        runSam(ns);
      }
    }
  } else if (prevKind === 'move-shape' || prevKind === 'move-vertex' || prevKind === 'bbox-handle') {
    snapshotHistory();
  }
  
  liveBbox = null;
  draw();
}

function onDblClick() {
  if (tool === 'polygon' && polyPts.length >= 3) {
    shapes.push({
      type: 'polygon',
      class_id: activeClass,
      pts: [...polyPts]
    });
    polyPts = [];
    polyHintEl.style.display = 'none';
    snapshotHistory();
    renderAnnotationsList();
    draw();
  }
}

function onWheel(e) {
  e.preventDefault();
  const { cx, cy } = getCanvasPx(e);
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const newZoom = clamp(zoom * factor, 0.15, 15);
  
  pan = {
    x: cx - (cx - pan.x) * newZoom / zoom,
    y: cy - (cy - pan.y) * newZoom / zoom
  };
  zoom = newZoom;
  document.getElementById('zoomLabel').textContent = `${Math.round(zoom * 100)}%`;
  draw();
}

function computeCursor(e, nx, ny) {
  if (drag.kind === 'pan') return 'grabbing';
  if (spaceHeld || tool === 'pan') return 'grab';
  if (tool === 'bbox' || tool === 'polygon') return 'crosshair';
  
  if (selectedIndex !== null) {
    const s = shapes[selectedIndex];
    if (s.type === 'bbox') {
      const h = hitBBoxHandle(s, nx, ny);
      if (h) return HANDLE_CURSORS[h] || 'pointer';
    }
    if (s.type === 'polygon') {
      const vi = hitVertex(s, nx, ny);
      if (vi >= 0) return 'crosshair';
    }
  }
  
  return hitShape(nx, ny) !== null ? 'move' : 'default';
}

function resizeBBox(orig, handle, dx, dy) {
  let { x, y, w, h } = orig;
  if (handle.includes('l')) { x += dx; w -= dx; }
  if (handle.includes('r')) { w += dx; }
  if (handle.includes('t')) { y += dy; h -= dy; }
  if (handle.includes('b')) { h += dy; }
  return {
    ...orig,
    x: clamp(Math.max(0, Math.min(x, x + w)), 0, 1),
    y: clamp(Math.max(0, Math.min(y, y + h)), 0, 1),
    w: Math.abs(w),
    h: Math.abs(h)
  };
}

// ─── Keyboard Shortcuts ──────────────────────────────────────────────────────
function setupKeyboardShortcuts() {
  window.addEventListener('keydown', e => {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
      return;
    }
    
    if (e.code === 'Space') {
      spaceHeld = true;
      e.preventDefault();
    }
    
    if (e.key === 'Escape') {
      polyPts = [];
      liveBbox = null;
      selectedIndex = null;
      samSession = null;
      samLoading = false;
      polyHintEl.style.display = 'none';
      draw();
      renderAnnotationsList();
    }

    if (e.key === 'Enter') {
      // Save changes shortcut
      e.preventDefault();
      save();
    }
    
    // Deleting selected shapes
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIndex !== null) {
      shapes.splice(selectedIndex, 1);
      selectedIndex = null;
      snapshotHistory();
      renderAnnotationsList();
      draw();
    }

    // Toggle tools
    const task = project ? project.task_type : '';
    const annType = project ? (project.annotation_type || 'bbox') : 'bbox';
    if (task !== 'image_classification') {
      if (e.key === '1') setTool('select');
      if (e.key === '2' && task === 'object_detection' && annType === 'bbox') setTool('bbox');
      if (e.key === '3' && task === 'image_segmentation') setTool('polygon');
      if (e.key === '4' && task === 'object_detection' && annType === 'point') setTool('point');
      if (e.key === '5' && task === 'image_segmentation') setTool('sam');
      if (e.key === '6') setTool('pan');
    }

    // Undo / Redo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }

    // Duplicate selected shape
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedIndex !== null) {
      e.preventDefault();
      const s = shapes[selectedIndex];
      let dup = null;
      if (s.type === 'bbox') {
        dup = { ...s, x: Math.min(s.x + 0.02, 1 - s.w), y: Math.min(s.y + 0.02, 1 - s.h) };
      } else if (s.type === 'point') {
        dup = { ...s, x: Math.min(s.x + 0.02, 1), y: Math.min(s.y + 0.02, 1) };
      } else if (s.type === 'polygon') {
        dup = { ...s, pts: s.pts.map(p => [Math.min(p[0] + 0.02, 1), Math.min(p[1] + 0.02, 1)]) };
      }
      if (dup) {
        shapes.push(dup);
        selectedIndex = shapes.length - 1;
        snapshotHistory();
        renderAnnotationsList();
        draw();
      }
    }
  });

  window.addEventListener('keyup', e => {
    if (e.code === 'Space') {
      spaceHeld = false;
    }
  });
}

// Set Active Tool Mode
function setTool(t) {
  tool = t;
  polyPts = [];
  liveBbox = null;
  polyHintEl.style.display = 'none';
  updateToolButtons();
  draw();
}

function updateToolButtons() {
  if (project && project.task_type === 'image_classification') return;
  
  toolSelectBtn.classList.toggle('active', tool === 'select');
  toolBBoxBtn.classList.toggle('active', tool === 'bbox');
  toolPolygonBtn.classList.toggle('active', tool === 'polygon');
  if (toolPointBtn) toolPointBtn.classList.toggle('active', tool === 'point');
  if (toolSamBtn) toolSamBtn.classList.toggle('active', tool === 'sam');
  if (toolPanBtn) toolPanBtn.classList.toggle('active', tool === 'pan');
}

// ─── Right Panel Renderers ───────────────────────────────────────────────────

// Classes lists in Sidebar
function renderClasses() {
  if (!project) return;
  classListEl.innerHTML = '';
  
  project.classes.forEach((c, idx) => {
    const color = getClassColor(idx);
    const btn = document.createElement('button');
    btn.className = `class-btn ${activeClass === idx ? 'active' : ''}`;
    btn.innerHTML = `
      <span class="class-dot" style="background: ${color}"></span>
      <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${c}</span>
      <span class="class-btn-actions">
        <span class="class-edit-btn" title="Rename Class"><i data-lucide="edit-2" style="width: 10px; height: 10px;"></i></span>
        <span class="class-delete-btn" title="Delete Class"><i data-lucide="trash-2" style="width: 10px; height: 10px;"></i></span>
      </span>
    `;
    
    // Select class on clicking name/dot
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.class-btn-actions')) return;
      
      activeClass = idx;
      renderClasses();
      
      // For classification task, clicking active class sets image tag immediately!
      if (project.task_type === 'image_classification') {
        setImageClassificationTag(idx);
      }
    });

    // Rename class click handler
    btn.querySelector('.class-edit-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const newName = prompt(`Rename class "${c}" to:`, c);
      if (newName && newName.trim()) {
        const cleaned = newName.trim();
        if (project.classes.includes(cleaned) && cleaned !== c) {
          alert("This class name already exists.");
          return;
        }
        project.classes[idx] = cleaned;
        await saveProjectClasses(project.classes);
        renderClasses();
        if (project.task_type === 'image_classification') {
          updateClassificationSidebar();
        } else {
          renderAnnotationsList();
          draw();
        }
      }
    });

    // Delete class click handler
    btn.querySelector('.class-delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (project.classes.length <= 1) {
        alert("A project must have at least one class label.");
        return;
      }
      if (confirm(`Delete class "${c}"? Existing shape annotations linked to this class index will be preserved but index color mapping will shift.`)) {
        project.classes.splice(idx, 1);
        await saveProjectClasses(project.classes);
        if (activeClass >= project.classes.length) {
          activeClass = project.classes.length - 1;
        }
        renderClasses();
        if (project.task_type === 'image_classification') {
          updateClassificationSidebar();
        } else {
          renderAnnotationsList();
          draw();
        }
      }
    });

    classListEl.appendChild(btn);
  });
  
  if (window.lucide) {
    lucide.createIcons();
  }
}

// Render list of shapes
function renderAnnotationsList() {
  annCountEl.textContent = shapes.length;
  annotationsContainerEl.innerHTML = '';

  if (shapes.length === 0) {
    annotationsContainerEl.innerHTML = '<p class="empty-ann-text">No annotations yet</p>';
    return;
  }

  shapes.forEach((s, idx) => {
    const isSelected = selectedIndex === idx;
    const color = getClassColor(s.class_id);
    
    // Select Icon based on shape
    let iconName = 'square';
    if (s.type === 'polygon') iconName = 'hexagon';
    if (s.type === 'point') iconName = 'crosshair';
    
    const div = document.createElement('div');
    div.className = `ann-item ${isSelected ? 'selected' : ''}`;
    div.innerHTML = `
      <div class="ann-item-left">
        <span class="class-dot" style="background: ${color}"></span>
        <span class="ann-item-icon"><i data-lucide="${iconName}" style="width: 11px; height: 11px;"></i></span>
        <span class="ann-item-label">${project.classes[s.class_id]}</span>
      </div>
      <div class="ann-item-actions">
        <button class="ann-mini-btn dupe-ann-btn" title="Duplicate shape"><i data-lucide="copy" style="width: 10px; height: 10px;"></i></button>
        <button class="ann-mini-btn delete-ann-btn danger" title="Delete shape"><i data-lucide="trash-2" style="width: 10px; height: 10px;"></i></button>
      </div>
    `;

    // Click to select annotation
    div.addEventListener('click', () => {
      selectAnnotation(idx);
    });

    // Duplicate action
    div.querySelector('.dupe-ann-btn').addEventListener('click', e => {
      e.stopPropagation();
      let dup = null;
      if (s.type === 'bbox') {
        dup = { ...s, x: Math.min(s.x + 0.02, 1 - s.w), y: Math.min(s.y + 0.02, 1 - s.h) };
      } else if (s.type === 'point') {
        dup = { ...s, x: Math.min(s.x + 0.02, 1), y: Math.min(s.y + 0.02, 1) };
      } else if (s.type === 'polygon') {
        dup = { ...s, pts: s.pts.map(p => [Math.min(p[0] + 0.02, 1), Math.min(p[1] + 0.02, 1)]) };
      }
      if (dup) {
        shapes.push(dup);
        selectedIndex = shapes.length - 1;
        snapshotHistory();
        renderAnnotationsList();
        draw();
      }
    });

    // Delete action
    div.querySelector('.delete-ann-btn').addEventListener('click', e => {
      e.stopPropagation();
      shapes.splice(idx, 1);
      selectedIndex = null;
      snapshotHistory();
      renderAnnotationsList();
      draw();
    });

    annotationsContainerEl.appendChild(div);
  });

  lucide.createIcons();
}

function selectAnnotation(idx) {
  selectedIndex = idx;
  if (idx !== null) {
    tool = 'select';
    updateToolButtons();
  }
  renderAnnotationsList();
  draw();
}

// ─── Classification Task-Specific Tagging Logic ──────────────────────────────
function updateClassificationSidebar() {
  imageClassSelectorEl.innerHTML = '';
  
  // Find classification tag in shapes list
  const tagAnn = shapes.find(s => s.type === 'classification');
  const taggedClassId = tagAnn ? tagAnn.class_id : null;

  project.classes.forEach((c, idx) => {
    const isSelected = taggedClassId === idx;
    const option = document.createElement('div');
    option.className = `image-class-option ${isSelected ? 'selected' : ''}`;
    option.innerHTML = `
      <input type="radio" name="imageClass" ${isSelected ? 'checked' : ''} style="margin: 0; cursor: pointer;" />
      <span>${c}</span>
    `;
    option.addEventListener('click', () => {
      setImageClassificationTag(idx);
    });
    imageClassSelectorEl.appendChild(option);
  });
}

function setImageClassificationTag(classId) {
  // Classification contains exactly one classification shape
  shapes = [{
    type: 'classification',
    class_id: classId
  }];
  
  if (project.task_type === 'image_classification') {
    updateClassificationSidebar();
  }
  
  snapshotHistory();
}

// ─── Save / Navigation & API Operations ──────────────────────────────────────
async function save() {
  const currentImage = images[currentIdx];
  if (!currentImage) return;

  const apiShapes = shapes.map(shapeToApi);
  try {
    const res = await fetch(`/api/projects/${projectId}/images/${currentImage.id}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiShapes)
    });
    
    if (res.ok) {
      setSavedStatus(true);
      // Update image annotated status in client list
      currentImage.annotated = shapes.length > 0;
    } else {
      alert("Failed to save annotations.");
    }
  } catch (err) {
    console.error("Save API failed:", err);
    alert("Error connecting to server to save changes.");
  }
}

async function copyFromPrevious() {
  if (currentIdx === 0) return;
  const prevImg = images[currentIdx - 1];
  if (!prevImg) return;

  try {
    const res = await fetch(`/api/projects/${projectId}/images/${prevImg.id}/annotations`);
    if (!res.ok) throw new Error("Failed to load previous annotations");
    const prevAnns = await res.json();
    const copiedShapes = prevAnns.map(apiToShape);
    
    if (copiedShapes.length > 0) {
      shapes = [...shapes, ...copiedShapes];
      snapshotHistory();
      renderAnnotationsList();
      draw();
      
      if (project.task_type === 'image_classification') {
        updateClassificationSidebar();
      }
    }
  } catch (err) {
    console.error(err);
    alert("Could not load annotations from the previous image.");
  }
}

// Navigate to image index, saving current changes first
async function goTo(idx) {
  if (idx < 0 || idx >= images.length) return;
  if (idx === currentIdx && currentImg) return;
  
  // Auto-save
  await save();
  
  // Load next image
  await loadImageIndex(idx);
}

// Setup top toolbar navigation events
function setupUIEvents() {
  prevImageBtn.addEventListener('click', () => goTo(currentIdx - 1));
  nextImageBtn.addEventListener('click', () => goTo(currentIdx + 1));
  saveBtn.addEventListener('click', () => save());
  copyPrevBtn.addEventListener('click', () => copyFromPrevious());

  // Zoom bindings
  document.getElementById('zoomIn').addEventListener('click', () => {
    zoom = clamp(zoom * 1.3, 0.15, 15);
    document.getElementById('zoomLabel').textContent = `${Math.round(zoom * 100)}%`;
    draw();
  });
  document.getElementById('zoomOut').addEventListener('click', () => {
    zoom = clamp(zoom / 1.3, 0.15, 15);
    document.getElementById('zoomLabel').textContent = `${Math.round(zoom * 100)}%`;
    draw();
  });
  document.getElementById('zoomFit').addEventListener('click', () => {
    fitToContainer();
    document.getElementById('zoomLabel').textContent = `${Math.round(zoom * 100)}%`;
    draw();
  });

  // Undo/Redo
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  // Clear Annotations
  clearAllAnnotationsBtn.addEventListener('click', () => {
    if (confirm("Clear all annotations on this image?")) {
      shapes = [];
      selectedIndex = null;
      snapshotHistory();
      renderAnnotationsList();
      draw();
      
      if (project.task_type === 'image_classification') {
        updateClassificationSidebar();
      }
    }
  });

  // Tool buttons
  toolSelectBtn.addEventListener('click', () => setTool('select'));
  toolBBoxBtn.addEventListener('click', () => setTool('bbox'));
  toolPolygonBtn.addEventListener('click', () => setTool('polygon'));
  if (toolPointBtn) toolPointBtn.addEventListener('click', () => setTool('point'));
  if (toolSamBtn) toolSamBtn.addEventListener('click', () => setTool('sam'));
  if (toolPanBtn) toolPanBtn.addEventListener('click', () => setTool('pan'));

  // Drag and drop uploading handlers
  uploadBox.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => uploadFiles(e.target.files));
  
  uploadBox.addEventListener('dragover', e => {
    e.preventDefault();
    uploadBox.classList.add('dragover');
  });
  uploadBox.addEventListener('dragleave', () => {
    uploadBox.classList.remove('dragover');
  });
  uploadBox.addEventListener('drop', e => {
    e.preventDefault();
    uploadBox.classList.remove('dragover');
    uploadFiles(e.dataTransfer.files);
  });

  // Gallery View filters and controls
  filterAllBtn.addEventListener('click', () => {
    filterAllBtn.classList.add('active');
    filterAnnotatedBtn.classList.remove('active');
    filterUnannotatedBtn.classList.remove('active');
    galleryFilter = 'all';
    renderGalleryGrid();
  });

  filterAnnotatedBtn.addEventListener('click', () => {
    filterAnnotatedBtn.classList.add('active');
    filterAllBtn.classList.remove('active');
    filterUnannotatedBtn.classList.remove('active');
    galleryFilter = 'annotated';
    renderGalleryGrid();
  });

  filterUnannotatedBtn.addEventListener('click', () => {
    filterUnannotatedBtn.classList.add('active');
    filterAllBtn.classList.remove('active');
    filterAnnotatedBtn.classList.remove('active');
    galleryFilter = 'unannotated';
    renderGalleryGrid();
  });

  gallerySearchInput.addEventListener('input', () => {
    renderGalleryGrid();
  });

  // Navigation handlers
  galleryBackToWorkflowBtn.addEventListener('click', () => {
    if (window.parent) {
      window.parent.postMessage({ type: 'NAVIGATE', tab: 'Visual Pipeline' }, '*');
    }
    window.location.href = `/workflow/?project_id=${projectId}`;
  });

  editorBackToGalleryBtn.addEventListener('click', async () => {
    await save();
    switchView('gallery');
  });

  galleryUploadBtn.addEventListener('click', () => {
    fileInput.click();
  });

  galleryExportBtn.addEventListener('click', () => {
    exportDatasetOverlay.style.display = 'flex';
    exportDatasetNameInput.value = project.name || "Custom Dataset";
  });

  // Add class button click handler
  document.getElementById('addClassBtn').addEventListener('click', async () => {
    const newClass = prompt("Enter name for the new class label:");
    if (newClass && newClass.trim()) {
      const cleanName = newClass.trim();
      if (project.classes.includes(cleanName)) {
        alert("This class name already exists.");
        return;
      }
      project.classes.push(cleanName);
      await saveProjectClasses(project.classes);
      renderClasses();
      if (project.task_type === 'image_classification') {
        updateClassificationSidebar();
      }
    }
  });

  // Export overlay triggers
  exportBtn.addEventListener('click', () => {
    exportDatasetOverlay.style.display = 'flex';
    exportDatasetNameInput.value = project.name || "Custom Dataset";
  });

  closeExportOverlayBtn.addEventListener('click', () => {
    exportDatasetOverlay.style.display = 'none';
  });

  saveToDatasetsBtn.addEventListener('click', async () => {
    const name = exportDatasetNameInput.value.trim();
    const version = exportDatasetVersionInput.value.trim();
    if (!name || !version) {
      alert("Please enter a valid name and version.");
      return;
    }
    
    saveToDatasetsBtn.disabled = true;
    const oldText = saveToDatasetsBtn.innerHTML;
    saveToDatasetsBtn.innerHTML = "Saving...";
    
    try {
      const res = await fetch(`/api/projects/${projectId}/save-dataset?dataset_name=${encodeURIComponent(name)}&version=${encodeURIComponent(version)}`, {
        method: 'POST'
      });
      if (res.ok) {
        alert("Dataset version successfully saved! You can now link it inside the Datasets builder.");
        exportDatasetOverlay.style.display = 'none';
      } else {
        const errData = await res.json();
        alert("Failed to export dataset: " + (errData.detail || "Unknown error"));
      }
    } catch (err) {
      console.error(err);
      alert("Error saving dataset.");
    } finally {
      saveToDatasetsBtn.disabled = false;
      saveToDatasetsBtn.innerHTML = oldText;
    }
  });

  downloadZipBtn.addEventListener('click', () => {
    window.open(`/api/projects/${projectId}/export-zip`, '_blank');
    exportDatasetOverlay.style.display = 'none';
  });

  // Project Statistics Summary overlay triggers
  const summaryBtn = document.getElementById('summaryBtn');
  const summaryOverlay = document.getElementById('summaryOverlay');
  const closeSummaryBtn = document.getElementById('closeSummaryBtn');

  if (summaryBtn) {
    summaryBtn.addEventListener('click', () => {
      summaryOverlay.style.display = 'flex';
      loadStatistics();
    });
  }

  if (closeSummaryBtn) {
    closeSummaryBtn.addEventListener('click', () => {
      summaryOverlay.style.display = 'none';
    });
  }
}

// Upload Files in Batch
async function uploadFiles(filesList) {
  if (filesList.length === 0) return;
  
  const filesArray = Array.from(filesList).filter(f => 
    /\.(jpe?g|png|bmp|webp)$/i.test(f.name)
  );
  if (filesArray.length === 0) {
    alert("Please select valid image files.");
    return;
  }

  // Show progress indicator
  uploadProgressContainer.style.display = 'flex';
  
  const total = filesArray.length;
  let doneCount = 0;

  // We upload in chunks to handle memory properly
  for (let i = 0; i < total; i++) {
    const formData = new FormData();
    formData.append('files', filesArray[i]);

    try {
      uploadProgressText.textContent = `Uploading ${i + 1}/${total}: ${filesArray[i].name}`;
      uploadProgressFill.style.width = `${Math.round((i / total) * 100)}%`;

      const res = await fetch(`/api/projects/${projectId}/images`, {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        doneCount++;
      }
    } catch (err) {
      console.error("Upload error for file:", filesArray[i].name, err);
    }
  }

  uploadProgressFill.style.width = '100%';
  uploadProgressText.textContent = `Upload finished. Added ${doneCount} images successfully.`;

  setTimeout(async () => {
    uploadProgressContainer.style.display = 'none';
    // Reload images list
    await loadImages();
  }, 1000);
}

// Show Project Selector Overlay when no project_id is parsed
async function showProjectSelector() {
  projectSelectorOverlay.style.display = 'flex';
  projectSelectorOverlay.classList.add('active');
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) throw new Error("Failed to list projects");
    const projectsList = await res.json();
    
    projectSelectDropdown.innerHTML = '';
    if (!projectsList || projectsList.length === 0) {
      projectSelectDropdown.innerHTML = '<option value="">No projects found. Create one in Visual Builder</option>';
      confirmProjectBtn.disabled = true;
      return;
    }
    
    projectsList.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.task_type.replace('_', ' ')})`;
      projectSelectDropdown.appendChild(opt);
    });
    
    confirmProjectBtn.addEventListener('click', () => {
      const selectedId = projectSelectDropdown.value;
      if (selectedId) {
        window.location.search = `?project_id=${selectedId}`;
      }
    });
  } catch (err) {
    console.error(err);
    projectSelectDropdown.innerHTML = '<option value="">Error loading projects list</option>';
  }
  
  if (window.lucide) {
    lucide.createIcons();
  }
}

// View Toggling Controller
function switchView(viewName) {
  currentView = viewName;
  if (viewName === 'gallery') {
    galleryView.style.display = 'flex';
    editorView.style.display = 'none';
    renderGalleryGrid();
  } else {
    galleryView.style.display = 'none';
    editorView.style.display = 'flex';
    setTimeout(() => {
      fitToContainer();
      draw();
    }, 50);
  }
}

// Render Full-Screen Images Gallery Grid with Status Filters
function renderGalleryGrid() {
  if (!galleryGrid) return;
  galleryGrid.innerHTML = '';
  
  const searchVal = gallerySearchInput.value.toLowerCase().trim();
  
  const filtered = images.filter(img => {
    // Search query matches original name
    if (searchVal && !img.original_name.toLowerCase().includes(searchVal)) {
      return false;
    }
    // Filter status matches
    if (galleryFilter === 'annotated' && !img.annotated) return false;
    if (galleryFilter === 'unannotated' && img.annotated) return false;
    return true;
  });
  
  if (filtered.length === 0) {
    galleryEmptyState.style.display = 'flex';
  } else {
    galleryEmptyState.style.display = 'none';
  }
  
  filtered.forEach(img => {
    const isAnnotated = img.annotated;
    const badgeClass = isAnnotated ? 'annotated' : 'unannotated';
    const badgeText = isAnnotated ? 'Annotated' : 'Unannotated';
    const iconName = isAnnotated ? 'check' : 'circle';
    
    // Get the index in the master images array
    const originalIdx = images.findIndex(i => i.id === img.id);
    
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.innerHTML = `
      <div class="gallery-card-img-wrapper">
        <img src="/api/projects/${projectId}/images/${img.id}/file" class="gallery-card-img" loading="lazy" />
      </div>
      <p class="gallery-card-title" title="${img.original_name}">${img.original_name}</p>
      <span class="gallery-card-status-badge ${badgeClass}">
        <i data-lucide="${iconName}" style="width: 8px; height: 8px;"></i>
        ${badgeText}
      </span>
    `;
    
    card.addEventListener('click', () => {
      goTo(originalIdx);
      switchView('editor');
    });
    
    galleryGrid.appendChild(card);
  });
  
  if (window.lucide) {
    lucide.createIcons();
  }
}

async function runSam(sess) {
  console.log("runSam: sess =", sess);
  const currentImage = images[currentIdx];
  if (!currentImage) {
    console.warn("runSam: no currentImage!");
    return;
  }
  samLoading = true;
  showSamLoadingAlert(true);
  try {
    const fetchUrl = `/api/projects/${projectId}/images/${currentImage.id}/sam-segment`;
    console.log("runSam: fetching", fetchUrl);
    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: sess.points,
        labels: sess.labels,
        box: sess.box
      })
    });
    console.log("runSam: response status =", res.status);
    if (!res.ok) throw new Error("SAM failed with status " + res.status);
    const data = await res.json();
    console.log("runSam: received data =", data);
    const pts = data.points;
    if (!pts || pts.length < 3) return;
    
    if (sess.idx >= 0 && sess.idx < shapes.length && shapes[sess.idx].type === 'polygon') {
      shapes[sess.idx] = { type: 'polygon', class_id: activeClass, pts };
    } else {
      shapes.push({ type: 'polygon', class_id: activeClass, pts });
      sess.idx = shapes.length - 1;
    }
    snapshotHistory();
    renderAnnotationsList();
    draw();
  } catch (err) {
    console.error("SAM failed:", err);
  } finally {
    samLoading = false;
    showSamLoadingAlert(false);
  }
}

function showSamLoadingAlert(loading) {
  if (loading) {
    polyHintEl.style.display = 'flex';
    polyHintTextEl.textContent = "Segmenting with SAM... Please wait...";
  } else {
    polyHintEl.style.display = 'none';
  }
}

async function loadStatistics() {
  const summaryLoadingState = document.getElementById('summaryLoadingState');
  const summaryErrorState = document.getElementById('summaryErrorState');
  const summaryStatsPanel = document.getElementById('summaryStatsPanel');
  
  summaryLoadingState.style.display = 'flex';
  summaryErrorState.style.display = 'none';
  summaryStatsPanel.style.display = 'none';
  
  try {
    const res = await fetch(`/api/projects/${projectId}/analytics`);
    if (!res.ok) throw new Error("Failed to fetch analytics");
    const data = await res.json();
    
    summaryLoadingState.style.display = 'none';
    renderStatistics(data);
    summaryStatsPanel.style.display = 'flex';
  } catch (err) {
    console.error("Error loading project stats:", err);
    summaryLoadingState.style.display = 'none';
    summaryErrorState.style.display = 'block';
  }
}

function renderStatistics(data) {
  // 1. Update Labelling Status Pie Chart (SVG circular progress)
  const total = data.total_images || 0;
  const annotated = data.annotated_images || 0;
  const unannotated = Math.max(0, total - annotated);
  
  document.getElementById('summaryTotalCount').textContent = total;
  document.getElementById('summaryLabelledCount').textContent = `${annotated} (${total > 0 ? Math.round((annotated / total) * 100) : 0}%)`;
  document.getElementById('summaryUnlabelledCount').textContent = `${unannotated} (${total > 0 ? Math.round((unannotated / total) * 100) : 0}%)`;
  
  const percentDone = total > 0 ? Math.round((annotated / total) * 100) : 0;
  document.getElementById('summaryPercentText').textContent = `${percentDone}%`;
  
  // Set SVG circle stroke-dasharray (dasharray = percent, 100-percent)
  const summaryStatusCircle = document.getElementById('summaryStatusCircle');
  if (summaryStatusCircle) {
    summaryStatusCircle.setAttribute('stroke-dasharray', `${percentDone} 100`);
  }
  
  // 2. Render Object Distribution List (horizontal progress bars)
  const classDistList = document.getElementById('summaryClassDistributionList');
  classDistList.innerHTML = '';
  
  if (!project || !project.classes || project.classes.length === 0) {
    classDistList.innerHTML = '<p style="color: var(--text3); font-size: 11px; text-align: center; padding-top: 20px;">No classes defined in project.</p>';
    return;
  }
  
  // Build chart data
  const chartData = project.classes.map((cls, idx) => ({
    name: cls,
    count: data.class_distribution[cls] || 0,
    color: getClassColor(idx)
  }));
  
  const maxVal = Math.max(...chartData.map(d => d.count), 0);
  
  if (maxVal === 0) {
    classDistList.innerHTML = '<p style="color: var(--text3); font-size: 11px; text-align: center; padding-top: 20px;">No annotations yet.</p>';
    return;
  }
  
  // Render horizontal progress bars
  chartData.forEach(item => {
    const barPercent = maxVal > 0 ? Math.round((item.count / maxVal) * 100) : 0;
    
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '4px';
    
    wrapper.innerHTML = `
      <div style="display: flex; justify-content: space-between; font-size: 11px; align-items: center;">
        <span style="color: var(--text2); display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: ${item.color}; display: inline-block; flex-shrink: 0;"></span>
          ${item.name}
        </span>
        <span style="color: var(--text); font-family: 'JetBrains Mono', monospace; font-weight: 600;">${item.count}</span>
      </div>
      <div style="background: rgba(0,0,0,0.06); height: 6px; border-radius: 3px; overflow: hidden; width: 100%;">
        <div style="background: ${item.color}; width: ${barPercent}%; height: 100%; border-radius: 3px; transition: width 0.3s ease;"></div>
      </div>
    `;
    classDistList.appendChild(wrapper);
  });
}
