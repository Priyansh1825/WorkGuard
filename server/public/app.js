// State Management
const state = {
  clients: [],
  screenshots: [],
  logs: [],
  policy: {
    allowed_apps: [],
    allowed_domains: [],
    sensitive_apps: [],
    sensitive_keywords: [],
    pause_on_sensitive: true,
    work_hours_start: '09:00',
    work_hours_end: '18:00',
    capture_interval_sec: 15,
    stream_fps: 15,
    policy_mode: 'audit-alert'
  },
  security: {
    is_password_set: false,
    agent_secret_key: 'workguard-lan-secret-key-2026',
    encryption_enabled: false,
    session_timeout_minutes: 15
  },
  stats: {},
  activeTab: 'overview',
  activeStreamClientId: null,
  isStreaming: false,
  streamFpsCounter: 0,
  streamFpsInterval: null,
  currentStreamBlobUrl: null,
  authMode: 'login', // 'setup', 'login', 'lock'
  lastActivityTime: Date.now(),
  dbStudio: {
    activeTable: 'clients',
    currentPage: 1,
    limit: 20,
    search: '',
    totalRecords: 0,
    totalPages: 1,
    currentRecord: null,
    modalMode: 'add'
  }
};

// --- Authentication & Session Storage Helpers ---
function getAuthToken() {
  return localStorage.getItem('workguard_admin_token') || '';
}

function setAuthToken(token) {
  if (token) {
    localStorage.setItem('workguard_admin_token', token);
  } else {
    localStorage.removeItem('workguard_admin_token');
  }
}

async function authFetch(url, options = {}) {
  const token = getAuthToken();
  const headers = options.headers ? { ...options.headers } : {};
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const opts = { ...options, headers };
  
  try {
    const res = await fetch(url, opts);
    if (res.status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/setup') && !url.includes('/api/auth/status')) {
      showAuthModal('login', 'Session expired or unauthorized. Please re-enter master password.');
    }
    return res;
  } catch (err) {
    throw err;
  }
}

function getSecureImageUrl(filepath) {
  if (!filepath) return '';
  const token = getAuthToken();
  if (token && filepath.startsWith('/api/screenshots/raw/')) {
    return `${filepath}?token=${encodeURIComponent(token)}`;
  }
  return filepath;
}

// Inactivity Auto-Lockout Monitor
function resetInactivityTimer() {
  state.lastActivityTime = Date.now();
}

function startInactivityWatcher() {
  ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'].forEach(evt => {
    window.addEventListener(evt, resetInactivityTimer, { passive: true });
  });

  setInterval(() => {
    if (!state.security || !state.security.is_password_set) return;
    const modal = document.getElementById('auth-modal');
    if (modal && modal.classList.contains('active')) return; // Already locked/logged out

    const timeoutMs = (state.security.session_timeout_minutes || 15) * 60 * 1000;
    if (Date.now() - state.lastActivityTime > timeoutMs) {
      lockStation('Station locked automatically due to inactivity.');
    }
  }, 15000);
}

function lockStation(reason = 'Station locked.') {
  setAuthToken('');
  if (ws) {
    try { ws.close(); } catch (e) {}
  }
  showAuthModal('lock', reason);
  showToast('🔒 Admin Station Locked', 'info');
}

// WebSocket Connection
let ws = null;

function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);
  ws.binaryType = 'blob';

  ws.onopen = () => {
    document.getElementById('ws-indicator').classList.remove('offline');
    document.getElementById('server-status-text').textContent = 'Connected (Secure)';
    ws.send(JSON.stringify({ 
      type: 'ADMIN_REGISTER',
      session_token: getAuthToken()
    }));
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
        case 'ADMIN_AUTH_REQUIRED':
          showAuthModal('login', 'Authentication required to connect to Admin Station.');
          break;

        case 'ADMIN_CONNECTED':
        case 'FLEET_UPDATE':
          state.clients = data.clients || [];
          if (data.stats) state.stats = data.stats;
          if (data.security) state.security = { ...state.security, ...data.security };
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

        case 'OTA_UPDATE_PROGRESS':
          handleOTAUpdateProgress(data);
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
    setTimeout(() => {
      const modal = document.getElementById('auth-modal');
      if (!modal || !modal.classList.contains('active')) {
        initWebSocket();
      }
    }, 3000);
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
  } else {
    authFetch(`/api/clients/${clientId}/capture`, { method: 'POST' })
      .then(() => showToast('📸 Instant capture requested', 'success'))
      .catch(e => showToast(`Error: ${e.message}`, 'alert'));
  }
}

// REST API Calls
async function fetchStats() {
  try {
    const res = await authFetch('/api/stats');
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
    const res = await authFetch('/api/clients');
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

    const res = await authFetch(url);
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
      authFetch('/api/policies'),
      authFetch('/api/settings/storage')
    ]);

    const data = await policyRes.json();
    if (data.success) {
      state.policy = data.policy;
      renderPolicyForm();
    }

    const storageData = await storageRes.json();
    if (storageData.success) {
      const localPathInput = document.getElementById('setting-local-storage-path');
      const cloudUrlInput = document.getElementById('setting-cloud-storage-url');
      const dbUrlInput = document.getElementById('setting-cloud-db-url');
      
      if (localPathInput) localPathInput.value = storageData.localStoragePath || storageData.local_storage_path || '';
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

    const localStoragePath = document.getElementById('setting-local-storage-path') ? document.getElementById('setting-local-storage-path').value.trim() : '';
    const cloudStorageUrl = document.getElementById('setting-cloud-storage-url') ? document.getElementById('setting-cloud-storage-url').value.trim() : '';
    const cloudDbUrl = document.getElementById('setting-cloud-db-url') ? document.getElementById('setting-cloud-db-url').value.trim() : '';

    const [res] = await Promise.all([
      authFetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }),
      authFetch('/api/settings/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          local_storage_path: localStoragePath,
          cloud_storage_url: cloudStorageUrl,
          database_url: cloudDbUrl,
          retention_days: payload.retention_days
        })
      })
    ]);

    const data = await res.json();
    if (data.success) {
      state.policy = data.policy;
      showToast('Settings & Storage paths saved successfully!', 'success');
    }
  } catch (err) {
    showToast('Failed to save settings: ' + err.message, 'alert');
  }
}

async function fetchLogs() {
  try {
    const res = await authFetch('/api/logs?limit=100');
    const data = await res.json();
    if (data.success) {
      state.logs = data.logs;
      renderLogsTable();
    }
  } catch (err) {
    console.error('Fetch logs error:', err);
  }
}

// --- Security & Privacy Settings Manager ---
async function fetchSecuritySettings() {
  try {
    const [secRes, polRes] = await Promise.all([
      authFetch('/api/security/settings'),
      authFetch('/api/policies')
    ]);

    const secData = await secRes.json();
    if (secData.success) {
      state.security = { ...state.security, ...secData };
      
      const agentKeyInput = document.getElementById('sec-agent-secret-key');
      const aesToggle = document.getElementById('sec-aes-encryption-toggle');
      const timeoutSelect = document.getElementById('sec-session-timeout-select');

      if (agentKeyInput) agentKeyInput.value = secData.agent_secret_key || '';
      if (aesToggle) aesToggle.checked = !!secData.encryption_enabled;
      if (timeoutSelect) timeoutSelect.value = secData.session_timeout_minutes || 15;
    }

    const polData = await polRes.json();
    if (polData.success && polData.policy) {
      state.policy = polData.policy;
      const sensApps = document.getElementById('sec-sensitive-apps');
      const sensKeywords = document.getElementById('sec-sensitive-keywords');
      const pauseToggle = document.getElementById('sec-privacy-pause-toggle');

      if (sensApps) sensApps.value = (polData.policy.sensitive_apps || []).join(', ');
      if (sensKeywords) sensKeywords.value = (polData.policy.sensitive_keywords || []).join(', ');
      if (pauseToggle) pauseToggle.checked = polData.policy.pause_on_sensitive !== false;
    }
  } catch (err) {
    console.error('Fetch security settings error:', err);
  }
}

async function saveSecuritySettings() {
  try {
    const agentKey = document.getElementById('sec-agent-secret-key').value.trim();
    const encryptionEnabled = document.getElementById('sec-aes-encryption-toggle').checked;
    const timeoutMin = parseInt(document.getElementById('sec-session-timeout-select').value, 10) || 15;

    const sensAppsRaw = document.getElementById('sec-sensitive-apps').value;
    const sensKeywordsRaw = document.getElementById('sec-sensitive-keywords').value;
    const pauseOnSens = document.getElementById('sec-privacy-pause-toggle').checked;

    const sensitiveApps = sensAppsRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const sensitiveKeywords = sensKeywordsRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    const [secRes, polRes] = await Promise.all([
      authFetch('/api/security/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_secret_key: agentKey,
          encryption_enabled: encryptionEnabled,
          session_timeout_minutes: timeoutMin
        })
      }),
      authFetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sensitive_apps: sensitiveApps,
          sensitive_keywords: sensitiveKeywords,
          pause_on_sensitive: pauseOnSens
        })
      })
    ]);

    const secData = await secRes.json();
    const polData = await polRes.json();

    if (secData.success && polData.success) {
      state.security = { ...state.security, ...secData.security };
      state.policy = polData.policy;
      showToast('🛡️ Security & Privacy configuration saved & deployed!', 'success');
    } else {
      showToast('Error saving security settings', 'alert');
    }
  } catch (err) {
    showToast('Failed to save security settings: ' + err.message, 'alert');
  }
}

async function updateAdminPassword() {
  const currentPass = document.getElementById('sec-current-password').value;
  const newPass = document.getElementById('sec-new-password').value;

  if (!newPass || newPass.length < 6) {
    showToast('New password must be at least 6 characters long', 'alert');
    return;
  }

  try {
    const res = await authFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: currentPass, new_password: newPass })
    });
    const data = await res.json();
    if (data.success) {
      setAuthToken(data.token);
      showToast('🔐 Master Admin Password updated successfully!', 'success');
      document.getElementById('sec-current-password').value = '';
      document.getElementById('sec-new-password').value = '';
    } else {
      showToast(data.error || 'Password update failed', 'alert');
    }
  } catch (err) {
    showToast('Failed to update password: ' + err.message, 'alert');
  }
}

// --- Auth Modal & Lock Screen Controller ---
function showAuthModal(mode = 'login', customMsg = '') {
  state.authMode = mode;
  const modal = document.getElementById('auth-modal');
  const title = document.getElementById('auth-modal-title');
  const subtitle = document.getElementById('auth-modal-subtitle');
  const icon = document.getElementById('auth-modal-icon');
  const submitBtn = document.getElementById('btn-auth-submit');
  const extraFields = document.getElementById('auth-setup-extra-fields');
  const inputLabel = document.getElementById('auth-input-label');
  const errorBox = document.getElementById('auth-error-msg');
  const passwordInput = document.getElementById('auth-password-input');

  if (errorBox) errorBox.style.display = 'none';
  if (passwordInput) passwordInput.value = '';

  if (mode === 'setup') {
    icon.textContent = '🚀';
    title.textContent = 'Setup Admin Master Password';
    subtitle.textContent = customMsg || 'Create a strong master password to secure your WorkGuard Station.';
    inputLabel.textContent = 'Master Password (Min 6 chars):';
    submitBtn.textContent = '💾 Save Password & Access Station';
    extraFields.style.display = 'block';
  } else if (mode === 'lock') {
    icon.textContent = '🔒';
    title.textContent = 'WorkGuard Station Locked';
    subtitle.textContent = customMsg || 'Enter your master password to resume session.';
    inputLabel.textContent = 'Master Password:';
    submitBtn.textContent = '🔓 Unlock Station';
    extraFields.style.display = 'none';
  } else {
    icon.textContent = '🔐';
    title.textContent = 'WorkGuard Admin Login';
    subtitle.textContent = customMsg || 'Enter your master password to access the monitoring station.';
    inputLabel.textContent = 'Master Password:';
    submitBtn.textContent = '🔓 Unlock Admin Station';
    extraFields.style.display = 'none';
  }

  if (modal) modal.classList.add('active');
  if (passwordInput) passwordInput.focus();
}

function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.remove('active');
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const password = document.getElementById('auth-password-input').value;
  const errorBox = document.getElementById('auth-error-msg');

  if (state.authMode === 'setup') {
    const confirmPass = document.getElementById('auth-confirm-password-input').value;
    if (password !== confirmPass) {
      errorBox.textContent = 'Passwords do not match. Please re-enter.';
      errorBox.style.display = 'block';
      return;
    }
    if (password.length < 6) {
      errorBox.textContent = 'Password must be at least 6 characters long.';
      errorBox.style.display = 'block';
      return;
    }

    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (data.success) {
        setAuthToken(data.token);
        hideAuthModal();
        showToast('Master password created successfully!', 'success');
        bootApplication();
      } else {
        errorBox.textContent = data.error || 'Setup failed';
        errorBox.style.display = 'block';
      }
    } catch (err) {
      errorBox.textContent = 'Connection error: ' + err.message;
      errorBox.style.display = 'block';
    }
  } else {
    // Login or Unlock
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (data.success) {
        setAuthToken(data.token);
        hideAuthModal();
        showToast('Welcome back! Station unlocked.', 'success');
        bootApplication();
      } else {
        errorBox.textContent = data.error || 'Incorrect master password.';
        errorBox.style.display = 'block';
      }
    } catch (err) {
      errorBox.textContent = 'Authentication error: ' + err.message;
      errorBox.style.display = 'block';
    }
  }
}

// Initial Auth Check & Boot
async function checkAuthAndBoot() {
  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();

    if (!data.is_password_set) {
      // Prompt First-Time Setup Wizard
      showAuthModal('setup');
    } else {
      const token = getAuthToken();
      if (!token) {
        showAuthModal('login');
      } else {
        // Verify existing token
        const verifyRes = await fetch('/api/auth/verify', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (verifyRes.ok) {
          bootApplication();
        } else {
          showAuthModal('login', 'Session expired. Please log in again.');
        }
      }
    }
  } catch (err) {
    console.warn('Auth status check error:', err);
    bootApplication();
  }
}

function bootApplication() {
  initTheme();
  initWebSocket();
  fetchClients();
  fetchStats();
  fetchPolicy();
  fetchLogs();
  fetchSecuritySettings();
  fetchOTAStatus();
}

// Render Functions
function updateStatsCards() {
  const clients = state.clients || [];
  const onlineCount = clients.filter(c => c.status === 'online').length;
  
  document.getElementById('stat-total-clients').textContent = clients.length;
  document.getElementById('stat-online-clients').textContent = onlineCount;
  
  if (state.stats) {
    if (state.stats.today_screenshots !== undefined) {
      document.getElementById('stat-today-shots').textContent = state.stats.today_screenshots;
    }
    if (state.stats.total_violations !== undefined) {
      document.getElementById('stat-violations').textContent = state.stats.total_violations;
    }
  }
  
  document.getElementById('clients-count-badge').textContent = `${clients.length} Devices`;
}

function renderFleetOverview() {
  const container = document.getElementById('clients-grid');
  const empty = document.getElementById('clients-empty');
  const searchVal = document.getElementById('client-search-input').value.toLowerCase();
  const deptFilter = document.getElementById('filter-dept-select') ? document.getElementById('filter-dept-select').value : 'ALL';

  let filtered = state.clients.filter(c => {
    const matchSearch = !searchVal || 
      (c.hostname && c.hostname.toLowerCase().includes(searchVal)) ||
      (c.username && c.username.toLowerCase().includes(searchVal)) ||
      (c.employee_name && c.employee_name.toLowerCase().includes(searchVal)) ||
      (c.department && c.department.toLowerCase().includes(searchVal)) ||
      (c.ip && c.ip.includes(searchVal));

    const matchDept = deptFilter === 'ALL' || (c.department === deptFilter);
    return matchSearch && matchDept;
  });

  if (filtered.length === 0) {
    container.innerHTML = '';
    container.appendChild(empty);
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  container.innerHTML = '';

  filtered.forEach((client, idx) => {
    const isOnline = client.status === 'online';
    const card = document.createElement('div');
    card.className = `client-card glass-card ${isOnline ? 'online' : 'offline'}`;
    
    const empName = client.employee_name || client.username || 'Employee';
    const empDept = client.department || 'General';
    const initials = empName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'EM';
    
    const colorTones = [
      { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
      { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' },
      { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
      { bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe' },
      { bg: '#fff1f2', text: '#be123c', border: '#fecdd3' }
    ];
    const tone = colorTones[idx % colorTones.length];

    const cpuVal = client.cpu_usage || 0;
    const ramVal = client.ram_usage || 0;
    const cpuColor = cpuVal > 85 ? 'var(--rose)' : cpuVal > 65 ? 'var(--amber)' : 'var(--emerald)';

    card.innerHTML = `
      <div class="client-card-header">
        <div class="client-identity">
          <div class="emp-title-wrap">
            <div style="width: 34px; height: 34px; border-radius: 50%; background: ${tone.bg}; color: ${tone.text}; border: 1px solid ${tone.border}; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; flex-shrink: 0; box-shadow: var(--shadow-sm);">
              ${initials}
            </div>
            <h3 class="emp-card-name" onclick="openAdminEditProfileModal('${client.id}')" title="Click to rename employee">${empName}</h3>
            <button class="emp-edit-btn" onclick="openAdminEditProfileModal('${client.id}')" title="Change Employee Name & Department">
              ✏️
            </button>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap;">
            <span class="emp-card-dept" style="background: ${tone.bg}; color: ${tone.text}; border-color: ${tone.border};">${empDept}</span>
            <span class="emp-card-host">${client.hostname} • ${client.ip}</span>
            <span style="font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 9999px; background: ${(client.agent_version || '1.0.0') === (state.latestAgentVersion || '1.2.0') ? 'var(--emerald-light)' : 'var(--rose-light)'}; color: ${(client.agent_version || '1.0.0') === (state.latestAgentVersion || '1.2.0') ? 'var(--emerald)' : 'var(--rose)'}; border: 1px solid ${(client.agent_version || '1.0.0') === (state.latestAgentVersion || '1.2.0') ? 'var(--emerald-pill)' : 'var(--rose-pill)'};" title="Agent Daemon Version">v${client.agent_version || '1.0.0'}</span>
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
        <div style="position: absolute; top: 12px; right: 12px; width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,0.92); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 800; color: #0f172a; box-shadow: 0 4px 12px rgba(0,0,0,0.18); transition: transform 0.2s;" title="Watch Live Stream">
          ↗
        </div>
      </div>
      <div class="client-card-body">
        <div class="metric-row">
          <span class="metric-label">Active App:</span>
          <span class="metric-val" title="${client.current_app || 'None'}">${client.current_app || 'Idle'}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Window:</span>
          <span class="metric-val" title="${client.current_window || 'Desktop'}">${client.current_window || 'Desktop'}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">CPU / RAM:</span>
          <span class="metric-val" style="color: ${cpuColor};">${cpuVal}% CPU • ${ramVal}% RAM</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Total Shots:</span>
          <span class="metric-val">${client.total_screenshots || 0} captures</span>
        </div>
      </div>
      <div class="client-card-actions" style="display: flex; gap: 6px; padding: 14px 18px; flex-wrap: wrap;">
        <button class="btn btn-primary btn-sm" onclick="openLiveStreamFor('${client.id}')" style="flex: 1.3; justify-content: center;" title="60 FPS Live Screen Stream">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 15px; height: 15px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Watch Live
        </button>
        <button class="btn btn-secondary btn-sm" onclick="triggerInstantSnap('${client.id}')" style="flex: 0.9; justify-content: center;" title="Take Instant Silent Screenshot">
          📸 Snap
        </button>
        <button class="btn btn-secondary btn-sm" onclick="filterGalleryByClient('${client.id}')" style="flex: 0.9; justify-content: center;" title="View Historical Screenshots">
          🖼️ Gallery
        </button>
        <button class="btn btn-secondary btn-sm" onclick="deployOTAUpdateTo('${client.id}')" style="flex: 0.9; justify-content: center; background: var(--bg-card-subtle);" title="Deploy remote update to this workstation">
          🚀 Update
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function triggerInstantSnap(clientId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'REQUEST_INSTANT_SCREENSHOT',
      target_client_id: clientId
    }));
    showToast('📸 Instant capture request sent to employee agent!', 'success');
  } else {
    authFetch(`/api/clients/${clientId}/capture`, { method: 'POST' })
      .then(() => showToast('📸 Instant capture requested', 'success'))
      .catch(e => showToast(`Error: ${e.message}`, 'alert'));
  }
}

// Analytics Loader & Renderer
async function fetchAnalytics() {
  try {
    const res = await authFetch('/api/analytics');
    const data = await res.json();
    if (!data.success) return;

    document.getElementById('analytics-dept-count').textContent = (data.departments || []).length;
    if (data.top_apps && data.top_apps.length > 0) {
      document.getElementById('analytics-top-app').textContent = data.top_apps[0].name;
    }

    const appsList = document.getElementById('analytics-apps-list');
    if (appsList) {
      if (!data.top_apps || data.top_apps.length === 0) {
        appsList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No active telemetry received yet.</p>';
      } else {
        appsList.innerHTML = data.top_apps.map(app => `
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 700;">
              <span>${app.name}</span>
              <span style="color: var(--primary);">${app.count} workstation(s) (${app.percent}%)</span>
            </div>
            <div style="width: 100%; height: 8px; background: var(--bg-card-subtle); border-radius: 9999px; overflow: hidden; border: 1px solid var(--border-subtle);">
              <div style="width: ${app.percent}%; height: 100%; background: linear-gradient(90deg, #4f46e5, #06b6d4); border-radius: 9999px;"></div>
            </div>
          </div>
        `).join('');
      }
    }

    const deptsList = document.getElementById('analytics-depts-list');
    if (deptsList) {
      if (!data.departments || data.departments.length === 0) {
        deptsList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No registered departments yet.</p>';
      } else {
        deptsList.innerHTML = data.departments.map(dept => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-card-subtle); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);">
            <span style="font-size: 0.88rem; font-weight: 700;">🏢 ${dept.name}</span>
            <span class="tag" style="background: var(--primary-light); color: var(--primary); font-weight: 700; border-radius: var(--radius-pill);">${dept.count} Employee(s)</span>
          </div>
        `).join('');
      }
    }
  } catch (e) {
    console.error('Failed to load analytics:', e);
  }
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
    const secureUrl = getSecureImageUrl(shot.filepath);

    const item = document.createElement('div');
    item.className = 'screenshot-item';
    item.onclick = () => openLightbox(shot, client);
    item.innerHTML = `
      <div class="screenshot-thumb-holder">
        <img src="${secureUrl}" alt="Screenshot" loading="lazy">
        ${shot.is_encrypted ? '<span style="position: absolute; bottom: 6px; right: 6px; background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.2); font-size: 10px; padding: 2px 6px; border-radius: 4px; color: #38bdf8;">🔒 AES-256</span>' : ''}
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

  const secureUrl = getSecureImageUrl(shot.filepath);
  img.src = secureUrl;
  title.textContent = `Workstation: ${client.hostname} (${client.username || 'User'})`;
  meta.textContent = `${new Date(shot.timestamp).toLocaleString()} | App: ${shot.active_app} | Window: ${shot.active_window} ${shot.is_encrypted ? '(🔒 Decrypted from AES-256 storage)' : ''}`;
  downloadLink.href = secureUrl;
  modal.classList.add('active');
}

function closeLightbox() {
  document.getElementById('image-modal').classList.remove('active');
}

// Navigation & Tab Switching
function switchTab(tabId) {
  state.activeTab = tabId;
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
    analytics: ['Productivity & Analytics', 'Workforce application usage ranking & department distribution'],
    policies: ['Whitelists & Rules', 'Application & website restriction policies'],
    security: ['Security & Privacy Governance', 'Master authentication, PSK agent tokens, storage encryption, and PII masking'],
    alerts: ['Alerts & Webhooks', 'Automated push notifications for prohibited applications and policy breaches'],
    rbac: ['Admin Roles & RBAC', 'Multi-user administrator accounts and departmental access permissions'],
    logs: ['Activity & Audit Logs', 'Tamper-evident logs of rule violations and system events'],
    database: ['Database Studio & Storage Manager', 'Live SQLite table browser, inline record editing, and automated photo retention']
  };

  if (titles[tabId]) {
    document.getElementById('page-title').textContent = titles[tabId][0];
    document.getElementById('page-subtitle').textContent = titles[tabId][1];
  }

  if (tabId === 'screenshots') fetchScreenshots();
  if (tabId === 'policies') fetchPolicy();
  if (tabId === 'security') fetchSecuritySettings();
  if (tabId === 'alerts') {
    loadAlertAppRules();
    loadAlertWebhooks();
    loadLiveAlertsFeed();
  }
  if (tabId === 'rbac') loadRbacUsers();
  if (tabId === 'logs') fetchLogs();
  if (tabId === 'analytics') fetchAnalytics();
  if (tabId === 'overview') fetchClients();
  if (tabId === 'database') {
    fetchDatabaseStats();
    loadActiveDatabaseTable();
  }
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

  // Lock Station buttons
  const btnLockTopbar = document.getElementById('btn-lock-topbar');
  if (btnLockTopbar) btnLockTopbar.addEventListener('click', () => lockStation('Admin Station locked manually.'));

  const btnSidebarLock = document.getElementById('btn-sidebar-lock');
  if (btnSidebarLock) btnSidebarLock.addEventListener('click', () => lockStation('Admin Station locked manually.'));

  // Auth Modal Form
  const formAuth = document.getElementById('form-auth-login');
  if (formAuth) formAuth.addEventListener('submit', handleAuthSubmit);

  // Security Controls Listeners
  const btnSaveSec = document.getElementById('btn-save-security');
  if (btnSaveSec) btnSaveSec.addEventListener('click', saveSecuritySettings);

  const btnUpdatePass = document.getElementById('btn-update-admin-pass');
  if (btnUpdatePass) btnUpdatePass.addEventListener('click', updateAdminPassword);

  const btnCopyAgentKey = document.getElementById('btn-copy-agent-key');
  if (btnCopyAgentKey) {
    btnCopyAgentKey.addEventListener('click', () => {
      const keyVal = document.getElementById('sec-agent-secret-key').value;
      navigator.clipboard.writeText(keyVal).then(() => {
        showToast('📋 Agent Secret Key copied to clipboard!', 'success');
      });
    });
  }

  const btnGenAgentKey = document.getElementById('btn-gen-agent-key');
  if (btnGenAgentKey) {
    btnGenAgentKey.addEventListener('click', () => {
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      const newKey = 'wg-' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
      document.getElementById('sec-agent-secret-key').value = newKey;
      showToast('🎲 New Agent Key generated! Remember to click "Save Security Configuration".', 'info');
    });
  }

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

  // Storage Path & Explorer Openers
  const btnSaveStoragePath = document.getElementById('btn-save-storage-path');
  if (btnSaveStoragePath) {
    btnSaveStoragePath.addEventListener('click', savePolicy);
  }

  const openStorageHandler = async () => {
    try {
      const res = await authFetch('/api/settings/open-storage-folder', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`Opened storage folder: ${data.path}`, 'success');
      }
    } catch (e) {
      showToast('Could not open folder: ' + e.message, 'alert');
    }
  };

  const btnOpenExplorer = document.getElementById('btn-open-explorer-storage');
  if (btnOpenExplorer) btnOpenExplorer.addEventListener('click', openStorageHandler);

  const btnOpenGalleryFolder = document.getElementById('btn-open-storage-folder');
  if (btnOpenGalleryFolder) btnOpenGalleryFolder.addEventListener('click', openStorageHandler);

  const btnCleanNow = document.getElementById('btn-clean-now');
  if (btnCleanNow) {
    btnCleanNow.addEventListener('click', async () => {
      const days = parseInt(document.getElementById('policy-retention-select').value, 10);
      btnCleanNow.textContent = 'Cleaning...';
      btnCleanNow.disabled = true;
      try {
        const res = await authFetch('/api/screenshots/cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`Cleanup complete: Shredded ${data.deletedCount} screenshots (${(data.freedBytes / (1024 * 1024)).toFixed(1)} MB freed)`, 'success');
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

  // Theme Toggle
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', toggleTheme);
  }

  // Start Inactivity Watcher
  startInactivityWatcher();

  // Database Studio Toolbar & Modal Listeners
  initDatabaseStudioListeners();

  // Enterprise Alerts & RBAC Listeners
  initEnterpriseSubsystemListeners();

  // Check Master Auth Status & Boot
  checkAuthAndBoot();
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

  const lanIp = '127.0.0.1';
  const port = window.location.port || '3000';
  const phoneUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://${lanIp}:${port}`
    : window.location.origin;

  document.getElementById('phone-lan-url').textContent = phoneUrl;
  renderQrCode(phoneUrl);
}

function renderQrCode(text) {
  const container = document.getElementById('phone-qr-container');
  if (!container) return;
  container.innerHTML = '';

  const qrImg = document.createElement('img');
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=168x168&data=${encodeURIComponent(text)}&margin=1`;
  qrImg.alt = 'Scan QR Code';
  qrImg.style.width = '100%';
  qrImg.style.height = '100%';
  qrImg.onerror = () => {
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

// Wire up Edit Profile Form
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
        const res = await authFetch(`/api/clients/${clientId}/profile`, {
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

  // Keyboard shortcut Ctrl+K to search
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      switchTab('overview');
      const searchInput = document.getElementById('client-search-input');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
  });

  // OTA Client Updater Controls
  const btnDeployOTAAll = document.getElementById('btn-deploy-ota-all');
  if (btnDeployOTAAll) {
    btnDeployOTAAll.addEventListener('click', () => {
      if (confirm('🚀 Deploy Remote OTA Update to all connected workstations now?')) {
        deployOTAUpdateTo('all');
      }
    });
  }

  // Auto-Update on Connect Toggle Listener
  const otaAutoToggle = document.getElementById('ota-auto-connect-toggle');
  if (otaAutoToggle) {
    otaAutoToggle.addEventListener('change', async (e) => {
      const isEnabled = e.target.checked;
      const pill = document.getElementById('ota-auto-status-pill');
      if (pill) {
        pill.textContent = isEnabled ? 'Active' : 'Disabled';
        pill.style.background = isEnabled ? 'var(--emerald-light)' : 'var(--rose-light)';
        pill.style.color = isEnabled ? 'var(--emerald)' : 'var(--rose)';
        pill.style.borderColor = isEnabled ? 'var(--emerald-pill)' : 'var(--rose-pill)';
      }
      try {
        const res = await authFetch('/api/updates/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auto_update_on_connect: isEnabled })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`⚡ Zero-Touch Auto-Update on Connect is now ${isEnabled ? 'ENABLED' : 'DISABLED'}`, isEnabled ? 'success' : 'info');
        }
      } catch (err) {
        showToast('Failed to update config: ' + err.message, 'alert');
      }
    });
  }

  // Cloud URL Release Ingestion Listener
  const btnFetchCloud = document.getElementById('btn-fetch-cloud-release');
  if (btnFetchCloud) {
    btnFetchCloud.addEventListener('click', async () => {
      const urlInput = document.getElementById('ota-cloud-url-input');
      const versionInput = document.getElementById('ota-cloud-version-input');
      const cloudUrl = urlInput ? urlInput.value.trim() : '';
      const version = versionInput ? versionInput.value.trim() : '';

      if (!cloudUrl) {
        showToast('Please enter a valid remote Cloud URL for the update package (.zip)', 'alert');
        return;
      }

      btnFetchCloud.textContent = '📥 Fetching...';
      btnFetchCloud.disabled = true;

      try {
        const res = await authFetch('/api/updates/fetch-cloud', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cloud_url: cloudUrl,
            version: version || null,
            auto_deploy: true
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`✅ ${data.message}`, 'success');
          if (urlInput) urlInput.value = '';
          if (versionInput) versionInput.value = '';
          fetchOTAStatus();
        } else {
          showToast(`Cloud fetch error: ${data.error}`, 'alert');
        }
      } catch (err) {
        showToast(`Failed to fetch cloud release: ${err.message}`, 'alert');
      } finally {
        btnFetchCloud.textContent = '☁️ Fetch from Cloud';
        btnFetchCloud.disabled = false;
      }
    });
  }

  const btnUploadOTABundle = document.getElementById('btn-upload-ota-bundle');
  const fileInputOTABundle = document.getElementById('ota-bundle-file-input');
  if (btnUploadOTABundle && fileInputOTABundle) {
    btnUploadOTABundle.addEventListener('click', () => {
      fileInputOTABundle.click();
    });

    fileInputOTABundle.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('bundle', file);

      btnUploadOTABundle.textContent = 'Uploading...';
      btnUploadOTABundle.disabled = true;

      try {
        const res = await authFetch('/api/updates/upload-bundle', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.success) {
          showToast(`✅ ${data.message} (v${data.info.version})`, 'success');
          fetchOTAStatus();
        } else {
          showToast(`Upload failed: ${data.error}`, 'alert');
        }
      } catch (err) {
        showToast(`Upload error: ${err.message}`, 'alert');
      } finally {
        btnUploadOTABundle.textContent = '📦 Upload Local .ZIP';
        btnUploadOTABundle.disabled = false;
        fileInputOTABundle.value = '';
      }
    });
  }
});

// --- OTA Remote Client Updates Manager ---
async function fetchOTAStatus() {
  try {
    const res = await authFetch('/api/updates/status');
    const data = await res.json();
    if (!data.success) return;

    state.latestAgentVersion = data.version;
    const badge = document.getElementById('ota-server-version-badge');
    const versionText = document.getElementById('ota-latest-version-text');
    const countUpToDate = document.getElementById('ota-count-uptodate');
    const countOutdated = document.getElementById('ota-count-outdated');
    const autoToggle = document.getElementById('ota-auto-connect-toggle');
    const autoPill = document.getElementById('ota-auto-status-pill');

    if (badge) badge.textContent = `Release v${data.version}`;
    if (versionText) versionText.textContent = `v${data.version}`;
    if (countUpToDate) countUpToDate.textContent = (data.total_clients || 0) - (data.outdated_count || 0);
    if (countOutdated) countOutdated.textContent = data.outdated_count || 0;

    if (autoToggle && data.auto_update_on_connect !== undefined) {
      autoToggle.checked = !!data.auto_update_on_connect;
    }
    if (autoPill && data.auto_update_on_connect !== undefined) {
      const isAuto = !!data.auto_update_on_connect;
      autoPill.textContent = isAuto ? 'Active' : 'Disabled';
      autoPill.style.background = isAuto ? 'var(--emerald-light)' : 'var(--rose-light)';
      autoPill.style.color = isAuto ? 'var(--emerald)' : 'var(--rose)';
      autoPill.style.borderColor = isAuto ? 'var(--emerald-pill)' : 'var(--rose-pill)';
    }

    renderOTAFleetList(data.clients || state.clients, data.version);
  } catch (err) {
    console.error('Failed to fetch OTA status:', err);
  }
}

function renderOTAFleetList(clients, latestVersion) {
  const container = document.getElementById('ota-workstations-list');
  if (!container) return;

  if (!clients || clients.length === 0) {
    container.innerHTML = '<p style="font-size: 0.8rem; color: var(--text-muted);">No client agents registered yet.</p>';
    return;
  }

  container.innerHTML = clients.map(client => {
    const isLatest = (client.agent_version || '1.0.0') === latestVersion;
    const isOnline = client.status === 'online';

    return `
      <div id="ota-row-${client.id}" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-card-subtle); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); flex-wrap: wrap; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="status-indicator ${isOnline ? '' : 'offline'}" style="width: 8px; height: 8px;"></span>
          <div>
            <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-main);">${client.hostname} (${client.employee_name || client.username})</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); font-family: 'JetBrains Mono';">${client.id}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="badge-pill" id="ota-badge-${client.id}" style="font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 9999px; background: ${isLatest ? 'var(--emerald-light)' : 'var(--rose-light)'}; color: ${isLatest ? 'var(--emerald)' : 'var(--rose)'}; border: 1px solid ${isLatest ? 'var(--emerald-pill)' : 'var(--rose-pill)'};">
            v${client.agent_version || '1.0.0'} ${isLatest ? '✓' : '⚠️ Outdated'}
          </span>
          <button type="button" class="btn btn-secondary btn-xs" id="ota-btn-${client.id}" onclick="deployOTAUpdateTo('${client.id}')" ${!isOnline ? 'disabled title="Client is offline"' : ''} style="gap: 4px;">
            🚀 ${isLatest ? 'Re-Deploy' : 'Deploy Update'}
          </button>
        </div>
        <div id="ota-progress-bar-${client.id}" style="display: none; width: 100%; height: 4px; background: var(--bg-card); border-radius: 9999px; overflow: hidden; margin-top: 4px;">
          <div id="ota-progress-fill-${client.id}" style="width: 0%; height: 100%; background: linear-gradient(90deg, #4f46e5, #06b6d4); transition: width 0.3s;"></div>
        </div>
      </div>
    `;
  }).join('');
}

async function deployOTAUpdateTo(clientId, force = false) {
  try {
    showToast(`🚀 Dispatched OTA update command to ${clientId === 'all' ? 'all workstations' : clientId}...`, 'info');
    const res = await authFetch('/api/updates/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_client_id: clientId, force })
    });
    const data = await res.json();
    if (data.success) {
      showToast('OTA update dispatched successfully', 'success');
      fetchOTAStatus();
    } else {
      showToast(`OTA Error: ${data.error}`, 'alert');
    }
  } catch (err) {
    showToast(`Failed to deploy update: ${err.message}`, 'alert');
  }
}

function handleOTAUpdateProgress(data) {
  const { client_id, status, percent, message, version } = data;
  const badge = document.getElementById(`ota-badge-${client_id}`);
  const progressBar = document.getElementById(`ota-progress-bar-${client_id}`);
  const progressFill = document.getElementById(`ota-progress-fill-${client_id}`);
  const btn = document.getElementById(`ota-btn-${client_id}`);

  if (progressBar && progressFill) {
    progressBar.style.display = 'block';
    if (percent !== undefined) progressFill.style.width = `${percent}%`;
  }

  if (badge) {
    if (status === 'downloading') {
      badge.textContent = `Downloading ${percent || 0}%`;
      badge.style.background = 'var(--cyan-light)';
      badge.style.color = 'var(--cyan)';
      badge.style.borderColor = 'var(--cyan-pill)';
    } else if (status === 'installing') {
      badge.textContent = `Extracting...`;
      badge.style.background = 'var(--amber-light)';
      badge.style.color = 'var(--amber)';
      badge.style.borderColor = 'var(--amber-pill)';
    } else if (status === 'restarting') {
      badge.textContent = `Restarting Daemon...`;
      badge.style.background = 'var(--purple-light)';
      badge.style.color = 'var(--purple)';
      badge.style.borderColor = 'var(--purple-pill)';
    } else if (status === 'updated' || status === 'already_latest') {
      badge.textContent = `v${version || '1.2.0'} ✓`;
      badge.style.background = 'var(--emerald-light)';
      badge.style.color = 'var(--emerald)';
      badge.style.borderColor = 'var(--emerald-pill)';
      if (progressBar) progressBar.style.display = 'none';
      if (btn) {
        btn.textContent = '🚀 Re-Deploy';
        btn.disabled = false;
      }
    } else if (status === 'error') {
      badge.textContent = `Update Failed`;
      badge.style.background = 'var(--rose-light)';
      badge.style.color = 'var(--rose)';
      badge.style.borderColor = 'var(--rose-pill)';
      if (progressBar) progressBar.style.display = 'none';
      if (btn) btn.disabled = false;
    }
  }

  if (status === 'restarting' || status === 'updated') {
    showToast(`Workstation ${client_id}: ${message || 'Updated successfully!'}`, status === 'error' ? 'alert' : 'success');
    setTimeout(() => {
      fetchClients();
      fetchOTAStatus();
    }, 2000);
  }
}

// ==========================================
// 🗄️ DATABASE STUDIO & LIVE STORAGE MANAGER
// ==========================================

function initDatabaseStudioListeners() {
  const tableSelect = document.getElementById('db-table-select');
  if (tableSelect) {
    tableSelect.addEventListener('change', () => {
      state.dbStudio.activeTable = tableSelect.value;
      state.dbStudio.currentPage = 1;
      state.dbStudio.search = '';
      const searchInput = document.getElementById('db-table-search');
      if (searchInput) searchInput.value = '';
      loadActiveDatabaseTable();
    });
  }

  const searchInput = document.getElementById('db-table-search');
  if (searchInput) {
    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.dbStudio.search = searchInput.value.trim();
        state.dbStudio.currentPage = 1;
        loadActiveDatabaseTable();
      }, 300);
    });
  }

  const btnRefresh = document.getElementById('btn-db-refresh-table');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      loadActiveDatabaseTable();
      fetchDatabaseStats();
      showToast('Table refreshed', 'info');
    });
  }

  const btnAdd = document.getElementById('btn-db-add-record');
  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      openDatabaseRecordModal('add', null);
    });
  }

  const limitSelect = document.getElementById('db-limit-select');
  if (limitSelect) {
    limitSelect.addEventListener('change', () => {
      state.dbStudio.limit = parseInt(limitSelect.value, 10) || 20;
      state.dbStudio.currentPage = 1;
      loadActiveDatabaseTable();
    });
  }

  const btnPrev = document.getElementById('btn-db-prev-page');
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (state.dbStudio.currentPage > 1) {
        state.dbStudio.currentPage--;
        loadActiveDatabaseTable();
      }
    });
  }

  const btnNext = document.getElementById('btn-db-next-page');
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (state.dbStudio.currentPage < state.dbStudio.totalPages) {
        state.dbStudio.currentPage++;
        loadActiveDatabaseTable();
      }
    });
  }

  // Backup & Purge Buttons
  const btnPurge = document.getElementById('btn-db-purge-retention');
  if (btnPurge) {
    btnPurge.addEventListener('click', triggerDatabaseRetentionPurge);
  }

  const btnExportDb = document.getElementById('btn-db-export-sqlite');
  if (btnExportDb) {
    btnExportDb.addEventListener('click', () => {
      const token = getAuthToken();
      window.open(`/api/database/export/sqlite?token=${encodeURIComponent(token)}`, '_blank');
      showToast('📥 Downloading raw workguard.db SQLite backup...', 'success');
    });
  }

  const btnExportJson = document.getElementById('btn-db-export-json');
  if (btnExportJson) {
    btnExportJson.addEventListener('click', () => {
      const token = getAuthToken();
      window.open(`/api/database/export/json?token=${encodeURIComponent(token)}`, '_blank');
      showToast('📥 Downloading JSON database export...', 'success');
    });
  }

  // Record Modal Listeners
  const modalClose = document.getElementById('db-record-modal-close');
  const modalCancel = document.getElementById('btn-cancel-db-record');
  const modalOverlay = document.getElementById('db-record-overlay');
  const formRecord = document.getElementById('form-db-record');

  if (modalClose) modalClose.addEventListener('click', closeDatabaseRecordModal);
  if (modalCancel) modalCancel.addEventListener('click', closeDatabaseRecordModal);
  if (modalOverlay) modalOverlay.addEventListener('click', closeDatabaseRecordModal);
  if (formRecord) formRecord.addEventListener('submit', handleSaveDatabaseRecord);
}

async function fetchDatabaseStats() {
  try {
    const res = await authFetch('/api/database/stats');
    const data = await res.json();
    if (data.success && data.stats) {
      const s = data.stats;
      document.getElementById('db-stat-filesize').textContent = s.db_file_size_formatted || '-- MB';
      document.getElementById('db-stat-shots-count').textContent = (s.table_counts.screenshots || 0).toLocaleString();
      document.getElementById('db-stat-shots-size').textContent = `${s.screenshot_storage_formatted} on disk`;
      document.getElementById('db-stat-clients-count').textContent = (s.table_counts.clients || 0).toLocaleString();
      document.getElementById('db-stat-retention-days').textContent = `${s.retention_days} Days`;
    }
  } catch (err) {
    console.error('[DB Studio] Stats error:', err);
  }
}

async function loadActiveDatabaseTable() {
  const table = state.dbStudio.activeTable;
  const page = state.dbStudio.currentPage;
  const limit = state.dbStudio.limit;
  const search = state.dbStudio.search;

  const thead = document.getElementById('db-studio-thead');
  const tbody = document.getElementById('db-studio-tbody');
  
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 24px; color: var(--text-muted);">⏳ Loading table '${table}'...</td></tr>`;
  }

  try {
    let url = `/api/database/table/${table}?page=${page}&limit=${limit}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    const res = await authFetch(url);
    const data = await res.json();

    if (data.success) {
      state.dbStudio.totalRecords = data.total_records || 0;
      state.dbStudio.totalPages = data.total_pages || 1;
      renderDatabaseTable(table, data.records || [], page, data.total_records, data.total_pages);
    } else {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 24px; color: var(--rose);">Error loading table: ${data.error}</td></tr>`;
    }
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 24px; color: var(--rose);">Failed to fetch records: ${err.message}</td></tr>`;
    }
  }
}

function renderDatabaseTable(table, records, page, totalRecords, totalPages) {
  const thead = document.getElementById('db-studio-thead');
  const tbody = document.getElementById('db-studio-tbody');
  const pageInfo = document.getElementById('db-pagination-info');
  const pageIndicator = document.getElementById('db-page-indicator');
  const btnPrev = document.getElementById('btn-db-prev-page');
  const btnNext = document.getElementById('btn-db-next-page');

  // Update Pagination Bar
  const limit = state.dbStudio.limit;
  const start = totalRecords === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, totalRecords);
  if (pageInfo) pageInfo.textContent = `Showing ${start}-${end} of ${totalRecords.toLocaleString()} records`;
  if (pageIndicator) pageIndicator.textContent = `Page ${page} of ${totalPages || 1}`;
  if (btnPrev) btnPrev.disabled = page <= 1;
  if (btnNext) btnNext.disabled = page >= totalPages;

  if (records.length === 0) {
    thead.innerHTML = `<tr><th style="padding: 12px;">Result</th></tr>`;
    tbody.innerHTML = `<tr><td style="text-align: center; padding: 28px; color: var(--text-muted);">No records found matching query in table <strong>${table}</strong>.</td></tr>`;
    return;
  }

  // Determine Columns from first record
  const columns = Object.keys(records[0]);
  
  // Render THEAD
  thead.innerHTML = `
    <tr>
      <th style="width: 90px; text-align: center;">Actions</th>
      ${columns.map(c => `<th>${c}</th>`).join('')}
    </tr>
  `;

  // Render TBODY
  tbody.innerHTML = '';
  records.forEach((row, rowIndex) => {
    const tr = document.createElement('tr');
    const rowId = row.id !== undefined ? row.id : (row.key !== undefined ? row.key : rowIndex);
    const rowJson = encodeURIComponent(JSON.stringify(row));

    let cellsHtml = `
      <td style="text-align: center; white-space: nowrap;">
        <button class="btn btn-secondary btn-xs" onclick="openDatabaseRecordModalFromRow('${rowJson}')" title="Edit row" style="padding: 3px 6px;">✏️</button>
        <button class="btn btn-secondary btn-xs" onclick="confirmDeleteDatabaseRecord('${table}', '${encodeURIComponent(rowId)}')" title="Delete row" style="padding: 3px 6px; color: var(--rose);">🗑️</button>
      </td>
    `;

    columns.forEach(col => {
      let val = row[col];
      let formattedVal = '';

      if (val === null || val === undefined) {
        formattedVal = '<span style="color: var(--text-dim); font-style: italic;">null</span>';
      } else if (typeof val === 'boolean' || val === 1 && (col === 'is_encrypted' || col === 'pause_on_sensitive')) {
        formattedVal = `<span class="badge-pill" style="font-size: 10px; background: ${val ? 'var(--emerald-light)' : 'var(--border-subtle)'}; color: ${val ? 'var(--emerald)' : 'var(--text-muted)'};">${Boolean(val)}</span>`;
      } else if (col === 'status') {
        formattedVal = `<span class="badge-pill ${val === 'online' ? 'online' : 'offline'}" style="font-size: 10px;">${val}</span>`;
      } else if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
        // Pretty JSON preview tag
        try {
          const parsed = JSON.parse(val);
          const isArr = Array.isArray(parsed);
          formattedVal = `<span class="badge-pill" style="font-family: 'JetBrains Mono'; font-size: 10px; background: rgba(99,102,241,0.1); color: var(--primary); cursor: pointer;" title="${escapeHtml(val)}">${isArr ? `Array(${parsed.length})` : 'Object {...}'}</span>`;
        } catch (e) {
          formattedVal = escapeHtml(String(val).substring(0, 40));
        }
      } else if (typeof val === 'string' && val.length > 50) {
        formattedVal = `<span title="${escapeHtml(val)}" style="cursor: help;">${escapeHtml(val.substring(0, 47))}...</span>`;
      } else {
        formattedVal = escapeHtml(String(val));
      }

      cellsHtml += `<td style="font-family: ${col.includes('id') || col.includes('hash') || col.includes('time') || col.includes('key') ? "'JetBrains Mono'" : 'inherit'}; font-size: 0.8rem;">${formattedVal}</td>`;
    });

    tr.innerHTML = cellsHtml;
    tbody.appendChild(tr);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.openDatabaseRecordModalFromRow = function(encodedRow) {
  try {
    const record = JSON.parse(decodeURIComponent(encodedRow));
    openDatabaseRecordModal('edit', record);
  } catch (e) {
    showToast('Failed to open record: ' + e.message, 'alert');
  }
};

window.confirmDeleteDatabaseRecord = async function(table, encodedId) {
  const id = decodeURIComponent(encodedId);
  if (!confirm(`Are you sure you want to permanently delete record '${id}' from '${table}'?`)) {
    return;
  }

  try {
    const res = await authFetch(`/api/database/table/${table}/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Deleted record '${id}' from ${table}`, 'success');
      loadActiveDatabaseTable();
      fetchDatabaseStats();
    } else {
      showToast(`Delete failed: ${data.error}`, 'alert');
    }
  } catch (err) {
    showToast(`Error deleting record: ${err.message}`, 'alert');
  }
};

function openDatabaseRecordModal(mode, record) {
  const table = state.dbStudio.activeTable;
  state.dbStudio.modalMode = mode;
  state.dbStudio.currentRecord = record;

  const modal = document.getElementById('db-record-modal');
  const title = document.getElementById('db-record-modal-title');
  const subtitle = document.getElementById('db-record-modal-subtitle');
  const container = document.getElementById('db-record-fields-container');

  title.textContent = mode === 'add' ? `➕ Add Record to ${table}` : `✏️ Edit Record in ${table}`;
  subtitle.textContent = `Table: ${table} (${mode === 'add' ? 'New Entry' : (record.id || record.key || '')})`;

  container.innerHTML = '';

  let fields = [];
  if (table === 'clients') {
    fields = [
      { key: 'id', label: 'Client ID', type: 'text', readonly: mode === 'edit', required: true, default: `client-${Date.now().toString(36)}` },
      { key: 'employee_name', label: 'Employee Full Name', type: 'text', required: true, default: 'Employee Name' },
      { key: 'department', label: 'Department', type: 'text', default: 'General' },
      { key: 'hostname', label: 'Host / PC Name', type: 'text', default: 'DESKTOP-PC' },
      { key: 'username', label: 'OS Username', type: 'text', default: 'user' },
      { key: 'ip', label: 'IP Address', type: 'text', default: '127.0.0.1' },
      { key: 'os', label: 'Operating System', type: 'text', default: 'Windows_NT' },
      { key: 'agent_version', label: 'Agent Version', type: 'text', default: '1.2.0' },
      { key: 'status', label: 'Status (online/offline)', type: 'select', options: ['online', 'offline'], default: 'offline' }
    ];
  } else if (table === 'policies') {
    fields = [
      { key: 'id', label: 'Policy ID', type: 'text', readonly: mode === 'edit', required: true, default: 'custom-policy' },
      { key: 'name', label: 'Policy Name', type: 'text', required: true, default: 'Custom Policy' },
      { key: 'policy_mode', label: 'Policy Mode', type: 'select', options: ['audit-alert', 'strict-block'], default: 'audit-alert' },
      { key: 'retention_days', label: 'Retention Period (Days)', type: 'number', default: 20 },
      { key: 'capture_interval_sec', label: 'Capture Interval (Seconds)', type: 'number', default: 600 },
      { key: 'stream_fps', label: 'Stream FPS', type: 'number', default: 15 },
      { key: 'work_hours_start', label: 'Work Hours Start', type: 'text', default: '09:00' },
      { key: 'work_hours_end', label: 'Work Hours End', type: 'text', default: '18:00' },
      { key: 'allowed_apps_json', label: 'Allowed Apps (JSON Array)', type: 'textarea', default: '["code.exe","chrome.exe","slack.exe"]' },
      { key: 'allowed_domains_json', label: 'Allowed Domains (JSON Array)', type: 'textarea', default: '["github.com","google.com","slack.com"]' }
    ];
  } else if (table === 'security_settings') {
    fields = [
      { key: 'key', label: 'Setting Key', type: 'text', readonly: mode === 'edit', required: true, default: 'custom_setting' },
      { key: 'value', label: 'Setting Value', type: 'text', required: true, default: '' }
    ];
  } else if (table === 'screenshots') {
    fields = [
      { key: 'id', label: 'Screenshot ID', type: 'text', readonly: true },
      { key: 'client_id', label: 'Client ID', type: 'text', readonly: true },
      { key: 'active_app', label: 'Active App', type: 'text' },
      { key: 'active_window', label: 'Active Window Title', type: 'text' },
      { key: 'timestamp', label: 'Timestamp', type: 'text', readonly: true },
      { key: 'filepath', label: 'File Path', type: 'text', readonly: true }
    ];
  } else if (table === 'audit_logs') {
    fields = [
      { key: 'id', label: 'Log ID', type: 'text', readonly: true },
      { key: 'event_type', label: 'Event Type', type: 'text', readonly: true },
      { key: 'client_id', label: 'Workstation / Actor', type: 'text', readonly: true },
      { key: 'details', label: 'Event Details', type: 'text', readonly: true },
      { key: 'timestamp', label: 'Timestamp', type: 'text', readonly: true },
      { key: 'hash', label: 'Cryptographic Hash', type: 'text', readonly: true }
    ];
  }

  fields.forEach(f => {
    const val = record && record[f.key] !== undefined ? record[f.key] : (f.default !== undefined ? f.default : '');
    const div = document.createElement('div');

    if (f.type === 'textarea') {
      div.innerHTML = `
        <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-muted); margin-bottom: 4px;">${f.label}:</label>
        <textarea name="${f.key}" class="input-search" style="width: 100%; height: 75px; font-family: 'JetBrains Mono'; font-size: 0.8rem; resize: vertical;" ${f.readonly ? 'readonly' : ''} ${f.required ? 'required' : ''}>${escapeHtml(val)}</textarea>
      `;
    } else if (f.type === 'select') {
      div.innerHTML = `
        <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-muted); margin-bottom: 4px;">${f.label}:</label>
        <select name="${f.key}" class="select-dropdown" style="width: 100%;">
          ${f.options.map(opt => `<option value="${opt}" ${val === opt ? 'selected' : ''}>${opt}</option>`).join('')}
        </select>
      `;
    } else {
      div.innerHTML = `
        <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-muted); margin-bottom: 4px;">${f.label}:</label>
        <input type="${f.type || 'text'}" name="${f.key}" class="input-search" value="${escapeHtml(val)}" style="width: 100%; font-family: ${f.key.includes('id') || f.key.includes('time') ? "'JetBrains Mono'" : 'inherit'}; font-size: 0.82rem;" ${f.readonly ? 'readonly' : ''} ${f.required ? 'required' : ''}>
      `;
    }

    container.appendChild(div);
  });

  modal.classList.add('active');
}

function closeDatabaseRecordModal() {
  const modal = document.getElementById('db-record-modal');
  if (modal) modal.classList.remove('active');
}

async function handleSaveDatabaseRecord(e) {
  if (e) e.preventDefault();
  const form = document.getElementById('form-db-record');
  const formData = new FormData(form);
  const data = {};

  formData.forEach((val, key) => {
    data[key] = val;
  });

  const table = state.dbStudio.activeTable;
  const mode = state.dbStudio.modalMode;
  const currentRecord = state.dbStudio.currentRecord;
  const recordId = currentRecord ? (currentRecord.id || currentRecord.key) : (data.id || data.key);

  try {
    let url = `/api/database/table/${table}`;
    let method = 'POST';

    if (mode === 'edit') {
      url += `/${encodeURIComponent(recordId)}`;
      method = 'PUT';
    }

    const res = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const resData = await res.json();
    if (resData.success) {
      showToast(mode === 'add' ? `Record added to ${table} successfully!` : `Record updated in ${table}!`, 'success');
      closeDatabaseRecordModal();
      loadActiveDatabaseTable();
      fetchDatabaseStats();
      if (table === 'clients') fetchClients();
      if (table === 'policies') fetchPolicy();
    } else {
      showToast(`Error saving record: ${resData.error}`, 'alert');
    }
  } catch (err) {
    showToast(`Failed to save record: ${err.message}`, 'alert');
  }
}

async function triggerDatabaseRetentionPurge() {
  const btn = document.getElementById('btn-db-purge-retention');
  if (!confirm('Run automatic photo retention cleanup now? This will permanently delete screenshots older than your retention policy from disk and database.')) {
    return;
  }

  if (btn) {
    btn.textContent = '🧹 Purging...';
    btn.disabled = true;
  }

  try {
    const res = await authFetch('/api/database/purge-retention', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      const count = data.result.deletedCount || 0;
      const mb = (data.result.freedBytes / (1024 * 1024)).toFixed(2);
      showToast(`✨ Retention cleanup complete! Shredded ${count} expired photos (${mb} MB freed).`, 'success');
      fetchDatabaseStats();
      loadActiveDatabaseTable();
      fetchScreenshots();
      fetchLogs();
    } else {
      showToast(`Purge failed: ${data.error}`, 'alert');
    }
  } catch (err) {
    showToast(`Retention purge error: ${err.message}`, 'alert');
  } finally {
    if (btn) {
      btn.textContent = '🧹 Purge Expired Photos';
      btn.disabled = false;
    }
  }
}

// ==========================================
// ENTERPRISE: RBAC & MULTI-ADMIN FRONTEND
// ==========================================
async function loadRbacUsers() {
  const tbody = document.getElementById('rbac-users-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">Loading admin users...</td></tr>';

  try {
    const res = await authFetch('/api/rbac/users');
    const data = await res.json();

    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 20px;">${data.error || 'Access restricted to SuperAdmin'}</td></tr>`;
      return;
    }

    if (data.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">No additional admin accounts configured.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    data.users.forEach(u => {
      const tr = document.createElement('tr');
      
      let roleBadge = '<span class="status-pill status-online" style="background: rgba(99,102,241,0.15); color: #818cf8;">SuperAdmin</span>';
      if (u.role === 'dept_manager') {
        roleBadge = '<span class="status-pill status-online" style="background: rgba(16,185,129,0.15); color: #34d399;">Dept Manager</span>';
      } else if (u.role === 'auditor') {
        roleBadge = '<span class="status-pill status-idle" style="background: rgba(245,158,11,0.15); color: #fbbf24;">Auditor</span>';
      }

      const depts = Array.isArray(u.allowed_departments) ? u.allowed_departments.join(', ') : 'ALL';
      const statusBadge = u.is_active ? 
        '<span style="color: #10B981; font-weight: 700;">Active</span>' : 
        '<span style="color: #F43F5E; font-weight: 700;">Disabled</span>';

      tr.innerHTML = `
        <td style="font-family: 'JetBrains Mono'; font-weight: 700;">${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.full_name || u.username)}</td>
        <td>${roleBadge}</td>
        <td><span style="font-size: 0.8rem; background: var(--bg-surface); padding: 3px 8px; border-radius: 6px; border: 1px solid var(--border-subtle);">${escapeHtml(depts)}</span></td>
        <td>${statusBadge}</td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
        <td style="text-align: right;">
          <button class="btn btn-secondary btn-xs btn-edit-rbac" data-user='${escapeHtml(JSON.stringify(u))}'>✏️ Edit</button>
          <button class="btn btn-secondary btn-xs btn-delete-rbac" data-id="${u.id}" data-name="${escapeHtml(u.username)}" style="color: var(--danger); margin-left: 4px;">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Wire action buttons
    tbody.querySelectorAll('.btn-edit-rbac').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const u = JSON.parse(e.currentTarget.dataset.user);
        openRbacUserModal(u);
      });
    });

    tbody.querySelectorAll('.btn-delete-rbac').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const name = e.currentTarget.dataset.name;
        deleteRbacUser(id, name);
      });
    });

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 20px;">Error: ${err.message}</td></tr>`;
  }
}

function openRbacUserModal(user = null) {
  const modal = document.getElementById('rbac-user-modal');
  const title = document.getElementById('rbac-user-modal-title');
  const idInput = document.getElementById('rbac-user-id');
  const userInput = document.getElementById('rbac-username');
  const nameInput = document.getElementById('rbac-fullname');
  const passInput = document.getElementById('rbac-password');
  const passLabel = document.getElementById('rbac-password-label');
  const roleSelect = document.getElementById('rbac-role-select');
  const deptsInput = document.getElementById('rbac-departments');

  if (user) {
    title.textContent = '✏️ Edit Admin Account';
    idInput.value = user.id;
    userInput.value = user.username;
    userInput.disabled = true;
    nameInput.value = user.full_name || '';
    passInput.value = '';
    passInput.placeholder = 'Leave blank to keep current password...';
    passLabel.textContent = 'New Password (Optional):';
    roleSelect.value = user.role || 'dept_manager';
    deptsInput.value = Array.isArray(user.allowed_departments) ? user.allowed_departments.join(', ') : 'ALL';
  } else {
    title.textContent = '👥 Create Admin Account';
    idInput.value = '';
    userInput.value = '';
    userInput.disabled = false;
    nameInput.value = '';
    passInput.value = '';
    passInput.placeholder = 'Enter secure password...';
    passLabel.textContent = 'Password:';
    roleSelect.value = 'dept_manager';
    deptsInput.value = 'ALL';
  }

  modal.classList.add('active');
}

function closeRbacUserModal() {
  const modal = document.getElementById('rbac-user-modal');
  if (modal) modal.classList.remove('active');
}

async function saveRbacUser(e) {
  if (e) e.preventDefault();
  const id = document.getElementById('rbac-user-id').value;
  const username = document.getElementById('rbac-username').value.trim();
  const full_name = document.getElementById('rbac-fullname').value.trim();
  const password = document.getElementById('rbac-password').value.trim();
  const role = document.getElementById('rbac-role-select').value;
  const deptsRaw = document.getElementById('rbac-departments').value.trim();

  const allowed_departments = deptsRaw.split(',').map(d => d.trim()).filter(Boolean);

  const payload = { full_name, role, allowed_departments };
  if (!id) {
    if (!username || !password) {
      showToast('Username and password are required', 'alert');
      return;
    }
    payload.username = username;
    payload.password = password;
  } else {
    if (password) payload.password = password;
  }

  try {
    const url = id ? `/api/rbac/users/${id}` : '/api/rbac/users';
    const method = id ? 'PUT' : 'POST';

    const res = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      showToast(id ? 'Admin account updated successfully!' : 'Admin account created successfully!', 'success');
      closeRbacUserModal();
      loadRbacUsers();
    } else {
      showToast(`Error: ${data.error}`, 'alert');
    }
  } catch (err) {
    showToast(`Failed to save admin user: ${err.message}`, 'alert');
  }
}

async function deleteRbacUser(id, username) {
  if (!confirm(`Are you sure you want to delete admin account '${username}'?`)) return;

  try {
    const res = await authFetch(`/api/rbac/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Admin account '${username}' deleted.`, 'success');
      loadRbacUsers();
    } else {
      showToast(`Delete failed: ${data.error}`, 'alert');
    }
  } catch (err) {
    showToast(`Error deleting user: ${err.message}`, 'alert');
  }
}

// ==========================================
// ENTERPRISE: APPLICATION ALERT RULES ("ADD APPLICATION TOOL")
// ==========================================
async function loadAlertAppRules() {
  const tbody = document.getElementById('app-rules-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 15px;">Loading alert rules...</td></tr>';

  try {
    const res = await authFetch('/api/alerts/app-rules');
    const data = await res.json();

    if (!data.success || data.rules.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 15px;">No application trigger rules configured.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    data.rules.forEach(r => {
      const tr = document.createElement('tr');
      let sevBadge = '<span class="status-pill status-idle" style="background: rgba(245,158,11,0.15); color: #fbbf24;">⚠️ Warning</span>';
      if (r.severity === 'critical') {
        sevBadge = '<span class="status-pill status-offline" style="background: rgba(244,63,94,0.15); color: #fda4af;">🚨 Critical</span>';
      } else if (r.severity === 'info') {
        sevBadge = '<span class="status-pill status-online" style="background: rgba(59,130,246,0.15); color: #60a5fa;">ℹ️ Info</span>';
      }

      tr.innerHTML = `
        <td style="font-family: 'JetBrains Mono'; font-weight: 700; color: var(--text-main);">${escapeHtml(r.app_name)}</td>
        <td>${sevBadge}</td>
        <td><code style="font-size: 0.8rem;">${escapeHtml(r.action)}</code></td>
        <td style="font-size: 0.82rem; color: var(--text-muted);">${escapeHtml(r.custom_message || 'Prohibited application')}</td>
        <td style="text-align: right;">
          <button class="btn btn-secondary btn-xs btn-delete-app-rule" data-id="${r.id}" data-name="${escapeHtml(r.app_name)}" style="color: var(--danger);">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-delete-app-rule').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const name = e.currentTarget.dataset.name;
        deleteAlertAppRule(id, name);
      });
    });

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger); padding: 15px;">Error: ${err.message}</td></tr>`;
  }
}

function openAlertAppModal() {
  document.getElementById('alert-app-name-input').value = '';
  document.getElementById('alert-app-msg').value = '';
  document.getElementById('alert-app-modal').classList.add('active');
}

function closeAlertAppModal() {
  document.getElementById('alert-app-modal').classList.remove('active');
}

async function saveAlertAppRule(e) {
  if (e) e.preventDefault();
  const app_name = document.getElementById('alert-app-name-input').value.trim();
  const severity = document.getElementById('alert-app-severity').value;
  const action = document.getElementById('alert-app-action').value;
  const custom_message = document.getElementById('alert-app-msg').value.trim();

  if (!app_name) {
    showToast('Application executable name is required', 'alert');
    return;
  }

  try {
    const res = await authFetch('/api/alerts/app-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_name, severity, action, custom_message })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`⚡ Alert rule for '${app_name}' created!`, 'success');
      closeAlertAppModal();
      loadAlertAppRules();
    } else {
      showToast(`Error: ${data.error}`, 'alert');
    }
  } catch (err) {
    showToast(`Failed to add rule: ${err.message}`, 'alert');
  }
}

async function deleteAlertAppRule(id, appName) {
  if (!confirm(`Delete alert trigger rule for '${appName}'?`)) return;

  try {
    const res = await authFetch(`/api/alerts/app-rules/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Rule for '${appName}' removed.`, 'success');
      loadAlertAppRules();
    } else {
      showToast(`Error: ${data.error}`, 'alert');
    }
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'alert');
  }
}

// ==========================================
// ENTERPRISE: WEBHOOK DESTINATIONS
// ==========================================
async function loadAlertWebhooks() {
  const tbody = document.getElementById('webhooks-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 15px;">Loading webhooks...</td></tr>';

  try {
    const res = await authFetch('/api/alerts/webhooks');
    const data = await res.json();

    if (!data.success || data.webhooks.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 15px;">No webhooks connected yet.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    data.webhooks.forEach(wh => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 700;">${escapeHtml(wh.name)}</td>
        <td><span style="font-size: 0.8rem; background: var(--bg-surface); padding: 3px 8px; border-radius: 6px; text-transform: uppercase;">${wh.type}</span></td>
        <td>${wh.is_enabled ? '<span style="color: #10B981; font-weight: 700;">● Active</span>' : '<span style="color: var(--text-muted);">Disabled</span>'}</td>
        <td style="text-align: right;">
          <button class="btn btn-secondary btn-xs btn-test-webhook" data-url="${escapeHtml(wh.webhook_url)}" data-type="${wh.type}">🧪 Test</button>
          <button class="btn btn-secondary btn-xs btn-delete-webhook" data-id="${wh.id}" data-name="${escapeHtml(wh.name)}" style="color: var(--danger); margin-left: 4px;">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-test-webhook').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const url = e.currentTarget.dataset.url;
        const type = e.currentTarget.dataset.type;
        testAlertWebhook(url, type);
      });
    });

    tbody.querySelectorAll('.btn-delete-webhook').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const name = e.currentTarget.dataset.name;
        deleteAlertWebhook(id, name);
      });
    });

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--danger); padding: 15px;">Error: ${err.message}</td></tr>`;
  }
}

function openAlertWebhookModal() {
  document.getElementById('webhook-id').value = '';
  document.getElementById('webhook-name-input').value = '';
  document.getElementById('webhook-url-input').value = '';
  document.getElementById('alert-webhook-modal').classList.add('active');
}

function closeAlertWebhookModal() {
  document.getElementById('alert-webhook-modal').classList.remove('active');
}

async function saveAlertWebhook(e) {
  if (e) e.preventDefault();
  const id = document.getElementById('webhook-id').value;
  const name = document.getElementById('webhook-name-input').value.trim();
  const type = document.getElementById('webhook-type-select').value;
  const webhook_url = document.getElementById('webhook-url-input').value.trim();

  if (!name || !webhook_url) {
    showToast('Name and Webhook URL are required', 'alert');
    return;
  }

  try {
    const res = await authFetch('/api/alerts/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id || undefined, name, type, webhook_url })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`🌐 Webhook '${name}' connected!`, 'success');
      closeAlertWebhookModal();
      loadAlertWebhooks();
    } else {
      showToast(`Error: ${data.error}`, 'alert');
    }
  } catch (err) {
    showToast(`Failed to connect webhook: ${err.message}`, 'alert');
  }
}

async function deleteAlertWebhook(id, name) {
  if (!confirm(`Disconnect webhook '${name}'?`)) return;

  try {
    const res = await authFetch(`/api/alerts/webhooks/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Webhook '${name}' deleted.`, 'success');
      loadAlertWebhooks();
    } else {
      showToast(`Error: ${data.error}`, 'alert');
    }
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'alert');
  }
}

async function testAlertWebhook(url = null, type = 'slack') {
  const targetUrl = url || document.getElementById('webhook-url-input').value.trim();
  const targetType = url ? type : document.getElementById('webhook-type-select').value;

  if (!targetUrl) {
    showToast('Please enter a Webhook URL to test', 'alert');
    return;
  }

  showToast('Sending test alert payload...', 'info');

  try {
    const res = await authFetch('/api/alerts/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl, type: targetType })
    });

    const data = await res.json();
    if (data.success) {
      showToast('✅ Test notification sent successfully to destination!', 'success');
    } else {
      showToast(`Webhook test failed: ${data.error}`, 'alert');
    }
  } catch (err) {
    showToast(`Connection error: ${err.message}`, 'alert');
  }
}

// ==========================================
// ENTERPRISE: LIVE ALERTS FEED
// ==========================================
async function loadLiveAlertsFeed() {
  const tbody = document.getElementById('live-alerts-feed-tbody');
  if (!tbody) return;

  try {
    const res = await authFetch('/api/alerts/recent');
    const data = await res.json();

    if (!data.success || data.alerts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 15px;">No recent security alerts recorded.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    data.alerts.forEach(a => {
      const tr = document.createElement('tr');
      const timeStr = new Date(a.timestamp).toLocaleTimeString();
      let sevColor = '#3B82F6';
      if (a.severity === 'critical') sevColor = '#E11D48';
      if (a.severity === 'warning') sevColor = '#F59E0B';

      tr.innerHTML = `
        <td style="font-size: 0.8rem; color: var(--text-muted);">${timeStr}</td>
        <td><span style="color: ${sevColor}; font-weight: 800; text-transform: uppercase;">● ${a.severity}</span></td>
        <td style="font-weight: 700;">${escapeHtml(a.workstation.hostname)}</td>
        <td>${escapeHtml(a.workstation.employee_name)}</td>
        <td style="font-family: 'JetBrains Mono'; font-weight: 700; color: #f43f5e;">${escapeHtml(a.app_name)}</td>
        <td style="font-size: 0.82rem; color: var(--text-muted); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(a.workstation.active_window)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 15px;">Error: ${err.message}</td></tr>`;
  }
}

// ==========================================
// ENTERPRISE: SUBSYSTEM EVENT LISTENERS
// ==========================================
function initEnterpriseSubsystemListeners() {
  // RBAC Listeners
  const btnCreateAdmin = document.getElementById('btn-create-admin-user-open');
  if (btnCreateAdmin) btnCreateAdmin.addEventListener('click', () => openRbacUserModal());

  const btnCloseRbac = document.getElementById('rbac-user-modal-close');
  if (btnCloseRbac) btnCloseRbac.addEventListener('click', closeRbacUserModal);

  const btnCancelRbac = document.getElementById('btn-cancel-rbac-user');
  if (btnCancelRbac) btnCancelRbac.addEventListener('click', closeRbacUserModal);

  const formRbac = document.getElementById('form-rbac-user');
  if (formRbac) formRbac.addEventListener('submit', saveRbacUser);

  // App Alert Rules Listeners
  const btnAddAppRule = document.getElementById('btn-add-app-rule-modal-open');
  if (btnAddAppRule) btnAddAppRule.addEventListener('click', openAlertAppModal);

  const btnCloseAlertApp = document.getElementById('alert-app-modal-close');
  if (btnCloseAlertApp) btnCloseAlertApp.addEventListener('click', closeAlertAppModal);

  const btnCancelAlertApp = document.getElementById('btn-cancel-alert-app');
  if (btnCancelAlertApp) btnCancelAlertApp.addEventListener('click', closeAlertAppModal);

  const formAlertApp = document.getElementById('form-alert-app');
  if (formAlertApp) formAlertApp.addEventListener('submit', saveAlertAppRule);

  // Webhook Listeners
  const btnAddWebhook = document.getElementById('btn-add-webhook-modal-open');
  if (btnAddWebhook) btnAddWebhook.addEventListener('click', openAlertWebhookModal);

  const btnCloseAlertWh = document.getElementById('alert-webhook-modal-close');
  if (btnCloseAlertWh) btnCloseAlertWh.addEventListener('click', closeAlertWebhookModal);

  const btnCancelAlertWh = document.getElementById('btn-cancel-alert-webhook');
  if (btnCancelAlertWh) btnCancelAlertWh.addEventListener('click', closeAlertWebhookModal);

  const formAlertWh = document.getElementById('form-alert-webhook');
  if (formAlertWh) formAlertWh.addEventListener('submit', saveAlertWebhook);

  const btnTestWh = document.getElementById('btn-test-webhook-connection');
  if (btnTestWh) btnTestWh.addEventListener('click', () => testAlertWebhook());
}
