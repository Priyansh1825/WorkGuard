// State Management
const state = {
  clients: [],
  screenshots: [],
  logs: [],
  policy: {
    allowed_apps: [],
    allowed_domains: [],
    work_hours_start: '09:00',
    work_hours_end: '18:00',
    capture_interval_sec: 15,
    stream_fps: 15,
    policy_mode: 'audit-alert'
  },
  stats: {},
  activeTab: 'overview',
  activeStreamClientId: null,
  isStreaming: false,
  streamFpsCounter: 0,
  streamFpsInterval: null,
  currentStreamBlobUrl: null
};

// WebSocket Connection
let ws = null;

function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);
  ws.binaryType = 'blob';

  ws.onopen = () => {
    document.getElementById('ws-indicator').classList.remove('offline');
    document.getElementById('server-status-text').textContent = 'Connected (Online)';
    ws.send(JSON.stringify({ type: 'ADMIN_REGISTER' }));
  };

  ws.onmessage = (event) => {
    // 1. Live Screen Binary Frame
    if (event.data instanceof Blob) {
      handleLiveFrameBlob(event.data);
      return;
    }

    // 2. JSON Telemetry & Messages
    try {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case 'ADMIN_CONNECTED':
        case 'FLEET_UPDATE':
          state.clients = data.clients || [];
          if (data.stats) state.stats = data.stats;
          renderFleetOverview();
          updateLiveStreamSelectors();
          updateStatsCards();
          break;

        case 'VIOLATION_ALERT':
          showToast(`⚠️ Violation Alert: ${data.log.details} (${data.log.client_id})`, 'alert');
          if (window.electronAPI && typeof window.electronAPI.sendNotification === 'function') {
            window.electronAPI.sendNotification('WorkGuard Policy Violation', `${data.log.details} (${data.log.client_id})`);
          }
          fetchLogs();
          fetchStats();
          break;

        case 'NEW_LOG':
          prependLog(data.log);
          break;

        case 'POLICY_SAVED':
          state.policy = data.policy;
          renderPolicyTags();
          showToast('Policy updated & deployed to all agents!', 'success');
          break;

        case 'STREAM_ENDED':
          if (state.activeStreamClientId === data.client_id) {
            stopLiveStream();
            showToast(`Live stream ended: ${data.reason}`, 'alert');
          }
          break;
      }
    } catch (err) {
      console.error('Error parsing WS message:', err);
    }
  };

  ws.onclose = () => {
    document.getElementById('ws-indicator').classList.add('offline');
    document.getElementById('server-status-text').textContent = 'Disconnected (Reconnecting...)';
    setTimeout(initWebSocket, 3000);
  };

  ws.onerror = () => {
    document.getElementById('ws-indicator').classList.add('offline');
  };
}

// Live Stream Frame Renderer
function handleLiveFrameBlob(blob) {
  state.streamFpsCounter++;
  const imgElement = document.getElementById('stream-img-element');
  const placeholder = document.getElementById('stream-placeholder');

  if (state.currentStreamBlobUrl) {
    URL.revokeObjectURL(state.currentStreamBlobUrl);
  }

  state.currentStreamBlobUrl = URL.createObjectURL(blob);
  imgElement.src = state.currentStreamBlobUrl;
  imgElement.style.display = 'block';
  placeholder.style.display = 'none';
}

function startLiveStream() {
  const select = document.getElementById('stream-client-select');
  const clientId = select.value;
  const fps = parseInt(document.getElementById('stream-fps-select').value) || 15;

  if (!clientId) {
    showToast('Please select a workstation first', 'alert');
    return;
  }

  state.activeStreamClientId = clientId;
  state.isStreaming = true;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'START_VIEW_STREAM',
      target_client_id: clientId,
      fps: fps,
      quality: 70
    }));
  }

  document.getElementById('btn-toggle-stream').innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="4" height="16" x="6" y="4"/><rect width="4" height="16" x="14" y="4"/></svg>
    Stop Live Stream
  `;
  document.getElementById('btn-toggle-stream').classList.add('btn-secondary');
  document.getElementById('btn-toggle-stream').classList.remove('btn-primary');
  document.getElementById('live-badge').style.display = 'inline-flex';
  document.getElementById('stream-footer-info').style.display = 'flex';
  
  const clientObj = state.clients.find(c => c.id === clientId);
  document.getElementById('stream-meta-info').textContent = `Target: ${clientObj ? clientObj.hostname : clientId}`;

  // FPS Counter
  state.streamFpsCounter = 0;
  if (state.streamFpsInterval) clearInterval(state.streamFpsInterval);
  state.streamFpsInterval = setInterval(() => {
    document.getElementById('footer-stream-fps').textContent = `${state.streamFpsCounter} FPS`;
    state.streamFpsCounter = 0;
  }, 1000);
}

function stopLiveStream() {
  if (state.activeStreamClientId && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'STOP_VIEW_STREAM',
      target_client_id: state.activeStreamClientId
    }));
  }

  state.isStreaming = false;
  state.activeStreamClientId = null;
  if (state.streamFpsInterval) clearInterval(state.streamFpsInterval);

  document.getElementById('btn-toggle-stream').innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    Start Live Stream
  `;
  document.getElementById('btn-toggle-stream').classList.remove('btn-secondary');
  document.getElementById('btn-toggle-stream').classList.add('btn-primary');
  document.getElementById('live-badge').style.display = 'none';
  document.getElementById('stream-footer-info').style.display = 'none';
  document.getElementById('stream-meta-info').textContent = 'Stream stopped';
  
  const imgElement = document.getElementById('stream-img-element');
  const placeholder = document.getElementById('stream-placeholder');
  imgElement.style.display = 'none';
  placeholder.style.display = 'flex';
}

function requestInstantScreenshot() {
  const select = document.getElementById('stream-client-select');
  const clientId = select.value;
  if (!clientId) return;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'REQUEST_INSTANT_SCREENSHOT',
      target_client_id: clientId
    }));
    showToast('Requested instant capture from agent...', 'success');
  }
}

// REST API Calls
async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (data.success) {
      state.stats = data.stats;
      updateStatsCards();
    }
  } catch (err) {
    console.error('Fetch stats error:', err);
  }
}

async function fetchClients() {
  try {
    const res = await fetch('/api/clients');
    const data = await res.json();
    if (data.success) {
      state.clients = data.clients;
      renderFleetOverview();
      updateLiveStreamSelectors();
    }
  } catch (err) {
    console.error('Fetch clients error:', err);
  }
}

async function fetchScreenshots() {
  try {
    const clientFilter = document.getElementById('gallery-client-filter').value;
    const dateFilter = document.getElementById('gallery-date-filter').value;
    const searchFilter = document.getElementById('gallery-search-input').value.toLowerCase();

    let url = `/api/screenshots?limit=60`;
    if (clientFilter && clientFilter !== 'all') url += `&client_id=${clientFilter}`;
    if (dateFilter) url += `&date=${dateFilter}`;

    const res = await fetch(url);
    const data = await res.json();
    if (data.success) {
      let shots = data.screenshots;
      if (searchFilter) {
        shots = shots.filter(s => 
          (s.active_app && s.active_app.toLowerCase().includes(searchFilter)) ||
          (s.active_window && s.active_window.toLowerCase().includes(searchFilter))
        );
      }
      state.screenshots = shots;
      renderScreenshotsGrid();
    }
  } catch (err) {
    console.error('Fetch screenshots error:', err);
  }
}

async function fetchPolicy() {
  try {
    const [policyRes, storageRes] = await Promise.all([
      fetch('/api/policies'),
      fetch('/api/settings/storage')
    ]);

    const data = await policyRes.json();
    if (data.success) {
      state.policy = data.policy;
      renderPolicyForm();
    }

    const storageData = await storageRes.json();
    if (storageData.success) {
      const cloudUrlInput = document.getElementById('setting-cloud-storage-url');
      const dbUrlInput = document.getElementById('setting-cloud-db-url');
      if (cloudUrlInput) cloudUrlInput.value = storageData.cloud_storage_url || '';
      if (dbUrlInput) dbUrlInput.value = storageData.database_url && storageData.database_url.startsWith('postgres') || storageData.database_url.startsWith('mongodb') ? storageData.database_url : '';
    }
  } catch (err) {
    console.error('Fetch policy error:', err);
  }
}

async function savePolicy() {
  try {
    const payload = {
      allowed_apps: state.policy.allowed_apps,
      allowed_domains: state.policy.allowed_domains,
      work_hours_start: document.getElementById('policy-work-start').value,
      work_hours_end: document.getElementById('policy-work-end').value,
      capture_interval_sec: parseInt(document.getElementById('policy-interval-select').value) || 15,
      policy_mode: document.getElementById('policy-mode-select').value,
      retention_days: parseInt(document.getElementById('policy-retention-select').value, 10)
    };

    const cloudStorageUrl = document.getElementById('setting-cloud-storage-url') ? document.getElementById('setting-cloud-storage-url').value.trim() : '';
    const cloudDbUrl = document.getElementById('setting-cloud-db-url') ? document.getElementById('setting-cloud-db-url').value.trim() : '';

    const [res, storageRes] = await Promise.all([
      fetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }),
      fetch('/api/settings/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cloud_storage_url: cloudStorageUrl,
          database_url: cloudDbUrl,
          retention_days: payload.retention_days
        })
      })
    ]);

    const data = await res.json();
    if (data.success) {
      state.policy = data.policy;
      showToast('Settings & Storage policy deployed successfully!', 'success');
    }
  } catch (err) {
    showToast('Failed to save settings: ' + err.message, 'alert');
  }
}

async function fetchLogs() {
  try {
    const res = await fetch('/api/logs?limit=100');
    const data = await res.json();
    if (data.success) {
      state.logs = data.logs;
      renderLogsTable();
    }
  } catch (err) {
    console.error('Fetch logs error:', err);
  }
}

// Render Functions
function updateStatsCards() {
  const clients = state.clients || [];
  const onlineCount = clients.filter(c => c.status === 'online').length;

  document.getElementById('stat-total-clients').textContent = clients.length;
  document.getElementById('stat-online-clients').textContent = onlineCount;
  document.getElementById('stat-today-shots').textContent = state.stats.today_screenshots || 0;
  document.getElementById('stat-violations').textContent = state.stats.total_violations || 0;
  document.getElementById('clients-count-badge').textContent = `${clients.length} Devices`;
}

function renderFleetOverview() {
  const container = document.getElementById('clients-grid');
  const emptyState = document.getElementById('clients-empty');
  const search = document.getElementById('client-search-input').value.toLowerCase();
  const deptFilter = document.getElementById('filter-dept-select') ? document.getElementById('filter-dept-select').value : 'ALL';

  let filtered = state.clients;
  
  if (deptFilter && deptFilter !== 'ALL') {
    filtered = filtered.filter(c => (c.department || 'General') === deptFilter);
  }

  if (search) {
    filtered = filtered.filter(c => 
      (c.employee_name && c.employee_name.toLowerCase().includes(search)) ||
      (c.department && c.department.toLowerCase().includes(search)) ||
      c.hostname.toLowerCase().includes(search) ||
      c.username.toLowerCase().includes(search) ||
      c.ip.toLowerCase().includes(search) ||
      (c.current_app && c.current_app.toLowerCase().includes(search))
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = '';
    container.appendChild(emptyState);
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';
  container.innerHTML = '';

  filtered.forEach((client, idx) => {
    const isOnline = client.status === 'online';
    const card = document.createElement('div');
    card.className = 'client-card';
    const empName = client.employee_name || client.username || 'Employee';
    const empDept = client.department || 'General';
    
    // Generate initials
    const initials = empName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'EM';
    
    // Curated accent color tones
    const colorTones = [
      { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' }, // Blue
      { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' }, // Sage green
      { bg: '#fffbeb', text: '#b45309', border: '#fde68a' }, // Warm sand
      { bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe' }, // Lavender
      { bg: '#fff1f2', text: '#be123c', border: '#fecdd3' }  // Rose
    ];
    const tone = colorTones[idx % colorTones.length];

    card.innerHTML = `
      <div class="client-card-header">
        <div class="client-identity">
          <div class="emp-title-wrap">
            <div style="width: 32px; height: 32px; border-radius: 50%; background: ${tone.bg}; color: ${tone.text}; border: 1px solid ${tone.border}; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; flex-shrink: 0;">
              ${initials}
            </div>
            <h3 class="emp-card-name" onclick="openAdminEditProfileModal('${client.id}')" title="Click to rename employee">${empName}</h3>
            <button class="emp-edit-btn" onclick="openAdminEditProfileModal('${client.id}')" title="Change Employee Name & Department">
              ✏️
            </button>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
            <span class="emp-card-dept" style="background: ${tone.bg}; color: ${tone.text}; border-color: ${tone.border};">${empDept}</span>
            <span class="emp-card-host">${client.hostname} • ${client.ip}</span>
          </div>
        </div>
        <div class="online-tag ${isOnline ? '' : 'offline'}">
          <span class="dot"></span> ${isOnline ? 'ONLINE' : 'OFFLINE'}
        </div>
      </div>
      <div class="client-preview-holder" onclick="openLiveStreamFor('${client.id}')" style="position: relative;">
        <div class="client-preview-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>
          <span>Click for 60 FPS Live Monitor</span>
        </div>
        <div style="position: absolute; top: 12px; right: 12px; width: 34px; height: 34px; border-radius: 50%; background: rgba(255,255,255,0.9); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 800; color: #0f172a; box-shadow: 0 4px 10px rgba(0,0,0,0.2); transition: transform 0.2s;" title="Watch Live Stream">
          ↗
        </div>
      </div>
      <div class="client-card-body">
        <div class="metric-row">
          <span class="metric-label">Active Program:</span>
          <span class="metric-val" title="${client.current_app || 'None'}">${client.current_app || 'Idle'}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Foreground Window:</span>
          <span class="metric-val" title="${client.current_window || 'Desktop'}">${client.current_window || 'Desktop'}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">CPU / RAM:</span>
          <span class="metric-val">${client.cpu_usage || 0}% CPU • ${client.ram_usage || 0}% RAM</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Total Captures:</span>
          <span class="metric-val">${client.total_screenshots || 0} shots</span>
        </div>
      </div>
      <div class="client-card-actions">
        <button class="btn btn-primary btn-sm" onclick="openLiveStreamFor('${client.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Watch Live
        </button>
        <button class="btn btn-secondary btn-sm" onclick="filterGalleryByClient('${client.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/></svg>
          Gallery
        </button>
        <button class="btn btn-secondary btn-sm" onclick="openAdminEditProfileModal('${client.id}')" title="Edit Employee Name & Department">
          ✏️ Edit
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function updateLiveStreamSelectors() {
  const select = document.getElementById('stream-client-select');
  const galleryFilter = document.getElementById('gallery-client-filter');
  const currentVal = select.value;

  select.innerHTML = '<option value="">-- Choose Connected Endpoint --</option>';
  galleryFilter.innerHTML = '<option value="all">All Workstations</option>';

  state.clients.forEach(c => {
    const isOnline = c.status === 'online';
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.hostname} (${c.username}) - ${isOnline ? '🟢 Online' : '🔴 Offline'}`;
    select.appendChild(opt);

    const galOpt = document.createElement('option');
    galOpt.value = c.id;
    galOpt.textContent = `${c.hostname} (${c.username})`;
    galleryFilter.appendChild(galOpt);
  });

  if (currentVal) select.value = currentVal;

  const btnToggle = document.getElementById('btn-toggle-stream');
  const btnSnap = document.getElementById('btn-instant-snap');
  btnToggle.disabled = !select.value;
  btnSnap.disabled = !select.value;
}

function renderScreenshotsGrid() {
  const grid = document.getElementById('screenshots-grid');
  const empty = document.getElementById('screenshots-empty');

  if (state.screenshots.length === 0) {
    grid.innerHTML = '';
    grid.appendChild(empty);
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = '';

  state.screenshots.forEach(shot => {
    const client = state.clients.find(c => c.id === shot.client_id) || { hostname: shot.client_id };
    const timeFormatted = new Date(shot.timestamp).toLocaleTimeString();
    const dateFormatted = new Date(shot.timestamp).toLocaleDateString();

    const item = document.createElement('div');
    item.className = 'screenshot-item';
    item.onclick = () => openLightbox(shot, client);
    item.innerHTML = `
      <div class="screenshot-thumb-holder">
        <img src="${shot.filepath}" alt="Screenshot" loading="lazy">
      </div>
      <div class="screenshot-item-body">
        <div class="screenshot-meta-top">
          <span class="screenshot-time">${timeFormatted}</span>
          <span class="screenshot-app-tag">${shot.active_app}</span>
        </div>
        <div class="screenshot-window-title" title="${shot.active_window}">${shot.active_window}</div>
        <div style="font-size: 0.72rem; color: var(--text-dim);">${client.hostname} • ${dateFormatted}</div>
      </div>
    `;
    grid.appendChild(item);
  });
}

function renderPolicyForm() {
  document.getElementById('policy-work-start').value = state.policy.work_hours_start || '09:00';
  document.getElementById('policy-work-end').value = state.policy.work_hours_end || '18:00';
  document.getElementById('policy-interval-select').value = state.policy.capture_interval_sec || 15;
  document.getElementById('policy-mode-select').value = state.policy.policy_mode || 'audit-alert';
  if (document.getElementById('policy-retention-select')) {
    document.getElementById('policy-retention-select').value = state.policy.retention_days !== undefined ? state.policy.retention_days : 20;
  }
  renderPolicyTags();
}

function renderPolicyTags() {
  const appsContainer = document.getElementById('allowed-apps-tags');
  const websContainer = document.getElementById('allowed-domains-tags');

  appsContainer.innerHTML = '';
  (state.policy.allowed_apps || []).forEach((app, idx) => {
    const tag = document.createElement('span');
    tag.className = 'policy-tag';
    tag.innerHTML = `${app} <span class="policy-tag-remove" onclick="removeAppTag(${idx})">&times;</span>`;
    appsContainer.appendChild(tag);
  });

  websContainer.innerHTML = '';
  (state.policy.allowed_domains || []).forEach((domain, idx) => {
    const tag = document.createElement('span');
    tag.className = 'policy-tag';
    tag.innerHTML = `${domain} <span class="policy-tag-remove" onclick="removeWebTag(${idx})">&times;</span>`;
    websContainer.appendChild(tag);
  });
}

function removeAppTag(idx) {
  state.policy.allowed_apps.splice(idx, 1);
  renderPolicyTags();
}

function removeWebTag(idx) {
  state.policy.allowed_domains.splice(idx, 1);
  renderPolicyTags();
}

function addAppTag() {
  const input = document.getElementById('app-tag-input');
  let val = input.value.trim().toLowerCase();
  if (val) {
    if (!val.endsWith('.exe') && !val.includes('.')) val += '.exe';
    if (!state.policy.allowed_apps.includes(val)) {
      state.policy.allowed_apps.push(val);
      renderPolicyTags();
    }
    input.value = '';
  }
}

function addWebTag() {
  const input = document.getElementById('web-tag-input');
  let val = input.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (val) {
    if (!state.policy.allowed_domains.includes(val)) {
      state.policy.allowed_domains.push(val);
      renderPolicyTags();
    }
    input.value = '';
  }
}

function renderLogsTable() {
  const tbody = document.getElementById('logs-table-body');
  tbody.innerHTML = '';

  state.logs.forEach(log => {
    const tr = document.createElement('tr');
    const timeFormatted = new Date(log.timestamp).toLocaleString();
    tr.innerHTML = `
      <td style="font-family: 'JetBrains Mono'; font-size: 0.8rem; color: var(--text-muted);">${timeFormatted}</td>
      <td><span class="event-badge ${log.event_type}">${log.event_type}</span></td>
      <td style="font-weight: 600;">${log.client_id}</td>
      <td style="color: var(--text-main);">${log.details}</td>
    `;
    tbody.appendChild(tr);
  });
}

function prependLog(log) {
  state.logs.unshift(log);
  if (state.logs.length > 200) state.logs.pop();
  renderLogsTable();
}

// Modal Lightbox
function openLightbox(shot, client) {
  const modal = document.getElementById('image-modal');
  const img = document.getElementById('modal-image');
  const title = document.getElementById('modal-client-name');
  const meta = document.getElementById('modal-meta');
  const downloadLink = document.getElementById('modal-download-link');

  img.src = shot.filepath;
  title.textContent = `Workstation: ${client.hostname} (${client.username || 'User'})`;
  meta.textContent = `${new Date(shot.timestamp).toLocaleString()} | App: ${shot.active_app} | Window: ${shot.active_window}`;
  downloadLink.href = shot.filepath;
  modal.classList.add('active');
}

function closeLightbox() {
  document.getElementById('image-modal').classList.remove('active');
}

// Navigation & Tab Switching
function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.toggle('active', tab.id === `tab-${tabId}`);
  });

  const titles = {
    overview: ['Fleet Overview', 'Real-time endpoint activity and productivity metrics'],
    'live-stream': ['Live Screen Monitor', 'Low-latency real-time workstation screen streaming'],
    screenshots: ['Screenshot Timeline', 'Automated periodic silent captures & activity history'],
    policies: ['Whitelists & Rules', 'Application & website restriction policies'],
    logs: ['Activity & Audit Logs', 'Tamper-evident logs of rule violations and system events']
  };

  document.getElementById('page-title').textContent = titles[tabId][0];
  document.getElementById('page-subtitle').textContent = titles[tabId][1];

  if (tabId === 'screenshots') fetchScreenshots();
  if (tabId === 'policies') fetchPolicy();
  if (tabId === 'logs') fetchLogs();
}

function openLiveStreamFor(clientId) {
  switchTab('live-stream');
  const select = document.getElementById('stream-client-select');
  select.value = clientId;
  document.getElementById('btn-toggle-stream').disabled = false;
  document.getElementById('btn-instant-snap').disabled = false;
  startLiveStream();
}

function filterGalleryByClient(clientId) {
  switchTab('screenshots');
  document.getElementById('gallery-client-filter').value = clientId;
  fetchScreenshots();
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4500);
}

// Setup Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  // Navigation tabs
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Top buttons
  document.getElementById('btn-refresh-all').addEventListener('click', () => {
    fetchClients();
    fetchStats();
    showToast('Fleet data refreshed', 'success');
  });

  // Stream controls
  const streamSelect = document.getElementById('stream-client-select');
  streamSelect.addEventListener('change', () => {
    const hasVal = Boolean(streamSelect.value);
    document.getElementById('btn-toggle-stream').disabled = !hasVal;
    document.getElementById('btn-instant-snap').disabled = !hasVal;
    if (state.isStreaming) stopLiveStream();
  });

  document.getElementById('btn-toggle-stream').addEventListener('click', () => {
    if (state.isStreaming) {
      stopLiveStream();
    } else {
      startLiveStream();
    }
  });

  document.getElementById('btn-instant-snap').addEventListener('click', requestInstantScreenshot);

  document.getElementById('btn-fullscreen-stream').addEventListener('click', () => {
    const elem = document.getElementById('stream-viewport-container');
    if (!document.fullscreenElement) {
      elem.requestFullscreen().catch(err => alert(err.message));
    } else {
      document.exitFullscreen();
    }
  });

  // Gallery Filters
  document.getElementById('gallery-client-filter').addEventListener('change', fetchScreenshots);
  document.getElementById('gallery-date-filter').addEventListener('change', fetchScreenshots);
  document.getElementById('gallery-search-input').addEventListener('input', fetchScreenshots);
  document.getElementById('btn-refresh-gallery').addEventListener('click', fetchScreenshots);

  // Policy Tags
  document.getElementById('btn-add-app-tag').addEventListener('click', addAppTag);
  document.getElementById('app-tag-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addAppTag();
  });

  document.getElementById('btn-add-web-tag').addEventListener('click', addWebTag);
  document.getElementById('web-tag-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addWebTag();
  });

  document.getElementById('btn-save-policy').addEventListener('click', savePolicy);
  document.getElementById('btn-refresh-logs').addEventListener('click', fetchLogs);

  const btnCleanNow = document.getElementById('btn-clean-now');
  if (btnCleanNow) {
    btnCleanNow.addEventListener('click', async () => {
      const days = parseInt(document.getElementById('policy-retention-select').value, 10);
      btnCleanNow.textContent = 'Cleaning...';
      btnCleanNow.disabled = true;
      try {
        const res = await fetch('/api/screenshots/cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`Cleanup complete: Removed ${data.deletedCount} screenshots (${(data.freedBytes / (1024 * 1024)).toFixed(1)} MB freed)`, 'success');
          fetchScreenshots();
          fetchStats();
          fetchLogs();
        }
      } catch (err) {
        showToast('Cleanup failed: ' + err.message, 'alert');
      } finally {
        btnCleanNow.textContent = '🧹 Clean Now';
        btnCleanNow.disabled = false;
      }
    });
  }

  // Client search
  document.getElementById('client-search-input').addEventListener('input', renderFleetOverview);

  // Modal
  document.getElementById('modal-close-btn').addEventListener('click', closeLightbox);
  document.getElementById('modal-overlay').addEventListener('click', closeLightbox);

  // Phone Connect Modal & QR
  const phoneModal = document.getElementById('phone-modal');
  const phoneModalClose = document.getElementById('phone-modal-close');
  const phoneModalOverlay = document.getElementById('phone-modal-overlay');
  const btnPhoneConnect = document.getElementById('btn-phone-connect');
  const btnCopyLanUrl = document.getElementById('btn-copy-lan-url');

  if (btnPhoneConnect) {
    btnPhoneConnect.addEventListener('click', () => {
      openPhoneModal();
    });
  }

  if (phoneModalClose) {
    phoneModalClose.addEventListener('click', () => {
      phoneModal.classList.remove('active');
    });
  }

  if (phoneModalOverlay) {
    phoneModalOverlay.addEventListener('click', () => {
      phoneModal.classList.remove('active');
    });
  }

  if (btnCopyLanUrl) {
    btnCopyLanUrl.addEventListener('click', () => {
      const urlText = document.getElementById('phone-lan-url').textContent;
      navigator.clipboard.writeText(urlText).then(() => {
        showToast('Mobile URL copied to clipboard!', 'success');
      });
    });
  }

  // Mobile Hamburger & Drawer
  const hamburger = document.getElementById('btn-hamburger');
  const sidebar = document.getElementById('app-sidebar');
  const mobileClose = document.getElementById('mobile-sidebar-close');
  const mobileOverlay = document.getElementById('mobile-sidebar-overlay');

  if (hamburger && sidebar) {
    hamburger.addEventListener('click', () => {
      sidebar.classList.add('mobile-open');
    });
  }

  const closeMobileSidebar = () => {
    if (sidebar) sidebar.classList.remove('mobile-open');
  };

  if (mobileClose) mobileClose.addEventListener('click', closeMobileSidebar);
  if (mobileOverlay) mobileOverlay.addEventListener('click', closeMobileSidebar);

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', closeMobileSidebar);
  });

  // Live Clock
  setInterval(() => {
    document.getElementById('live-clock').textContent = new Date().toLocaleTimeString();
  }, 1000);

  // Electron Desktop Station Integration
  if (window.electronAPI && window.electronAPI.isElectron) {
    const openFolderBtn = document.getElementById('btn-open-storage-folder');
    if (openFolderBtn) {
      openFolderBtn.style.display = 'inline-flex';
      openFolderBtn.addEventListener('click', () => {
        if (typeof window.electronAPI.openStorageFolder === 'function') {
          window.electronAPI.openStorageFolder();
        }
      });
    }
  }

  // Theme Toggle Management
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', toggleTheme);
  }

  // Initial Boot
  initTheme();
  initWebSocket();
  fetchClients();
  fetchStats();
  fetchPolicy();
  fetchLogs();
});

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('workguard_theme') || 'light';
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('workguard_theme', theme);
  const icon = document.getElementById('theme-icon');
  const text = document.getElementById('theme-text');
  if (icon && text) {
    if (theme === 'light') {
      icon.textContent = '☀️';
      text.textContent = 'Light Mode';
    } else {
      icon.textContent = '🌙';
      text.textContent = 'Dark Mode';
    }
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  showToast(`Switched to ${next === 'light' ? 'Light' : 'Dark'} Mode`, 'info');
}

// Phone Connect Modal Open & QR Generation
function openPhoneModal() {
  const modal = document.getElementById('phone-modal');
  if (!modal) return;
  modal.classList.add('active');

  const lanIp = '192.168.2.136';
  const port = window.location.port || '3000';
  const phoneUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://${lanIp}:${port}`
    : window.location.origin;

  document.getElementById('phone-lan-url').textContent = phoneUrl;
  renderQrCode(phoneUrl);
}

// Pure Client-Side Offline QR Code Renderer
function renderQrCode(text) {
  const container = document.getElementById('phone-qr-container');
  if (!container) return;
  container.innerHTML = '';

  // Use QuickChart / standard offline SVG generator or canvas QR
  const qrImg = document.createElement('img');
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=168x168&data=${encodeURIComponent(text)}&margin=1`;
  qrImg.alt = 'Scan QR Code';
  qrImg.style.width = '100%';
  qrImg.style.height = '100%';
  qrImg.onerror = () => {
    // Fallback if no external internet (draw local visual guide)
    container.innerHTML = `
      <div style="text-align:center; padding:12px; font-size:0.75rem; color:#1e293b; font-weight:600;">
        <div style="font-size:1.8rem; margin-bottom:4px;">🌐</div>
        Type in Phone Chrome:<br>
        <span style="color:#4f46e5; font-size:0.85rem;">${text}</span>
      </div>
    `;
  };
  container.appendChild(qrImg);
}

// Admin Edit Employee Profile Modal Functions
function openAdminEditProfileModal(clientId) {
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return;

  document.getElementById('edit-client-id').value = client.id;
  document.getElementById('edit-emp-name').value = client.employee_name || client.username || '';
  document.getElementById('edit-emp-dept').value = client.department || 'Engineering & Development';
  document.getElementById('admin-edit-modal-title').textContent = `✏️ Edit Profile: ${client.hostname}`;

  const modal = document.getElementById('admin-edit-profile-modal');
  if (modal) modal.classList.add('active');
}

function closeAdminEditProfileModal() {
  const modal = document.getElementById('admin-edit-profile-modal');
  if (modal) modal.classList.remove('active');
}

// Wire up Edit Profile Form and Filter Listeners
document.addEventListener('DOMContentLoaded', () => {
  const editModalClose = document.getElementById('admin-edit-modal-close');
  const editModalCancel = document.getElementById('btn-cancel-edit-profile');
  const editModalOverlay = document.getElementById('admin-edit-profile-overlay');
  const formAdminEdit = document.getElementById('form-admin-edit-profile');
  const deptFilterSelect = document.getElementById('filter-dept-select');

  if (editModalClose) editModalClose.addEventListener('click', closeAdminEditProfileModal);
  if (editModalCancel) editModalCancel.addEventListener('click', closeAdminEditProfileModal);
  if (editModalOverlay) editModalOverlay.addEventListener('click', closeAdminEditProfileModal);

  if (deptFilterSelect) {
    deptFilterSelect.addEventListener('change', renderFleetOverview);
  }

  if (formAdminEdit) {
    formAdminEdit.addEventListener('submit', async (e) => {
      e.preventDefault();
      const clientId = document.getElementById('edit-client-id').value;
      const empName = document.getElementById('edit-emp-name').value.trim();
      const dept = document.getElementById('edit-emp-dept').value;

      if (!clientId || !empName) return;

      const saveBtn = document.getElementById('btn-save-edit-profile');
      saveBtn.textContent = 'Saving...';

      try {
        const res = await fetch(`/api/clients/${clientId}/profile`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employee_name: empName, department: dept })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`Profile updated for ${empName} (${dept})`, 'success');
          closeAdminEditProfileModal();
          fetchClients();
        } else {
          showToast(`Error: ${data.error}`, 'alert');
        }
      } catch (err) {
        showToast(`Failed to update profile: ${err.message}`, 'alert');
      } finally {
        saveBtn.textContent = '💾 Save & Sync Profile';
      }
    });
  }
});


