const WebSocket = require('ws');
const config = require('./config');
const captureEngine = require('./capture_engine');
const liveStreamer = require('./live_streamer');
const appController = require('./app_controller');
const webController = require('./web_controller');
const offlineQueue = require('./offline_queue');
const autoDiscovery = require('./auto_discovery');
const ClientUIServer = require('./ui_server');
const updater = require('./updater');
const { getActiveWindowInfo } = require('./system_info');

console.log(`=======================================================`);
console.log(`🛡️  WorkGuard Secure Client Agent Initializing...`);
console.log(`💻 Client ID:   ${config.CLIENT_ID}`);
console.log(`🖥️  Host / User: ${config.HOSTNAME} (${config.USERNAME})`);
console.log(`🏷️  Version:     v${config.AGENT_VERSION}`);
console.log(`📡 Server URL:  ${config.SERVER_HTTP_URL} (Auto-discovery: ${config.AUTO_DISCOVER ? 'ON' : 'OFF'})`);
console.log(`🔐 PSK Token:   ${config.AUTH_TOKEN ? 'Configured (Active)' : 'Missing'}`);
console.log(`🖥️  Employee UI: ${config.ENABLE_UI ? 'Enabled' : 'Disabled (Stealth)'}`);
console.log(`=======================================================`);

// Local active policy state
let currentPolicy = {
  allowed_apps: [],
  allowed_domains: [],
  sensitive_apps: [
    '1password.exe', 'bitwarden.exe', 'keepass.exe', 'lastpass.exe',
    'authy.exe', 'nordpass.exe', 'kdbx.exe', 'authenticator.exe'
  ],
  sensitive_keywords: [
    'password', 'bitwarden', '1password', 'keepass', 'bank',
    'banking', 'netbanking', 'credit card', 'debit card', 'checkout',
    'paypal', 'medical portal', 'hsa', 'mychart'
  ],
  pause_on_sensitive: true,
  work_hours_start: '00:00',
  work_hours_end: '23:59',
  capture_interval_sec: config.DEFAULT_CAPTURE_INTERVAL_SEC,
  policy_mode: 'audit-alert'
};

let ws = null;
let captureTimer = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let isConnecting = false;
let isEmployeeOnBreak = false;
let isPrivacyPaused = false;
let lastSysInfo = { processName: 'Idle', windowTitle: 'Desktop', cpuUsage: 0, ramUsage: 0 };

function isWithinWorkHours() {
  if (isEmployeeOnBreak) {
    return false; // Break mode suspends monitoring
  }
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = (currentPolicy.work_hours_start || '00:00').split(':').map(Number);
  const [endH, endM] = (currentPolicy.work_hours_end || '23:59').split(':').map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    // Crosses midnight
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
}

/**
 * Checks whether the current active window or application is sensitive (e.g. Password Manager, Banking).
 * If sensitive and policy allows, captures are automatically paused for privacy and compliance.
 */
function isSensitiveActivity(processName, windowTitle) {
  if (!currentPolicy.pause_on_sensitive) return false;

  const proc = (processName || '').toLowerCase();
  const win = (windowTitle || '').toLowerCase();

  // 1. Check sensitive executable names
  const sensitiveApps = currentPolicy.sensitive_apps || [];
  const matchesApp = sensitiveApps.some(app => proc === app.toLowerCase() || proc.includes(app.toLowerCase().replace('.exe', '')));
  if (matchesApp) return true;

  // 2. Check sensitive title keywords
  const sensitiveKeywords = currentPolicy.sensitive_keywords || [];
  const matchesKeyword = sensitiveKeywords.some(keyword => win.includes(keyword.toLowerCase()));
  return matchesKeyword;
}

function connectToServer() {
  if (isConnecting) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  isConnecting = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  console.log(`[Network] Connecting to secure WebSocket: ${config.SERVER_WS_URL}...`);
  try {
    ws = new WebSocket(config.SERVER_WS_URL);
  } catch (e) {
    console.error('[Network] Connection initiation failed:', e.message);
    isConnecting = false;
    scheduleReconnect();
    return;
  }

  liveStreamer.setWebSocket(ws);

  ws.on('open', async () => {
    isConnecting = false;
    console.log('[Network] ✅ Connected to monitoring server.');

    // Fetch initial system state
    const sys = await getActiveWindowInfo();

    // Register with server, including Pre-Shared Secret Key
    ws.send(JSON.stringify({
      type: 'AGENT_REGISTER',
      client_id: config.CLIENT_ID,
      auth_token: config.AUTH_TOKEN,
      hostname: config.HOSTNAME,
      username: config.USERNAME,
      employee_name: config.EMPLOYEE_NAME,
      department: config.DEPARTMENT,
      os: config.OS_TYPE,
      agent_version: config.AGENT_VERSION,
      current_app: sys.processName,
      current_window: sys.windowTitle,
      cpu_usage: sys.cpuUsage,
      ram_usage: sys.ramUsage
    }));

    // Trigger flush of any offline queued captures
    offlineQueue.flushQueue();
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      switch (msg.type) {
        case 'REGISTER_OK':
          if (msg.policy) {
            currentPolicy = { ...currentPolicy, ...msg.policy };
            console.log(`[Policy] Updated: Interval=${currentPolicy.capture_interval_sec}s, Mode=${currentPolicy.policy_mode}, SensitiveShield=${currentPolicy.pause_on_sensitive ? 'Active' : 'Disabled'}`);
            resetCaptureTimer();
          }
          if (msg.update_available && msg.auto_update_enabled && msg.latest_version) {
            console.log(`[AutoUpdate] 🚀 Server indicated update available: v${config.AGENT_VERSION} -> v${msg.latest_version}. Initiating auto-upgrade...`);
            updater.handleOTAUpdate({
              version: msg.latest_version,
              download_url: '/api/updates/download/latest',
              force: true
            }, ws);
          }
          break;

        case 'POLICY_UPDATE':
          if (msg.policy) {
            currentPolicy = { ...currentPolicy, ...msg.policy };
            console.log(`[Policy] Updated: Interval=${currentPolicy.capture_interval_sec}s, Mode=${currentPolicy.policy_mode}, SensitiveShield=${currentPolicy.pause_on_sensitive ? 'Active' : 'Disabled'}`);
            resetCaptureTimer();
          }
          break;

        case 'AUTH_FAILED':
          console.error(`[Security] 🚫 Server rejected authentication: ${msg.error}. Check client auth_token in config.json.`);
          break;

        case 'OTA_UPDATE_COMMAND':
          updater.handleOTAUpdate(msg, ws);
          break;

        case 'UPDATE_EMPLOYEE_PROFILE':
          if (msg.employee_name || msg.department) {
            config.setProfile(msg.employee_name, msg.department);
            console.log(`[Agent] Profile updated remotely: Name="${config.EMPLOYEE_NAME}", Department="${config.DEPARTMENT}"`);
          }
          break;

        case 'START_STREAMING':
          if (isWithinWorkHours() && !isPrivacyPaused) {
            liveStreamer.startStreaming({
              fps: msg.fps || 15,
              quality: msg.quality || 70
            });
          }
          break;

        case 'STOP_STREAMING':
          liveStreamer.stopStreaming();
          break;

        case 'CAPTURE_INSTANT_SCREENSHOT':
          await takeSilentScreenshot();
          break;

        case 'ADMIN_NOTIFICATION':
          console.log(`[Admin Notice] ${msg.title}: ${msg.message}`);
          if (clientUI) {
            clientUI.broadcastNotification(msg.message, msg.title);
          }
          break;

        default:
          break;
      }
    } catch (e) {
      console.error('[Network] Message parse error:', e.message);
    }
  });

  ws.on('close', (code, reason) => {
    isConnecting = false;
    if (code === 4001) {
      console.error('[Security] 🚫 Disconnected: Authentication failed with server (Code 4001).');
    } else {
      console.log('[Network] ⚠️ Connection closed. Reconnecting in 5s...');
    }
    liveStreamer.stopStreaming();
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    isConnecting = false;
    console.error('[Network] WS Error:', err.message);
  });
}

function scheduleReconnect(delay = 5000) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectToServer();
  }, delay);
}

// Auto-Discovery Listener
if (config.AUTO_DISCOVER) {
  autoDiscovery.on('discovered', (serverInfo) => {
    console.log(`[Network] 🔄 Auto-Discovery verified: Switching to ${serverInfo.httpUrl}`);
    config.setServerEndpoint(serverInfo.host, serverInfo.port);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (ws) {
        try { ws.terminate(); } catch (e) {}
      }
      isConnecting = false;
      connectToServer();
    }
  });

  autoDiscovery.start();
}

/**
 * Captures a silent screenshot and hands it to the offline queue.
 * Respects work hours and pauses for sensitive applications (Privacy Shield).
 */
async function takeSilentScreenshot() {
  if (!isWithinWorkHours()) {
    return;
  }

  try {
    const sys = await getActiveWindowInfo();

    // Check Privacy Shield
    if (isSensitiveActivity(sys.processName, sys.windowTitle)) {
      console.log(`[Privacy Shield] 🛡️ Sensitive window in focus ('${sys.windowTitle}'). Screenshot capture paused.`);
      return;
    }

    const imageBuffer = await captureEngine.captureScreen();

    if (imageBuffer) {
      const metadata = {
        client_id: config.CLIENT_ID,
        active_app: sys.processName,
        active_window: sys.windowTitle,
        timestamp: new Date().toISOString()
      };

      // Upload or buffer locally if offline
      await offlineQueue.enqueueAndUpload(imageBuffer, metadata);
    }
  } catch (err) {
    console.error('[Capture] Error during silent capture:', err.message);
  }
}

function resetCaptureTimer() {
  if (captureTimer) clearInterval(captureTimer);
  const intervalMs = Math.max(5, currentPolicy.capture_interval_sec || config.DEFAULT_CAPTURE_INTERVAL_SEC) * 1000;
  
  captureTimer = setInterval(() => {
    takeSilentScreenshot();
  }, intervalMs);
}

// Background evaluation loop: heartbeats, privacy checks, process/website whitelisting
function startMonitoringLoop() {
  heartbeatTimer = setInterval(async () => {
    try {
      const sys = await getActiveWindowInfo();
      lastSysInfo = sys;

      const isSensitive = isSensitiveActivity(sys.processName, sys.windowTitle);
      isPrivacyPaused = isSensitive;

      // 1. Send Heartbeat to server if connected
      if (ws && ws.readyState === WebSocket.OPEN) {
        let displayApp = sys.processName;
        let displayWin = sys.windowTitle;

        if (isEmployeeOnBreak) {
          displayApp = '☕ On Break';
          displayWin = 'Break Mode Active';
        } else if (isSensitive) {
          displayApp = '🛡️ Privacy Shield';
          displayWin = 'Sensitive App in Focus (Masked)';
        }

        ws.send(JSON.stringify({
          type: 'AGENT_HEARTBEAT',
          current_app: displayApp,
          current_window: displayWin,
          cpu_usage: sys.cpuUsage,
          ram_usage: sys.ramUsage,
          is_privacy_paused: isSensitive
        }));
      }

      // 2. Evaluate Application Whitelist
      if (isWithinWorkHours() && !isSensitive) {
        appController.evaluateProcess(sys.processName, sys.windowTitle, currentPolicy, (violation) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'AGENT_LOG',
              event_type: violation.event_type,
              details: violation.details
            }));
          }
        });

        // 3. Evaluate Website Whitelist
        webController.evaluateWebActivity(sys.processName, sys.windowTitle, currentPolicy, (violation) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'AGENT_LOG',
              event_type: violation.event_type,
              details: violation.details
            }));
          }
        });
      }
    } catch (e) {
      console.error('[Monitor] Loop error:', e.message);
    }
  }, 3000);
}

function setBreakMode(onBreak) {
  isEmployeeOnBreak = onBreak;
  console.log(`[Agent] Employee Break Mode: ${onBreak ? '☕ ON (Monitoring Suspended)' : '🟢 OFF (Active)'}`);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'AGENT_LOG',
      event_type: onBreak ? 'BREAK_STARTED' : 'BREAK_ENDED',
      details: `Employee ${config.USERNAME} ${onBreak ? 'paused work for a break' : 'resumed work'}`
    }));
  }
}

function getProfile() {
  return {
    employee_name: config.EMPLOYEE_NAME,
    department: config.DEPARTMENT,
    is_configured: !!(config.EMPLOYEE_NAME && config.EMPLOYEE_NAME !== config.USERNAME)
  };
}

function saveProfile(name, dept) {
  config.setProfile(name, dept);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'AGENT_PROFILE_UPDATE',
      employee_name: config.EMPLOYEE_NAME,
      department: config.DEPARTMENT
    }));
  }
  return getProfile();
}

function getLiveStatus() {
  return {
    isConnected: ws && ws.readyState === WebSocket.OPEN,
    clientId: config.CLIENT_ID,
    hostname: config.HOSTNAME,
    username: config.USERNAME,
    employeeName: config.EMPLOYEE_NAME,
    department: config.DEPARTMENT,
    serverUrl: config.SERVER_HTTP_URL,
    currentApp: isEmployeeOnBreak ? '☕ On Break' : (isPrivacyPaused ? '🛡️ Privacy Shield' : (lastSysInfo.processName || 'Desktop')),
    currentWindow: isEmployeeOnBreak ? 'Break Mode (Capture Paused)' : (isPrivacyPaused ? 'Sensitive App Focused' : (lastSysInfo.windowTitle || 'Idle')),
    pendingBufferCount: offlineQueue.getPendingCount(),
    policy: currentPolicy,
    isOnBreak: isEmployeeOnBreak,
    isPrivacyPaused: isPrivacyPaused
  };
}

// Start Client UI Server if enabled
let clientUI = null;
if (config.ENABLE_UI) {
  clientUI = new ClientUIServer({
    getLiveStatus,
    setBreakMode,
    getProfile,
    saveProfile,
    flushOfflineQueue: () => offlineQueue.flushQueue()
  });

  clientUI.start().then(() => {
    // Open UI automatically if requested
    if (process.argv.includes('--open-ui') || process.argv.includes('--ui')) {
      clientUI.openWindow();
    }
  });
}

// Initialize Agent
connectToServer();
resetCaptureTimer();
startMonitoringLoop();

// Initial immediate screenshot
setTimeout(takeSilentScreenshot, 2000);
