// ===== Unified Dashboard client logic =====

// Preset colors for class builder
const PRESET_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#a855f7', '#ec4899'];
let modalClasses = []; // Tracks classes during project creation

// Global State
let projects = [];
let activeProjectId = null;
let activeProject = null;
let datasets = [];
let jobs = [];
let modelGardenJobs = [];
let activeJobId = null; // For tracking current training progress
let pollingInterval = null;

// Validation slideshow state
let sampleImages = [];
let currentSampleIdx = 0;

// Navigation switching helper
function switchMainView(view) {
  const landing = document.getElementById('landingView');
  const projectsEl = document.getElementById('projectsView');
  const about = document.getElementById('aboutView');
  const workspace = document.getElementById('workspaceView');
  
  if (!landing || !projectsEl || !about || !workspace) return;

  // Hide all main views
  landing.style.display = 'none';
  projectsEl.style.display = 'none';
  about.style.display = 'none';
  workspace.style.display = 'none';
  
  // Hide toggle button by default (only show in workspace view on small screens via CSS)
  const mobileToggle = document.getElementById('mobileSidebarToggleBtn');
  if (mobileToggle) {
    mobileToggle.style.display = 'none';
  }

  // Remove active state from nav links
  document.querySelectorAll('.header-nav .nav-link').forEach(link => link.classList.remove('active'));
  
  // Show target view
  if (view === 'landing') {
    landing.style.display = 'block';
    const link = document.getElementById('navLinkLanding');
    if (link) link.classList.add('active');
  } else if (view === 'projects') {
    projectsEl.style.display = 'block';
    const link = document.getElementById('navLinkProjects');
    if (link) link.classList.add('active');
    loadProjects();
  } else if (view === 'about') {
    about.style.display = 'block';
    const link = document.getElementById('navLinkAbout');
    if (link) link.classList.add('active');
  } else if (view === 'workspace') {
    workspace.style.display = 'flex';
    if (mobileToggle) {
      mobileToggle.style.display = 'inline-flex';
    }
  }
}

// Page initialization
document.addEventListener('DOMContentLoaded', () => {
  // Bind top navbar tabs
  document.getElementById('navLinkLanding').addEventListener('click', () => switchMainView('landing'));
  document.getElementById('navLinkProjects').addEventListener('click', () => switchMainView('projects'));
  document.getElementById('navLinkAbout').addEventListener('click', () => switchMainView('about'));
  
  // Bind landing page action buttons
  document.getElementById('landingGetStartedBtn').addEventListener('click', () => switchMainView('projects'));
  document.getElementById('landingLearnMoreBtn').addEventListener('click', () => switchMainView('about'));

  // Bind mobile sidebar toggle
  const mobileToggle = document.getElementById('mobileSidebarToggleBtn');
  if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
      const sidebar = document.querySelector('.workspace-sidebar');
      if (sidebar) {
        sidebar.classList.toggle('active');
      }
    });
  }

  // Go to Landing Page by default
  switchMainView('landing');

  setupUIEvents();
  
  // Set up task cards in project modal
  document.querySelectorAll('.task-option-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.task-option-card').forEach(c => {
        c.classList.remove('active');
        const icon = c.querySelector('i');
        if (icon) {
          icon.style.color = 'var(--text-secondary)';
        }
      });
      card.classList.add('active');
      const icon = card.querySelector('i');
      if (icon) icon.style.color = 'var(--accent)';
      
      // Toggle conditional annotation type container
      const task = card.getAttribute('data-task');
      const annotationContainer = document.getElementById('newProjectAnnotationContainer');
      if (task === 'object_detection') {
        annotationContainer.style.display = 'block';
      } else {
        annotationContainer.style.display = 'none';
      }
    });
  });

  // Data Card modal tabs
  document.getElementById('tabBtnReport').addEventListener('click', () => switchDatacardTab('report'));
  document.getElementById('tabBtnDistribution').addEventListener('click', () => switchDatacardTab('distribution'));
  document.getElementById('tabBtnSamples').addEventListener('click', () => switchDatacardTab('samples'));
  
  // Project Search binder
  document.getElementById('projectsSearch').addEventListener('input', () => {
    renderProjectsGrid();
  });
});

// Setup click and change observers
function setupUIEvents() {
  // New Project modal triggers
  const createProjectOverlay = document.getElementById('createProjectOverlay');
  const openCreateBtn = document.getElementById('openCreateProjectModalBtn');
  if (openCreateBtn) {
    openCreateBtn.addEventListener('click', () => {
      document.getElementById('newProjectName').value = '';
      document.getElementById('newProjectDesc').value = '';
      document.getElementById('newProjectError').style.display = 'none';
      
      // Reset classes builder
      modalClasses = [];
      document.getElementById('newClassInputName').value = '';
      document.getElementById('newClassInputColor').value = PRESET_COLORS[0];
      renderModalClassesPreview();
      
      // Select Object Detection by default
      document.querySelectorAll('.task-option-card').forEach(c => {
        c.classList.remove('active');
        const icon = c.querySelector('i');
        if (icon) icon.style.color = 'var(--text-secondary)';
      });
      const defaultCard = document.querySelector('.task-option-card[data-task="object_detection"]');
      if (defaultCard) {
        defaultCard.classList.add('active');
        const icon = defaultCard.querySelector('i');
        if (icon) icon.style.color = 'var(--accent)';
      }
      document.getElementById('newProjectAnnotationContainer').style.display = 'block';
      
      createProjectOverlay.classList.add('active');
      if (window.lucide) lucide.createIcons();
    });
  }
  
  const closeCreateBtn = document.getElementById('closeCreateProjectModalBtn');
  if (closeCreateBtn) {
    closeCreateBtn.addEventListener('click', () => createProjectOverlay.classList.remove('active'));
  }
  const cancelCreateBtn = document.getElementById('cancelCreateProjectBtn');
  if (cancelCreateBtn) {
    cancelCreateBtn.addEventListener('click', () => createProjectOverlay.classList.remove('active'));
  }
  const saveCreateBtn = document.getElementById('saveCreateProjectBtn');
  if (saveCreateBtn) {
    saveCreateBtn.addEventListener('click', handleCreateProject);
  }
  
  // Add class in modal binder
  const addClassBtn = document.getElementById('addNewClassBtn');
  if (addClassBtn) {
    addClassBtn.addEventListener('click', () => {
      const nameInput = document.getElementById('newClassInputName');
      const colorPicker = document.getElementById('newClassInputColor');
      const name = nameInput.value.trim();
      const color = colorPicker.value;
      
      if (!name) return;
      
      const exists = modalClasses.some(c => c.name.toLowerCase() === name.toLowerCase());
      if (exists) {
        alert("Class name already exists in this project.");
        return;
      }
      
      modalClasses.push({ name, color });
      nameInput.value = '';
      
      // Select next preset color
      const nextColor = PRESET_COLORS[modalClasses.length % PRESET_COLORS.length];
      colorPicker.value = nextColor;
      
      renderModalClassesPreview();
    });
  }
  
  // Sidebar Back to Projects
  const backToProjectsBtn = document.getElementById('backToProjectsBtn');
  if (backToProjectsBtn) {
    backToProjectsBtn.addEventListener('click', () => {
      stopPolling();
      activeProjectId = null;
      activeProject = null;
      switchMainView('projects');
      loadProjects();
    });
  }

  // Sidebar Tabs switching
  document.querySelectorAll('.sidebar-menu .menu-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-menu .menu-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      const tabId = item.getAttribute('data-tab');
      document.querySelectorAll('.workspace-viewport .viewport-tab').forEach(tab => {
        tab.classList.remove('active');
      });
      document.getElementById(`tab-${tabId}`).classList.add('active');
      
      // Hook lifecycle refresh calls
      if (tabId === 'datasets') {
        loadDatasets();
      } else if (tabId === 'modelGarden') {
        loadModelGarden();
      } else if (tabId === 'trainingJobs') {
        loadJobs();
      }
    });
  });

  // Model Garden Refresh
  const refreshModelGardenBtn = document.getElementById('refreshModelGardenBtn');
  if (refreshModelGardenBtn) {
    refreshModelGardenBtn.addEventListener('click', loadModelGarden);
  }

  // Dataset Actions
  const refreshDatasetsBtn = document.getElementById('refreshDatasetsBtn');
  if (refreshDatasetsBtn) {
    refreshDatasetsBtn.addEventListener('click', loadDatasets);
  }
  
  // Dataset Upload Modal
  const uploadOverlay = document.getElementById('uploadDatasetOverlay');
  const openUploadModalBtn = document.getElementById('openUploadDatasetModalBtn');
  if (openUploadModalBtn) {
    openUploadModalBtn.addEventListener('click', () => {
      document.getElementById('datasetUploadName').value = 'My Custom Dataset';
      document.getElementById('datasetUploadFile').value = '';
      const progressBox = document.getElementById('uploadProgressBox');
      if (progressBox) progressBox.style.display = 'none';
      uploadOverlay.classList.add('active');
    });
  }
  const closeUploadModalBtn = document.getElementById('closeUploadDatasetModalBtn');
  if (closeUploadModalBtn) {
    closeUploadModalBtn.addEventListener('click', () => {
      uploadOverlay.classList.remove('active');
    });
  }
  
  const datasetUploadSubmitBtn = document.getElementById('datasetUploadSubmitBtn');
  if (datasetUploadSubmitBtn) {
    datasetUploadSubmitBtn.addEventListener('click', handleDatasetUpload);
  }
  
  const closeDatacardModalBtn = document.getElementById('closeDatacardModalBtn');
  if (closeDatacardModalBtn) {
    closeDatacardModalBtn.addEventListener('click', () => {
      document.getElementById('datacardOverlay').classList.remove('active');
    });
  }

  // Dataset Slideshow nav
  const prevSampleBtn = document.getElementById('prevSampleBtn');
  if (prevSampleBtn) {
    prevSampleBtn.addEventListener('click', () => {
      if (currentSampleIdx > 0) {
        currentSampleIdx--;
        renderSampleImage();
      }
    });
  }
  const nextSampleBtn = document.getElementById('nextSampleBtn');
  if (nextSampleBtn) {
    nextSampleBtn.addEventListener('click', () => {
      if (currentSampleIdx < sampleImages.length - 1) {
        currentSampleIdx++;
        renderSampleImage();
      }
    });
  }

  // Model training config triggers & search inputs
  const refreshJobsBtn = document.getElementById('refreshJobsBtn');
  if (refreshJobsBtn) {
    refreshJobsBtn.addEventListener('click', loadJobs);
  }
  
  const startMlflowBtn = document.getElementById('startMlflowBtn');
  if (startMlflowBtn) {
    startMlflowBtn.addEventListener('click', async () => {
      try {
        await fetch('/mlflow/start-server', { method: 'POST' });
        const res = await fetch('/mlflow/ui-url');
        if (res.ok) {
          const data = await res.json();
          if (data.url) window.open(data.url, '_blank');
        }
      } catch (err) {
        console.error(err);
        alert("Error loading MLflow server UI.");
      }
    });
  }

  // Search input listeners for workspace tables
  const datasetsSearchInput = document.getElementById('datasetsSearch');
  if (datasetsSearchInput) {
    datasetsSearchInput.addEventListener('input', renderDatasetsTable);
  }
  
  const modelGardenSearchInput = document.getElementById('modelGardenSearch');
  if (modelGardenSearchInput) {
    modelGardenSearchInput.addEventListener('input', renderModelGardenTable);
  }
  
  const jobsSearchInput = document.getElementById('jobsSearch');
  if (jobsSearchInput) {
    jobsSearchInput.addEventListener('input', renderJobsTable);
  }

  // Curves & Card Modal dismiss
  const closeCurvesModalBtn = document.getElementById('closeCurvesModalBtn');
  if (closeCurvesModalBtn) {
    closeCurvesModalBtn.addEventListener('click', () => {
      document.getElementById('curvesOverlay').classList.remove('active');
    });
  }
  const closeModelCardModalBtn = document.getElementById('closeModelCardModalBtn');
  if (closeModelCardModalBtn) {
    closeModelCardModalBtn.addEventListener('click', () => {
      document.getElementById('modelCardOverlay').classList.remove('active');
    });
  }
  const closeLogsModalBtn = document.getElementById('closeLogsModalBtn');
  if (closeLogsModalBtn) {
    closeLogsModalBtn.addEventListener('click', () => {
      document.getElementById('logsOverlay').classList.remove('active');
    });
  }
}

function renderModalClassesPreview() {
  const preview = document.getElementById('modalClassesPreview');
  preview.innerHTML = '';
  
  if (modalClasses.length === 0) {
    preview.innerHTML = `<span style="color: var(--text-secondary); font-size: 11px;">No classes added yet. Default 'class0' will be used if none are specified.</span>`;
    return;
  }
  
  modalClasses.forEach((cls, idx) => {
    const tag = document.createElement('div');
    tag.className = 'modal-class-tag';
    tag.innerHTML = `
      <span class="modal-class-dot" style="background-color: ${cls.color};"></span>
      <span style="font-weight: 500; color: var(--text);">${cls.name}</span>
      <button class="modal-class-del-btn" onclick="handleRemoveModalClass(${idx}, event)">&times;</button>
    `;
    preview.appendChild(tag);
  });
}

window.handleRemoveModalClass = function(idx, event) {
  if (event) event.stopPropagation();
  modalClasses.splice(idx, 1);
  
  // Cycle back color selection
  const colorPicker = document.getElementById('newClassInputColor');
  const nextColor = PRESET_COLORS[modalClasses.length % PRESET_COLORS.length];
  colorPicker.value = nextColor;
  
  renderModalClassesPreview();
};

// ==================== PROJECTS OPERATIONS ====================

async function loadProjects() {
  const errorDiv = document.getElementById('projectsListError');
  errorDiv.style.display = 'none';
  
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) throw new Error("Failed to load projects list");
    projects = await res.json();
    
    renderProjectsGrid();
  } catch (err) {
    errorDiv.style.display = 'block';
    errorDiv.textContent = err.message;
  }
}

function renderProjectsGrid() {
  const grid = document.getElementById('projectsGrid');
  const empty = document.getElementById('projectsEmptyState');
  const searchVal = document.getElementById('projectsSearch').value.trim().toLowerCase();
  
  grid.innerHTML = '';
  empty.style.display = 'none';
  
  const filtered = projects.filter(p => p.name.toLowerCase().includes(searchVal));
  
  if (filtered.length === 0) {
    empty.style.display = 'block';
    empty.querySelector('p').textContent = searchVal ? "No matching projects found" : "No projects yet";
    return;
  }
  
  filtered.forEach(p => {
    const card = document.createElement('div');
    card.className = 'project-card';
    
    let typeLabel = p.task_type.replace('_', ' ');
    let typeClass = p.task_type;
    if (typeClass.includes('segmentation')) typeClass = 'segmentation';
    else if (typeClass.includes('classification')) typeClass = 'classification';
    else typeClass = 'detection';
    
    card.innerHTML = `
      <!-- Left Thumbnail area -->
      <div class="project-card-thumb" id="thumb-${p.id}">
        <i data-lucide="image" style="width: 24px; height: 24px; opacity: 0.15; color: var(--text);"></i>
      </div>
      <!-- Right Details content area -->
      <div class="project-card-details">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-shrink: 0;">
          <div style="flex-grow: 1; min-width: 0;">
            <h3 class="project-card-title">${p.name}</h3>
            <span class="task-badge ${typeClass}" style="margin-top: 4px;">${typeLabel}</span>
          </div>
          <button class="btn danger" style="padding: 4px;" onclick="handleDeleteProject('${p.id}', event)">
            <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
          </button>
        </div>
        <div style="font-size: 11px; color: var(--text-secondary); display: flex; align-items: center; gap: 12px; margin-top: 4px; flex-shrink: 0;">
          <span style="display: inline-flex; align-items: center; gap: 3px;"><i data-lucide="tags" style="width: 11px; height: 11px; color: var(--accent);"></i><strong id="classes-count-${p.id}">${p.classes ? p.classes.length : 0}</strong> Classes</span>
          <span>&bull;</span>
          <span style="display: inline-flex; align-items: center; gap: 3px;"><i data-lucide="image" style="width: 11px; height: 11px; color: var(--accent);"></i><strong id="images-count-${p.id}">...</strong> Images</span>
        </div>
      </div>
    `;
    
    card.addEventListener('click', () => loadProjectWorkspace(p.id));
    grid.appendChild(card);
    
    // Asynchronously load thumbnail image and image count
    fetchImagesAndStatsForCard(p.id);
  });
  
  if (window.lucide) lucide.createIcons();
}

async function fetchImagesAndStatsForCard(projectId) {
  try {
    const res = await fetch(`/api/projects/${projectId}/images`);
    if (!res.ok) return;
    const images = await res.json();
    
    // Update image count
    const countEl = document.getElementById(`images-count-${projectId}`);
    if (countEl) countEl.textContent = images.length;
    
    // Update thumbnail if images exist
    if (images.length > 0) {
      const thumbEl = document.getElementById(`thumb-${projectId}`);
      if (thumbEl) {
        thumbEl.innerHTML = `<img src="/api/projects/${projectId}/images/${images[0].id}/file" />`;
      }
    }
  } catch (err) {
    console.error("Failed to load project details for card stats: ", err);
  }
}

async function handleCreateProject() {
  const name = document.getElementById('newProjectName').value.trim();
  const desc = document.getElementById('newProjectDesc').value.trim();
  const activeTaskCard = document.querySelector('.task-option-card.active');
  const taskType = activeTaskCard ? activeTaskCard.getAttribute('data-task') : 'object_detection';
  const annotationTypeSelect = document.getElementById('newProjectAnnotation');
  const annotationType = taskType === 'object_detection' ? annotationTypeSelect.value : 'bbox';
  const errorDiv = document.getElementById('newProjectError');
  
  if (!name) {
    errorDiv.style.display = 'block';
    errorDiv.textContent = "Project name is required.";
    return;
  }
  
  errorDiv.style.display = 'none';
  
  // Format classes list and class_colors dictionary
  const classesList = [];
  const classColorsDict = {};
  modalClasses.forEach(c => {
    classesList.push(c.name);
    classColorsDict[c.name] = c.color;
  });
  
  // Fallback to class0 if none added
  if (classesList.length === 0) {
    classesList.push("class0");
    classColorsDict["class0"] = "#0071e3";
  }
  
  const payload = {
    name,
    description: desc,
    task_type: taskType,
    annotation_type: annotationType,
    classes: classesList,
    class_colors: classColorsDict
  };
  
  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to create project");
    }
    
    document.getElementById('createProjectOverlay').classList.remove('active');
    loadProjects();
  } catch (err) {
    errorDiv.style.display = 'block';
    errorDiv.textContent = err.message;
  }
}

async function handleDeleteProject(id, event) {
  event.stopPropagation();
  if (confirm("Delete this project and all its annotations/images?")) {
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Delete failed");
      loadProjects();
    } catch (err) {
      alert("Failed to delete project: " + err.message);
    }
  }
}

// ==================== WORKSPACE NAVIGATION ====================

async function loadProjectWorkspace(id) {
  try {
    const res = await fetch(`/api/projects/${id}`);
    if (!res.ok) throw new Error("Failed to load project details");
    activeProject = await res.json();
    activeProjectId = id;
    
    // Update sidebar headings
    document.getElementById('wsProjectName').textContent = activeProject.name;
    const taskBadge = document.getElementById('wsProjectTaskBadge');
    taskBadge.textContent = activeProject.task_type.replace('_', ' ');
    taskBadge.className = 'task-badge ' + (activeProject.task_type.includes('segmentation') ? 'segmentation' : activeProject.task_type.includes('classification') ? 'classification' : 'detection');
    
    // Configure iframe URLs
    document.getElementById('pipelineBuilderIframe').src = `/workflow/index.html?project_id=${id}`;
    document.getElementById('annotateIframe').src = `/annotator/index.html?project_id=${id}`;
    
    // Switch to Visual Builder active tab default
    document.querySelectorAll('.sidebar-menu .menu-item').forEach(i => i.classList.remove('active'));
    document.querySelector('.sidebar-menu .menu-item[data-tab="pipelineBuilder"]').classList.add('active');
    document.querySelectorAll('.workspace-viewport .viewport-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-pipelineBuilder').classList.add('active');
    
    // Display Workspace View
    switchMainView('workspace');
    
  } catch (err) {
    alert("Could not load project workspace: " + err.message);
  }
}

// ==================== DATASETS TABS ====================

async function loadDatasets() {
  const tbody = document.getElementById('datasetsTableBody');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">Loading datasets...</td></tr>';
  
  try {
    const res = await fetch(`/datasets/available?project_id=${activeProjectId}`);
    if (!res.ok) throw new Error("Failed to load datasets list");
    datasets = await res.json();
    
    renderDatasetsTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger);">${err.message}</td></tr>`;
  }
}

function renderDatasetsTable() {
  const tbody = document.getElementById('datasetsTableBody');
  const searchVal = document.getElementById('datasetsSearch').value.trim().toLowerCase();
  
  tbody.innerHTML = '';
  
  if (!datasets || datasets.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">No datasets available. Upload a dataset first.</td></tr>';
    return;
  }
  
  const filtered = datasets.filter(d => {
    const name = (d.name || d.id || '').toLowerCase();
    const task = (d.task_type || '').toLowerCase();
    return name.includes(searchVal) || task.includes(searchVal);
  });
  
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">No matching datasets found.</td></tr>';
    return;
  }
  
  filtered.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${d.name || d.id}</b></td>
      <td><span class="task-badge ${d.task_type.includes('classification') ? 'classification' : 'detection'}">${d.task_type.replace('_', ' ')}</span></td>
      <td>${d.classes ? d.classes.length : 0} classes</td>
      <td>${d.item_count || 0} items</td>
      <td>${d.is_coco_format ? 'COCO' : 'Standard'}</td>
    `;
    tr.addEventListener('click', () => openDatacardValidation(d.id, d.name || d.id));
    tbody.appendChild(tr);
  });
}

async function handleDatasetUpload() {
  const name = document.getElementById('datasetUploadName').value.trim();
  const taskType = document.getElementById('datasetUploadTask').value;
  const fileInput = document.getElementById('datasetUploadFile');
  const submitBtn = document.getElementById('datasetUploadSubmitBtn');
  
  if (!name) {
    alert("Please specify a dataset name.");
    return;
  }
  if (fileInput.files.length === 0) {
    alert("Please select a ZIP file archive to upload.");
    return;
  }
  
  const file = fileInput.files[0];
  const datasetId = name.toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'dataset_' + Date.now();
  
  submitBtn.disabled = true;
  const progressBox = document.getElementById('uploadProgressBox');
  const progressFill = document.getElementById('uploadProgressFill');
  const progressText = document.getElementById('uploadProgressText');
  
  progressBox.style.display = 'flex';
  progressFill.style.width = '0%';
  progressText.textContent = "Uploading file... please wait";
  
  const formData = new FormData();
  formData.append('file', file);
  formData.append('project_id', activeProjectId);
  if (taskType === 'image_classification') {
    formData.append('file_type', 'zip');
  }
  
  const uploadUrl = taskType === 'object_detection' 
    ? `/upload-detection-dataset/${datasetId}?task_type=${taskType}&dataset_name=${encodeURIComponent(name)}`
    : `/upload-dataset/${datasetId}?task_type=${taskType}&dataset_name=${encodeURIComponent(name)}`;
    
  // Using XMLHttpRequest for upload progress
  const xhr = new XMLHttpRequest();
  xhr.open('POST', uploadUrl);
  
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      progressFill.style.width = pct + '%';
      progressText.textContent = `Uploading: ${pct}% (${Math.round(e.loaded/1024/1024)}MB / ${Math.round(e.total/1024/1024)}MB)`;
    }
  };
  
  xhr.onload = () => {
    submitBtn.disabled = false;
    if (xhr.status === 200) {
      progressText.textContent = "Processing finished! Dataset uploaded successfully.";
      progressFill.style.width = '100%';
      setTimeout(() => {
        progressBox.style.display = 'none';
        fileInput.value = '';
        const modal = document.getElementById('uploadDatasetOverlay');
        if (modal) modal.classList.remove('active');
        loadDatasets();
      }, 1500);
    } else {
      progressText.textContent = "Upload failed: " + xhr.responseText;
      setTimeout(() => { progressBox.style.display = 'none'; }, 5000);
    }
  };
  
  xhr.onerror = () => {
    submitBtn.disabled = false;
    progressText.textContent = "Network error during upload.";
    setTimeout(() => { progressBox.style.display = 'none'; }, 5000);
  };
  
  xhr.send(formData);
}

// Datacard Validation Details Modal Drawer
async function openDatacardValidation(datasetId, datasetName) {
  const modal = document.getElementById('datacardOverlay');
  const markdown = document.getElementById('datacardMarkdown');
  const dist = document.getElementById('datacardDistributionContainer');
  const counter = document.getElementById('sampleImageCounter');
  const display = document.getElementById('sampleImageDisplay');
  const label = document.getElementById('sampleImageLabel');
  
  document.getElementById('datacardModalTitle').textContent = `Data Card: ${datasetName}`;
  markdown.innerHTML = 'Generating and compiling Responsible AI validation report... please wait...';
  dist.innerHTML = 'Loading distribution metrics...';
  counter.textContent = '0 / 0';
  display.src = '';
  label.textContent = '';
  
  modal.classList.add('active');
  switchDatacardTab('report');
  
  try {
    const res = await fetch(`/responsible-ai/dataset-validation/${datasetId}`, { method: 'POST' });
    if (!res.ok) throw new Error("Failed to generate validation report");
    const result = await res.json();
    
    // 1. Markdown Report
    if (result.data_card_markdown) {
      // Basic markdown inline parser
      let html = result.data_card_markdown
        .replace(/### (.*)/g, '<h3>$1</h3>')
        .replace(/## (.*)/g, '<h2>$1</h2>')
        .replace(/# (.*)/g, '<h1>$1</h1>')
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.*?)\*/g, '<i>$1</i>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
      markdown.innerHTML = html;
    } else {
      markdown.innerHTML = 'No report markdown returned.';
    }
    
    // 2. Class Distribution Progress Bars
    dist.innerHTML = '';
    const classCounts = result.class_distribution || {};
    const classKeys = Object.keys(classCounts);
    
    if (classKeys.length === 0) {
      dist.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">No distribution metrics returned.</p>';
    } else {
      const maxCount = Math.max(...Object.values(classCounts), 0);
      classKeys.forEach(cls => {
        const count = classCounts[cls];
        const barPct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
        
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.gap = '4px';
        
        wrapper.innerHTML = `
          <div style="display: flex; justify-content: space-between; font-size: 11px; align-items: center; font-weight: 500;">
            <span style="color: var(--text-secondary);">${cls}</span>
            <span style="color: var(--text); font-weight: 600; font-family: monospace;">${count}</span>
          </div>
          <div style="background: rgba(0,0,0,0.06); height: 8px; border-radius: 4px; overflow: hidden; width: 100%;">
            <div style="background: var(--accent); width: ${barPct}%; height: 100%; border-radius: 4px; transition: width 0.3s ease;"></div>
          </div>
        `;
        dist.appendChild(wrapper);
      });
    }
    
    // 3. Slideshow images setup
    sampleImages = result.sample_images || [];
    currentSampleIdx = 0;
    renderSampleImage();
    
  } catch (err) {
    markdown.innerHTML = `<span style="color: var(--danger);">${err.message}</span>`;
    dist.innerHTML = '';
  }
}

function switchDatacardTab(tab) {
  // Toggle active button styling
  const btns = {
    report: document.getElementById('tabBtnReport'),
    distribution: document.getElementById('tabBtnDistribution'),
    samples: document.getElementById('tabBtnSamples')
  };
  Object.keys(btns).forEach(k => {
    btns[k].style.color = 'var(--text-secondary)';
    btns[k].style.borderBottom = 'none';
    btns[k].style.fontWeight = '500';
  });
  btns[tab].style.color = 'var(--accent)';
  btns[tab].style.borderBottom = '2px solid var(--accent)';
  btns[tab].style.fontWeight = '600';

  // Toggle visible pane
  const views = {
    report: document.getElementById('datacardReportView'),
    distribution: document.getElementById('datacardDistributionView'),
    samples: document.getElementById('datacardSamplesView')
  };
  Object.keys(views).forEach(k => {
    views[k].style.display = 'none';
  });
  views[tab].style.display = 'block';
}

function renderSampleImage() {
  const display = document.getElementById('sampleImageDisplay');
  const label = document.getElementById('sampleImageLabel');
  const counter = document.getElementById('sampleImageCounter');
  
  if (sampleImages.length === 0) {
    display.src = '';
    label.textContent = "No samples available";
    counter.textContent = "0 / 0";
    return;
  }
  
  const img = sampleImages[currentSampleIdx];
  display.src = `data:image/jpeg;base64,${img.image_base64}`;
  label.textContent = img.class_name;
  counter.textContent = `${currentSampleIdx + 1} / ${sampleImages.length}`;
}

// ==================== MODEL GARDEN & JOBS ====================

async function loadDatasetsForSelect() {
  const select = document.getElementById('trainDatasetSelect');
  select.innerHTML = '';
  
  try {
    const res = await fetch(`/datasets/available?project_id=${activeProjectId}`);
    if (!res.ok) throw new Error();
    const dList = await res.json();
    
    if (!dList || dList.length === 0) {
      select.innerHTML = '<option value="">No datasets available. Upload a dataset first.</option>';
      return;
    }
    dList.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.name || d.id} (${d.task_type.replace('_', ' ')})`;
      select.appendChild(opt);
    });
  } catch (err) {
    select.innerHTML = '<option value="">Error loading datasets</option>';
  }
}

async function loadJobs() {
  const tbody = document.getElementById('jobsTableBody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">Loading pipelines...</td></tr>';
  
  try {
    const res = await fetch(`/pipelines?project_id=${activeProjectId}`);
    if (!res.ok) throw new Error("Failed to load pipelines list");
    jobs = await res.json();
    
    // Sort jobs by created date descending
    jobs.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    
    // Check if there is any actively running job we should poll
    const runningJob = jobs.find(j => j.status === 'running' || j.status === 'training');
    if (runningJob) {
      startPolling(runningJob.id);
    } else {
      stopPolling();
    }
    
    renderJobsTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger);">${err.message}</td></tr>`;
  }
}

function renderJobsTable() {
  const tbody = document.getElementById('jobsTableBody');
  const searchVal = document.getElementById('jobsSearch').value.trim().toLowerCase();
  
  tbody.innerHTML = '';
  
  if (!jobs || jobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">No pipeline runs found.</td></tr>';
    return;
  }
  
  const filtered = jobs.filter(j => {
    const config = j.pipeline_config || {};
    const name = (config.name || '').toLowerCase();
    const id = (j.id || '').toLowerCase();
    const status = (j.status || '').toLowerCase();
    const model = (config.architecture || '').toLowerCase();
    const task = (config.task_type || '').toLowerCase();
    return name.includes(searchVal) || id.includes(searchVal) || status.includes(searchVal) || model.includes(searchVal) || task.includes(searchVal);
  });
  
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">No matching pipelines found.</td></tr>';
    return;
  }
  
  filtered.forEach(j => {
    const id = j.id;
    const config = j.pipeline_config || {};
    const status = j.status || 'pending';
    const created = j.created_at ? j.created_at.substring(0, 10) : 'N/A';
    const model = config.architecture || 'N/A';
    const task = config.task_type ? config.task_type.replace('_', ' ') : 'N/A';
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code style="font-size:11px;">${id.substring(0, 8)}...</code></td>
      <td><b>${config.name || 'N/A'}</b></td>
      <td><span class="status-badge ${status.toLowerCase()}">${status}</span></td>
      <td>${created}</td>
      <td>${model}</td>
      <td>${task}</td>
      <td style="text-align: right; display:flex; gap:4px; justify-content: flex-end;">
        <button class="btn" style="padding: 2px 6px; font-size:11px; height:24px;" onclick="openJobLogs('${id}', event)"><i data-lucide="terminal" style="width:11px; height:11px;"></i> Logs</button>
        <button class="btn" style="padding: 2px 6px; font-size:11px; height:24px;" onclick="openJobCurves('${id}', event)"><i data-lucide="line-chart" style="width:11px; height:11px;"></i> Curves</button>
        <button class="btn danger" style="padding: 4px; height:24px; width:24px; min-width:24px;" onclick="handleDeleteJob('${id}', event)"><i data-lucide="trash-2" style="width:12px; height:12px;"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  if (window.lucide) lucide.createIcons();
}

async function loadModelGarden() {
  const tbody = document.getElementById('modelGardenTableBody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">Loading models...</td></tr>';
  
  try {
    const res = await fetch(`/pipelines?project_id=${activeProjectId}`);
    if (!res.ok) throw new Error("Failed to load models list");
    const allJobs = await res.json();
    
    tbody.innerHTML = '';
    
    // Filter for completed/success status
    modelGardenJobs = allJobs.filter(j => {
      const status = (j.status || '').toLowerCase();
      return status === 'completed' || status === 'success';
    });
    
    // Sort by creation date descending
    modelGardenJobs.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    
    renderModelGardenTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--danger);">${err.message}</td></tr>`;
  }
}

function renderModelGardenTable() {
  const tbody = document.getElementById('modelGardenTableBody');
  const searchVal = document.getElementById('modelGardenSearch').value.trim().toLowerCase();
  
  tbody.innerHTML = '';
  
  if (!modelGardenJobs || modelGardenJobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">No completed models found. Run a training job to train a model.</td></tr>';
    return;
  }
  
  const filtered = modelGardenJobs.filter(j => {
    const config = j.pipeline_config || {};
    const name = (config.name || '').toLowerCase();
    const id = (j.id || '').toLowerCase();
    const model = (config.architecture || '').toLowerCase();
    const task = (config.task_type || '').toLowerCase();
    return name.includes(searchVal) || id.includes(searchVal) || model.includes(searchVal) || task.includes(searchVal);
  });
  
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">No matching completed models found.</td></tr>';
    return;
  }
  
  filtered.forEach(j => {
    const id = j.id;
    const config = j.pipeline_config || {};
    const model = config.architecture || 'N/A';
    const task = config.task_type ? config.task_type.replace('_', ' ') : 'N/A';
    const epochs = config.epochs || 'N/A';
    
    // Metrics parsing
    let acc = 'N/A';
    let loss = 'N/A';
    if (j.metrics) {
      const a = j.metrics.accuracy || j.metrics.val_acc || j.metrics.val_accuracy || j.metrics.map_50;
      const l = j.metrics.loss || j.metrics.val_loss;
      if (a !== undefined) acc = Number(a).toFixed(4);
      if (l !== undefined) loss = Number(l).toFixed(4);
    }
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code style="font-size:11px;">${id.substring(0, 8)}...</code></td>
      <td><b>${config.name || 'N/A'}</b></td>
      <td>${model}</td>
      <td>${task}</td>
      <td>${epochs}</td>
      <td>${acc}</td>
      <td>${loss}</td>
      <td style="text-align: right; display:flex; gap:4px; justify-content: flex-end;">
        <button class="btn primary" style="padding: 2px 6px; font-size:11px; height:24px;" onclick="openModelCard('${id}', event)"><i data-lucide="file-text" style="width:11px; height:11px;"></i> Model Card</button>
        <button class="btn" style="padding: 2px 6px; font-size:11px; height:24px;" onclick="openJobCurves('${id}', event)"><i data-lucide="line-chart" style="width:11px; height:11px;"></i> Curves</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  if (window.lucide) lucide.createIcons();
}

async function handleDeleteJob(jobId, event) {
  if (event) event.stopPropagation();
  if (!confirm("Are you sure you want to delete this training pipeline run? This will delete the model weights and all logs.")) {
    return;
  }
  
  try {
    const res = await fetch(`/pipelines/${jobId}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to delete pipeline");
    }
    
    alert("Pipeline deleted successfully.");
    loadJobs();
  } catch (err) {
    alert("Error deleting pipeline: " + err.message);
  }
}

window.handleDeleteJob = handleDeleteJob;


async function handleStartTraining() {
  const name = document.getElementById('trainPipelineName').value.trim();
  const datasetSelect = document.getElementById('trainDatasetSelect');
  const datasetId = datasetSelect.value;
  const arch = document.getElementById('trainArchitecture').value;
  const epochs = parseInt(document.getElementById('trainEpochs').value) || 5;
  const batchSize = parseInt(document.getElementById('trainBatchSize').value) || 8;
  const lr = parseFloat(document.getElementById('trainLr').value) || 0.001;
  const augment = document.getElementById('trainAugment').checked;
  const earlyStop = document.getElementById('trainEarlyStop').checked;
  
  if (!datasetId) {
    alert("Please select a dataset to train on.");
    return;
  }
  
  const submitIcon = document.getElementById('startTrainingIcon');
  submitIcon.className = 'spin';
  submitIcon.innerHTML = `<path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>`; // Loading spinner icon
  
  const payload = {
    name: name || "My Pipeline",
    task_type: activeProject.task_type,
    architecture: arch,
    batch_size: batchSize,
    epochs: epochs,
    learning_rate: lr,
    early_stopping: earlyStop,
    feature_extraction_only: false,
    patience: 3,
    num_classes: activeProject.classes.length,
    image_size: [224, 224],
    augmentation_enabled: augment,
    project_id: activeProjectId,
    dataset_id: datasetId
  };
  
  try {
    const res = await fetch('/pipelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) throw new Error("Failed to start training run");
    const job = await res.json();
    
    // Reset start button icon
    submitIcon.className = '';
    submitIcon.innerHTML = '';
    
    // Poll progress
    startPolling(job.id);
    loadJobs();
    
  } catch (err) {
    submitIcon.className = '';
    submitIcon.innerHTML = '';
    alert("Error launching training: " + err.message);
  }
}

// Status & log polling helper
function startPolling(jobId) {
  if (pollingInterval) clearInterval(pollingInterval);
  activeJobId = jobId;
  
  const activeBox = document.getElementById('activeJobStatusBox');
  if (activeBox) activeBox.style.display = 'flex';
  
  pollActiveJob(); // Run first immediately
  pollingInterval = setInterval(pollActiveJob, 2000);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  activeJobId = null;
  const activeBox = document.getElementById('activeJobStatusBox');
  if (activeBox) activeBox.style.display = 'none';
}

async function pollActiveJob() {
  if (!activeJobId) return;
  
  try {
    const res = await fetch(`/pipelines/${activeJobId}`);
    if (!res.ok) throw new Error();
    const job = await res.json();
    
    // Render status
    const statusLabel = document.getElementById('activeJobStatusLabel');
    if (statusLabel) statusLabel.textContent = job.status.toUpperCase();
    
    // Render logs
    const consoleEl = document.getElementById('activeJobLogs');
    if (consoleEl) {
      if (job.logs && job.logs.length > 0) {
        consoleEl.textContent = job.logs.join('\n');
        consoleEl.scrollTop = consoleEl.scrollHeight; // Auto scroll to bottom
      } else {
        consoleEl.textContent = "Initializing pipeline run... logs will print here.";
      }
    }
    
    // Stop condition
    if (job.status !== 'running' && job.status !== 'training') {
      stopPolling();
      loadJobs();
      alert(`Training run completed with status: ${job.status.toUpperCase()}`);
    }
  } catch (err) {
    console.error("Polling status error: ", err);
  }
}

// Logs Modal Viewer
async function openJobLogs(jobId, event) {
  event.stopPropagation();
  const modal = document.getElementById('logsOverlay');
  const consoleEl = document.getElementById('logsModalConsole');
  document.getElementById('logsModalTitle').textContent = `Pipeline Logs: ${jobId.substring(0,8)}`;
  consoleEl.textContent = 'Loading training logs...';
  modal.classList.add('active');
  
  try {
    const res = await fetch(`/pipelines/${jobId}`);
    if (!res.ok) throw new Error("Failed to load logs");
    const data = await res.json();
    
    if (data.logs && data.logs.length > 0) {
      consoleEl.textContent = data.logs.join('\n');
    } else {
      consoleEl.textContent = 'No logs available for this pipeline run.';
    }
  } catch (err) {
    consoleEl.textContent = 'Failed to load logs: ' + err.message;
  }
}

// Curves Modal Viewer
async function openJobCurves(jobId, event) {
  event.stopPropagation();
  const modal = document.getElementById('curvesOverlay');
  document.getElementById('curvesModalTitle').textContent = `Training Curves: ${jobId.substring(0,8)}`;
  modal.classList.add('active');
  
  const canvas = document.getElementById('curvesCanvas');
  const metricTypeSelect = document.getElementById('curvesMetricSelect');
  
  // Save current job ID on metric dropdown element to query it
  metricTypeSelect.setAttribute('data-job-id', jobId);
  
  // Trigger rendering when metric selector changes
  metricTypeSelect.onchange = () => drawCurvesForJob(jobId);
  
  drawCurvesForJob(jobId);
}

async function drawCurvesForJob(jobId) {
  const canvas = document.getElementById('curvesCanvas');
  const ctx = canvas.getContext('2d');
  const metricType = document.getElementById('curvesMetricSelect').value;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Display loading
  ctx.font = '13px Inter';
  ctx.fillStyle = '#86868b';
  ctx.textAlign = 'center';
  ctx.fillText('Loading curves data...', canvas.width / 2, canvas.height / 2);
  
  try {
    const res = await fetch(`/pipelines/${jobId}`);
    if (!res.ok) throw new Error();
    const job = await res.json();
    
    const history = job.history || [];
    if (history.length === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillText('No epochs training metrics available yet.', canvas.width / 2, canvas.height / 2);
      return;
    }
    
    // Parse epochs and metric arrays
    const epochs = history.map(h => h.epoch !== undefined ? h.epoch : h.iter !== undefined ? h.iter : 1);
    
    let trainVal = [];
    let valVal = [];
    let yMax = 1;
    let yMin = 0;
    
    if (metricType === 'accuracy') {
      trainVal = history.map(h => {
        let v = h.train_acc !== undefined ? h.train_acc : h.accuracy !== undefined ? h.accuracy : h.train_accuracy !== undefined ? h.train_accuracy : h.acc || 0;
        return v > 1 ? v / 100 : v;
      });
      valVal = history.map(h => {
        let v = h.val_acc !== undefined ? h.val_acc : h.val_accuracy || 0;
        return v > 1 ? v / 100 : v;
      });
      yMax = 1;
      yMin = 0;
    } else {
      trainVal = history.map(h => h.train_loss !== undefined ? h.train_loss : h.loss || 0);
      valVal = history.map(h => h.val_loss || 0);
      
      const maxVal = Math.max(...trainVal, ...valVal, 1);
      yMax = maxVal * 1.1;
      yMin = 0;
    }
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Setup drawing metrics dimensions
    const paddingLeft = 40;
    const paddingRight = 80;
    const paddingTop = 30;
    const paddingBottom = 40;
    
    const chartW = canvas.width - paddingLeft - paddingRight;
    const chartH = canvas.height - paddingTop - paddingBottom;
    
    // Draw Grid Lines & Borders
    ctx.strokeStyle = '#e9ecef';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#86868b';
    ctx.font = '9px Inter';
    ctx.textAlign = 'right';
    
    // Y axis labels (draw 5 lines)
    for (let i = 0; i <= 4; i++) {
      const yFraction = i / 4;
      const yVal = yMin + yFraction * (yMax - yMin);
      const yPx = canvas.height - paddingBottom - yFraction * chartH;
      
      // Draw grid line
      ctx.beginPath();
      ctx.moveTo(paddingLeft, yPx);
      ctx.lineTo(canvas.width - paddingRight, yPx);
      ctx.stroke();
      
      // Label
      const labelText = metricType === 'accuracy' ? Math.round(yVal * 100) + '%' : yVal.toFixed(2);
      ctx.fillText(labelText, paddingLeft - 6, yPx + 3);
    }
    
    // X axis labels
    const totalEpochs = epochs.length;
    ctx.textAlign = 'center';
    epochs.forEach((e, idx) => {
      const xPx = paddingLeft + (idx / Math.max(1, totalEpochs - 1)) * chartW;
      ctx.fillText(`E${e}`, xPx, canvas.height - paddingBottom + 14);
    });
    
    // Helper to map values to coordinates
    const getXPx = (idx) => paddingLeft + (idx / Math.max(1, totalEpochs - 1)) * chartW;
    const getYPx = (val) => canvas.height - paddingBottom - ((val - yMin) / (yMax - yMin)) * chartH;
    
    // 1. Draw Training line
    ctx.strokeStyle = metricType === 'accuracy' ? '#0071e3' : '#ff3b30'; // Blue or Red
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    trainVal.forEach((v, idx) => {
      const x = getXPx(idx);
      const y = getYPx(v);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    
    // Draw dots for Training
    ctx.fillStyle = ctx.strokeStyle;
    trainVal.forEach((v, idx) => {
      ctx.beginPath();
      ctx.arc(getXPx(idx), getYPx(v), 3.5, 0, 2 * Math.PI);
      ctx.fill();
    });
    
    // 2. Draw Validation line (if validation exists)
    const hasVal = valVal.some(v => v > 0);
    if (hasVal) {
      ctx.strokeStyle = metricType === 'accuracy' ? '#ff9500' : '#89898f'; // Orange or Grey
      ctx.beginPath();
      valVal.forEach((v, idx) => {
        const x = getXPx(idx);
        const y = getYPx(v);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      
      // Draw dots for Validation
      ctx.fillStyle = ctx.strokeStyle;
      valVal.forEach((v, idx) => {
        ctx.beginPath();
        ctx.arc(getXPx(idx), getYPx(v), 3.5, 0, 2 * Math.PI);
        ctx.fill();
      });
    }
    
    // Draw Legends on the right margin
    const legX = canvas.width - paddingRight + 12;
    ctx.textAlign = 'left';
    ctx.font = '10px Inter';
    ctx.fontWeight = '600';
    
    // Train Legend
    ctx.fillStyle = metricType === 'accuracy' ? '#0071e3' : '#ff3b30';
    ctx.fillRect(legX, paddingTop + 6, 10, 4);
    ctx.fillText('Train', legX + 15, paddingTop + 10);
    
    // Val Legend
    if (hasVal) {
      ctx.fillStyle = metricType === 'accuracy' ? '#ff9500' : '#89898f';
      ctx.fillRect(legX, paddingTop + 22, 10, 4);
      ctx.fillText('Validation', legX + 15, paddingTop + 26);
    }
    
  } catch (err) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillText('Failed to load curves: ' + err.message, canvas.width / 2, canvas.height / 2);
  }
}

// Model Card Modal Viewer
async function openModelCard(jobId, event) {
  event.stopPropagation();
  const modal = document.getElementById('modelCardOverlay');
  const cardDiv = document.getElementById('modelCardMarkdown');
  cardDiv.innerHTML = 'Fetching and rendering model card... please wait...';
  modal.classList.add('active');
  
  try {
    const res = await fetch(`/pipelines/${jobId}/model-card`);
    if (!res.ok) throw new Error("Failed to load model card details");
    const result = await res.json();
    
    if (result.model_card_markdown) {
      let html = result.model_card_markdown
        .replace(/### (.*)/g, '<h3>$1</h3>')
        .replace(/## (.*)/g, '<h2>$1</h2>')
        .replace(/# (.*)/g, '<h1>$1</h1>')
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.*?)\*/g, '<i>$1</i>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
      cardDiv.innerHTML = html;
    } else {
      cardDiv.innerHTML = 'No model card metadata returned.';
    }
  } catch (err) {
    cardDiv.innerHTML = `<span style="color: var(--danger);">${err.message}</span>`;
  }
}
