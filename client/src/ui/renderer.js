// Client UI State & Logic
let shiftSeconds = 0;
let isOnBreak = false;
let timerInterval = null;

// DOM Elements
const shiftTimerEl = document.getElementById('shift-timer');
const workStateBadgeEl = document.getElementById('work-state-badge');
const breakBtn = document.getElementById('btn-toggle-break');
const breakBtnText = document.getElementById('break-btn-text');
const connBadge = document.getElementById('conn-badge');
const statusDot = document.getElementById('status-dot');
const connText = document.getElementById('conn-text');
const currentAppEl = document.getElementById('current-app');
const currentWindowEl = document.getElementById('current-window');
const syncStatusEl = document.getElementById('sync-status');
const pendingCountEl = document.getElementById('pending-count');
const clientIdEl = document.getElementById('client-id');
const hostUserEl = document.getElementById('host-user');
const adminEndpointEl = document.getElementById('admin-endpoint');

const displayEmpNameEl = document.getElementById('display-emp-name');
const displayEmpDeptEl = document.getElementById('display-emp-dept');
const onboardingModal = document.getElementById('onboarding-modal');
const formOnboarding = document.getElementById('form-onboarding');
const inputEmpName = document.getElementById('input-emp-name');
const selectEmpDept = document.getElementById('select-emp-dept');

const policyModal = document.getElementById('policy-modal');
const btnOpenRules = document.getElementById('btn-open-rules');
const btnCloseRules = document.getElementById('btn-close-rules');
const btnCloseRulesBottom = document.getElementById('btn-close-rules-bottom');
const btnSyncNow = document.getElementById('btn-sync-now');
const allowedAppsList = document.getElementById('allowed-apps-list');
const allowedDomainsList = document.getElementById('allowed-domains-list');

// Check Profile State
async function checkEmployeeProfile() {
  try {
    const res = await fetch('/api/profile');
    if (!res.ok) return;
    const profile = await res.json();

    if (profile.employee_name) {
      displayEmpNameEl.textContent = profile.employee_name;
      displayEmpDeptEl.textContent = profile.department || 'General';
      if (onboardingModal) onboardingModal.classList.remove('active');
    } else {
      // First-time user needs setup
      if (onboardingModal) onboardingModal.classList.add('active');
    }
  } catch (e) {
    console.error('Failed to load profile:', e);
  }
}

// Handle Onboarding Form Submit
if (formOnboarding) {
  formOnboarding.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = inputEmpName.value.trim();
    const dept = selectEmpDept.value;
    if (!name) return;

    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_name: name, department: dept })
      });
      const data = await res.json();
      displayEmpNameEl.textContent = name;
      displayEmpDeptEl.textContent = dept;
      onboardingModal.classList.remove('active');
      fetchClientStatus();
    } catch (err) {
      alert('Failed to save profile: ' + err.message);
    }
  });
}

// Shift Timer Clock
function formatTime(totalSec) {
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

timerInterval = setInterval(() => {
  if (!isOnBreak) {
    shiftSeconds++;
    shiftTimerEl.textContent = formatTime(shiftSeconds);
  }
}, 1000);

// Fetch Live Status from Local Client Agent Daemon
async function fetchClientStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('Daemon status unreachable');
    const data = await res.json();

    // Update Connection Badge
    if (data.isConnected) {
      statusDot.className = 'status-dot online';
      connText.textContent = 'Connected (LAN)';
      connBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      connBadge.style.color = '#10b981';
    } else {
      statusDot.className = 'status-dot offline';
      connText.textContent = 'Buffering Offline';
      connBadge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      connBadge.style.color = '#f59e0b';
    }

    // Update Identity if received from server
    if (data.employeeName) {
      displayEmpNameEl.textContent = data.employeeName;
    }
    if (data.department) {
      displayEmpDeptEl.textContent = data.department;
    }

    // Update Telemetry
    currentAppEl.textContent = data.currentApp || 'Desktop Idle';
    currentWindowEl.textContent = data.currentWindow || 'Active Foreground Window';
    clientIdEl.textContent = data.clientId || '---';
    hostUserEl.textContent = `${data.hostname} • ${data.username}`;
    adminEndpointEl.textContent = data.serverUrl || 'http://127.0.0.1:3000';
    pendingCountEl.textContent = `${data.pendingBufferCount || 0} offline captures`;

    // Sync Status
    if (data.pendingBufferCount > 0) {
      syncStatusEl.textContent = 'Buffering...';
      syncStatusEl.className = 'stat-value font-mono';
      syncStatusEl.style.color = '#f59e0b';
    } else {
      syncStatusEl.textContent = 'Synchronized';
      syncStatusEl.className = 'stat-value text-green';
      syncStatusEl.style.color = '#10b981';
    }

    // Break State
    if (data.isOnBreak !== undefined && data.isOnBreak !== isOnBreak) {
      updateBreakUI(data.isOnBreak);
    }

    // Handle Admin Notifications / Broadcasts
    if (data.notification && data.notification.id && data.notification.id !== window.lastNotifId) {
      window.lastNotifId = data.notification.id;
      showEmployeeToast(data.notification.title, data.notification.message);
    }

    // Policies
    if (data.policy && Array.isArray(data.policy.allowed_apps) && data.policy.allowed_apps.length > 0) {
      allowedAppsList.innerHTML = data.policy.allowed_apps.map(app => `<span class="tag">${app}</span>`).join('');
    }
    if (data.policy && Array.isArray(data.policy.allowed_domains) && data.policy.allowed_domains.length > 0) {
      allowedDomainsList.innerHTML = data.policy.allowed_domains.map(d => `<span class="tag">${d}</span>`).join('');
    }

  } catch (err) {
    statusDot.className = 'status-dot offline';
    connText.textContent = 'Disconnected';
    connBadge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    connBadge.style.color = '#ef4444';
  }
}

function showEmployeeToast(title, msg) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #0f172a; color: #ffffff; padding: 14px 24px; border-radius: 9999px; box-shadow: 0 10px 30px rgba(0,0,0,0.35); font-size: 13px; font-weight: 700; z-index: 99999; display: flex; align-items: center; gap: 10px; border: 1px solid rgba(255,255,255,0.15); animation: toastPop 0.3s cubic-bezier(0.16, 1, 0.3, 1);';
  toast.innerHTML = `<span>💬 <strong>${title || 'Manager Notice'}:</strong> ${msg}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 6000);
}

// Break Mode Toggle
function updateBreakUI(onBreak) {
  isOnBreak = onBreak;
  if (isOnBreak) {
    breakBtn.classList.add('on-break');
    breakBtnText.textContent = 'Resume Work';
    workStateBadgeEl.className = 'badge-break';
    workStateBadgeEl.textContent = '☕ On Break (Capture Suspended)';
  } else {
    breakBtn.classList.remove('on-break');
    breakBtnText.textContent = 'Take Break (Pause)';
    workStateBadgeEl.className = 'badge-active';
    workStateBadgeEl.textContent = '🟢 Working (Monitoring Active)';
  }
}

breakBtn.addEventListener('click', async () => {
  try {
    const newState = !isOnBreak;
    const res = await fetch('/api/break', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onBreak: newState })
    });
    const result = await res.json();
    updateBreakUI(result.onBreak);
  } catch (e) {
    console.error('Failed to toggle break:', e);
  }
});

// Manual Sync Now
btnSyncNow.addEventListener('click', async () => {
  btnSyncNow.textContent = 'Syncing...';
  try {
    await fetch('/api/sync-now', { method: 'POST' });
    setTimeout(() => {
      btnSyncNow.textContent = 'Sync Now';
      fetchClientStatus();
    }, 1000);
  } catch (e) {
    btnSyncNow.textContent = 'Sync Now';
  }
});

// Rules Modal
btnOpenRules.addEventListener('click', () => policyModal.classList.add('active'));
btnCloseRules.addEventListener('click', () => policyModal.classList.remove('active'));
btnCloseRulesBottom.addEventListener('click', () => policyModal.classList.remove('active'));

// Initial Fetch & Interval
checkEmployeeProfile();
fetchClientStatus();
setInterval(fetchClientStatus, 2000);

